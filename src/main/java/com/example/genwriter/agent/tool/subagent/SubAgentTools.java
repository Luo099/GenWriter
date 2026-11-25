package com.example.genwriter.agent.tool.subagent;

import com.example.genwriter.agent.chain.ThoughtChainPublisher;
import com.example.genwriter.agent.skill.WritingGenreProfile;
import com.example.genwriter.agent.skill.WritingGenreResolver;
import com.example.genwriter.agent.supervisor.worker.DraftGenerationWorker;
import com.example.genwriter.agent.supervisor.worker.OutlineGenerationWorker;
import com.example.genwriter.agent.supervisor.worker.PolishWorker;
import com.example.genwriter.agent.supervisor.worker.ResearcherWorker;
import com.example.genwriter.agent.supervisor.worker.ReviewWorker;
import com.example.genwriter.agent.tool.AgentToolSupport;
import com.example.genwriter.agent.tool.SessionContextHolder;
import com.example.genwriter.agent.tool.ToolResult;
import com.example.genwriter.model.dto.response.LearningResultVO;
import com.example.genwriter.model.enums.AssistantMode;
import com.example.genwriter.service.WritingOutputSettingsService;
import com.example.genwriter.service.WritingSkillLearningService;
import com.example.genwriter.service.workspace.WorkspaceExecutionSession;
import com.example.genwriter.service.workspace.WorkspaceExecutionSessionRegistry;
import com.example.genwriter.service.workspace.WorkspaceMutationGateway;
import com.example.genwriter.service.workspace.WorkspaceMutationGateway.MutationOutcome;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.ai.chat.model.ToolContext;
import org.springframework.stereotype.Component;

import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;

