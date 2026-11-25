package com.example.genwriter.agent.orchestrator;

import com.example.genwriter.agent.chatclient.ChatClientFactory;
import com.example.genwriter.agent.memory.LongTermMemoryAdvisor;
import com.example.genwriter.agent.memory.LongTermMemoryProbeRecorder;
import com.example.genwriter.agent.memory.LongTermMemoryPromptFormatter;
import com.example.genwriter.agent.memory.LongTermMemoryProperties;
import com.example.genwriter.agent.memory.RedisChatMemory;
import com.example.genwriter.agent.profile.AgentPromptRenderer;
import com.example.genwriter.agent.profile.RenderedAgentPrompt;
import com.example.genwriter.agent.skill.SkillService;
import com.example.genwriter.agent.streaming.ContentStreamPublisher;
import com.example.genwriter.agent.tool.AgentToolSupport;
import com.example.genwriter.agent.tool.SessionContextHolder;
import com.example.genwriter.message.AgentTraceEvent;
import com.example.genwriter.message.ChainNode;
import com.example.genwriter.agent.chain.ThoughtChainPublisher;
import com.example.genwriter.model.dto.MultimodalContent;
import com.example.genwriter.model.dto.workspace.WorkspaceModels.ChangeItem;
import com.example.genwriter.model.dto.workspace.WorkspaceModels.ChangeSet;
import com.example.genwriter.model.entity.MessageAttachment;
import com.example.genwriter.model.enums.AssistantMode;
import com.example.genwriter.model.enums.GhostwriteApplyMode;
import com.example.genwriter.model.enums.MemoryType;
import com.example.genwriter.retrieval.GlobalRerankConverger;
import com.example.genwriter.service.FileStorageService;
import com.example.genwriter.service.LongTermMemoryService;
import com.example.genwriter.service.WritingOutputSettingsService;
import com.example.genwriter.service.workspace.WorkspaceExecutionSession;
import com.example.genwriter.service.workspace.WorkspaceExecutionSessionRegistry;
import com.example.genwriter.service.workspace.WorkspaceMutationGateway;
import com.example.genwriter.service.workspace.WorkspaceMutationGateway.OutlineNodeView;
import com.example.genwriter.service.workspace.WorkspaceMutationGateway.OutlineView;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.ai.chat.client.ChatClient;
import org.springframework.ai.chat.client.advisor.AbstractChatMemoryAdvisor;
import org.springframework.ai.chat.client.advisor.MessageChatMemoryAdvisor;
import org.springframework.ai.model.Media;
import org.springframework.stereotype.Service;
import org.springframework.util.MimeType;
import reactor.core.publisher.Mono;

import java.net.URI;
import java.time.Duration;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;

