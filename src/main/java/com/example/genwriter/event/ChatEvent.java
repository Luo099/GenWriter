package com.example.genwriter.event;

import com.example.genwriter.model.dto.MultimodalContent;
import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;

/**
 * 聊天事件
 *
 * 基于 Spring Event 机制。当用户发起聊天/写作请求时，系统会发布此事件。
 * 后台的异步监听器（@EventListener）会捕获此事件，并负责处理：
 * 1. 调用 AI 模型生成内容
 * 2. 通过 SSE 推送实时进度
 * 3. 结果持久化
 */
@Data
@NoArgsConstructor
@AllArgsConstructor
public class ChatEvent {

    /**
     * 任务会话 ID
     */
    private String sessionId;

    /**
     * 文档 ID（可选，新建时为空）
     */
    private String documentId;

    /**
     * 用户输入的多模态内容（文本 + 附件）
     */
    private MultimodalContent userInput;

    /**
     * 便捷方法：获取用户输入的纯文本
     */
    public String getUserInputText() {
        return userInput != null ? userInput.getTextOnly() : "";
    }

    /**
     * 本轮可检索的知识库 ID
     */
    private List<String> knowledgeBaseIds;

    /**
     * 写作类型
     */
    private WritingType type;

    /**
     * 是否启用联网搜索
     */
    private boolean webSearch = true;

    private com.example.genwriter.model.enums.AssistantMode mode;

    private String activeNodeId;

    private String activeUnsavedPreview;

    private com.example.genwriter.model.dto.workspace.WorkspaceModels.WritingTarget target;

    public ChatEvent(String sessionId,
                     String documentId,
                     MultimodalContent userInput,
                     List<String> knowledgeBaseIds,
                     WritingType type,
                     boolean webSearch,
                     com.example.genwriter.model.dto.workspace.WorkspaceModels.WritingTarget target) {
        this(sessionId, documentId, userInput, knowledgeBaseIds, type, webSearch, null, null, null, target);
    }

    /**
     * 写作类型枚举
     */
    public enum WritingType {
        /**
         * 自动识别（默认）
         */
        AUTO,

        /**
         * 新建文档
         */
        CREATE,

        /**
         * 文档续写
         */
        CONTINUE,

        /**
         * 文档润色
         */
        POLISH,

        /**
         * 基于知识库问答
         */
        KNOWLEDGE_QA
    }
}
