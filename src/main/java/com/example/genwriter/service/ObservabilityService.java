package com.example.genwriter.service;

import com.example.genwriter.message.AgentTraceEvent;
import com.example.genwriter.model.dto.response.ObservabilityDashboardDTO;
import com.example.genwriter.model.dto.response.ObservabilityRunDetailDTO;

import java.util.List;

public interface ObservabilityService {
    void recordTraceEvent(String sessionId, AgentTraceEvent event);
    ObservabilityDashboardDTO dashboard(int limit);
    ObservabilityRunDetailDTO runDetail(String runId);
    List<AgentTraceEvent> sessionEvents(String sessionId, int limit);
}
