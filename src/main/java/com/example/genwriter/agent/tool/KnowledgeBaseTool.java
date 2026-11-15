package com.example.genwriter.agent.tool;

import com.example.genwriter.agent.chain.ThoughtChainPublisher;
import com.example.genwriter.mapper.KnowledgeBaseMapper;
import com.example.genwriter.model.dto.response.KnowledgeChunkDTO;
import com.example.genwriter.model.entity.KnowledgeBase;
import com.example.genwriter.service.RAGPipelineService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.ai.chat.model.ToolContext;
import org.springframework.stereotype.Component;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.stream.Collectors;

@Slf4j
@Component
@RequiredArgsConstructor
public class KnowledgeBaseTool {
    public static final String NO_MATCH = "所选知识库中未找到相关资料";
    public static final String RETRY_MESSAGE = "知识库检索失败，请稍后重试";

    private final RAGPipelineService ragPipelineService;
    private final KnowledgeBaseMapper knowledgeBaseMapper;
    private final ThoughtChainPublisher chainPublisher;

    public record KnowledgeSearchInput(String query, Integer topK) {
        public KnowledgeSearchInput {
            topK = topK == null || topK < 1 ? 5 : Math.min(topK, 20);
        }
    }

    public String apply(KnowledgeSearchInput input, ToolContext toolContext) {
        Map<String, Object> context = toolContext == null ? null : toolContext.getContext();
        List<String> ids = context == null ? List.of() : AgentToolSupport.knowledgeBaseIds(context);
        SessionContextHolder.ContextSnapshot trace = AgentToolSupport.contextSnapshot(toolContext);
        if (trace == null) {
            trace = SessionContextHolder.snapshot();
        }
        return search(input, ids, trace).toJson();
    }

    public ToolResult search(KnowledgeSearchInput input, List<String> ids, SessionContextHolder.ContextSnapshot trace) {
        if (ids.isEmpty()) {
            return ToolResult.fail("本轮没有可用的参考知识库");
        }
        if (input == null || input.query() == null || input.query().isBlank()) {
            return ToolResult.fail("检索关键词不能为空");
        }

        String sessionId = trace == null ? null : trace.sessionId();
        SessionContextHolder.ContextSnapshot previous = SessionContextHolder.snapshot();
        SessionContextHolder.restore(trace);
        try {
            return searchAndPublish(input, ids, sessionId);
        } finally {
            SessionContextHolder.restore(previous);
        }
    }

    private ToolResult searchAndPublish(KnowledgeSearchInput input, List<String> ids, String sessionId) {
        String spanId = sessionId == null || sessionId.isBlank() ? null
                : chainPublisher.publishToolStart(sessionId, AgentToolSupport.KNOWLEDGE_BASE_SEARCH,
                        Map.of("query", input.query(), "knowledgeBaseIds", ids.stream().distinct()
                                .collect(Collectors.toMap(id -> id, id -> true)), "topK", input.topK()));
        try {
            List<KnowledgeChunkDTO> chunks = ragPipelineService.searchAcrossKnowledgeBases(input.query(), ids, input.topK());
            List<String> matchedIds = chunks.stream().map(KnowledgeChunkDTO::getKbId).distinct().toList();
            Map<String, String> names = matchedIds.isEmpty() ? Map.of() : knowledgeBaseMapper.selectByIdBatch(matchedIds)
                    .stream().collect(Collectors.toMap(KnowledgeBase::getId, KnowledgeBase::getName));
            List<String> matchedNames = matchedIds.stream().map(id -> names.getOrDefault(id, id)).distinct().toList();
            Map<String, Map<String, String>> matches = new LinkedHashMap<>();
            for (KnowledgeChunkDTO chunk : chunks) {
                matches.put(chunk.getId(), Map.of("knowledgeBaseId", chunk.getKbId(),
                        "knowledgeBaseName", names.getOrDefault(chunk.getKbId(), chunk.getKbId())));
            }
            var metadata = Map.<String, Object>of(
                    "total", chunks.size(),
                    "knowledgeBaseIds", ids,
                    "matchedKnowledgeBases", matchedNames,
                    "matches", matches);
            String content = chunks.isEmpty() ? NO_MATCH : chunks.stream()
                    .map(chunk -> "【知识库：" + names.getOrDefault(chunk.getKbId(), chunk.getKbId()) + "】\n" + chunk.getContent())
                    .collect(Collectors.joining("\n\n"));
            List<String> sources = chunks.stream().map(KnowledgeChunkDTO::getMetadata)
                    .filter(Objects::nonNull).filter(source -> !source.isBlank()).toList();
            if (spanId != null) {
                chainPublisher.publishToolComplete(sessionId, spanId, AgentToolSupport.KNOWLEDGE_BASE_SEARCH,
                        Map.of("total", chunks.size(), "matches", matches));
            }
            return ToolResult.ok(content, sources, metadata);
        } catch (Exception e) {
            log.warn("知识库检索失败，知识库 ID 列表 {}", ids, e);
            if (spanId != null) {
                chainPublisher.publishToolError(sessionId, spanId, AgentToolSupport.KNOWLEDGE_BASE_SEARCH, RETRY_MESSAGE);
            }
            return ToolResult.fail(RETRY_MESSAGE);
        }
    }
}
