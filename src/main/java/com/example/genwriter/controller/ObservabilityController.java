package com.example.genwriter.controller;

import com.example.genwriter.message.AgentTraceEvent;
import com.example.genwriter.model.common.ApiResponse;
import com.example.genwriter.model.dto.response.ObservabilityDashboardDTO;
import com.example.genwriter.model.dto.response.ObservabilityRunDetailDTO;
import com.example.genwriter.service.ObservabilityService;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequestMapping("/api/observability")
@RequiredArgsConstructor
public class ObservabilityController {

    private final ObservabilityService observabilityService;

    @GetMapping
    public ApiResponse<ObservabilityDashboardDTO> dashboard(
            @RequestParam(defaultValue = "50") int limit) {
        return ApiResponse.success(observabilityService.dashboard(limit));
    }

    @GetMapping("/runs/{runId}")
    public ApiResponse<ObservabilityRunDetailDTO> runDetail(@PathVariable String runId) {
        return ApiResponse.success(observabilityService.runDetail(runId));
    }

    @GetMapping("/sessions/{sessionId}/events")
    public ApiResponse<List<AgentTraceEvent>> sessionEvents(
            @PathVariable String sessionId,
            @RequestParam(defaultValue = "200") int limit) {
        return ApiResponse.success(observabilityService.sessionEvents(sessionId, limit));
    }
}
