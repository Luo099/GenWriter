package com.example.genwriter.model.dto.response;

import com.example.genwriter.message.AgentTraceEvent;
import lombok.Builder;
import lombok.Data;

import java.util.List;

@Data
@Builder
public class ObservabilityRunDetailDTO {
    private String runId;
    private String sessionId;
    private Long totalDurationMs;
    private String status;
    private List<AgentTraceEvent> events;
}
