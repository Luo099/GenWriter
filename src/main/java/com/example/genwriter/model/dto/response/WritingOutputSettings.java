package com.example.genwriter.model.dto.response;

import com.example.genwriter.model.enums.GhostwriteApplyMode;

public record WritingOutputSettings(boolean markdownEnabled,
                                    String format,
                                    boolean parallelChapterWritingEnabled,
                                    GhostwriteApplyMode ghostwriteApplyMode) {

    public WritingOutputSettings(boolean markdownEnabled, String format, boolean parallelChapterWritingEnabled) {
        this(markdownEnabled, format, parallelChapterWritingEnabled, GhostwriteApplyMode.DIRECT_SNAPSHOT);
    }
}
