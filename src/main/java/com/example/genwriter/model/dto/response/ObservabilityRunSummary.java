package com.example.genwriter.model.dto.response;

import lombok.Builder;
import lombok.Data;

import java.time.OffsetDateTime;

@Data
@Builder
public class ObservabilityRunSummary {
    private String runId;
    private String sessionId;
    private String lastPhase;
    private String lastStatus;
    private String lastKind;
    private String lastName;
    private String provider;
    private String model;
    private Long durationMs;
    private String error;
    private OffsetDateTime updatedAt;
}
