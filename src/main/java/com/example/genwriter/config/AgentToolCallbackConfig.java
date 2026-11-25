package com.example.genwriter.config;

import com.example.genwriter.agent.skill.SkillService;
import com.example.genwriter.agent.tool.AgentToolSupport;
import com.example.genwriter.agent.tool.KnowledgeBaseTool;
import com.example.genwriter.agent.tool.SaveSettingDetailTool;
import com.example.genwriter.agent.tool.TavilyWebSearchTool;
import com.example.genwriter.agent.tool.ToolResult;
import com.example.genwriter.agent.tool.UpdateWritingSkillTool;
import com.example.genwriter.agent.tool.subagent.SubAgentTools;
import com.example.genwriter.agent.tool.workspace.WorkspaceReadTools;
import com.example.genwriter.agent.tool.workspace.WorkspaceWriteTools;
import com.example.genwriter.service.workspace.WorkspaceExecutionSession;
import com.example.genwriter.service.workspace.WorkspaceExecutionSessionRegistry;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.ai.chat.model.ToolContext;
import org.springframework.ai.model.function.FunctionCallback;
import org.springframework.ai.tool.function.FunctionToolCallback;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.function.BiFunction;

@Configuration
public class AgentToolCallbackConfig {

    @Bean
    public FunctionCallback webSearchToolCallback(ObjectProvider<TavilyWebSearchTool> webSearchToolProvider,
                                                  ObjectProvider<WorkspaceExecutionSessionRegistry> sessionRegistryProvider,
                                                  ObjectProvider<ObjectMapper> objectMapperProvider) {
        BiFunction<TavilyWebSearchTool.WebSearchInput, ToolContext, String> gatedWebSearch =
                (input, toolContext) -> {
                    if (!AgentToolSupport.isWebSearchEnabled(toolContext)) {
                        return ToolResult.fail("web_search is disabled for this request. Continue without web search.").toJson();
                    }
                    String json = webSearchToolProvider.getObject().apply(input);
                    WorkspaceExecutionSession session = sessionRegistryProvider.getObject().resolve(toolContext);
                    if (session != null && json != null && !json.isBlank()) {
                        try {
                            JsonNode root = objectMapperProvider.getObject().readTree(json);
                            JsonNode sourcesNode = root.path("sources");
                            if (sourcesNode.isArray() && !sourcesNode.isEmpty()) {
                                List<Map<String, String>> collected = new ArrayList<>();
                                for (JsonNode urlNode : sourcesNode) {
                                    String url = urlNode.asText("");
                                    if (!url.isBlank()) {
                                        collected.add(Map.of("title", url, "url", url));
                                    }
                                }
                                session.addSources(collected);
                            }
                        } catch (Exception ignored) {
                            // Ignore malformed JSON during best-effort source tracking
                        }
                    }
                    return json;
                };

        return FunctionToolCallback
                .builder(AgentToolSupport.WEB_SEARCH, gatedWebSearch)
                .description("Search the web for current information, facts, data, or internet content.")
                .inputType(TavilyWebSearchTool.WebSearchInput.class)
                .build();
    }

    @Bean
    public FunctionCallback knowledgeBaseSearchToolCallback(ObjectProvider<KnowledgeBaseTool> knowledgeBaseToolProvider) {
        return FunctionToolCallback
                .builder(AgentToolSupport.KNOWLEDGE_BASE_SEARCH,
                        (BiFunction<KnowledgeBaseTool.KnowledgeSearchInput, ToolContext, String>) (input, ctx) ->
                                knowledgeBaseToolProvider.getObject().apply(input, ctx))
                .description("Search the reference knowledge bases configured for this project. Provide a query when the task needs reference material.")
                .inputType(KnowledgeBaseTool.KnowledgeSearchInput.class)
                .build();
    }

    @Bean
    public FunctionCallback workspaceOutlineToolCallback(ObjectProvider<WorkspaceReadTools> toolsProvider) {
        return FunctionToolCallback
                .builder("workspace_outline",
                        (BiFunction<WorkspaceReadTools.OutlineInput, ToolContext, String>) (input, ctx) ->
                                toolsProvider.getObject().outline(input, ctx))
                .description("Inspect the project's chapter tree, nodeIds, titles, versions, line/char counts, active focus node, and chapter summaries.")
                .inputType(WorkspaceReadTools.OutlineInput.class)
                .build();
    }