/**
 * Coordinates workspace CHAT (read-only) and GHOSTWRITE (AI-IDE style read/write/delegate) turns
 * via explicit workspace tools and sub-agent tools.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class WorkspaceAgentOrchestrator {

    private static final double CHAT_TEMPERATURE = 0.5;
    private static final double GHOSTWRITE_TEMPERATURE = 0.35;
    private static final Duration STREAM_TIMEOUT = Duration.ofMinutes(12);
    private static final int ORIENTATION_CHAPTER_LIMIT = 30;
    private static final int MEMORY_RETRIEVE_SIZE = 20;

    private static final List<MemoryType> MEMORY_TYPES = List.of(
            MemoryType.WRITING_PREFERENCE,
            MemoryType.DOMAIN_KNOWLEDGE,
            MemoryType.CHARACTER_PROFILE,
            MemoryType.WORLD_SETTING,
            MemoryType.FORESHADOWING
    );

    private final ChatClientFactory chatClientFactory;
    private final AgentPromptRenderer promptRenderer;
    private final WritingOutputSettingsService writingOutputSettingsService;
    private final SkillService skillService;
    private final WorkspaceExecutionSessionRegistry sessionRegistry;
    private final WorkspaceMutationGateway mutationGateway;
    private final RedisChatMemory chatMemory;
    private final LongTermMemoryService memoryService;
    private final LongTermMemoryPromptFormatter memoryPromptFormatter;
    private final LongTermMemoryProbeRecorder memoryProbeRecorder;
    private final GlobalRerankConverger globalRerankConverger;
    private final LongTermMemoryProperties longTermMemoryProperties;
    private final FileStorageService fileStorageService;
    private final ContentStreamPublisher contentStreamPublisher;
    private final ThoughtChainPublisher chainPublisher;

    public record RunRequest(
            String sessionId,
            String projectId,
            String activeNodeId,
            String activeUnsavedPreview,
            AssistantMode mode,
            GhostwriteApplyMode applyMode,
            boolean webSearchEnabled,
            List<String> knowledgeBaseIds,
            MultimodalContent multimodalContent,
            String userText,
            String chapterSummary,
            String parentSpanId
    ) {}

    public record OrchestratorResult(
            String assistantContent,
            List<Map<String, String>> collectedSources,
            ChangeSet changeSet,
            AssistantMode mode,
            GhostwriteApplyMode applyMode,
            List<String> touchedNodeIds,
            String runId
    ) {}

    public OrchestratorResult run(RunRequest req) {
        AssistantMode mode = req.mode() != null ? req.mode() : AssistantMode.CHAT;
        GhostwriteApplyMode applyMode = req.applyMode() != null
                ? req.applyMode()
                : writingOutputSettingsService.getGhostwriteApplyMode();
        List<String> kbIds = req.knowledgeBaseIds() != null ? List.copyOf(req.knowledgeBaseIds()) : List.of();

        String runId = UUID.randomUUID().toString();
        WorkspaceExecutionSession execSession = new WorkspaceExecutionSession(
                runId,
                req.projectId(),
                req.sessionId(),
                req.activeNodeId(),
                req.activeUnsavedPreview(),
                mode,
                applyMode,
                req.webSearchEnabled(),
                kbIds
        );
        sessionRegistry.register(execSession);

        String sessionId = req.sessionId();
        String profileName = mode == AssistantMode.GHOSTWRITE ? "workspace_ghostwrite" : "workspace_chat";
        String nodeName = mode == AssistantMode.GHOSTWRITE ? "代笔 Agent" : "对话助手";

        Map<String, Object> startInput = new LinkedHashMap<>();
        startInput.put("mode", mode.name());
        startInput.put("applyMode", applyMode.name());
        startInput.put("activeNodeId", safe(req.activeNodeId()));
        startInput.put("userInput", truncate(req.userText(), 200));

        String nodeId = chainPublisher.publishStart(
                sessionId, nodeName, ChainNode.Type.EXECUTION, null, startInput);
        String llmSpanId = chainPublisher.publishTraceStart(
                sessionId,
                nodeName + " 推理调度",
                AgentTraceEvent.Kind.LLM,
                nodeId,
                Map.of(
                        "mode", mode.name(),
                        "applyMode", applyMode.name(),
                        "webSearch", req.webSearchEnabled(),
                        "knowledgeBaseCount", kbIds.size()
                ),
                null);

        SessionContextHolder.ContextSnapshot previousCtx = SessionContextHolder.snapshot();
        SessionContextHolder.set(sessionId, llmSpanId, nodeName, runId);

        StringBuilder contentBuilder = new StringBuilder();
        try {
            Map<String, Object> promptContext = buildPromptContext(execSession, req, mode, applyMode);
            RenderedAgentPrompt rendered = promptRenderer.render(profileName, promptContext);

            List<String> tools = visibleTools(mode, req.webSearchEnabled(), kbIds);
            double temperature = mode == AssistantMode.GHOSTWRITE ? GHOSTWRITE_TEMPERATURE : CHAT_TEMPERATURE;
            ChatClient chatClient = chatClientFactory.create(temperature);

            ChatClient.ChatClientRequestSpec baseSpec = chatClient.prompt()
                    .system(rendered.systemPrompt());
            ChatClient.ChatClientRequestSpec promptSpec = buildUserSpec(
                    baseSpec, rendered.userPrompt(), req.multimodalContent());

            Map<String, Object> toolContext = new HashMap<>(AgentToolSupport.sessionContext(
                    sessionId, llmSpanId, nodeName, runId));
            toolContext.put(AgentToolSupport.WEB_SEARCH_ENABLED, req.webSearchEnabled());
            toolContext.put(AgentToolSupport.KNOWLEDGE_BASE_IDS, kbIds);

            promptSpec = promptSpec
                    .tools(tools.toArray(new String[0]))
                    .toolContext(toolContext)
                    .advisors(new MessageChatMemoryAdvisor(chatMemory))
                    .advisors(spec -> spec
                            .param(AbstractChatMemoryAdvisor.CHAT_MEMORY_CONVERSATION_ID_KEY, sessionId)
                            .param(AbstractChatMemoryAdvisor.CHAT_MEMORY_RETRIEVE_SIZE_KEY, MEMORY_RETRIEVE_SIZE));

            if (longTermMemoryProperties.isEnabled()) {
                promptSpec = promptSpec.advisors(new LongTermMemoryAdvisor(
                        memoryService,
                        memoryPromptFormatter,
                        MEMORY_TYPES,
                        sessionId,
                        null,
                        memoryProbeRecorder,
                        globalRerankConverger,
                        longTermMemoryProperties));
            }

            contentStreamPublisher.startStage(sessionId, nodeId, ContentStreamPublisher.Stage.DIRECT_ANSWER);
            promptSpec.stream()
                    .content()
                    .doOnNext(chunk -> {
                        if (chunk == null || chunk.isEmpty()) return;
                        contentBuilder.append(chunk);
                        contentStreamPublisher.publishDelta(
                                sessionId, nodeId, ContentStreamPublisher.Stage.DIRECT_ANSWER, chunk, contentBuilder);
                    })
                    .then(Mono.just(contentBuilder.toString()))
                    .block(STREAM_TIMEOUT);

            String finalContent = contentBuilder.toString().trim();
            if (finalContent.isEmpty() && !execSession.getRecordedItemsSnapshot().isEmpty()) {
                finalContent = buildFallbackMutationSummary(execSession, applyMode);
                contentStreamPublisher.publishDelta(
                        sessionId, nodeId, ContentStreamPublisher.Stage.DIRECT_ANSWER, finalContent, finalContent);
            }

            contentStreamPublisher.completeStage(
                    sessionId, nodeId, ContentStreamPublisher.Stage.DIRECT_ANSWER, finalContent);
            chainPublisher.publishTraceComplete(
                    sessionId,
                    llmSpanId,
                    Map.of(
                            "outputLength", finalContent.length(),
                            "mutationCount", execSession.getRecordedItemsSnapshot().size()
                    ));
            chainPublisher.publishComplete(sessionId, nodeId, truncate(finalContent, 300));

            return new OrchestratorResult(
                    finalContent,
                    execSession.getCollectedSourcesSnapshot(),
                    execSession.getLatestChangeSet(),
                    mode,
                    applyMode,
                    List.copyOf(execSession.getTouchedNodeIds()),
                    runId
            );
        } catch (Exception e) {
            log.error("[WorkspaceAgentOrchestrator] execution failed: sessionId={}, mode={}, error={}",
                    sessionId, mode, e.getMessage(), e);
            chainPublisher.publishTraceError(sessionId, llmSpanId, e.getMessage());
            chainPublisher.publishError(sessionId, nodeId, e.getMessage());
            throw e instanceof RuntimeException runtime ? runtime : new IllegalStateException(e.getMessage(), e);
        } finally {
            SessionContextHolder.restore(previousCtx);
            sessionRegistry.unregister(runId);
        }
    }

    private Map<String, Object> buildPromptContext(WorkspaceExecutionSession execSession,
                                                     RunRequest req,
                                                     AssistantMode mode,
                                                     GhostwriteApplyMode applyMode) {
        Map<String, Object> ctx = new LinkedHashMap<>();
        OutlineView outlineView = mutationGateway.outline(execSession, false);

        StringBuilder overview = new StringBuilder();
        overview.append("作品名称：").append(safe(outlineView.projectName())).append('\n');
        if (outlineView.description() != null && !outlineView.description().isBlank()) {
            overview.append("作品简介与设定：").append(truncate(outlineView.description(), 800)).append('\n');
        }
        List<OutlineNodeView> nodes = outlineView.nodes();
        overview.append("章节目录（共 ").append(nodes.size()).append(" 个节点，需完整查看请调用 workspace_outline）：\n");
        int limit = Math.min(nodes.size(), ORIENTATION_CHAPTER_LIMIT);
        OutlineNodeView activeNode = null;
        for (int i = 0; i < limit; i++) {
            OutlineNodeView node = nodes.get(i);
            if (node.active()) activeNode = node;
            String indent = "  ".repeat(Math.max(0, Math.min(node.depth(), 4)));
            overview.append(indent)
                    .append("- ")
                    .append(node.title())
                    .append(" (nodeId=").append(node.nodeId())
                    .append(", V").append(node.version())
                    .append(", ").append(node.lineCount()).append("行")
                    .append(node.active() ? ", 当前焦点" : "")
                    .append(")\n");
        }
        if (nodes.size() > ORIENTATION_CHAPTER_LIMIT) {
            overview.append("  ... 其余 ").append(nodes.size() - ORIENTATION_CHAPTER_LIMIT)
                    .append(" 个节点可通过 workspace_outline / workspace_search 查看\n");
        }
        if (activeNode == null) {
            activeNode = nodes.stream().filter(OutlineNodeView::active).findFirst().orElse(null);
        }

        StringBuilder activeSection = new StringBuilder();
        if (activeNode != null) {
            activeSection.append("当前聚焦章节：").append(activeNode.title())
                    .append("（nodeId=").append(activeNode.nodeId())
                    .append(", version=V").append(activeNode.version())
                    .append(", docId=").append(safe(activeNode.documentId()))
                    .append(", 共 ").append(activeNode.lineCount()).append(" 行）\n");
        }
        if (req.activeUnsavedPreview() != null && !req.activeUnsavedPreview().isBlank()) {
            activeSection.append("【注意】右侧编辑器当前存在尚未手动保存的局部草稿内容（如工具读取结果与以下草稿存在差异，请予以说明）：\n")
                    .append(truncate(req.activeUnsavedPreview(), 3000));
        }

        String enabledSkills = skillService.getEnabledSkillsSummary();
        String outputFormatHint = writingOutputSettingsService.isMarkdownEnabled()
                ? "允许使用清晰的 Markdown 排版（格式：" + writingOutputSettingsService.currentFormat() + "）。"
                : "请输出纯文本格式，不要使用 Markdown 标题、加粗或列表语法。";

        String applyModeHint = applyMode == GhostwriteApplyMode.STAGED_CANDIDATE
                ? "STAGED_CANDIDATE（写入暂存为待审变更集，作者审阅 Diff 后原子采纳）"
                : "DIRECT_SNAPSHOT（写入直接生成新版本快照并支持一键撤销）";

        ctx.put("workspaceOverview", overview.toString().strip());
        ctx.put("activeNodeSection", activeSection.toString().strip());
        ctx.put("chapterSummary", safe(req.chapterSummary()));
        ctx.put("documentAttachments", extractDocumentAttachments(req.multimodalContent()));
        ctx.put("enabledSkills", enabledSkills != null ? enabledSkills.strip() : "");
        ctx.put("outputFormatHint", outputFormatHint);
        ctx.put("applyModeHint", applyModeHint);
        ctx.put("userInput", safe(req.userText()));
        return ctx;
    }

    private List<String> visibleTools(AssistantMode mode, boolean webSearchEnabled, List<String> kbIds) {
        List<String> tools = new ArrayList<>();
        // Always-available read / analysis / research tools
        tools.add("workspace_outline");
        tools.add("workspace_read");
        tools.add("workspace_search");
        tools.add("call_researcher");
        tools.add("call_reviewer");
        tools.add("call_skill_extractor");
        tools.add("read_skill_detail");

        if (webSearchEnabled) {
            tools.add(AgentToolSupport.WEB_SEARCH);
        }
        if (kbIds != null && !kbIds.isEmpty()) {
            tools.add(AgentToolSupport.KNOWLEDGE_BASE_SEARCH);
        }

        if (mode == AssistantMode.GHOSTWRITE) {
            tools.add("workspace_patch");
            tools.add("workspace_write");
            tools.add("workspace_tree");
            tools.add("call_outline_planner");
            tools.add("call_draft_writer");
            tools.add("call_polisher");
            tools.add("save_setting_detail");
            tools.add("update_writing_skill");
        }
        return tools;
    }

    private ChatClient.ChatClientRequestSpec buildUserSpec(ChatClient.ChatClientRequestSpec baseSpec,
                                                            String userPrompt,
                                                            MultimodalContent multimodalContent) {
        if (multimodalContent != null && multimodalContent.hasImages()) {
            Media[] mediaArr = multimodalContent.getImageAttachments().stream()
                    .map(a -> {
                        try {
                            return new Media(
                                    MimeType.valueOf(a.getMimeType()),
                                    URI.create(a.getFileUrl()).toURL());
                        } catch (Exception ex) {
                            log.warn("[WorkspaceAgentOrchestrator] 构建图片 Media 失败: {}", a.getFileUrl(), ex);
                            return null;
                        }
                    })
                    .filter(Objects::nonNull)
                    .toArray(Media[]::new);
            if (mediaArr.length > 0) {
                return baseSpec.user(u -> u.text(userPrompt).media(mediaArr));
            }
        }
        return baseSpec.user(userPrompt);
    }

    private String extractDocumentAttachments(MultimodalContent multimodalContent) {
        if (multimodalContent == null || !multimodalContent.hasDocuments()) {
            return "";
        }
        StringBuilder sb = new StringBuilder();
        for (MultimodalContent.AttachmentRef docRef : multimodalContent.getDocumentAttachments()) {
            MessageAttachment att = fileStorageService.getById(docRef.getAttachmentId());
            if (att != null && "COMPLETED".equals(att.getProcessingStatus()) && att.getExtractedText() != null) {
                sb.append("[附件文档: ").append(safe(att.getOriginalFilename())).append("]\n")
                        .append(att.getExtractedText())
                        .append("\n[/附件文档]\n");
            }
        }
        return sb.toString().strip();
    }

    private String buildFallbackMutationSummary(WorkspaceExecutionSession session, GhostwriteApplyMode applyMode) {
        List<ChangeItem> items = session.getRecordedItemsSnapshot();
        StringBuilder sb = new StringBuilder();
        sb.append(applyMode == GhostwriteApplyMode.STAGED_CANDIDATE
                ? "已将本轮修改暂存为待审变更集：\n"
                : "已完成本轮工作区写入（已保留可撤销版本快照）：\n");
        for (ChangeItem item : items) {
            sb.append("- ").append(item.action())
                    .append("：").append(safe(item.title()))
                    .append('\n');
        }
        return sb.toString().trim();
    }

    private static String safe(String value) {
        return value == null ? "" : value;
    }

    private static String truncate(String text, int maxLen) {
        if (text == null) return "";
        return text.length() <= maxLen ? text : text.substring(0, maxLen) + "...";
    }
}
