package com.example.genwriter.service;

import com.example.genwriter.event.ChatEvent;
import com.example.genwriter.model.dto.MultimodalContent;
import com.example.genwriter.model.dto.workspace.WorkspaceModels.WritingTarget;
import lombok.AllArgsConstructor;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.stereotype.Service;

import java.util.List;

/**
 * 聊天服务
 * 发布聊天事件，触发异步处理
 */
@Service
@AllArgsConstructor
public class ChatService {

    private final ApplicationEventPublisher publisher;

    public void submitChatTask(String sessionId, String documentId, MultimodalContent userInput,
                               ChatEvent.WritingType type, boolean webSearch, List<String> knowledgeBaseIds,
                               WritingTarget target) {
        publisher.publishEvent(new ChatEvent(sessionId, documentId, userInput, List.copyOf(knowledgeBaseIds),
                type, webSearch, target));
    }
}