    @Bean
    public FunctionCallback workspaceReadToolCallback(ObjectProvider<WorkspaceReadTools> toolsProvider) {
        return FunctionToolCallback
                .builder("workspace_read",
                        (BiFunction<WorkspaceReadTools.ReadChapterInput, ToolContext, String>) (input, ctx) ->
                                toolsProvider.getObject().readChapter(input, ctx))
                .description("Read a chapter's content with 1-based line numbers (L1| ...), documentId and version. Supports pagination (startLine, lineCount) and headingsOnly=true.")
                .inputType(WorkspaceReadTools.ReadChapterInput.class)
                .build();
    }

    @Bean
    public FunctionCallback workspaceSearchToolCallback(ObjectProvider<WorkspaceReadTools> toolsProvider) {
        return FunctionToolCallback
                .builder("workspace_search",
                        (BiFunction<WorkspaceReadTools.SearchInput, ToolContext, String>) (input, ctx) ->
                                toolsProvider.getObject().search(input, ctx))
                .description("Search text or regex across saved (or current staged) chapters in the workspace and return matching nodeIds, titles, line numbers, and excerpts.")
                .inputType(WorkspaceReadTools.SearchInput.class)
                .build();
    }

    @Bean
    public FunctionCallback workspacePatchToolCallback(ObjectProvider<WorkspaceWriteTools> toolsProvider) {
        return FunctionToolCallback
                .builder("workspace_patch",
                        (BiFunction<WorkspaceWriteTools.PatchInput, ToolContext, String>) (input, ctx) ->
                                toolsProvider.getObject().patchChapter(input, ctx))
                .description("Apply targeted prose-friendly hunks (REPLACE, INSERT_AFTER, INSERT_BEFORE, APPEND, DELETE) to a chapter using exact anchor excerpts and optional nearLine disambiguation.")
                .inputType(WorkspaceWriteTools.PatchInput.class)
                .build();
    }

    @Bean
    public FunctionCallback workspaceWriteToolCallback(ObjectProvider<WorkspaceWriteTools> toolsProvider) {
        return FunctionToolCallback
                .builder("workspace_write",
                        (BiFunction<WorkspaceWriteTools.WriteInput, ToolContext, String>) (input, ctx) ->
                                toolsProvider.getObject().writeChapter(input, ctx))
                .description("Write or completely replace the full Markdown content of an existing chapter node.")
                .inputType(WorkspaceWriteTools.WriteInput.class)
                .build();
    }

    @Bean
    public FunctionCallback workspaceTreeToolCallback(ObjectProvider<WorkspaceWriteTools> toolsProvider) {
        return FunctionToolCallback
                .builder("workspace_tree",
                        (BiFunction<WorkspaceWriteTools.TreeInput, ToolContext, String>) (input, ctx) ->
                                toolsProvider.getObject().mutateTree(input, ctx))
                .description("Manage the chapter tree structure: action=CREATE, RENAME, MOVE, or DELETE.")
                .inputType(WorkspaceWriteTools.TreeInput.class)
                .build();
    }

    @Bean
    public FunctionCallback callResearcherToolCallback(ObjectProvider<SubAgentTools> toolsProvider) {
        return FunctionToolCallback
                .builder("call_researcher",
                        (BiFunction<SubAgentTools.ResearcherInput, ToolContext, String>) (input, ctx) ->
                                toolsProvider.getObject().callResearcher(input, ctx))
                .description("Delegate multi-round research across project knowledge bases and web search to the Researcher sub-agent and return a sourced report.")
                .inputType(SubAgentTools.ResearcherInput.class)
                .build();
    }

    @Bean
    public FunctionCallback callReviewerToolCallback(ObjectProvider<SubAgentTools> toolsProvider) {
        return FunctionToolCallback
                .builder("call_reviewer",
                        (BiFunction<SubAgentTools.ReviewerInput, ToolContext, String>) (input, ctx) ->
                                toolsProvider.getObject().callReviewer(input, ctx))
                .description("Delegate literary, structural, and factual quality review of a workspace chapter to the Review sub-agent.")
                .inputType(SubAgentTools.ReviewerInput.class)
                .build();
    }

