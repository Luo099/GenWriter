package com.example.genwriter.agent.supervisor.worker;

import com.example.genwriter.agent.chain.ThoughtChainPublisher;
import com.example.genwriter.agent.chatclient.ChatClientFactory;
import com.example.genwriter.agent.memory.LongTermMemoryAdvisor;
import com.example.genwriter.agent.memory.LongTermMemoryProbeRecorder;
import com.example.genwriter.agent.memory.LongTermMemoryPromptFormatter;
import com.example.genwriter.agent.profile.AgentPromptRenderer;
import com.example.genwriter.agent.streaming.ContentStreamPublisher;
import com.example.genwriter.agent.streaming.ReasoningStreamHelper;
import com.example.genwriter.agent.memory.LongTermMemoryProperties;
import com.example.genwriter.retrieval.GlobalRerankConverger;
import com.example.genwriter.agent.memory.RedisChatMemory;
import com.example.genwriter.agent.profile.RenderedAgentPrompt;
import com.example.genwriter.agent.supervisor.WorkerAgent;
import com.example.genwriter.agent.supervisor.WorkerRegistry;
import com.example.genwriter.agent.tool.AgentToolSupport;
import com.example.genwriter.agent.tool.KnowledgeBaseTool;
import com.example.genwriter.agent.tool.ToolResult;
import com.example.genwriter.agent.tool.SessionContextHolder;
import com.example.genwriter.message.AgentTraceEvent;
import com.example.genwriter.message.ChainNode;
import com.example.genwriter.model.dto.MultimodalContent;
import com.example.genwriter.model.entity.MessageAttachment;
import com.example.genwriter.model.enums.MemoryType;
import com.example.genwriter.service.FileStorageService;
import com.example.genwriter.service.LongTermMemoryService;
import jakarta.annotation.PostConstruct;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.ai.chat.client.ChatClient;
import org.springframework.ai.chat.client.advisor.AbstractChatMemoryAdvisor;
import org.springframework.ai.chat.client.advisor.MessageChatMemoryAdvisor;
import org.springframework.ai.model.Media;
import org.springframework.stereotype.Component;
import org.springframework.util.MimeType;
import reactor.core.publisher.Mono;

import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

@Slf4j
@Component
@RequiredArgsConstructor
public class DirectAnswerWorker implements WorkerAgent {

    private static final double TEMPERATURE = 0.7;

    private final ChatClientFactory chatClientFactory;
    private final AgentPromptRenderer agentPromptRenderer;
    private final RedisChatMemory chatMemory;
    private final WorkerRegistry registry;
    private final LongTermMemoryService memoryService;
    private final LongTermMemoryPromptFormatter memoryPromptFormatter;
    private final LongTermMemoryProperties longTermMemoryProperties;
    private final LongTermMemoryProbeRecorder memoryProbeRecorder;
    private final GlobalRerankConverger globalRerankConverger;
    private final ThoughtChainPublisher chainPublisher;
    private final ReasoningStreamHelper reasoningStreamHelper;
    private final ContentStreamPublisher contentStreamPublisher;
    private final FileStorageService fileStorageService;
    private final KnowledgeBaseTool knowledgeBaseTool;

    @PostConstruct
    void init() {
        registry.register(this);
    }

    @Override
    public String name() {
        return "direct_answer";
    }

    @Override
    public String description() {
        return "直接回答用户问题，可自主调用网络搜索和知识库检索工具获取信息";
    }

