package com.example.genwriter.agent.tool.workspace;

import com.example.genwriter.agent.chain.ThoughtChainPublisher;
import com.example.genwriter.agent.supervisor.SupervisorModeProperties;
import com.example.genwriter.agent.tool.AgentToolSupport;
import com.example.genwriter.agent.tool.SessionContextHolder;
import com.example.genwriter.agent.tool.ToolResult;
import com.example.genwriter.service.workspace.WorkspaceExecutionSession;
import com.example.genwriter.service.workspace.WorkspaceExecutionSessionRegistry;
import com.example.genwriter.service.workspace.WorkspaceMutationGateway;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.ai.chat.model.ToolContext;
import org.springframework.stereotype.Component;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Read-only workspace inspection tools available in both CHAT and GHOSTWRITE modes.
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class WorkspaceReadTools {

    private final WorkspaceExecutionSessionRegistry sessionRegistry;
    private final WorkspaceMutationGateway gateway;
    private final SupervisorModeProperties supervisorProperties;
    private final ThoughtChainPublisher chainPublisher;
    private final ObjectMapper objectMapper;

    public record OutlineInput(Boolean includeSummaries) {}

    public record ReadChapterInput(String nodeId, Integer startLine, Integer lineCount, Boolean headingsOnly) {}

    public record SearchInput(String query, String nodeId, Boolean regex, Integer maxMatches) {}

    public String outline(OutlineInput input, ToolContext toolContext) {
        WorkspaceExecutionSession session = sessionRegistry.resolve(toolContext);
        if (session == null) {
            return ToolResult.fail("当前会话未关联作品工作区").toJson();
        }
        boolean includeSummaries = input == null || !Boolean.FALSE.equals(input.includeSummaries());
        return executeWithTrace(session, toolContext, "workspace_outline",
                Map.of("includeSummaries", includeSummaries), () -> {
                    WorkspaceMutationGateway.OutlineView view = gateway.outline(session, includeSummaries);
                    Map<String, Object> payload = new LinkedHashMap<>();
                    payload.put("projectId", view.projectId());
                    payload.put("projectName", view.projectName());
                    payload.put("description", view.description());
                    payload.put("activeNodeId", view.activeNodeId());
                    payload.put("nodes", view.nodes());
                    return ToolResult.ok(objectMapper.writeValueAsString(payload), null,
                            Map.of("nodeCount", view.nodes().size())).toJson();
                });
    }

    public String readChapter(ReadChapterInput input, ToolContext toolContext) {
        WorkspaceExecutionSession session = sessionRegistry.resolve(toolContext);
        if (session == null) {
            return ToolResult.fail("当前会话未关联作品工作区").toJson();
        }
        String nodeId = input != null ? input.nodeId() : null;
        int startLine = input != null && input.startLine() != null ? input.startLine() : 1;
        int defaultLimit = Math.max(20, supervisorProperties.getAgent().getMaxReadLinesPerCall());
        int lineCount = input != null && input.lineCount() != null ? Math.min(input.lineCount(), 300) : defaultLimit;
        boolean headingsOnly = input != null && Boolean.TRUE.equals(input.headingsOnly());

        Map<String, Object> traceInput = new LinkedHashMap<>();
        traceInput.put("nodeId", nodeId != null ? nodeId : "(active)");
        traceInput.put("startLine", startLine);
        traceInput.put("lineCount", lineCount);
        if (headingsOnly) traceInput.put("headingsOnly", true);

        return executeWithTrace(session, toolContext, "workspace_read", traceInput, () -> {
            WorkspaceMutationGateway.ChapterView view = gateway.readChapter(session, nodeId, startLine, lineCount, headingsOnly);
            Map<String, Object> payload = new LinkedHashMap<>();
            payload.put("nodeId", view.nodeId());
            payload.put("title", view.title());
            payload.put("documentId", view.documentId());
            payload.put("version", view.version());
            payload.put("startLine", view.window().startLine());
            payload.put("endLine", view.window().endLine());
            payload.put("totalLines", view.window().totalLines());
            payload.put("totalChars", view.window().totalChars());
            payload.put("hasMore", view.window().hasMore());
            if (view.activeUnsavedNotice()) {
                payload.put("unsavedPreview", true);
            }
            payload.put("content", view.window().numberedContent());

            Map<String, Object> meta = new LinkedHashMap<>();
            meta.put("nodeId", view.nodeId());
            meta.put("title", view.title());
            meta.put("startLine", view.window().startLine());
            meta.put("endLine", view.window().endLine());
            meta.put("totalLines", view.window().totalLines());
            return ToolResult.ok(objectMapper.writeValueAsString(payload), null, meta).toJson();
        });
    }

    public String search(SearchInput input, ToolContext toolContext) {
        WorkspaceExecutionSession session = sessionRegistry.resolve(toolContext);
        if (session == null) {
            return ToolResult.fail("当前会话未关联作品工作区").toJson();
        }
        String query = input != null ? input.query() : null;
        if (query == null || query.isBlank()) {
            return ToolResult.fail("检索关键词 query 不能为空").toJson();
        }
        String nodeId = input.nodeId();
        boolean regex = Boolean.TRUE.equals(input.regex());
        int maxMatches = input.maxMatches() != null ? input.maxMatches() : 20;

        Map<String, Object> traceInput = new LinkedHashMap<>();
        traceInput.put("query", query);
        if (nodeId != null && !nodeId.isBlank()) traceInput.put("nodeId", nodeId);

        return executeWithTrace(session, toolContext, "workspace_search", traceInput, () -> {
            List<WorkspaceMutationGateway.SearchHit> hits = gateway.search(session, query, nodeId, regex, maxMatches);
            Map<String, Object> payload = new LinkedHashMap<>();
            payload.put("query", query);
            payload.put("total", hits.size());
            payload.put("matches", hits);
            return ToolResult.ok(objectMapper.writeValueAsString(payload), null,
                    Map.of("total", hits.size())).toJson();
        });
    }

    @FunctionalInterface
    private interface ToolAction {
        String run() throws Exception;
    }

    private String executeWithTrace(WorkspaceExecutionSession session, ToolContext toolContext,
                                    String toolName, Map<String, Object> traceInput, ToolAction action) {
        SessionContextHolder.ContextSnapshot previous = SessionContextHolder.snapshot();
        SessionContextHolder.ContextSnapshot ctx = AgentToolSupport.contextSnapshot(toolContext);
        if (ctx != null) {
            SessionContextHolder.restore(ctx);
        }
        String sessionId = session.getSessionId();
        String spanId = sessionId != null && !sessionId.isBlank()
                ? chainPublisher.publishToolStart(sessionId, toolName, traceInput)
                : null;
        try {
            String resultJson = action.run();
            if (spanId != null) {
                chainPublisher.publishToolComplete(sessionId, spanId, toolName, traceInput);
            }
            return resultJson;
        } catch (Exception e) {
            log.warn("[WorkspaceReadTools] {} failed: {}", toolName, e.getMessage());
            if (spanId != null) {
                chainPublisher.publishToolError(sessionId, spanId, toolName, e.getMessage());
            }
            return ToolResult.fail(e.getMessage()).toJson();
        } finally {
            SessionContextHolder.restore(previous);
        }
    }
}