    @Bean
    public FunctionCallback callSkillExtractorToolCallback(ObjectProvider<SubAgentTools> toolsProvider) {
        return FunctionToolCallback
                .builder("call_skill_extractor",
                        (BiFunction<SubAgentTools.SkillExtractorInput, ToolContext, String>) (input, ctx) ->
                                toolsProvider.getObject().callSkillExtractor(input, ctx))
                .description("Extract reusable writing skills/techniques from sample text or a chapter and save them to long-term memory.")
                .inputType(SubAgentTools.SkillExtractorInput.class)
                .build();
    }

    @Bean
    public FunctionCallback callOutlinePlannerToolCallback(ObjectProvider<SubAgentTools> toolsProvider) {
        return FunctionToolCallback
                .builder("call_outline_planner",
                        (BiFunction<SubAgentTools.OutlinePlannerInput, ToolContext, String>) (input, ctx) ->
                                toolsProvider.getObject().callOutlinePlanner(input, ctx))
                .description("Delegate narrative/structural blueprint design to the Outline sub-agent before creating or drafting chapters.")
                .inputType(SubAgentTools.OutlinePlannerInput.class)
                .build();
    }

    @Bean
    public FunctionCallback callDraftWriterToolCallback(ObjectProvider<SubAgentTools> toolsProvider) {
        return FunctionToolCallback
                .builder("call_draft_writer",
                        (BiFunction<SubAgentTools.DraftWriterInput, ToolContext, String>) (input, ctx) ->
                                toolsProvider.getObject().callDraftWriter(input, ctx))
                .description("Delegate full long-form chapter drafting to the high-creativity Draft Writer sub-agent; streams draft live and applies or stages it directly into the target chapter.")
                .inputType(SubAgentTools.DraftWriterInput.class)
                .build();
    }

    @Bean
    public FunctionCallback callPolisherToolCallback(ObjectProvider<SubAgentTools> toolsProvider) {
        return FunctionToolCallback
                .builder("call_polisher",
                        (BiFunction<SubAgentTools.PolisherInput, ToolContext, String>) (input, ctx) ->
                                toolsProvider.getObject().callPolisher(input, ctx))
                .description("Delegate full-chapter prose polishing to the Polish sub-agent; reads the current chapter and applies or stages the polished version.")
                .inputType(SubAgentTools.PolisherInput.class)
                .build();
    }

    @Bean
    public FunctionCallback saveSettingDetailToolCallback(ObjectProvider<SaveSettingDetailTool> saveSettingDetailToolProvider) {
        return FunctionToolCallback
                .builder("save_setting_detail",
                        (BiFunction<SaveSettingDetailTool.SaveSettingDetailInput, ToolContext, String>) (input, ctx) ->
                                saveSettingDetailToolProvider.getObject().applyWithContext(input, ctx))
                .description("Save a confirmed world setting, character profile, or foreshadowing plot detail to project long-term memory.")
                .inputType(SaveSettingDetailTool.SaveSettingDetailInput.class)
                .build();
    }

    @Bean
    public FunctionCallback updateWritingSkillToolCallback(ObjectProvider<UpdateWritingSkillTool> updateWritingSkillToolProvider) {
        return FunctionToolCallback
                .builder("update_writing_skill",
                        (BiFunction<UpdateWritingSkillTool.UpdateWritingSkillInput, ToolContext, String>) (input, ctx) ->
                                updateWritingSkillToolProvider.getObject().applyWithContext(input, ctx))
                .description("Save a reusable writing skill or style rule taught by the user to long-term memory.")
                .inputType(UpdateWritingSkillTool.UpdateWritingSkillInput.class)
                .build();
    }

    public record ReadSkillDetailInput(String skillName) {}

    @Bean
    public FunctionCallback readSkillDetailToolCallback(ObjectProvider<SkillService> skillServiceProvider) {
        return FunctionToolCallback
                .builder("read_skill_detail",
                        (java.util.function.Function<ReadSkillDetailInput, String>) input -> {
                            String skillName = input != null && input.skillName() != null ? input.skillName().trim() : "";
                            if (skillName.isBlank()) {
                                return ToolResult.fail("skillName 不能为空").toJson();
                            }
                            return skillServiceProvider.getObject().readSkillDetail(skillName);
                        })
                .description("Read the full detailed guideline of an enabled writing skill by skillName.")
                .inputType(ReadSkillDetailInput.class)
                .build();
    }
}
