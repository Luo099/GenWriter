package com.example.genwriter.model.enums;

/**
 * 创作助手会话模式：收敛为只读对话（CHAT）与 Agent 代笔（GHOSTWRITE）两类。
 */
public enum AssistantMode {
    CHAT,
    GHOSTWRITE;

    public static AssistantMode fromNullable(AssistantMode mode, AssistantMode fallback) {
        return mode != null ? mode : fallback;
    }
}
