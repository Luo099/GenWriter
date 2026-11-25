package com.example.genwriter.service;

import com.example.genwriter.model.dto.response.WritingOutputSettings;
import com.example.genwriter.model.enums.GhostwriteApplyMode;

public interface WritingOutputSettingsService {

    WritingOutputSettings getSettings();

    WritingOutputSettings updateMarkdownEnabled(boolean markdownEnabled);

    WritingOutputSettings updateSettings(Boolean markdownEnabled, Boolean parallelChapterWritingEnabled);

    default WritingOutputSettings updateSettings(Boolean markdownEnabled,
                                                 Boolean parallelChapterWritingEnabled,
                                                 GhostwriteApplyMode ghostwriteApplyMode) {
        return updateSettings(markdownEnabled, parallelChapterWritingEnabled);
    }

    boolean isMarkdownEnabled();

    boolean isParallelChapterWritingEnabled();

    default GhostwriteApplyMode getGhostwriteApplyMode() {
        return GhostwriteApplyMode.DIRECT_SNAPSHOT;
    }

    String currentFormat();
}