/**
 * Exposes specialized writing/research/review sub-agents as callable tools for the workspace coordinator agent.
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class SubAgentTools {

    private final WorkspaceExecutionSessionRegistry sessionRegistry;
    private final WorkspaceMutationGateway gateway;
    private final ThoughtChainPublisher chainPublisher;
    private final WritingOutputSettingsService writingOutputSettingsService;
    private final WritingSkillLearningService skillLearningService;
    private final ResearcherWorker researcherWorker;
    private final ReviewWorker reviewWorker;
    private final OutlineGenerationWorker outlineGenerationWorker;
    private final DraftGenerationWorker draftGenerationWorker;
    private final PolishWorker polishWorker;
    private final ObjectMapper objectMapper;

    public record ResearcherInput(String query, String focus) {}

    public record ReviewerInput(String nodeId, String outline, String focus) {}

    public record SkillExtractorInput(String sampleText, String nodeId, String instruction) {}

    public record OutlinePlannerInput(String goal, String targetNodeId, String contextNotes) {}

    public record DraftWriterInput(String nodeId, String instruction, String outline,
                                   String contextNotes, String title, Boolean applyToChapter) {}

    public record PolisherInput(String nodeId, String instruction, String feedback, Boolean applyToChapter) {}

    public String callResearcher(ResearcherInput input, ToolContext toolContext) {
        WorkspaceExecutionSession session = sessionRegistry.resolve(toolContext);
        if (session == null) return ToolResult.fail("当前会话未关联作品工作区").toJson();
        String query = input != null && input.query() != null ? input.query() : "";
        if (query.isBlank()) return ToolResult.fail("调研问题 query 不能为空").toJson();

        return runWithSpan(session, toolContext, "call_researcher", Map.of("query", truncate(query, 120)), () -> {
            Map<String, Object> state = baseWorkerState(session, query);
            if (input.focus() != null && !input.focus().isBlank()) {
                state.put("context", input.focus());
            }
            Map<String, Object> out = researcherWorker.execute(state);
            String report = Objects.toString(out.get("researchReport"), "");
            String sourcesJson = Objects.toString(out.get("researchSources"), "[]");
            List<Map<String, String>> sources = List.of();
            try {
                sources = objectMapper.readValue(sourcesJson, new TypeReference<>() {});
            } catch (Exception ignored) {}
            session.addSources(sources);
            List<String> urls = sources.stream()
                    .map(s -> s.getOrDefault("url", ""))
                    .filter(u -> !u.isBlank())
                    .toList();
            return ToolResult.ok(report, urls, Map.of(
                    "sourcesCount", sources.size(),
                    "searchRounds", out.getOrDefault("searchRounds", 0))).toJson();
        });
    }

    public String callReviewer(ReviewerInput input, ToolContext toolContext) {
        WorkspaceExecutionSession session = sessionRegistry.resolve(toolContext);
        if (session == null) return ToolResult.fail("当前会话未关联作品工作区").toJson();
        String nodeId = input != null ? input.nodeId() : null;

        return runWithSpan(session, toolContext, "call_reviewer",
                Map.of("nodeId", nodeId != null ? nodeId : "(active)"), () -> {
                    WorkspaceMutationGateway.ChapterView chapter = gateway.readChapter(session, nodeId, 1, 1, false);
                    String fullText = gateway.readFullChapterText(session, chapter.nodeId());
                    if (fullText.isBlank()) {
                        return ToolResult.fail("目标章节「" + chapter.title() + "」正文为空，无法评审").toJson();
                    }
                    String focus = input != null && input.focus() != null ? input.focus() : "全面评审该章节质量";
                    Map<String, Object> state = baseWorkerState(session, focus);
                    state.put("polishedContent", fullText);
                    state.put("outline", input != null && input.outline() != null ? input.outline() : "");
                    state.put("reviewCount", 0);
                    Map<String, Object> out = reviewWorker.execute(state);
                    Map<String, Object> payload = new LinkedHashMap<>();
                    payload.put("nodeId", chapter.nodeId());
                    payload.put("title", chapter.title());
                    payload.put("verdict", out.get("reviewResult"));
                    payload.put("feedback", out.get("reviewFeedback"));
                    return ToolResult.ok(objectMapper.writeValueAsString(payload), null,
                            Map.of("verdict", Objects.toString(out.get("reviewResult"), ""))).toJson();
                });
    }

    public String callSkillExtractor(SkillExtractorInput input, ToolContext toolContext) {
        WorkspaceExecutionSession session = sessionRegistry.resolve(toolContext);
        if (session == null) return ToolResult.fail("当前会话未关联作品工作区").toJson();

        return runWithSpan(session, toolContext, "call_skill_extractor",
                Map.of("hasSample", input != null && input.sampleText() != null && !input.sampleText().isBlank()), () -> {
                    String sample = input != null ? input.sampleText() : null;
                    if ((sample == null || sample.isBlank()) && input != null && input.nodeId() != null) {
                        sample = gateway.readFullChapterText(session, input.nodeId());
                    }
                    if (sample == null || sample.isBlank()) {
                        return ToolResult.fail("请提供 sampleText 或指定非空章节 nodeId 用于提取写作技巧").toJson();
                    }
                    String content = (input != null && input.instruction() != null && !input.instruction().isBlank())
                            ? input.instruction() + "\n\n" + sample
                            : sample;
                    LearningResultVO result = skillLearningService.analyzeAndStore(
                            content, null, "PROJECT", session.getProjectId(), session.getSessionId());
                    return ToolResult.ok(objectMapper.writeValueAsString(result), null,
                            Map.of("storedCount", result.getStoredCount())).toJson();
                });
    }

    public String callOutlinePlanner(OutlinePlannerInput input, ToolContext toolContext) {
        WorkspaceExecutionSession session = sessionRegistry.resolve(toolContext);
        if (session == null) return ToolResult.fail("当前会话未关联作品工作区").toJson();
        if (session.getMode() != AssistantMode.GHOSTWRITE) {
            return ToolResult.fail("当前为对话模式（只读），禁止调用 call_outline_planner").toJson();
        }
        String goal = input != null && input.goal() != null ? input.goal() : "";
        if (goal.isBlank()) return ToolResult.fail("构思目标 goal 不能为空").toJson();

        return runWithSpan(session, toolContext, "call_outline_planner",
                Map.of("goal", truncate(goal, 120)), () -> {
                    Map<String, Object> state = baseWorkerState(session, goal);
                    StringBuilder ctx = new StringBuilder();
                    WorkspaceMutationGateway.OutlineView outlineView = gateway.outline(session, true);
                    ctx.append("作品：").append(outlineView.projectName()).append('\n');
                    if (outlineView.description() != null && !outlineView.description().isBlank()) {
                        ctx.append("设定与简介：").append(truncate(outlineView.description(), 1500)).append('\n');
                    }
                    if (input.targetNodeId() != null && !input.targetNodeId().isBlank()) {
                        String existing = gateway.readFullChapterText(session, input.targetNodeId());
                        if (!existing.isBlank()) {
                            ctx.append("目标节点已有内容参考：\n").append(truncate(existing, 2000)).append('\n');
                        }
                    }
                    if (input.contextNotes() != null && !input.contextNotes().isBlank()) {
                        ctx.append("补充约束：\n").append(input.contextNotes()).append('\n');
                    }
                    state.put("context", ctx.toString());
                    Map<String, Object> out = outlineGenerationWorker.execute(state);
                    String outline = Objects.toString(out.get("outline"), "");
                    return ToolResult.ok(outline, null, Map.of("length", outline.length())).toJson();
                });
    }

    public String callDraftWriter(DraftWriterInput input, ToolContext toolContext) {
        WorkspaceExecutionSession session = sessionRegistry.resolve(toolContext);
        if (session == null) return ToolResult.fail("当前会话未关联作品工作区").toJson();
        if (session.getMode() != AssistantMode.GHOSTWRITE) {
            return ToolResult.fail("当前为对话模式（只读），禁止调用 call_draft_writer").toJson();
        }
        String instruction = input != null && input.instruction() != null ? input.instruction() : "";
        if (instruction.isBlank()) return ToolResult.fail("写作指令 instruction 不能为空").toJson();

        boolean apply = input.applyToChapter() == null || input.applyToChapter();
        String requestedNode = input.nodeId();

        return runWithSpan(session, toolContext, "call_draft_writer",
                Map.of("nodeId", requestedNode != null ? requestedNode : "(active)", "apply", apply), () -> {
                    WorkspaceMutationGateway.ChapterView chapter = gateway.readChapter(session, requestedNode, 1, 1, false);
                    String existing = gateway.readFullChapterText(session, chapter.nodeId());

                    Map<String, Object> state = baseWorkerState(session, instruction);
                    state.put("outline", input.outline() != null ? input.outline() : "");
                    StringBuilder ctx = new StringBuilder();
                    if (input.contextNotes() != null && !input.contextNotes().isBlank()) {
                        ctx.append(input.contextNotes()).append("\n\n");
                    }
                    if (!existing.isBlank()) {
                        ctx.append("目标章节「").append(chapter.title()).append("」现有内容（供参考或重写/续写）：\n")
                                .append(existing);
                    }
                    state.put("context", ctx.toString());
                    Map<String, Object> out = draftGenerationWorker.execute(state);
                    String generated = Objects.toString(out.get("draft"), "");

                    Map<String, Object> payload = new LinkedHashMap<>();
                    payload.put("nodeId", chapter.nodeId());
                    payload.put("charCount", generated.length());
                    if (apply && !generated.isBlank()) {
                        MutationOutcome outcome = gateway.writeChapter(
                                session, chapter.nodeId(), null, input.title(), generated, instruction);
                        payload.put("applied", true);
                        payload.put("applyMode", outcome.applyMode().name());
                        payload.put("changeSetId", outcome.changeSetId());
                        payload.put("title", outcome.title());
                        payload.put("documentId", outcome.documentId());
                        payload.put("version", outcome.version());
                        payload.put("addedLines", outcome.diff().addedLines());
                        payload.put("removedLines", outcome.diff().removedLines());
                        payload.put("excerpt", truncate(generated, 500));
                    } else {
                        payload.put("applied", false);
                        payload.put("title", chapter.title());
                        payload.put("content", generated);
                    }
                    return ToolResult.ok(objectMapper.writeValueAsString(payload), null,
                            Map.of("nodeId", chapter.nodeId(), "length", generated.length())).toJson();
                });
    }

    public String callPolisher(PolisherInput input, ToolContext toolContext) {
        WorkspaceExecutionSession session = sessionRegistry.resolve(toolContext);
        if (session == null) return ToolResult.fail("当前会话未关联作品工作区").toJson();
        if (session.getMode() != AssistantMode.GHOSTWRITE) {
            return ToolResult.fail("当前为对话模式（只读），禁止调用 call_polisher").toJson();
        }
        boolean apply = input == null || input.applyToChapter() == null || input.applyToChapter();
        String requestedNode = input != null ? input.nodeId() : null;

        return runWithSpan(session, toolContext, "call_polisher",
                Map.of("nodeId", requestedNode != null ? requestedNode : "(active)", "apply", apply), () -> {
                    WorkspaceMutationGateway.ChapterView chapter = gateway.readChapter(session, requestedNode, 1, 1, false);
                    String original = gateway.readFullChapterText(session, chapter.nodeId());
                    if (original.isBlank()) {
                        return ToolResult.fail("目标章节「" + chapter.title() + "」正文为空，无法润色").toJson();
                    }
                    String instruction = input != null && input.instruction() != null && !input.instruction().isBlank()
                            ? input.instruction()
                            : "润色优化该章节语言节奏与表达";
                    Map<String, Object> state = baseWorkerState(session, instruction);
                    state.put("draft", original);
                    if (input != null && input.feedback() != null) {
                        state.put("reviewFeedback", input.feedback());
                    }
                    Map<String, Object> out = polishWorker.execute(state);
                    String polished = Objects.toString(out.get("polishedContent"), "");

                    Map<String, Object> payload = new LinkedHashMap<>();
                    payload.put("nodeId", chapter.nodeId());
                    payload.put("charCount", polished.length());
                    if (apply && !polished.isBlank()) {
                        MutationOutcome outcome = gateway.writeChapter(
                                session, chapter.nodeId(), null, null, polished, instruction);
                        payload.put("applied", true);
                        payload.put("applyMode", outcome.applyMode().name());
                        payload.put("changeSetId", outcome.changeSetId());
                        payload.put("title", outcome.title());
                        payload.put("documentId", outcome.documentId());
                        payload.put("version", outcome.version());
                        payload.put("addedLines", outcome.diff().addedLines());
                        payload.put("removedLines", outcome.diff().removedLines());
                        payload.put("excerpt", truncate(polished, 400));
                    } else {
                        payload.put("applied", false);
                        payload.put("title", chapter.title());
                        payload.put("content", polished);
                    }
                    return ToolResult.ok(objectMapper.writeValueAsString(payload), null,
                            Map.of("nodeId", chapter.nodeId(), "length", polished.length())).toJson();
                });
    }

    private Map<String, Object> baseWorkerState(WorkspaceExecutionSession session, String userInput) {
        WritingGenreProfile genreProfile = WritingGenreResolver.resolve(userInput);
        Map<String, Object> state = new HashMap<>();
        state.put("sessionId", session.getSessionId());
        state.put("userInput", userInput);
        state.put("knowledgeBaseIds", session.getKnowledgeBaseIds());
        state.put("webSearch", String.valueOf(session.isWebSearchEnabled()));
        state.put("writingGenre", genreProfile.genre().name());
        state.put("genreLabel", genreProfile.displayName());
        state.put("markdownEnabled", writingOutputSettingsService.isMarkdownEnabled());
        state.put("outputFormat", writingOutputSettingsService.currentFormat());
        // Mark as workspace run so Draft/Outline workers don't silently leak setting saves on un-adopted runs.
        state.put("writingTarget", Map.of(
                "projectId", session.getProjectId(),
                "nodeId", session.getActiveNodeId() != null ? session.getActiveNodeId() : "",
                "operation", session.getMode().name()));
        return state;
    }

    @FunctionalInterface
    private interface SubAgentAction {
        String run() throws Exception;
    }

    private String runWithSpan(WorkspaceExecutionSession session, ToolContext toolContext,
                               String toolName, Map<String, Object> traceInput, SubAgentAction action) {
        SessionContextHolder.ContextSnapshot previous = SessionContextHolder.snapshot();
        SessionContextHolder.ContextSnapshot ctx = AgentToolSupport.contextSnapshot(toolContext);
        if (ctx != null) {
            SessionContextHolder.restore(ctx);
        }
        String sessionId = session.getSessionId();
        String spanId = sessionId != null && !sessionId.isBlank()
                ? chainPublisher.publishToolStart(sessionId, toolName, traceInput)
                : null;
        if (spanId != null) {
            SessionContextHolder.set(sessionId, spanId, toolName, session.getRunId());
        } else {
            SessionContextHolder.setWorkspaceRunId(session.getRunId());
        }
        try {
            String resultJson = action.run();
            if (spanId != null) {
                chainPublisher.publishToolComplete(sessionId, spanId, toolName, traceInput);
            }
            return resultJson;
        } catch (Exception e) {
            log.warn("[SubAgentTools] {} failed: {}", toolName, e.getMessage(), e);
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
        return text.substring(0, maxLen) + "...";
    }
}
