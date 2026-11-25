package com.example.genwriter.service.impl;

import com.example.genwriter.mapper.AiTraceEventMapper;
import com.example.genwriter.message.AgentTraceEvent;
import com.example.genwriter.model.dto.response.ObservabilityDashboardDTO;
import com.example.genwriter.model.dto.response.ObservabilityHealthDTO;
import com.example.genwriter.model.dto.response.ObservabilityRunDetailDTO;
import com.example.genwriter.model.dto.response.ObservabilityRunSummary;
import com.example.genwriter.model.entity.AiTraceEventEntity;
import com.example.genwriter.observability.ObservabilityProperties;
import com.example.genwriter.observability.ObservabilitySanitizer;
import com.example.genwriter.observability.RunContextHolder;
import com.example.genwriter.service.ObservabilityService;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.micrometer.core.instrument.Counter;
import io.micrometer.core.instrument.MeterRegistry;
import io.micrometer.core.instrument.Timer;
import lombok.extern.slf4j.Slf4j;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

import java.math.BigDecimal;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Map;
import java.util.Objects;

@Slf4j
@Service
public class ObservabilityServiceImpl implements ObservabilityService {

    private final AiTraceEventMapper mapper;
    private final ObjectMapper objectMapper;
    private final ObservabilityProperties properties;
    private final ObservabilitySanitizer sanitizer;
    private final MeterRegistry meterRegistry;

    public ObservabilityServiceImpl(AiTraceEventMapper mapper,
                                    ObjectMapper objectMapper,
                                    ObservabilityProperties properties,
                                    ObservabilitySanitizer sanitizer,
                                    MeterRegistry meterRegistry) {
        this.mapper = mapper;
        this.objectMapper = objectMapper;
        this.properties = properties;
        this.sanitizer = sanitizer;
        this.meterRegistry = meterRegistry;
    }

    @Override
    public void recordTraceEvent(String sessionId, AgentTraceEvent event) {
        if (!properties.isEnabled() || event == null) {
            return;
        }
        enrichEvent(sessionId, event);
        recordMetrics(event);
        if (!properties.isTracePersistenceEnabled() || !Boolean.TRUE.equals(event.getSampled())) {
            return;
        }
        try {
            mapper.insertEvent(toEntity(sessionId, event));
        } catch (Exception e) {
            log.debug("AI trace persistence failed: runId={}, eventId={}, error={}",
                    event.getRunId(), event.getEventId(), e.getMessage());
        }
    }

    @Override
    public ObservabilityDashboardDTO dashboard(int limit) {
        int safeLimit = Math.max(1, Math.min(limit, 200));
        OffsetDateTime since = OffsetDateTime.now(ZoneOffset.UTC).minusHours(1);
        long total = mapper.countSince(since);
        long errors = mapper.countErrorsSince(since);
        double errorRate = total == 0 ? 0 : (errors * 100.0 / total);
        double avgDuration = mapper.avgDurationSince(since);
        String healthStatus = errorRate > 5 ? "critical" : errorRate > 1 ? "warning" : "healthy";
        return ObservabilityDashboardDTO.builder()
                .health(ObservabilityHealthDTO.builder()
                        .eventsLastHour(total)
                        .errorsLastHour(errors)
                        .errorRatePercent(errorRate)
                        .avgDurationMs(avgDuration)
                        .status(healthStatus)
                        .build())
                .runs(mapper.selectRecentRuns(safeLimit).stream().map(this::toRunSummary).toList())
                .recentErrors(mapper.selectRecent(safeLimit).stream()
                        .filter(e -> "ERROR".equals(e.getPhase()) || "ERROR".equals(e.getStatus()))
                        .map(this::toEvent)
                        .toList())
                .build();
    }

    @Override
    public ObservabilityRunDetailDTO runDetail(String runId) {
        List<AgentTraceEvent> events = mapper.selectByRunId(runId).stream().map(this::toEvent).toList();
        String sessionId = events.stream()
                .map(AgentTraceEvent::getTraceId)
                .filter(Objects::nonNull)
                .findFirst()
                .orElse(null);
        long totalDuration = events.stream()
                .map(AgentTraceEvent::getDurationMs)
                .filter(Objects::nonNull)
                .mapToLong(Long::longValue)
                .max()
                .orElse(0);
        String status = events.stream().anyMatch(e -> "ERROR".equals(e.getPhase()) || "ERROR".equals(e.getStatus()))
                ? "ERROR" : "OK";
        return ObservabilityRunDetailDTO.builder()
                .runId(runId)
                .sessionId(sessionId)
                .totalDurationMs(totalDuration)
                .status(status)
                .events(events)
                .build();
    }

