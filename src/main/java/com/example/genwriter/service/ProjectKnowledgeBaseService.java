package com.example.genwriter.service;

import com.example.genwriter.exception.BizException;
import lombok.RequiredArgsConstructor;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;

@Service
@RequiredArgsConstructor
public class ProjectKnowledgeBaseService {
    private final JdbcTemplate jdbc;
    private final NamedParameterJdbcTemplate namedJdbc;

    @Transactional(readOnly = true)
    public List<String> get(String projectId) {
        return readScope("project", "id", uuid(projectId), BizException.ErrorCode.PROJECT_NOT_FOUND).knowledgeBaseIds();
    }

    @Transactional
    public List<String> replace(String projectId, List<String> knowledgeBaseIds) {
        UUID project = uuid(projectId);
        if (jdbc.queryForList("SELECT id FROM project WHERE id = ? FOR UPDATE", UUID.class, project).isEmpty()) {
            throw new BizException(BizException.ErrorCode.PROJECT_NOT_FOUND);
        }
        if (knowledgeBaseIds == null) {
            throw new BizException("400", "请提供知识库列表");
        }
        List<UUID> ids = knowledgeBaseIds.stream().map(ProjectKnowledgeBaseService::uuid).distinct().sorted().toList();
        if (!ids.isEmpty()) {
            List<UUID> existing = namedJdbc.queryForList(
                    "SELECT id FROM knowledge_base WHERE id IN (:ids) ORDER BY id FOR KEY SHARE",
                    Map.of("ids", ids), UUID.class);
            if (existing.size() != ids.size()) {
                throw new BizException("400", "部分知识库已不存在，请刷新后重试");
            }
        }
        jdbc.update("DELETE FROM project_knowledge_base WHERE project_id = ?", project);
        if (!ids.isEmpty()) {
            jdbc.batchUpdate("INSERT INTO project_knowledge_base (project_id, kb_id) VALUES (?, ?)",
                    ids, ids.size(), (statement, id) -> {
                        statement.setObject(1, project);
                        statement.setObject(2, id);
                    });
        }
        return get(projectId);
    }

    @Transactional(readOnly = true)
    public List<String> resolveForChat(String sessionId, String legacyKbId) {
        Scope scope = readScope("task_session", "project_id", uuid(sessionId), BizException.ErrorCode.SESSION_NOT_FOUND);
        if (legacyKbId == null || legacyKbId.isBlank()) {
            return scope.knowledgeBaseIds();
        }
        UUID kbId = uuid(legacyKbId);
        if (scope.hasProject()) {
            if (!scope.knowledgeBaseIds().contains(kbId.toString())) {
                throw new BizException("403", "该知识库未配置为当前项目的参考知识库");
            }
        } else if (jdbc.queryForList("SELECT id FROM knowledge_base WHERE id = ?", UUID.class, kbId).isEmpty()) {
            throw new BizException(BizException.ErrorCode.KNOWLEDGE_BASE_NOT_FOUND);
        }
        return List.of(kbId.toString());
    }

    private Scope readScope(String table, String projectColumn, UUID id, BizException.ErrorCode missing) {
        // One statement sees a complete selection during a concurrent save.
        String sql = """
                SELECT owner.%s IS NOT NULL AS has_project, link.kb_id::text AS kb_id
                FROM %s owner LEFT JOIN project_knowledge_base link ON link.project_id = owner.%s
                WHERE owner.id = ? ORDER BY link.kb_id
                """.formatted(projectColumn, table, projectColumn);
        List<ScopeRow> rows = jdbc.query(sql, (rs, row) -> new ScopeRow(
                rs.getBoolean("has_project"), rs.getString("kb_id")), id);
        if (rows.isEmpty()) {
            throw new BizException(missing);
        }
        return new Scope(rows.get(0).hasProject(), rows.stream().map(ScopeRow::knowledgeBaseId)
                .filter(Objects::nonNull).toList());
    }

    private static UUID uuid(String value) {
        if (value != null) {
            try {
                UUID id = UUID.fromString(value);
                if (id.toString().equalsIgnoreCase(value)) {
                    return id;
                }
            } catch (IllegalArgumentException ignored) {
                // Fall through to the same validation error.
            }
        }
        throw new BizException("400", "ID 格式无效");
    }

    private record ScopeRow(boolean hasProject, String knowledgeBaseId) {}
    private record Scope(boolean hasProject, List<String> knowledgeBaseIds) {}
}
