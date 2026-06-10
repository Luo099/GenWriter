package com.example.genwriter.agent.streaming;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.micrometer.core.instrument.Counter;
import io.micrometer.core.instrument.MeterRegistry;
import io.micrometer.core.instrument.Timer;
import lombok.extern.slf4j.Slf4j;
import org.springframework.core.ParameterizedTypeReference;
import org.springframework.http.MediaType;
import org.springframework.http.codec.ServerSentEvent;
import org.springframework.stereotype.Component;
import org.springframework.web.reactive.function.client.WebClient;

import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

@Slf4j
@Component
public class ReasoningStreamingClient {

    private final ObjectMapper objectMapper;
    private final MeterRegistry meterRegistry;

    public ReasoningStreamingClient(ObjectMapper objectMapper, MeterRegistry meterRegistry) {
        this.objectMapper = objectMapper;
        this.meterRegistry = meterRegistry;
    }

    public record StreamingResult(String reasoningContent, String content) {}

    public interface ChunkCallback {
        void onReasoningChunk(String chunk);
        void onContentChunk(String chunk);
    }

    public StreamingResult stream(String baseUrl, String apiKey, String model,
                                  List<Map<String, String>> messages, double temperature,
                                  boolean enableThinking, ChunkCallback callback) {
        long startNanos = System.nanoTime();
        if (baseUrl == null || baseUrl.isBlank()) {
            recordStream(model, "config_error", startNanos);
            throw new IllegalStateException("base-url must be configured for reasoning streaming");
        }

        Map<String, Object> body = new java.util.LinkedHashMap<>();
        body.put("model", model);
        body.put("messages", messages);
        body.put("stream", true);
        body.put("temperature", temperature);
        if (enableThinking) {
            body.put("enable_thinking", true);
        }

        AtomicReference<StringBuilder> reasoningBuilder = new AtomicReference<>(new StringBuilder());
        AtomicReference<StringBuilder> contentBuilder = new AtomicReference<>(new StringBuilder());
        String finalBaseUrl = baseUrl.endsWith("/") ? baseUrl : baseUrl + "/";

        try {
            WebClient.builder()
                    .baseUrl(finalBaseUrl)
                    .build()
                    .post()
                    .uri("chat/completions")
                    .header("Authorization", "Bearer " + apiKey)
                    .contentType(MediaType.APPLICATION_JSON)
                    .bodyValue(body)
                    .retrieve()
                    .bodyToFlux(new ParameterizedTypeReference<ServerSentEvent<String>>() {})
                    .doOnNext(sse -> {
                        String data = sse.data();
                        if (data != null) {
                            parseLine("data:" + data, reasoningBuilder, contentBuilder, callback);
                        }
                    })
                    .doOnError(e -> log.warn("SSE streaming error: {}", e.getMessage()))
                    .blockLast(Duration.ofMinutes(10));
        } catch (Exception e) {
            recordStream(model, "error", startNanos);
            throw new IllegalStateException("Reasoning model streaming failed: " + e.getMessage(), e);
        }

        if (contentBuilder.get().isEmpty()) {
            recordStream(model, "empty", startNanos);
            throw new IllegalStateException("Reasoning model streaming returned no content");
        }

        recordStream(model, "success", startNanos);
        return new StreamingResult(reasoningBuilder.get().toString(), contentBuilder.get().toString());
    }

    private void parseLine(String line, AtomicReference<StringBuilder> reasoningBuilder,
                           AtomicReference<StringBuilder> contentBuilder, ChunkCallback callback) {
        if (line == null) return;
        String trimmed = line.trim();
        if (!trimmed.startsWith("data:")) return;
        String data = trimmed.substring(5).trim();
        if ("[DONE]".equals(data)) return;
        if (data.isEmpty()) return;

        try {
            JsonNode root = objectMapper.readTree(data);
            JsonNode delta = root.path("choices").path(0).path("delta");
            if (delta.isMissingNode()) return;

            JsonNode reasoningNode = delta.get("reasoning_content");
            if (reasoningNode != null && !reasoningNode.isNull()) {
                String reasoning = reasoningNode.asText("");
                if (!reasoning.isEmpty()) {
                    reasoningBuilder.get().append(reasoning);
                    callback.onReasoningChunk(reasoning);
                }
            }

            JsonNode contentNode = delta.get("content");
            if (contentNode != null && !contentNode.isNull()) {
                String content = contentNode.asText("");
                if (!content.isEmpty()) {
                    contentBuilder.get().append(content);
                    callback.onContentChunk(content);
                }
            }
        } catch (Exception e) {
            log.debug("Failed to parse SSE chunk: {}", e.getMessage());
        }
    }

    private void recordStream(String model, String status, long startNanos) {
        Counter.builder("genwriter_reasoning_stream_requests_total")
                .tag("model", safe(model))
                .tag("status", status)
                .register(meterRegistry)
                .increment();
        Timer.builder("genwriter_reasoning_stream_duration")
                .tag("model", safe(model))
                .tag("status", status)
                .publishPercentileHistogram()
                .register(meterRegistry)
                .record(System.nanoTime() - startNanos, TimeUnit.NANOSECONDS);
    }

    private String safe(String value) {
        return value == null || value.isBlank() ? "unknown" : value;
    }
}
