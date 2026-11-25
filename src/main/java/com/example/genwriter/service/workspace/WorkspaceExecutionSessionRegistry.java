package com.example.genwriter.service.workspace;

import com.example.genwriter.agent.tool.AgentToolSupport;
import com.example.genwriter.agent.tool.SessionContextHolder;
import org.springframework.ai.chat.model.ToolContext;
import org.springframework.stereotype.Component;

import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ConcurrentMap;

@Component
public class WorkspaceExecutionSessionRegistry {

    private final ConcurrentMap<String, WorkspaceExecutionSession> byRunId = new ConcurrentHashMap<>();
    private final ConcurrentMap<String, String> latestRunBySession = new ConcurrentHashMap<>();

    public void register(WorkspaceExecutionSession session) {
        if (session == null || session.getRunId() == null) return;
        byRunId.put(session.getRunId(), session);
        if (session.getSessionId() != null) {
            latestRunBySession.put(session.getSessionId(), session.getRunId());
        }
    }

    public void unregister(String runId) {
        if (runId == null) return;
        WorkspaceExecutionSession removed = byRunId.remove(runId);
        if (removed != null && removed.getSessionId() != null) {
            latestRunBySession.remove(removed.getSessionId(), runId);
        }
    }

    public WorkspaceExecutionSession resolve(ToolContext toolContext) {
        if (toolContext != null && toolContext.getContext() != null) {
            Map<String, Object> ctx = toolContext.getContext();
            Object runObj = ctx.get(AgentToolSupport.WORKSPACE_RUN_ID);
            if (runObj != null && !String.valueOf(runObj).isBlank()) {
                WorkspaceExecutionSession found = byRunId.get(String.valueOf(runObj));
                if (found != null) return found;
            }
            Object sessionObj = ctx.get(AgentToolSupport.SESSION_ID);
            if (sessionObj != null && !String.valueOf(sessionObj).isBlank()) {
                String runId = latestRunBySession.get(String.valueOf(sessionObj));
                if (runId != null) {
                    WorkspaceExecutionSession found = byRunId.get(runId);
                    if (found != null) return found;
                }
            }
        }
        String threadRunId = SessionContextHolder.getWorkspaceRunId();
        if (threadRunId != null && !threadRunId.isBlank()) {
            WorkspaceExecutionSession found = byRunId.get(threadRunId);
            if (found != null) return found;
        }
        String threadSessionId = SessionContextHolder.get();
        if (threadSessionId != null && !threadSessionId.isBlank()) {
            String runId = latestRunBySession.get(threadSessionId);
            if (runId != null) {
                return byRunId.get(runId);
            }
        }
        return null;
    }

    public WorkspaceExecutionSession getByRunId(String runId) {
        return runId == null ? null : byRunId.get(runId);
    }
}