    @Override
    public List<AgentTraceEvent> sessionEvents(String sessionId, int limit) {
        int safeLimit = Math.max(1, Math.min(limit, 500));
        return mapper.selectBySessionId(sessionId, safeLimit).stream().map(this::toEvent).toList();
    }

    @Scheduled(cron = "0 30 3 * * *")
    public void cleanupOldTraceEvents() {
        if (!properties.isTracePersistenceEnabled() || properties.getRetentionDays() <= 0) {
            return;
        }
        OffsetDateTime cutoff = OffsetDateTime.now(ZoneOffset.UTC).minusDays(properties.getRetentionDays());
        try {
            int deleted = mapper.deleteBefore(cutoff);
            if (deleted > 0) {
                log.info("Cleaned old AI trace events: deleted={}, cutoff={}", deleted, cutoff);
            }
        } catch (Exception e) {
            log.debug("AI trace cleanup failed: {}", e.getMessage());
        }
    }

    private void enrichEvent(String sessionId, AgentTraceEvent event) {
        event.setRunId(event.getRunId() != null ? event.getRunId() : RunContextHolder.runIdOr(event.getTraceId()));
        event.setTraceId(event.getTraceId() != null ? event.getTraceId() : sessionId);
        event.setSampled(event.getSampled() != null ? event.getSampled() : shouldSample(event));
        if (event.getStatus() == null) {
            event.setStatus("ERROR".equals(event.getPhase()) ? "ERROR" : "OK");
        }
    }

    private boolean shouldSample(AgentTraceEvent event) {
        if ("ERROR".equals(event.getPhase()) || "ERROR".equals(event.getStatus())) {
            return true;
        }
        double rate = properties.getSuccessSampleRate();
        if (rate >= 1.0) {
            return true;
        }
        if (rate <= 0) {
            return false;
        }
        String key = event.getRunId() != null ? event.getRunId() : event.getTraceId();
        int bucket = Math.floorMod(key != null ? key.hashCode() : 0, 10_000);
        return bucket < (int) Math.round(rate * 10_000);
    }

    private void recordMetrics(AgentTraceEvent event) {
        if (!properties.isMetricsEnabled()) {
            return;
        }
        String kind = safeTag(event.getKind());
        String phase = safeTag(event.getPhase());
        String status = safeTag(event.getStatus());
        Counter.builder("genwriter_ai_trace_events_total")
                .tag("kind", kind)
                .tag("phase", phase)
                .tag("status", status)
                .register(meterRegistry)
                .increment();
        if (event.getDurationMs() != null && event.getDurationMs() >= 0) {
            Timer.builder("genwriter_ai_span_duration")
                    .tag("kind", kind)
                    .tag("name", safeTag(event.getName()))
                    .tag("status", status)
                    .publishPercentileHistogram()
                    .register(meterRegistry)
                    .record(java.time.Duration.ofMillis(event.getDurationMs()));
        }
        if (event.getTokenUsage() != null && !event.getTokenUsage().isEmpty()) {
            Object total = event.getTokenUsage().get("total");
            if (total instanceof Number number) {
                Counter.builder("genwriter_ai_tokens_total")
                        .tag("provider", safeTag(event.getProvider()))
                        .tag("model", safeTag(event.getModel()))
                        .register(meterRegistry)
                        .increment(number.doubleValue());
            }
        }
    }

