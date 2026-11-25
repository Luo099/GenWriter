package com.example.genwriter.model.enums;

/**
 * 代笔模式对工作区文章的写入策略（设置偏好中互斥二选一）。
 */
public enum GhostwriteApplyMode {
    /** 直接提交不可变新版本快照或更新目录，支持本轮一键回退。 */
    DIRECT_SNAPSHOT,
    /** 写入待确认变更集（候选），用户在前端审阅差异并点击采纳后生效。 */
    STAGED_CANDIDATE
}