    @Override
    public Map<String, Object> execute(Map<String, Object> state) throws Exception {
        String sessionId = (String) state.getOrDefault("sessionId", "");
        String userInput = (String) state.getOrDefault("userInput", "");
        String context = (String) state.getOrDefault("context", "");
        List<String> knowledgeBaseIds = AgentToolSupport.knowledgeBaseIds(state);
        boolean explicitKnowledgeQa = Boolean.TRUE.equals(state.get("explicitKnowledgeQa"));
        boolean webSearchEnabled = AgentToolSupport.isWebSearchEnabled(state.get("webSearch"));

        // 获取多模态内容
        Object mcObj = state.get("multimodalContent");
        MultimodalContent multimodalContent = mcObj instanceof MultimodalContent ? (MultimodalContent) mcObj : null;

        String nodeId = chainPublisher.publishStart(sessionId, "直接回答",
                ChainNode.Type.EXECUTION, null,
                Map.of("userInput", truncate(userInput, 200), "hasKnowledgeBases", !knowledgeBaseIds.isEmpty(),
                        "webSearch", webSearchEnabled));
        contentStreamPublisher.startStage(sessionId, nodeId, ContentStreamPublisher.Stage.DIRECT_ANSWER);

        String answerPrefix = "";
        String knowledgeSourceFooter = "";
        if (explicitKnowledgeQa) {
            ToolResult lookup = knowledgeBaseTool.search(new KnowledgeBaseTool.KnowledgeSearchInput(userInput, null),
                    knowledgeBaseIds, new SessionContextHolder.ContextSnapshot(sessionId, nodeId, name()));
            if (!lookup.success()) {
                return completeAnswer(sessionId, nodeId, lookup.error());
            }
            if (Integer.valueOf(0).equals(lookup.metadata().get("total"))) {
                if (!webSearchEnabled) {
                    return completeAnswer(sessionId, nodeId, KnowledgeBaseTool.NO_MATCH + "。");
                }
                answerPrefix = KnowledgeBaseTool.NO_MATCH + "。\n\n";
                context += "\n\n所选知识库没有命中。仅在取得网页结果时补充回答，注明网页来源。";
            } else {
                context += "\n\n本轮知识库检索资料（引述时标注片段所属知识库）：\n" + lookup.content();
                if (lookup.metadata().get("matchedKnowledgeBases") instanceof List<?> names && !names.isEmpty()) {
                    knowledgeSourceFooter = "\n\n参考知识库：" + names.stream()
                            .map(String::valueOf).collect(Collectors.joining("、"));
                }
            }
        }

        RenderedAgentPrompt renderedPrompt = agentPromptRenderer.render(name(), Map.of(
                "userInput", userInput,
                "context", context,
                "hasKnowledgeBases", !explicitKnowledgeQa && !knowledgeBaseIds.isEmpty()
        ));
        String systemPrompt = renderedPrompt.systemPrompt();
        if (explicitKnowledgeQa) {
            systemPrompt += "\n本轮知识问答的知识库事实以本轮检索资料为准。会话历史仅用于理解问题。"
                    + "资料不足时明确说明。联网补充需要网页检索结果和来源链接。";
        }
        String userPrompt = renderedPrompt.userPrompt();
        userPrompt = AgentToolSupport.appendWebSearchDisabledNotice(userPrompt, webSearchEnabled);

        // Inject document content into prompt
        if (multimodalContent != null && multimodalContent.hasDocuments()) {
            StringBuilder docContent = new StringBuilder();
            for (var docRef : multimodalContent.getDocumentAttachments()) {
                try {
                    MessageAttachment att = fileStorageService.getById(docRef.getAttachmentId());
                    if (att != null && "COMPLETED".equals(att.getProcessingStatus()) && att.getExtractedText() != null) {
                        docContent.append("\n[附件文档: ").append(docRef.getFileName()).append("]\n");
                        docContent.append(att.getExtractedText()).append("\n[/附件文档]\n");
                    } else if (att != null && !"COMPLETED".equals(att.getProcessingStatus())) {
                        docContent.append("\n[附件文档: ").append(docRef.getFileName()).append(" - 文档正在处理中，暂无法使用其内容]\n");
                    }
                } catch (Exception e) {
                    log.debug("查询附件文档内容失败: {}", e.getMessage());
                }
            }
            if (docContent.length() > 0) {
                userPrompt = userPrompt + "\n\n--- 附件文档内容 ---\n" + docContent;
            }
        }

        String conversationId = sessionId + ":direct";
        final String finalUserPrompt = userPrompt;

        StringBuilder contentBuilder = new StringBuilder(answerPrefix);
        if (!answerPrefix.isEmpty()) {
            contentStreamPublisher.publishDelta(sessionId, nodeId, ContentStreamPublisher.Stage.DIRECT_ANSWER,
                    answerPrefix, contentBuilder);
        }
        SessionContextHolder.set(sessionId, nodeId, name());
        // 思考流与工具调用共存：采集由 ReasoningChatModelDecorator 在标准管线上完成
        // （webSearch/kb 启用时工具循环在装饰器内执行，不再因工具需求放弃采集）
        boolean reasoningCaptured = reasoningStreamHelper.isReasoningModel();
        String llmSpanId = chainPublisher.publishTraceStart(sessionId, "模型直接回答",
                AgentTraceEvent.Kind.LLM, nodeId,
                Map.of("promptLength", userPrompt.length(), "temperature", TEMPERATURE,
                        "webSearch", webSearchEnabled, "hasKnowledgeBases", !knowledgeBaseIds.isEmpty(),
                        "hasImages", multimodalContent != null && multimodalContent.hasImages(),
                        "reasoningCaptured", reasoningCaptured), null);
        try {
            ChatClient chatClient = chatClientFactory.create(TEMPERATURE);
            var baseSpec = chatClient.prompt()
                    .system(systemPrompt);

            // 多模态支持：如果有图片附件，构建 PromptUserSpec with Media
            ChatClient.ChatClientRequestSpec promptSpec;
            if (multimodalContent != null && multimodalContent.hasImages()) {
                try {
                    Media[] mediaArr = multimodalContent.getImageAttachments().stream()
                            .map(a -> {
                                try {
                                    return new Media(
                                            MimeType.valueOf(a.getMimeType()),
                                            new java.net.URI(a.getFileUrl()).toURL());
                                } catch (Exception ex) {
                                    throw new RuntimeException("Invalid URL: " + a.getFileUrl(), ex);
                                }
                            })
                            .toArray(Media[]::new);
                    promptSpec = baseSpec.user(u -> u.text(finalUserPrompt).media(mediaArr));
                } catch (Exception e) {
                    log.warn("构建多模态消息失败，降级为纯文本: {}", e.getMessage());
                    promptSpec = baseSpec.user(finalUserPrompt);
                }
            } else {
                promptSpec = baseSpec.user(finalUserPrompt);
            }

            promptSpec = AgentToolSupport.applyToolVisibility(
                    promptSpec, webSearchEnabled, explicitKnowledgeQa ? List.of() : knowledgeBaseIds);

            promptSpec.advisors(new MessageChatMemoryAdvisor(chatMemory))
                    .advisors(a -> a.param(
                            AbstractChatMemoryAdvisor.CHAT_MEMORY_CONVERSATION_ID_KEY,
                            conversationId));

            if (!explicitKnowledgeQa && longTermMemoryProperties.isEnabled()) {
                promptSpec = promptSpec.advisors(new LongTermMemoryAdvisor(
                        memoryService,
                        memoryPromptFormatter,
                        List.of(MemoryType.WRITING_PREFERENCE, MemoryType.DOMAIN_KNOWLEDGE),
                        sessionId,
                        null,
                        memoryProbeRecorder,
                        globalRerankConverger,
                        longTermMemoryProperties));
            }

            promptSpec.stream()
                    .content()
                    .doOnNext(chunk -> {
                        contentBuilder.append(chunk);
                        contentStreamPublisher.publishDelta(sessionId, nodeId,
                                ContentStreamPublisher.Stage.DIRECT_ANSWER, chunk, contentBuilder);
                    })
                    .then(Mono.just(contentBuilder.toString()))
                    .block(Duration.ofMinutes(5));
            chainPublisher.publishTraceComplete(sessionId, llmSpanId,
                    Map.of("outputLength", contentBuilder.length()));
        } catch (Exception e) {
            chainPublisher.publishTraceError(sessionId, llmSpanId, e.getMessage());
            chainPublisher.publishError(sessionId, nodeId, e.getMessage());
            SessionContextHolder.clear();
            throw e;
        } finally {
            SessionContextHolder.clear();
        }

        if (!knowledgeSourceFooter.isEmpty()) {
            contentBuilder.append(knowledgeSourceFooter);
            contentStreamPublisher.publishDelta(sessionId, nodeId, ContentStreamPublisher.Stage.DIRECT_ANSWER,
                    knowledgeSourceFooter, contentBuilder);
        }
        return completeAnswer(sessionId, nodeId, contentBuilder.toString());
    }

    private Map<String, Object> completeAnswer(String sessionId, String nodeId, String fullResponse) {
        log.info("[DirectAnswerWorker] 回答完成: length={}", fullResponse.length());
        chainPublisher.publishComplete(sessionId, nodeId,
                Map.of("length", fullResponse.length()), null);
        contentStreamPublisher.completeStage(sessionId, nodeId, ContentStreamPublisher.Stage.DIRECT_ANSWER, fullResponse);
        return Map.of("finalOutput", fullResponse);
    }

    private String truncate(String text, int maxLen) {
        if (text == null) return "";
        return text.length() <= maxLen ? text : text.substring(0, maxLen) + "...";
    }
}
