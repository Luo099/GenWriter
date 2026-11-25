package com.example.genwriter.model.dto.request;

import com.example.genwriter.model.enums.GhostwriteApplyMode;
import lombok.Data;

@Data
public class UpdateWritingOutputSettingsRequest {

    private Boolean markdownEnabled;

    private Boolean parallelChapterWritingEnabled;

    private GhostwriteApplyMode ghostwriteApplyMode;
}
