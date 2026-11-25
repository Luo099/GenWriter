package com.example.genwriter.agent.tool;

import org.springframework.ai.chat.client.ChatClient;
import org.springframework.ai.chat.model.ToolContext;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * Shared tool registration names and per-request visibility helpers.
 */
public final class AgentToolSupport {

    public static final String WEB_SEARCH = "web_search";
    public static final String KNOWLEDGE_BASE_SEARCH = "knowledge_base_search";
    public static final String KNOWLEDGE_BASE_IDS = "knowledgeBaseIds";
    public static final String WEB_SEARCH_ENABLED = "webSearchEnabled";
    public static final String SESSION_ID = "sessionId";
    public static final String CURRENT_SPAN_ID = "currentSpanId";
    public static final String CURRENT_AGENT_NAME = "currentAgentName";
    public static final String WORKSPACE_RUN_ID = "workspaceRunId";

    private AgentToolSupport() {
    }

    public static boolean isWorkspaceRun(Map<String, Object> state) {
        return state.get("writingTarget") instanceof Map<?, ?> target && !target.isEmpty();
    }

    public static ChatClient.ChatClientRequestSpec applyToolVisibility(
            ChatClient.ChatClientRequestSpec promptSpec,
            boolean webSearchEnabled,
            List<String> knowledgeBaseIds) {

        List<String> toolNames = new ArrayList<>();
        if (webSearchEnabled) {
            toolNames.add(WEB_SEARCH);
        }
        if (!knowledgeBaseIds.isEmpty()) {
            toolNames.add(KNOWLEDGE_BASE_SEARCH);
        }
        if (!toolNames.isEmpty()) {
            promptSpec = promptSpec.tools(toolNames.toArray(new String[0]));
        }
        Map<String, Object> toolContext = new HashMap<>(sessionContext(
                SessionContextHolder.get(), SessionContextHolder.getCurrentSpanId(),
                SessionContextHolder.getCurrentAgentName(), SessionContextHolder.getWorkspaceRunId()));
        toolContext.put(WEB_SEARCH_ENABLED, webSearchEnabled);
        toolContext.put(KNOWLEDGE_BASE_IDS, knowledgeBaseIds);
        return promptSpec.toolContext(toolContext);
    }

    public static List<String> knowledgeBaseIds(Map<?, ?> state) {
        if (!(state.get(KNOWLEDGE_BASE_IDS) instanceof List<?> ids)) {
            return List.of();
        }
        return ids.stream().filter(String.class::isInstance).map(String.class::cast).toList();
    }

    public static ChatClient.ChatClientRequestSpec applySessionContext(
            ChatClient.ChatClientRequestSpec promptSpec,
            String sessionId,
            String currentSpanId,
            String currentAgentName) {

        return promptSpec.toolContext(sessionContext(sessionId, currentSpanId, currentAgentName));
    }

    public static Map<String, Object> sessionContext(
            String sessionId,
            String currentSpanId,
            String currentAgentName) {
        return sessionContext(sessionId, currentSpanId, currentAgentName, SessionContextHolder.getWorkspaceRunId());
    }

    public static Map<String, Object> sessionContext(
            String sessionId,
            String currentSpanId,
            String currentAgentName,
            String workspaceRunId) {

        return Map.of(
                SESSION_ID, safe(sessionId),
                CURRENT_SPAN_ID, safe(currentSpanId),
                CURRENT_AGENT_NAME, safe(currentAgentName),
                WORKSPACE_RUN_ID, safe(workspaceRunId)
        );
    }

    public static SessionContextHolder.ContextSnapshot contextSnapshot(ToolContext toolContext) {
        if (toolContext == null || toolContext.getContext() == null) {
            return null;
        }
        Map<String, Object> context = toolContext.getContext();
        String sessionId = stringValue(context.get(SESSION_ID));
        String currentSpanId = stringValue(context.get(CURRENT_SPAN_ID));
        String currentAgentName = stringValue(context.get(CURRENT_AGENT_NAME));
        String workspaceRunId = stringValue(context.get(WORKSPACE_RUN_ID));
        if (isBlank(sessionId) && isBlank(currentSpanId) && isBlank(currentAgentName) && isBlank(workspaceRunId)) {
            return null;
        }
        return new SessionContextHolder.ContextSnapshot(sessionId, currentSpanId, currentAgentName, workspaceRunId);
    }

    public static boolean isWebSearchEnabled(ToolContext toolContext) {
        if (toolContext == null || toolContext.getContext() == null) {
            return true;
        }
        return isWebSearchEnabled(toolContext.getContext().get(WEB_SEARCH_ENABLED));
    }

    public static boolean isWebSearchEnabled(Object enabled) {
        return enabled == null || !"false".equalsIgnoreCase(String.valueOf(enabled));
    }

    private static String stringValue(Object value) {
        return value == null ? null : String.valueOf(value);
    }

    private static String safe(String value) {
        return value == null ? "" : value;
    }

    private static boolean isBlank(String value) {
        return value == null || value.isBlank();
    }

    public static String appendWebSearchDisabledNotice(String prompt, boolean webSearchEnabled) {
        if (webSearchEnabled) {
            return prompt;
        }
        String basePrompt = prompt != null ? prompt : "";
        return basePrompt + """

                ## Tool constraints
                web_search is disabled for this request. Do not call web_search; use available knowledge base results, attachments, memory, and existing context only.
                """;
    }
}
