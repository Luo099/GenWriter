package com.example.genwriter.event.listener;

import com.example.genwriter.agent.graph.runner.StateGraphRunner;
import com.example.genwriter.event.ChatEvent;
import com.example.genwriter.message.AgentTraceEvent;
import com.example.genwriter.observability.RunContext;
import com.example.genwriter.observability.RunContextHolder;
import com.example.genwriter.service.ObservabilityService;
import com.example.genwriter.service.TitleGenerationService;
import lombok.extern.slf4j.Slf4j;
import org.springframework.context.event.EventListener;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Component;

import java.util.Map;

@Slf4j
@Component
public class ChatEventListener {

    private final StateGraphRunner stateGraphRunner;
    private final TitleGenerationService titleGenerationService;
    private final ObservabilityService observabilityService;

    public ChatEventListener(StateGraphRunner stateGraphRunner,
                             TitleGenerationService titleGenerationService,
                             ObservabilityService observabilityService) {
        this.stateGraphRunner = stateGraphRunner;
        this.titleGenerationService = titleGenerationService;
        this.observabilityService = observabilityService;
    }

    @Async("taskExecutor")
    @EventListener
    public void handle(ChatEvent event) {
        String writingType = event.getType() != null ? event.getType().name() : "AUTO";
        RunContext runContext = RunContext.create(event.getSessionId(), writingType, event.isWebSearch(), event.getKbId());
        RunContextHolder.set(runContext);
        long startedAt = System.currentTimeMillis();

        observabilityService.recordTraceEvent(event.getSessionId(), AgentTraceEvent.builder()
                .traceId(event.getSessionId())
                .runId(runContext.runId())
                .eventId("evt-root-start-" + runContext.runId())
                .spanId(runContext.rootSpanId())
                .kind(AgentTraceEvent.Kind.SUPERVISOR.name())
                .phase(AgentTraceEvent.Phase.STARTED.name())
                .name("AI run")
                .summary("AI run started")
                .metadata(Map.of(
                        "writingType", writingType,
                        "webSearch", event.isWebSearch(),
                        "kbId", event.getKbId() != null ? event.getKbId() : ""
                ))
                .inputChars(event.getUserInputText() != null ? event.getUserInputText().length() : 0)
                .startedAt(startedAt)
                .timestamp(startedAt)
                .build());

        log.info("Chat event received: sessionId={}, type={}, documentId={}, runId={}",
                event.getSessionId(), event.getType(), event.getDocumentId(), runContext.runId());

        try {
            titleGenerationService.generateAndSetTitle(event.getSessionId(), event.getUserInputText());
            stateGraphRunner.run(
                    event.getSessionId(),
                    event.getDocumentId(),
                    event.getUserInput(),
                    event.getKbId(),
                    writingType,
                    event.isWebSearch()
            );

            long endedAt = System.currentTimeMillis();
            observabilityService.recordTraceEvent(event.getSessionId(), AgentTraceEvent.builder()
                    .traceId(event.getSessionId())
                    .runId(runContext.runId())
                    .eventId("evt-root-complete-" + runContext.runId())
                    .spanId(runContext.rootSpanId())
                    .kind(AgentTraceEvent.Kind.SUPERVISOR.name())
                    .phase(AgentTraceEvent.Phase.COMPLETED.name())
                    .name("AI run")
                    .summary("AI run completed")
                    .status("OK")
                    .startedAt(startedAt)
                    .endedAt(endedAt)
                    .durationMs(endedAt - startedAt)
                    .timestamp(endedAt)
                    .build());
            log.info("Supervisor completed: sessionId={}, runId={}", event.getSessionId(), runContext.runId());
        } catch (Exception e) {
            long endedAt = System.currentTimeMillis();
            observabilityService.recordTraceEvent(event.getSessionId(), AgentTraceEvent.builder()
                    .traceId(event.getSessionId())
                    .runId(runContext.runId())
                    .eventId("evt-root-error-" + runContext.runId())
                    .spanId(runContext.rootSpanId())
                    .kind(AgentTraceEvent.Kind.ERROR.name())
                    .phase(AgentTraceEvent.Phase.ERROR.name())
                    .name("AI run")
                    .summary("AI run failed")
                    .status("ERROR")
                    .errorCode(e.getClass().getSimpleName())
                    .error(e.getMessage())
                    .startedAt(startedAt)
                    .endedAt(endedAt)
                    .durationMs(endedAt - startedAt)
                    .timestamp(endedAt)
                    .build());
            log.error("Supervisor failed: sessionId={}, runId={}, error={}",
                    event.getSessionId(), runContext.runId(), e.getMessage(), e);
        } finally {
            RunContextHolder.clear();
        }
    }
}
