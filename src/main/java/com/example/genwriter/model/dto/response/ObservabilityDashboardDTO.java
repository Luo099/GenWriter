package com.example.genwriter.model.dto.response;

import com.example.genwriter.message.AgentTraceEvent;
import lombok.Builder;
import lombok.Data;

import java.util.List;

@Data
@Builder
public class ObservabilityDashboardDTO {
    private ObservabilityHealthDTO health;
    private List<ObservabilityRunSummary> runs;
    private List<AgentTraceEvent> recentErrors;
}
