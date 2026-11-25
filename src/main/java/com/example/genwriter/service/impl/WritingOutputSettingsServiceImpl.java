package com.example.genwriter.service.impl;

import com.example.genwriter.config.WritingProperties;
import com.example.genwriter.model.dto.response.WritingOutputSettings;
import com.example.genwriter.model.enums.GhostwriteApplyMode;
import com.example.genwriter.service.WritingOutputSettingsService;
import jakarta.annotation.PostConstruct;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

import java.util.List;

@Slf4j
@Service
public class WritingOutputSettingsServiceImpl implements WritingOutputSettingsService {

    private static final String PREFERENCE_KEY_APPLY_MODE = "ghostwrite_apply_mode";

    private final WritingProperties writingProperties;
    private final JdbcTemplate jdbcTemplate;

    private volatile boolean markdownEnabled = true;
    private volatile boolean parallelChapterWritingEnabled = false;
    private volatile GhostwriteApplyMode ghostwriteApplyMode = GhostwriteApplyMode.DIRECT_SNAPSHOT;
    private volatile boolean preferenceLoaded = false;

    public WritingOutputSettingsServiceImpl(WritingProperties writingProperties) {
        this(writingProperties, null);
    }

    @Autowired
    public WritingOutputSettingsServiceImpl(WritingProperties writingProperties,
                                            @Autowired(required = false) JdbcTemplate jdbcTemplate) {
        this.writingProperties = writingProperties;
        this.jdbcTemplate = jdbcTemplate;
    }

    @PostConstruct
    void init() {
        markdownEnabled = !"plain".equalsIgnoreCase(writingProperties.getDefaultFormat())
                && !"text".equalsIgnoreCase(writingProperties.getDefaultFormat());
        ghostwriteApplyMode = writingProperties.getDefaultGhostwriteApplyMode() != null
                ? writingProperties.getDefaultGhostwriteApplyMode()
                : GhostwriteApplyMode.DIRECT_SNAPSHOT;
        loadPersistedApplyMode();
    }

    @Override
    public WritingOutputSettings getSettings() {
        loadPersistedApplyMode();
        return new WritingOutputSettings(
                markdownEnabled,
                currentFormat(),
                parallelChapterWritingEnabled,
                ghostwriteApplyMode);
    }

    @Override
    public WritingOutputSettings updateMarkdownEnabled(boolean markdownEnabled) {
        return updateSettings(markdownEnabled, null, null);
    }

    @Override
    public WritingOutputSettings updateSettings(Boolean markdownEnabled, Boolean parallelChapterWritingEnabled) {
        return updateSettings(markdownEnabled, parallelChapterWritingEnabled, null);
    }

    @Override
    public WritingOutputSettings updateSettings(Boolean markdownEnabled,
                                                Boolean parallelChapterWritingEnabled,
                                                GhostwriteApplyMode ghostwriteApplyMode) {
        loadPersistedApplyMode();
        if (markdownEnabled != null) {
            this.markdownEnabled = markdownEnabled;
        }
        if (parallelChapterWritingEnabled != null) {
            this.parallelChapterWritingEnabled = parallelChapterWritingEnabled;
        }
        if (ghostwriteApplyMode != null) {
            this.ghostwriteApplyMode = ghostwriteApplyMode;
            persistApplyMode(ghostwriteApplyMode);
            this.preferenceLoaded = true;
        }
        return getSettings();
    }

    @Override
    public boolean isMarkdownEnabled() {
        return markdownEnabled;
    }

    @Override
    public boolean isParallelChapterWritingEnabled() {
        return parallelChapterWritingEnabled;
    }

    @Override
    public GhostwriteApplyMode getGhostwriteApplyMode() {
        loadPersistedApplyMode();
        return ghostwriteApplyMode;
    }

    @Override
    public String currentFormat() {
        return markdownEnabled ? "markdown" : "plain";
    }

    private synchronized void loadPersistedApplyMode() {
        if (preferenceLoaded || jdbcTemplate == null) {
            return;
        }
        try {
            List<String> values = jdbcTemplate.query(
                    "SELECT value FROM app_preference WHERE key = ?",
                    (rs, rowNum) -> rs.getString(1),
                    PREFERENCE_KEY_APPLY_MODE);
            if (!values.isEmpty() && values.get(0) != null && !values.get(0).isBlank()) {
                this.ghostwriteApplyMode = GhostwriteApplyMode.valueOf(values.get(0).trim());
            }
            this.preferenceLoaded = true;
        } catch (Exception e) {
            // Schema migration may run after bean init, or DB may be absent in slice tests.
            log.debug("读取持久化代笔写入偏好跳过: {}", e.getMessage());
        }
    }

    private void persistApplyMode(GhostwriteApplyMode mode) {
        if (jdbcTemplate == null || mode == null) {
            return;
        }
        try {
            jdbcTemplate.update("""
                    INSERT INTO app_preference(key, value, updated_at)
                    VALUES (?, ?, CURRENT_TIMESTAMP)
                    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = CURRENT_TIMESTAMP
                    """, PREFERENCE_KEY_APPLY_MODE, mode.name());
        } catch (Exception e) {
            log.warn("持久化代笔写入偏好失败，已保留运行时内存值: {}", e.getMessage());
        }
    }
}
