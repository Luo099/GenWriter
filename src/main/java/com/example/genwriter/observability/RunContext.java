package com.example.genwriter.observability;

import lombok.Builder;

import java.util.UUID;

@Builder
public record RunContext(
        String runId,
        String sessionId,
        String rootSpanId,
        String writingType,
        boolean webSearch,
        String kbId
) {

    public static RunContext create(String sessionId, String writingType, boolean webSearch, String kbId) {
        return RunContext.builder()
                .runId("run-" + UUID.randomUUID())
                .sessionId(sessionId)
                .rootSpanId("root-" + UUID.randomUUID().toString().substring(0, 12))
                .writingType(writingType)
                .webSearch(webSearch)
                .kbId(kbId)
                .build();
    }
}
