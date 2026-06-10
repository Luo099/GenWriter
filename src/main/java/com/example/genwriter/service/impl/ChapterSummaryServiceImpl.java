package com.example.genwriter.service.impl;

import com.example.genwriter.agent.chatclient.ChatClientFactory;
import com.example.genwriter.agent.supervisor.SupervisorModeProperties;
import com.example.genwriter.service.ChapterSummaryService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.ai.chat.client.ChatClient;
import org.springframework.stereotype.Service;

import java.util.concurrent.CompletableFuture;
import java.util.concurrent.TimeUnit;

@Slf4j
@Service
@RequiredArgsConstructor
public class ChapterSummaryServiceImpl implements ChapterSummaryService {

    private final ChatClientFactory chatClientFactory;
    private final SupervisorModeProperties supervisorProperties;

    @Override
    public String summarize(String userInput, String finalOutput, String writingType) {
        SupervisorModeProperties.ChapterContext properties = supervisorProperties.getChapterContext();
        if (!properties.isEnabled() || finalOutput == null || finalOutput.isBlank()) {
            return "";
        }

        try {
            ChatClient client = chatClientFactory.create(properties.getTemperature());
            String systemPrompt = """
                    You are a continuity summarizer for long-form Chinese fiction.
                    Based only on the provided chapter, summarize the established narrative state.
                    Do not invent new setting facts, judge quality, or add instructions.
                    Output one concise Chinese paragraph without markdown, lists, titles, or numbering.
                    Cover what happened, key facts, character/object states, unresolved items, and the next-chapter handoff point.
                    """;
            String userPrompt = """
                    User chapter request:
                    %s

                    Writing type:
                    %s

                    Chapter content:
                    %s
                    """.formatted(safe(userInput), safe(writingType), finalOutput);

            int timeoutSeconds = Math.max(1, properties.getTimeoutSeconds());
            String summary = CompletableFuture.supplyAsync(() -> client.prompt()
                            .system(systemPrompt)
                            .user(userPrompt)
                            .call()
                            .content())
                    .get(timeoutSeconds, TimeUnit.SECONDS);
            return truncate(clean(summary), properties.getMaxSummaryChars());
        } catch (Exception e) {
            log.warn("Chapter summary generation degraded; final content will be saved without continuity summary: {}",
                    e.getMessage());
            return "";
        }
    }

    private String clean(String value) {
        if (value == null) {
            return "";
        }
        return value.replaceAll("\\s+", " ").trim();
    }

    private String safe(String value) {
        return value != null ? value : "";
    }

    private String truncate(String value, int maxLength) {
        if (value == null || value.isBlank()) {
            return "";
        }
        int limit = Math.max(1, maxLength);
        return value.length() <= limit ? value : value.substring(0, limit);
    }
}