    private AiTraceEventEntity toEntity(String sessionId, AgentTraceEvent event) {
        return AiTraceEventEntity.builder()
                .runId(value(event.getRunId()))
                .traceId(value(event.getTraceId()))
                .eventId(value(event.getEventId()))
                .sessionId(value(sessionId != null ? sessionId : event.getTraceId()))
                .spanId(value(event.getSpanId()))
                .parentSpanId(value(event.getParentSpanId()))
                .kind(value(event.getKind()))
                .phase(value(event.getPhase()))
                .name(value(event.getName()))
                .agentName(value(event.getAgentName()))
                .toolName(value(event.getToolName()))
                .provider(value(event.getProvider()))
                .model(value(event.getModel()))
                .summary((String) sanitizer.sanitize(event.getSummary(), properties.getTextSummaryLimit()))
                .inputSummary(json(sanitizer.sanitize(event.getInput(), properties.getTextSummaryLimit())))
                .outputSummary(json(sanitizer.sanitize(event.getOutput(), properties.getTextSummaryLimit())))
                .metadata(json(sanitizer.sanitize(event.getMetadata(), properties.getTextSummaryLimit())))
                .tokenUsage(json(event.getTokenUsage()))
                .costEstimate(event.getCostEstimate() != null ? BigDecimal.valueOf(event.getCostEstimate()) : null)
                .inputChars(event.getInputChars())
                .outputChars(event.getOutputChars())
                .status(value(event.getStatus()))
                .errorCode(value(event.getErrorCode()))
                .error(sanitizer.sanitizeError(event.getError(), properties.isIncludeErrorDetails()))
                .sampled(Boolean.TRUE.equals(event.getSampled()))
                .startedAt(toOffset(event.getStartedAt()))
                .endedAt(toOffset(event.getEndedAt()))
                .durationMs(event.getDurationMs())
                .eventTimestamp(toOffset(event.getTimestamp()))
                .createdAt(OffsetDateTime.now(ZoneOffset.UTC))
                .build();
    }

    private AgentTraceEvent toEvent(AiTraceEventEntity entity) {
        return AgentTraceEvent.builder()
                .runId(entity.getRunId())
                .traceId(entity.getTraceId())
                .eventId(entity.getEventId())
                .spanId(entity.getSpanId())
                .parentSpanId(entity.getParentSpanId())
                .kind(entity.getKind())
                .phase(entity.getPhase())
                .name(entity.getName())
                .agentName(entity.getAgentName())
                .toolName(entity.getToolName())
                .provider(entity.getProvider())
                .model(entity.getModel())
                .summary(entity.getSummary())
                .input(readJson(entity.getInputSummary()))
                .output(readJson(entity.getOutputSummary()))
                .metadata(readMap(entity.getMetadata()))
                .tokenUsage(readMap(entity.getTokenUsage()))
                .costEstimate(entity.getCostEstimate() != null ? entity.getCostEstimate().doubleValue() : null)
                .inputChars(entity.getInputChars())
                .outputChars(entity.getOutputChars())
                .status(entity.getStatus())
                .errorCode(entity.getErrorCode())
                .error(entity.getError())
                .sampled(entity.getSampled())
                .startedAt(toMillis(entity.getStartedAt()))
                .endedAt(toMillis(entity.getEndedAt()))
                .durationMs(entity.getDurationMs())
                .timestamp(toMillis(entity.getEventTimestamp()))
                .build();
    }

    private ObservabilityRunSummary toRunSummary(AiTraceEventEntity entity) {
        return ObservabilityRunSummary.builder()
                .runId(entity.getRunId())
                .sessionId(entity.getSessionId())
                .lastPhase(entity.getPhase())
                .lastStatus(entity.getStatus())
                .lastKind(entity.getKind())
                .lastName(entity.getName())
                .provider(entity.getProvider())
                .model(entity.getModel())
                .durationMs(entity.getDurationMs())
                .error(entity.getError())
                .updatedAt(entity.getCreatedAt())
                .build();
    }

    private String json(Object value) {
        try {
            Object safe = value == null ? Map.of() : value;
            return objectMapper.writeValueAsString(safe);
        } catch (Exception e) {
            return "{}";
        }
    }

    private Object readJson(String json) {
        if (json == null || json.isBlank()) {
            return null;
        }
        try {
            return objectMapper.readValue(json, Object.class);
        } catch (Exception e) {
            return json;
        }
    }

    private Map<String, Object> readMap(String json) {
        if (json == null || json.isBlank()) {
            return Map.of();
        }
        try {
            return objectMapper.readValue(json, new TypeReference<>() {});
        } catch (Exception e) {
            return Map.of();
        }
    }

    private OffsetDateTime toOffset(Long epochMillis) {
        if (epochMillis == null) {
            return null;
        }
        return OffsetDateTime.ofInstant(Instant.ofEpochMilli(epochMillis), ZoneOffset.UTC);
    }

    private Long toMillis(OffsetDateTime value) {
        return value == null ? null : value.toInstant().toEpochMilli();
    }

    private String value(String value) {
        return value == null ? "" : value;
    }

    private String safeTag(String value) {
        return value == null || value.isBlank() ? "unknown" : value;
    }
}
