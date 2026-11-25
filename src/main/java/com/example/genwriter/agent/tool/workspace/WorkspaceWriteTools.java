package com.example.genwriter.agent.tool.workspace;

import com.example.genwriter.agent.chain.ThoughtChainPublisher;
import com.example.genwriter.agent.tool.AgentToolSupport;
import com.example.genwriter.agent.tool.SessionContextHolder;
import com.example.genwriter.agent.tool.ToolResult;
import com.example.genwriter.model.enums.AssistantMode;
import com.example.genwriter.service.workspace.TextPatchEngine.HunkMode;
import com.example.genwriter.service.workspace.TextPatchEngine.PatchHunk;
import com.example.genwriter.service.workspace.WorkspaceExecutionSession;
import com.example.genwriter.service.workspace.WorkspaceExecutionSessionRegistry;
import com.example.genwriter.service.workspace.WorkspaceMutationGateway;
import com.example.genwriter.service.workspace.WorkspaceMutationGateway.MutationOutcome;
import com.example.genwriter.service.workspace.WorkspaceMutationGateway.TreeAction;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.ai.chat.model.ToolContext;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * Write and structural workspace tools available exclusively in GHOSTWRITE mode.
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class WorkspaceWriteTools {

    private final WorkspaceExecutionSessionRegistry sessionRegistry;
    private final WorkspaceMutationGateway gateway;
    private final ThoughtChainPublisher chainPublisher;
    private final ObjectMapper objectMapper;

    public record PatchHunkInput(String mode, String anchor, String content, Integer nearLine) {}

    public record PatchInput(String nodeId, String expectedDocumentId, String title,
                             String reason, List<PatchHunkInput> hunks) {}

    public record WriteInput(String nodeId, String expectedDocumentId, String title,
                             String content, String reason) {}

    public record TreeInput(String action, String nodeId, String parentId, String afterNodeId,
                            Integer position, String title, String initialContent, String reason) {}

    public String patchChapter(PatchInput input, ToolContext toolContext) {
        WorkspaceExecutionSession session = sessionRegistry.resolve(toolContext);
        if (session == null) {
            return ToolResult.fail("当前会话未关联作品工作区").toJson();
        }
        if (session.getMode() != AssistantMode.GHOSTWRITE) {
            return ToolResult.fail("当前为对话模式（只读），禁止调用 workspace_patch").toJson();
        }
        if (input == null || input.hunks() == null || input.hunks().isEmpty()) {
            return ToolResult.fail("hunks 不能为空").toJson();
        }

        Map<String, Object> traceInput = new LinkedHashMap<>();
        traceInput.put("nodeId", input.nodeId() != null ? input.nodeId() : "(active)");
        traceInput.put("hunkCount", input.hunks().size());
        if (input.reason() != null) traceInput.put("reason", input.reason());

        return executeWithTrace(session, toolContext, "workspace_patch", traceInput, () -> {
            List<PatchHunk> hunks = new ArrayList<>(input.hunks().size());
            for (PatchHunkInput h : input.hunks()) {
                HunkMode mode = HunkMode.valueOf(h.mode().trim().toUpperCase(Locale.ROOT));
                hunks.add(new PatchHunk(mode, h.anchor(), h.content(), h.nearLine()));
            }
            MutationOutcome outcome = gateway.patchChapter(
                    session, input.nodeId(), input.expectedDocumentId(),
                    input.title(), hunks, input.reason());
            return formatOutcome(outcome);
        });
    }

    public String writeChapter(WriteInput input, ToolContext toolContext) {
        WorkspaceExecutionSession session = sessionRegistry.resolve(toolContext);
        if (session == null) {
            return ToolResult.fail("当前会话未关联作品工作区").toJson();
        }
        if (session.getMode() != AssistantMode.GHOSTWRITE) {
            return ToolResult.fail("当前为对话模式（只读），禁止调用 workspace_write").toJson();
        }
        if (input == null || input.content() == null) {
            return ToolResult.fail("content 不能为空").toJson();
        }

        Map<String, Object> traceInput = new LinkedHashMap<>();
        traceInput.put("nodeId", input.nodeId() != null ? input.nodeId() : "(active)");
        traceInput.put("contentChars", input.content().length());
        if (input.reason() != null) traceInput.put("reason", input.reason());

        return executeWithTrace(session, toolContext, "workspace_write", traceInput, () -> {
            MutationOutcome outcome = gateway.writeChapter(
                    session, input.nodeId(), input.expectedDocumentId(),
                    input.title(), input.content(), input.reason());
            return formatOutcome(outcome);
        });
    }

    public String mutateTree(TreeInput input, ToolContext toolContext) {
        WorkspaceExecutionSession session = sessionRegistry.resolve(toolContext);
        if (session == null) {
            return ToolResult.fail("当前会话未关联作品工作区").toJson();
        }
        if (session.getMode() != AssistantMode.GHOSTWRITE) {
            return ToolResult.fail("当前为对话模式（只读），禁止调用 workspace_tree").toJson();
        }
        if (input == null || input.action() == null || input.action().isBlank()) {
            return ToolResult.fail("action 不能为空（CREATE / RENAME / MOVE / DELETE）").toJson();
        }

        Map<String, Object> traceInput = new LinkedHashMap<>();
        traceInput.put("action", input.action());
        if (input.nodeId() != null) traceInput.put("nodeId", input.nodeId());
        if (input.title() != null) traceInput.put("title", input.title());

        return executeWithTrace(session, toolContext, "workspace_tree", traceInput, () -> {
            TreeAction action = TreeAction.valueOf(input.action().trim().toUpperCase(Locale.ROOT));
            MutationOutcome outcome = gateway.mutateTree(
                    session, action, input.nodeId(), input.parentId(), input.afterNodeId(),
                    input.position(), input.title(), input.initialContent(), input.reason());
            return formatOutcome(outcome);
        });
    }

    private String formatOutcome(MutationOutcome outcome) throws Exception {
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("changeSetId", outcome.changeSetId());
        payload.put("applyMode", outcome.applyMode().name());
        payload.put("status", outcome.item().status());
        payload.put("action", outcome.item().action());
        payload.put("nodeId", outcome.nodeId());
        payload.put("title", outcome.title());
        payload.put("documentId", outcome.documentId());
        payload.put("version", outcome.version());
        payload.put("addedLines", outcome.diff().addedLines());
        payload.put("removedLines", outcome.diff().removedLines());
        payload.put("afterChars", outcome.diff().afterChars());
        payload.put("diffPreview", truncate(outcome.diff().unifiedDiff(), 1800));

        Map<String, Object> meta = new LinkedHashMap<>();
        meta.put("nodeId", outcome.nodeId());
        meta.put("title", outcome.title());
        meta.put("addedLines", outcome.diff().addedLines());
        meta.put("removedLines", outcome.diff().removedLines());
        meta.put("applyMode", outcome.applyMode().name());
        return ToolResult.ok(objectMapper.writeValueAsString(payload), null, meta).toJson();
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
                chainPublisher.publishToolComplete(sessionId, spanId, toolName,
                        Map.of("summary", "完成 " + traceInput.getOrDefault("nodeId", "")));
            }
            return resultJson;
        } catch (Exception e) {
            log.warn("[WorkspaceWriteTools] {} failed: {}", toolName, e.getMessage());
            if (spanId != null) {
                chainPublisher.publishToolError(sessionId, spanId, toolName, e.getMessage());
            }
            return ToolResult.fail(e.getMessage()).toJson();
        } finally {
            SessionContextHolder.restore(previous);
        }
    }

    private static String truncate(String text, int maxLen) {
        if (text == null || text.length() <= maxLen) return text == null ? "" : text;
        return text.substring(0, maxLen) + "\n...(diff truncated)";
    }
}
