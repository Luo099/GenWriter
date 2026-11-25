package com.example.genwriter.service;

import com.example.genwriter.exception.BizException;
import com.example.genwriter.model.dto.response.DocumentDTO;
import com.example.genwriter.model.dto.workspace.WorkspaceModels.*;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.OffsetDateTime;
import java.util.*;

/** Owns the work tree and its immutable snapshots; sessions only identify provenance. */
@Service
@RequiredArgsConstructor
public class WorkspaceService {
    private final JdbcTemplate jdbc;
    private final ObjectMapper json;
    private final ApplicationEventPublisher events;
    private final MessageService messages;

    public record ProjectOverview(String projectId, String name, String description, String rootId, List<ContentNode> nodes) {}
    public record NodeContent(ContentNode node, DocumentDTO document) {}

    @Transactional
    public ProjectOverview getProjectOverview(String projectId) {
        lockProject(projectId);
        Map<String, Object> projectRow = jdbc.queryForList(
                "SELECT name, COALESCE(description, '') AS description FROM project WHERE id = ?",
                uuid(projectId)).stream().findFirst()
                .orElseThrow(() -> new BizException(BizException.ErrorCode.PROJECT_NOT_FOUND));
        ContentNode root = ensureRoot(projectId);
        return new ProjectOverview(
                projectId,
                Objects.toString(projectRow.get("name"), "未命名作品"),
                Objects.toString(projectRow.get("description"), ""),
                root.id(),
                orderedNodes(projectId));
    }

    @Transactional(readOnly = true)
    public NodeContent readNodeContent(String projectId, String nodeId) {
        ContentNode target = node(projectId, nodeId);
        DocumentDTO doc = target.currentDocumentId() == null ? null : snapshot(target.currentDocumentId());
        return new NodeContent(target, doc);
    }

    @Transactional
    public DocumentDTO applyAgentSnapshot(String projectId, String nodeId, String expectedDocumentId,
                                          String title, String content, String instruction, String sessionId) {
        lockProject(projectId);
        ContentNode target = node(projectId, nodeId);
        if (expectedDocumentId != null) {
            requireBase(target, expectedDocumentId);
        }
        String validSession = existingSourceSession(projectId, sessionId);
        String resolvedTitle = blank(title) ? target.title() : title;
        return writeSnapshot(target, resolvedTitle, Objects.toString(content, ""), "markdown",
                Objects.toString(instruction, "代笔修改"),
                new SnapshotSource(validSession, null, "agent", sessionId));
    }

    @Transactional
    public NodeContent createAgentNode(String projectId, String requestedNodeId, String parentId,
                                       String afterNodeId, String title, String initialContent,
                                       String instruction, String sessionId) {
        lockProject(projectId);
        ContentNode root = ensureRoot(projectId);
        String resolvedParentId = blank(parentId) ? root.id() : parentId;
        node(projectId, resolvedParentId);
        List<ContentNode> siblings = children(projectId, resolvedParentId);
        Integer insertion = null;
        if (!blank(afterNodeId)) {
            ContentNode after = node(projectId, afterNodeId);
            if (!Objects.equals(after.parentId(), resolvedParentId)) {
                throw invalid("目标插入位置与父节点不匹配");
            }
            insertion = after.position() + 1;
        } else {
            insertion = siblings.size();
        }
        ContentNode created = insertNodeWithId(projectId, requestedNodeId, resolvedParentId, title, insertion);
        DocumentDTO doc = null;
        if (initialContent != null && !initialContent.isBlank()) {
            String validSession = existingSourceSession(projectId, sessionId);
            doc = writeSnapshot(created, created.title(), initialContent, "markdown",
                    Objects.toString(instruction, "代笔新建章节"),
                    new SnapshotSource(validSession, null, "agent", sessionId));
            created = node(projectId, created.id());
        }
        return new NodeContent(created, doc);
    }

    @Transactional
    public ChangeSet createChangeSet(String projectId, String sessionId, String runId, String applyMode, String summary) {
        lockProject(projectId);
        String id = UUID.randomUUID().toString();
        String validSession = existingSourceSession(projectId, sessionId);
        jdbc.update("""
                INSERT INTO workspace_change_set(id, project_id, session_id, source_session_id, run_id, apply_mode, status, summary)
                VALUES (?,?,?,?,?,?,?,?)
                """, uuid(id), uuid(projectId), uuid(validSession), uuid(sessionId),
                runId, applyMode, "DIRECT_SNAPSHOT".equals(applyMode) ? "APPLIED" : "PENDING",
                Objects.toString(summary, ""));
        if ("DIRECT_SNAPSHOT".equals(applyMode)) {
            jdbc.update("UPDATE workspace_change_set SET resolved_at=CURRENT_TIMESTAMP WHERE id=?", uuid(id));
        }
        return getChangeSet(projectId, id);
    }

    @Transactional
    public ChangeItem appendChangeItem(String projectId, String changeSetId, int seq, String action,
                                       String targetNodeId, String parentNodeId, String afterNodeId, Integer position,
                                       String baseDocumentId, String afterDocumentId, String title, String beforeTitle,
                                       String content, String diffPreview, Map<String, Object> stats,
                                       Map<String, Object> beforeTreeState, String status) {
        lockProject(projectId);
        getChangeSet(projectId, changeSetId);
        String itemId = UUID.randomUUID().toString();
        jdbc.update("""
                INSERT INTO workspace_change_item(
                    id, change_set_id, seq, action, target_node_id, parent_node_id, after_node_id, position,
                    base_document_id, after_document_id, title, before_title, content, diff_preview,
                    stats, before_tree_state, status)
                VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,CAST(? AS jsonb),CAST(? AS jsonb),?)
                """, uuid(itemId), uuid(changeSetId), seq, action,
                uuid(targetNodeId), uuid(parentNodeId), uuid(afterNodeId), position,
                uuid(baseDocumentId), uuid(afterDocumentId),
                limit(Objects.toString(title, ""), 500), limit(Objects.toString(beforeTitle, ""), 500),
                Objects.toString(content, ""), Objects.toString(diffPreview, ""),
                writeJson(stats), writeJson(beforeTreeState), status);
        return getChangeItem(changeSetId, itemId);
    }

    @Transactional
    public void updateChangeSetSummary(String projectId, String changeSetId, String summary) {
        lockProject(projectId);
        jdbc.update("UPDATE workspace_change_set SET summary=? WHERE id=? AND project_id=?",
                Objects.toString(summary, ""), uuid(changeSetId), uuid(projectId));
    }

    @Transactional(readOnly = true)
    public List<ChangeSet> listChangeSets(String projectId) {
        requireProject(projectId);
        List<ChangeSet> sets = jdbc.query(
                "SELECT * FROM workspace_change_set WHERE project_id=? ORDER BY created_at DESC LIMIT 100",
                CHANGE_SET, uuid(projectId));
        List<ChangeSet> enriched = new ArrayList<>(sets.size());
        for (ChangeSet set : sets) {
            enriched.add(withItems(set));
        }
        return enriched;
    }

    @Transactional(readOnly = true)
    public ChangeSet getChangeSet(String projectId, String changeSetId) {
        ChangeSet set = jdbc.query("SELECT * FROM workspace_change_set WHERE id=?", CHANGE_SET, uuid(changeSetId))
                .stream().findFirst().orElseThrow(() -> new BizException("404", "变更集不存在"));
        if (!projectId.equals(set.projectId())) throw forbidden();
        return withItems(set);
    }

    @Transactional
    public ChangeSet adoptChangeSet(String projectId, String changeSetId) {
        lockProject(projectId);
        ChangeSet set = getChangeSet(projectId, changeSetId);
        if ("APPLIED".equals(set.status())) {
            return set;
        }
        if (!"PENDING".equals(set.status())) {
            throw conflict("变更集当前状态为 " + set.status() + "，无法采纳");
        }
        ContentNode root = ensureRoot(projectId);
        Set<String> createdInSet = new HashSet<>();
        Set<String> verifiedExistingBase = new HashSet<>();
        String provenanceSession = existingSourceSession(projectId, set.sessionId());
        String originalSession = set.sourceSessionId();

        for (ChangeItem item : set.items()) {
            String action = item.action();
            String targetId = item.targetNodeId();
            if ("CREATE_NODE".equals(action)) {
                String parentId = blank(item.parentNodeId()) ? root.id() : item.parentNodeId();
                node(projectId, parentId);
                String newId = blank(targetId) ? UUID.randomUUID().toString() : targetId;
                NodeContent created = createAgentNode(projectId, newId, parentId, item.afterNodeId(),
                        item.title(), item.content(), "采纳代笔新建章节", originalSession);
                createdInSet.add(created.node().id());
                String afterDocId = created.document() != null ? created.document().getId() : null;
                jdbc.update("UPDATE workspace_change_item SET status='APPLIED', after_document_id=? WHERE id=?",
                        uuid(afterDocId), uuid(item.id()));
            } else {
                ContentNode target = node(projectId, targetId);
                if (!createdInSet.contains(targetId) && verifiedExistingBase.add(targetId)) {
                    requireBase(target, item.baseDocumentId());
                }
                if ("PATCH_CONTENT".equals(action) || "WRITE_CONTENT".equals(action)) {
                    String title = blank(item.title()) ? target.title() : item.title();
                    DocumentDTO saved = writeSnapshot(target, title, item.content(), "markdown",
                            "采纳代笔修改", new SnapshotSource(provenanceSession, item.id(), "agent", originalSession));
                    jdbc.update("UPDATE workspace_change_item SET status='APPLIED', after_document_id=? WHERE id=?",
                            uuid(saved.getId()), uuid(item.id()));
                } else if ("RENAME_NODE".equals(action)) {
                    renameNode(projectId, targetId, new NodeRequest(item.title(), null, null));
                    jdbc.update("UPDATE workspace_change_item SET status='APPLIED' WHERE id=?", uuid(item.id()));
                } else if ("MOVE_NODE".equals(action)) {
                    String parentId = blank(item.parentNodeId()) ? root.id() : item.parentNodeId();
                    int pos = item.position() != null ? item.position() : children(projectId, parentId).size();
                    moveNode(projectId, targetId, new MoveRequest(parentId, pos));
                    jdbc.update("UPDATE workspace_change_item SET status='APPLIED' WHERE id=?", uuid(item.id()));
                } else if ("DELETE_NODE".equals(action)) {
                    deleteNode(projectId, targetId);
                    jdbc.update("UPDATE workspace_change_item SET status='APPLIED' WHERE id=?", uuid(item.id()));
                }
            }
        }
        jdbc.update("UPDATE workspace_change_set SET status='APPLIED', resolved_at=CURRENT_TIMESTAMP WHERE id=?", uuid(changeSetId));
        return getChangeSet(projectId, changeSetId);
    }

    @Transactional
    public ChangeSet discardChangeSet(String projectId, String changeSetId) {
        lockProject(projectId);
        ChangeSet set = getChangeSet(projectId, changeSetId);
        if ("DISCARDED".equals(set.status())) return set;
        if (!"PENDING".equals(set.status())) {
            throw conflict("仅待确认变更集可以放弃");
        }
        jdbc.update("UPDATE workspace_change_item SET status='DISCARDED' WHERE change_set_id=?", uuid(changeSetId));
        jdbc.update("UPDATE workspace_change_set SET status='DISCARDED', resolved_at=CURRENT_TIMESTAMP WHERE id=?", uuid(changeSetId));
        return getChangeSet(projectId, changeSetId);
    }

    @Transactional
    public ChangeSet rollbackChangeSet(String projectId, String changeSetId) {
        lockProject(projectId);
        ChangeSet set = getChangeSet(projectId, changeSetId);
        if ("ROLLED_BACK".equals(set.status())) return set;
        if (!"APPLIED".equals(set.status())) {
            throw conflict("当前变更集尚未生效或已失效，无法回退");
        }
        List<ChangeItem> items = new ArrayList<>(set.items());
        // Track latest produced document per node and nodes created inside this changeset.
        Map<String, String> latestAfterDocByNode = new HashMap<>();
        Set<String> createdInSet = new HashSet<>();
        for (ChangeItem item : items) {
            if ("CREATE_NODE".equals(item.action()) && item.targetNodeId() != null) {
                createdInSet.add(item.targetNodeId());
            }
            if (item.targetNodeId() != null && !blank(item.afterDocumentId())) {
                latestAfterDocByNode.put(item.targetNodeId(), item.afterDocumentId());
            }
        }
        // Verify none of the touched nodes were independently edited after this changeset.
        for (var entry : latestAfterDocByNode.entrySet()) {
            ContentNode current = jdbc.query("SELECT * FROM content_node WHERE id=? AND NOT deleted", NODE, uuid(entry.getKey()))
                    .stream().findFirst().orElse(null);
            if (current != null && !Objects.equals(current.currentDocumentId(), entry.getValue())) {
                throw conflict("章节「" + current.title() + "」在代笔后又被修改过，请通过版本历史手动恢复");
            }
        }

        Collections.reverse(items);
        String validSession = existingSourceSession(projectId, set.sessionId());
        Set<String> restoredContentNodes = new HashSet<>();

        for (ChangeItem item : items) {
            String action = item.action();
            String targetId = item.targetNodeId();
            if ("PATCH_CONTENT".equals(action) || "WRITE_CONTENT".equals(action)) {
                if (createdInSet.contains(targetId)) {
                    // Node will be soft-deleted by its CREATE_NODE item in this reverse pass.
                    jdbc.update("UPDATE workspace_change_item SET status='ROLLED_BACK' WHERE id=?", uuid(item.id()));
                    continue;
                }
                // Find earliest baseDocumentId/beforeTitle for this node in forward order, apply once.
                if (restoredContentNodes.add(targetId)) {
                    ChangeItem earliest = set.items().stream()
                            .filter(it -> targetId.equals(it.targetNodeId())
                                    && ("PATCH_CONTENT".equals(it.action()) || "WRITE_CONTENT".equals(it.action())))
                            .findFirst().orElse(item);
                    ContentNode target = node(projectId, targetId);
                    String restoreContent = !blank(earliest.baseDocumentId())
                            ? Objects.toString(snapshot(earliest.baseDocumentId()).getContent(), "")
                            : "";
                    String restoreTitle = !blank(earliest.beforeTitle()) ? earliest.beforeTitle() : target.title();
                    writeSnapshot(target, restoreTitle, restoreContent, "markdown", "回退代笔修改",
                            new SnapshotSource(validSession, earliest.id(), "user", set.sourceSessionId()));
                }
            } else if ("CREATE_NODE".equals(action)) {
                ContentNode created = jdbc.query("SELECT * FROM content_node WHERE id=? AND NOT deleted", NODE, uuid(targetId))
                        .stream().findFirst().orElse(null);
                if (created != null) {
                    deleteNode(projectId, targetId);
                }
            } else if ("RENAME_NODE".equals(action)) {
                if (!createdInSet.contains(targetId) && !blank(item.beforeTitle())) {
                    renameNode(projectId, targetId, new NodeRequest(item.beforeTitle(), null, null));
                }
            } else if ("MOVE_NODE".equals(action)) {
                if (!createdInSet.contains(targetId)) {
                    Map<String, Object> before = item.beforeTreeState();
                    String prevParent = asString(before.get("parentId"));
                    int prevPos = before.get("position") instanceof Number n ? n.intValue() : 0;
                    if (!blank(prevParent)) {
                        moveNode(projectId, targetId, new MoveRequest(prevParent, prevPos));
                    }
                }
            } else if ("DELETE_NODE".equals(action)) {
                Map<String, Object> before = item.beforeTreeState();
                @SuppressWarnings("unchecked")
                List<String> deletedIds = before.get("deletedNodeIds") instanceof List<?> list
                        ? list.stream().map(String::valueOf).toList()
                        : List.of(targetId);
                for (String id : deletedIds) {
                    jdbc.update("UPDATE content_node SET deleted=FALSE, updated_at=CURRENT_TIMESTAMP WHERE id=? AND project_id=?",
                            uuid(id), uuid(projectId));
                }
                String prevParent = asString(before.get("parentId"));
                if (!blank(prevParent)) {
                    normalizeChildren(projectId, prevParent);
                }
            }
            jdbc.update("UPDATE workspace_change_item SET status='ROLLED_BACK' WHERE id=?", uuid(item.id()));
        }
        jdbc.update("UPDATE workspace_change_set SET status='ROLLED_BACK', resolved_at=CURRENT_TIMESTAMP WHERE id=?", uuid(changeSetId));
        return getChangeSet(projectId, changeSetId);
    }

    @Transactional
    public Candidate proposeSnapshot(String projectId, ProposalRequest request) {
        lockProject(projectId);
        ContentNode target = node(projectId, request.nodeId());
        requireBase(target, request.baseDocumentId());
        String sessionId = existingSourceSession(projectId, request.sourceSessionId());
        Candidate proposed = createCandidate(sessionId, new WritingTarget(projectId, target.id(), "REPLACE", null, null,
                target.currentDocumentId()), request.title(), request.content(), request.instruction(), "markdown");
        if (sessionId != null) {
            messages.createMessage(sessionId, "user", Objects.toString(request.instruction(), "选区修改"));
            messages.createMessage(sessionId, "assistant", request.content());
        }
        return proposed;
    }

    @Transactional
    public Workspace getWorkspace(String projectId) {
        lockProject(projectId);
        ContentNode root = ensureRoot(projectId);
        return new Workspace(projectId, root.id(), orderedNodes(projectId));
    }

    @Transactional
    public ContentNode createNode(String projectId, NodeRequest request) {
        lockProject(projectId);
        ContentNode root = ensureRoot(projectId);
        String parentId = blank(request.parentId()) ? root.id() : request.parentId();
        node(projectId, parentId);
        return insertNode(projectId, parentId, request.title(), request.position());
    }

    @Transactional
    public ContentNode renameNode(String projectId, String nodeId, NodeRequest request) {
        lockProject(projectId);
        node(projectId, nodeId);
        jdbc.update("UPDATE content_node SET title=?, updated_at=CURRENT_TIMESTAMP WHERE id=?", request.title().trim(), uuid(nodeId));
        return node(projectId, nodeId);
    }

    @Transactional
    public ContentNode moveNode(String projectId, String nodeId, MoveRequest request) {
        lockProject(projectId);
        ContentNode moving = node(projectId, nodeId);
        if (moving.root()) throw invalid("正文根节点不能移动");
        ContentNode parent = node(projectId, request.parentId());
        for (ContentNode cursor = parent; cursor != null; cursor = cursor.parentId() == null ? null : node(projectId, cursor.parentId())) {
            if (cursor.id().equals(nodeId)) throw invalid("不能将节点移动到自身或子节点内");
        }
        List<ContentNode> siblings = children(projectId, parent.id()).stream().filter(n -> !n.id().equals(nodeId)).toList();
        int position = position(request.position(), siblings.size());
        jdbc.update("UPDATE content_node SET parent_id=?, updated_at=CURRENT_TIMESTAMP WHERE id=?", uuid(parent.id()), uuid(nodeId));
        List<String> reordered = new ArrayList<>(siblings.stream().map(ContentNode::id).toList());
        reordered.add(position, nodeId);
        setPositions(reordered);
        if (!Objects.equals(moving.parentId(), parent.id())) normalizeChildren(projectId, moving.parentId());
        return node(projectId, nodeId);
    }

    @Transactional
    public void deleteNode(String projectId, String nodeId) {
        lockProject(projectId);
        ContentNode target = node(projectId, nodeId);
        if (target.root()) throw invalid("正文根节点不能删除");
        Set<String> deleting = new HashSet<>();
        deleting.add(nodeId);
        for (ContentNode entry : orderedNodes(projectId)) {
            if (deleting.contains(entry.parentId())) deleting.add(entry.id());
        }
        for (String id : deleting) {
            jdbc.update("UPDATE content_node SET deleted=TRUE, updated_at=CURRENT_TIMESTAMP WHERE id=?", uuid(id));
        }
        normalizeChildren(projectId, target.parentId());
    }

    @Transactional(readOnly = true)
    public List<DocumentDTO> versions(String projectId, String nodeId) {
        node(projectId, nodeId);
        return jdbc.query("SELECT * FROM document WHERE node_id=? ORDER BY version DESC", DOCUMENT, uuid(nodeId));
    }

    @Transactional
    public DocumentDTO saveSnapshot(String projectId, String nodeId, SaveRequest request) {
        lockProject(projectId);
        ContentNode target = node(projectId, nodeId);
        requireBase(target, request.baseDocumentId());
        String sessionId = existingSourceSession(projectId, request.sourceSessionId());
        return writeSnapshot(target, request.title(), request.content(), "markdown", "手动保存", new SnapshotSource(sessionId, null, "user", sessionId));
    }

    @Transactional(readOnly = true)
    public List<DocumentDTO> legacyDocuments(String projectId) {
        requireProject(projectId);
        return jdbc.query("SELECT * FROM document WHERE project_id=? AND node_id IS NULL ORDER BY updated_at DESC, version DESC", DOCUMENT, uuid(projectId));
    }

    @Transactional
    public Adoption importLegacy(String projectId, ImportRequest request) {
        lockProject(projectId);
        DocumentDTO legacy = snapshot(request.documentId());
        if (!Objects.equals(projectId, legacy.getProjectId()) || legacy.getNodeId() != null) throw forbidden();
        ContentNode root = ensureRoot(projectId);
        String parentId = blank(request.parentId()) ? root.id() : request.parentId();
        node(projectId, parentId);
        ContentNode imported = insertNode(projectId, parentId, legacy.getTitle(), null);
        DocumentDTO document = writeSnapshot(imported, legacy.getTitle(), Objects.toString(legacy.getContent(), ""),
                Objects.toString(legacy.getFormat(), "markdown"), "导入历史文稿", new SnapshotSource(legacy.getSessionId(), legacy.getId(), "import", legacyOrigin(legacy)));
        return new Adoption(node(projectId, imported.id()), document, null);
    }

    /** Freeze the target before publishing the asynchronous chat event. */
    @Transactional
    public WritingTarget prepareTarget(String sessionId, WritingTarget requested, String legacyDocumentId) {
        List<String> projects = jdbc.query("SELECT project_id::text FROM task_session WHERE id=?", (rs, n) -> rs.getString(1), uuid(sessionId));
        if (projects.isEmpty()) throw new BizException(BizException.ErrorCode.SESSION_NOT_FOUND);
        String projectId = projects.get(0);
        if (blank(projectId)) {
            if (requested != null && !"DISCUSS".equalsIgnoreCase(requested.operation())) throw invalid("请先将会话放入作品项目");
            if (!blank(legacyDocumentId) && !Objects.equals(snapshot(legacyDocumentId).getSessionId(), sessionId)) throw forbidden();
            return new WritingTarget(null, null, "DISCUSS", null, null, blank(legacyDocumentId) ? null : legacyDocumentId);
        }
        lockProject(projectId);
        ContentNode root = ensureRoot(projectId);
        if (requested == null) {
            String selected = root.id();
            if (!blank(legacyDocumentId)) {
                DocumentDTO document = snapshot(legacyDocumentId);
                if (!Objects.equals(projectId, document.getProjectId())) throw forbidden();
                if (document.getNodeId() != null) selected = document.getNodeId();
            }
            ContentNode current = node(projectId, selected);
            return new WritingTarget(projectId, selected, "DISCUSS", null, null, current.currentDocumentId());
        }
        if (!blank(requested.projectId()) && !projectId.equals(requested.projectId())) throw forbidden();
        String operation = Objects.toString(requested.operation(), "DISCUSS").toUpperCase(Locale.ROOT);
        if (!Set.of("DISCUSS", "REPLACE", "APPEND", "CREATE_NODE").contains(operation)) throw invalid("未知写入操作");
        ContentNode target = node(projectId, blank(requested.nodeId()) ? root.id() : requested.nodeId());
        if (!operation.equals("DISCUSS")) requireBase(target, requested.baseDocumentId());
        String parentId = null;
        String afterId = null;
        if (operation.equals("CREATE_NODE")) {
            parentId = blank(requested.parentId()) ? (target.root() ? root.id() : target.parentId()) : requested.parentId();
            node(projectId, parentId);
            afterId = requested.afterNodeId();
            if (!blank(afterId) && !parentId.equals(node(projectId, afterId).parentId())) throw invalid("新增位置不属于所选父节点");
        }
        return new WritingTarget(projectId, target.id(), operation, parentId, afterId, target.currentDocumentId());
    }

    /**
     * Resolve target context for the unified CHAT / GHOSTWRITE workspace modes without requiring legacy operations.
     */
    @Transactional
    public WritingTarget prepareModeTarget(String sessionId,
                                           com.example.genwriter.model.enums.AssistantMode mode,
                                           String activeNodeId,
                                           String legacyDocumentId) {
        List<String> projects = jdbc.query("SELECT project_id::text FROM task_session WHERE id=?", (rs, n) -> rs.getString(1), uuid(sessionId));
        if (projects.isEmpty()) throw new BizException(BizException.ErrorCode.SESSION_NOT_FOUND);
        String projectId = projects.get(0);
        if (blank(projectId)) {
            if (mode == com.example.genwriter.model.enums.AssistantMode.GHOSTWRITE) {
                throw invalid("请先将会话放入作品项目后再使用代笔模式");
            }
            if (!blank(legacyDocumentId) && !Objects.equals(snapshot(legacyDocumentId).getSessionId(), sessionId)) {
                throw forbidden();
            }
            return new WritingTarget(null, null, "DISCUSS", null, null, blank(legacyDocumentId) ? null : legacyDocumentId);
        }
        lockProject(projectId);
        ContentNode root = ensureRoot(projectId);
        String selected = null;
        if (!blank(activeNodeId)) {
            selected = node(projectId, activeNodeId).id();
        } else if (!blank(legacyDocumentId)) {
            DocumentDTO document = snapshot(legacyDocumentId);
            if (!Objects.equals(projectId, document.getProjectId())) throw forbidden();
            selected = document.getNodeId();
        }
        if (blank(selected)) {
            selected = root.id();
        }
        ContentNode current = node(projectId, selected);
        String operation = mode == com.example.genwriter.model.enums.AssistantMode.GHOSTWRITE ? "AGENT" : "DISCUSS";
        return new WritingTarget(projectId, current.id(), operation, null, null, current.currentDocumentId());
    }

    @Transactional
    public Candidate createCandidate(String sessionId, WritingTarget target, String title, String content, String instruction, String format) {
        lockProject(target.projectId());
        node(target.projectId(), target.nodeId());
        String id = UUID.randomUUID().toString();
        String source = existingSourceSession(target.projectId(), sessionId);
        jdbc.update("""
                INSERT INTO writing_candidate(id,project_id,session_id,source_session_id,target_node_id,parent_node_id,
                    after_node_id,operation,base_document_id,title,content,instruction,format)
                VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
                """, uuid(id), uuid(target.projectId()), uuid(source), uuid(sessionId), uuid(target.nodeId()),
                uuid(target.parentId()), uuid(target.afterNodeId()), target.operation(), uuid(target.baseDocumentId()),
                safeTitle(title), content, Objects.toString(instruction, ""), Objects.toString(format, "markdown"));
        return candidate(target.projectId(), id);
    }

    @Transactional(readOnly = true)
    public List<Candidate> candidates(String projectId) {
        requireProject(projectId);
        return jdbc.query("SELECT * FROM writing_candidate WHERE project_id=? ORDER BY created_at DESC", CANDIDATE, uuid(projectId));
    }

    @Transactional
    public Adoption adopt(String projectId, String candidateId) {
        // Serializes saves, tree mutations and adoption, including concurrent/repeated adoption requests.
        lockProject(projectId);
        Candidate candidate = candidate(projectId, candidateId);
        if (candidate.status().equals("ADOPTED")) {
            return new Adoption(node(projectId, candidate.acceptedNodeId()), snapshot(candidate.acceptedDocumentId()), candidate);
        }
        ContentNode target = node(projectId, candidate.targetNodeId());
        requireBase(target, candidate.baseDocumentId());
        String content = candidate.content();
        if (candidate.operation().equals("CREATE_NODE")) {
            node(projectId, candidate.parentNodeId());
            int insertion = children(projectId, candidate.parentNodeId()).size();
            if (!blank(candidate.afterNodeId())) {
                ContentNode after = node(projectId, candidate.afterNodeId());
                if (!Objects.equals(after.parentId(), candidate.parentNodeId())) throw conflict("目录位置已改变，请重新生成新增章节候选");
                insertion = after.position() + 1;
            }
            target = insertNode(projectId, candidate.parentNodeId(), candidate.title(), insertion);
        } else if (candidate.operation().equals("APPEND") && target.currentDocumentId() != null) {
            content = Objects.toString(snapshot(target.currentDocumentId()).getContent(), "") + "\n\n" + content;
        }
        DocumentDTO document = writeSnapshot(target, candidate.operation().equals("CREATE_NODE") ? candidate.title() : target.title(),
                content, candidate.format(), candidate.instruction(), new SnapshotSource(existingSourceSession(projectId, candidate.sessionId()), candidate.id(), "agent", candidate.sourceSessionId()));
        jdbc.update("UPDATE writing_candidate SET status='ADOPTED', accepted_document_id=?, accepted_node_id=?, adopted_at=CURRENT_TIMESTAMP WHERE id=?",
                uuid(document.getId()), uuid(target.id()), uuid(candidateId));
        return new Adoption(node(projectId, target.id()), document, candidate(projectId, candidateId));
    }

    @Transactional
    public String wholeContent(String projectId) {
        lockProject(projectId);
        ensureRoot(projectId);
        StringBuilder result = new StringBuilder();
        Map<String, Integer> depths = new HashMap<>();
        for (ContentNode entry : orderedNodes(projectId)) {
            int depth = entry.root() ? 0 : depths.getOrDefault(entry.parentId(), 0) + 1;
            depths.put(entry.id(), depth);
            if (!entry.root()) result.append("#".repeat(Math.min(6, depth + 1))).append(" ").append(entry.title()).append("\n\n");
            if (entry.currentDocumentId() != null) result.append(Objects.toString(snapshot(entry.currentDocumentId()).getContent(), "")).append("\n\n");
        }
        return result.toString().trim();
    }

    @Transactional(readOnly = true)
    public String writingContext(WritingTarget target) {
        if (target == null) return "";
        if (target.projectId() == null) return "\n本次为历史独立会话的自由讨论，不自动写入作品正文。\n";
        List<ContentNode> ordered = orderedNodes(target.projectId());
        String description = jdbc.queryForObject("SELECT COALESCE(description,'') FROM project WHERE id=?", String.class, uuid(target.projectId()));
        StringBuilder result = new StringBuilder("\n## 作品目标与约束\n").append(limit(description, 4000)).append("\n## 作品目录\n");
        for (ContentNode entry : ordered) {
            if (result.length() > 16000) { result.append("（其余目录省略）\n"); break; }
            result.append(entry.id().equals(target.nodeId()) ? "当前：" : "- ").append(entry.title()).append('\n');
        }
        List<ContentNode> preceding = new ArrayList<>();
        Map<String, ContentNode> byId = new HashMap<>();
        ordered.forEach(entry -> byId.put(entry.id(), entry));
        Deque<ContentNode> ancestors = new ArrayDeque<>();
        ContentNode selected = byId.get(target.nodeId());
        for (ContentNode ancestor = selected == null ? null : byId.get(selected.parentId()); ancestor != null; ancestor = byId.get(ancestor.parentId())) ancestors.push(ancestor);
        result.append("\n## 上层节点的已保存约束与正文\n");
        Set<String> ancestorIds = new HashSet<>();
        for (ContentNode ancestor : ancestors) {
            ancestorIds.add(ancestor.id());
            if (ancestor.currentDocumentId() != null) {
                String text = blank(ancestor.summary()) ? snapshot(ancestor.currentDocumentId()).getContent() : ancestor.summary();
                result.append(ancestor.title()).append(": ").append(limit(text, 1200)).append('\n');
            }
            if (result.length() > 28000) break;
        }
        for (ContentNode entry : ordered) { if (entry.id().equals(target.nodeId())) break; if (entry.currentDocumentId() != null && !ancestorIds.contains(entry.id())) preceding.add(entry); }
        result.append("\n## 前序正文（只含已保存版本）\n");
        for (ContentNode entry : preceding.subList(Math.max(0, preceding.size() - 12), preceding.size())) {
            String summary = entry.summary();
            if (blank(summary)) summary = limit(snapshot(entry.currentDocumentId()).getContent(), 700);
            result.append(entry.title()).append(": ").append(limit(summary, 900)).append('\n');
        }
        result.append("\n会话中的试写和候选仅供讨论，不能替代作品已保存正文和明确确认的设定。\n");
        switch (target.operation()) {
            case "APPEND" -> result.append("本次只输出当前正文之后新增的续写段落，不要重复原文，不另起下一章。\n");
            case "CREATE_NODE" -> result.append("本次生成一个新章节的完整正文；新章节仍是待采纳候选，不修改原章节。\n");
            case "REPLACE" -> result.append("本次输出目标节点修改后的完整正文，供用户预览采纳。\n");
            default -> result.append("本次为自由讨论，结果不会自动写入作品正文。\n");
        }
        return result.toString();
    }

    public DocumentDTO snapshot(String documentId) {
        return jdbc.query("SELECT * FROM document WHERE id=?", DOCUMENT, uuid(documentId)).stream().findFirst()
                .orElseThrow(() -> new BizException(BizException.ErrorCode.DOCUMENT_NOT_FOUND));
    }

    public boolean isCurrentSnapshot(String nodeId, String documentId) {
        return jdbc.queryForObject("SELECT COUNT(*) FROM content_node WHERE id=? AND current_document_id=? AND NOT deleted", Integer.class, uuid(nodeId), uuid(documentId)) > 0;
    }

    @Transactional(propagation = org.springframework.transaction.annotation.Propagation.REQUIRES_NEW)
    public void storeSummary(String nodeId, String documentId, String summary) {
        jdbc.update("UPDATE content_node SET summary=?, summary_document_id=? WHERE id=? AND current_document_id=? AND NOT deleted",
                summary, uuid(documentId), uuid(nodeId), uuid(documentId));
    }

    private record SnapshotSource(String sessionId, String sourceId, String kind, String originalSessionId) {}

    private String legacyOrigin(DocumentDTO document) {
        if (blank(document.getMetadata())) return document.getSessionId();
        try {
            var metadata = json.readTree(document.getMetadata());
            return metadata == null ? document.getSessionId() : metadata.path("sourceSessionId").asText(document.getSessionId());
        } catch (JsonProcessingException ignored) { return document.getSessionId(); }
    }

    private DocumentDTO writeSnapshot(ContentNode target, String title, String content, String format, String instruction, SnapshotSource source) {
        String id = UUID.randomUUID().toString();
        int version = target.version() + 1;
        Map<String, Object> metadata = new LinkedHashMap<>();
        metadata.put("sourceSessionId", source.originalSessionId());
        metadata.put("derivedFromDocumentId", target.currentDocumentId());
        metadata.put("derivedFromVersion", target.version() > 0 ? target.version() : null);
        metadata.put("sourceId", source.sourceId());
        metadata.put("generatedBy", source.kind());
        if (source.kind().equals("user")) metadata.put("createdBy", "user");
        metadata.put("instruction", instruction);
        String metadataJson;
        try { metadataJson = json.writeValueAsString(metadata); }
        catch (JsonProcessingException e) { throw new IllegalStateException("无法保存快照来源", e); }
        jdbc.update("""
                INSERT INTO document(id,project_id,node_id,session_id,title,type,content,format,version,status,metadata)
                VALUES (?,?,?,?,?,'draft',?,?,?,'editing',CAST(? AS jsonb))
                """, uuid(id), uuid(target.projectId()), uuid(target.id()), uuid(source.sessionId()), safeTitle(title), content, format, version, metadataJson);
        jdbc.update("UPDATE content_node SET current_document_id=?, current_version=?, title=?, summary='', summary_document_id=NULL, updated_at=CURRENT_TIMESTAMP WHERE id=?",
                uuid(id), version, safeTitle(title), uuid(target.id()));
        events.publishEvent(new SnapshotSaved(target.projectId(), target.id(), id, source.sessionId(), safeTitle(title), content, instruction));
        return snapshot(id);
    }

    private ContentNode ensureRoot(String projectId) {
        List<ContentNode> roots = jdbc.query("SELECT * FROM content_node WHERE project_id=? AND is_root", NODE, uuid(projectId));
        if (!roots.isEmpty()) return roots.get(0);
        String id = UUID.randomUUID().toString();
        jdbc.update("INSERT INTO content_node(id,project_id,title,is_root) VALUES (?,?,'正文',TRUE)", uuid(id), uuid(projectId));
        return node(projectId, id);
    }

    private ContentNode insertNode(String projectId, String parentId, String title, Integer requestedPosition) {
        return insertNodeWithId(projectId, null, parentId, title, requestedPosition);
    }

    private ContentNode insertNodeWithId(String projectId, String requestedId, String parentId, String title, Integer requestedPosition) {
        List<ContentNode> siblings = children(projectId, parentId);
        int insertion = position(requestedPosition, siblings.size());
        String id = blank(requestedId) ? UUID.randomUUID().toString() : requestedId;
        jdbc.update("INSERT INTO content_node(id,project_id,parent_id,title,position) VALUES (?,?,?,?,?)", uuid(id), uuid(projectId), uuid(parentId), safeTitle(title), insertion);
        List<String> reordered = new ArrayList<>(siblings.stream().map(ContentNode::id).toList());
        reordered.add(insertion, id);
        setPositions(reordered);
        return node(projectId, id);
    }

    private ContentNode node(String projectId, String id) {
        ContentNode result = jdbc.query("SELECT * FROM content_node WHERE id=? AND NOT deleted", NODE, uuid(id)).stream().findFirst()
                .orElseThrow(() -> new BizException("404", "正文节点不存在或已删除"));
        if (!result.projectId().equals(projectId)) throw forbidden();
        return result;
    }

    private List<ContentNode> children(String projectId, String parentId) {
        return jdbc.query("SELECT * FROM content_node WHERE project_id=? AND parent_id=? AND NOT deleted ORDER BY position,created_at,id", NODE, uuid(projectId), uuid(parentId));
    }

    private List<ContentNode> orderedNodes(String projectId) {
        List<ContentNode> flat = jdbc.query("SELECT * FROM content_node WHERE project_id=? AND NOT deleted ORDER BY position,created_at,id", NODE, uuid(projectId));
        Map<String, List<ContentNode>> children = new HashMap<>();
        for (ContentNode entry : flat) children.computeIfAbsent(Objects.toString(entry.parentId(), ""), ignored -> new ArrayList<>()).add(entry);
        Deque<Iterator<ContentNode>> stack = new ArrayDeque<>();
        stack.push(children.getOrDefault("", List.of()).iterator());
        List<ContentNode> ordered = new ArrayList<>();
        while (!stack.isEmpty()) {
            if (!stack.peek().hasNext()) { stack.pop(); continue; }
            ContentNode next = stack.peek().next();
            ordered.add(next);
            stack.push(children.getOrDefault(next.id(), List.of()).iterator());
        }
        return ordered;
    }

    private Candidate candidate(String projectId, String id) {
        Candidate result = jdbc.query("SELECT * FROM writing_candidate WHERE id=?", CANDIDATE, uuid(id)).stream().findFirst()
                .orElseThrow(() -> new BizException("404", "候选不存在"));
        if (!projectId.equals(result.projectId())) throw forbidden();
        return result;
    }

    private void requireProject(String projectId) {
        if (jdbc.queryForObject("SELECT COUNT(*) FROM project WHERE id=?", Integer.class, uuid(projectId)) == 0)
            throw new BizException(BizException.ErrorCode.PROJECT_NOT_FOUND);
    }

    private void lockProject(String projectId) {
        if (jdbc.queryForList("SELECT id FROM project WHERE id=? FOR UPDATE", uuid(projectId)).isEmpty())
            throw new BizException(BizException.ErrorCode.PROJECT_NOT_FOUND);
    }

    private String existingSourceSession(String projectId, String sessionId) {
        if (blank(sessionId)) return null;
        List<String> projects = jdbc.query("SELECT project_id::text FROM task_session WHERE id=?", (rs, n) -> rs.getString(1), uuid(sessionId));
        if (projects.isEmpty()) return null;
        if (!projectId.equals(projects.get(0))) throw forbidden();
        return sessionId;
    }

    private void normalizeChildren(String projectId, String parentId) { setPositions(children(projectId, parentId).stream().map(ContentNode::id).toList()); }
    private void setPositions(List<String> ids) { for (int i = 0; i < ids.size(); i++) jdbc.update("UPDATE content_node SET position=? WHERE id=?", i, uuid(ids.get(i))); }
    private static int position(Integer requested, int size) { if (requested != null && requested < 0) throw invalid("排序位置不能为负数"); return requested == null ? size : Math.min(requested, size); }
    private static void requireBase(ContentNode target, String base) { if (!Objects.equals(target.currentDocumentId(), blank(base) ? null : base)) throw conflict("正文已变化，请保存当前修改并基于最新正文重新生成候选"); }
    private static boolean blank(String value) { return value == null || value.isBlank(); }
    private static UUID uuid(String value) { return blank(value) ? null : UUID.fromString(value); }
    private static String safeTitle(String title) { String value = blank(title) ? "未命名章节" : title.trim(); if (value.length() > 500) throw invalid("标题不能超过 500 字符"); return value; }
    private static String limit(String value, int length) { return value == null ? "" : value.substring(0, Math.min(value.length(), length)); }
    private static BizException invalid(String message) { return new BizException("400", message); }
    private static BizException conflict(String message) { return new BizException("409", message); }
    private static BizException forbidden() { return new BizException(BizException.ErrorCode.FORBIDDEN); }
    private static String id(ResultSet rs, String name) throws SQLException { return rs.getString(name); }

    private static final RowMapper<ContentNode> NODE = (rs, n) -> new ContentNode(id(rs,"id"),id(rs,"project_id"),id(rs,"parent_id"),rs.getString("title"),
            rs.getInt("position"),rs.getBoolean("is_root"),id(rs,"current_document_id"),rs.getInt("current_version"),
            Objects.equals(id(rs,"current_document_id"),id(rs,"summary_document_id")) ? rs.getString("summary") : "");
    private static final RowMapper<DocumentDTO> DOCUMENT = (rs, n) -> DocumentDTO.builder().id(id(rs,"id")).projectId(id(rs,"project_id"))
            .nodeId(id(rs,"node_id")).sessionId(id(rs,"session_id")).title(rs.getString("title")).type(rs.getString("type"))
            .content(rs.getString("content")).format(rs.getString("format")).version(rs.getInt("version")).status(rs.getString("status"))
            .metadata(rs.getString("metadata")).createdAt(rs.getTimestamp("created_at").toLocalDateTime()).updatedAt(rs.getTimestamp("updated_at").toLocalDateTime()).build();
    private static final RowMapper<Candidate> CANDIDATE = (rs, n) -> new Candidate(id(rs,"id"),id(rs,"project_id"),id(rs,"session_id"),id(rs,"source_session_id"),
            id(rs,"target_node_id"),id(rs,"parent_node_id"),id(rs,"after_node_id"),rs.getString("operation"),id(rs,"base_document_id"),
            rs.getString("title"),rs.getString("content"),rs.getString("instruction"),rs.getString("format"),rs.getString("status"),
            id(rs,"accepted_document_id"),id(rs,"accepted_node_id"),rs.getObject("created_at", OffsetDateTime.class));
    private final RowMapper<ChangeSet> CHANGE_SET = (rs, n) -> new ChangeSet(
            id(rs, "id"), id(rs, "project_id"), id(rs, "session_id"), id(rs, "source_session_id"),
            rs.getString("run_id"), rs.getString("apply_mode"), rs.getString("status"), rs.getString("summary"),
            List.of(), rs.getObject("created_at", OffsetDateTime.class), rs.getObject("resolved_at", OffsetDateTime.class));
    private final RowMapper<ChangeItem> CHANGE_ITEM = (rs, n) -> new ChangeItem(
            id(rs, "id"), id(rs, "change_set_id"), rs.getInt("seq"), rs.getString("action"),
            id(rs, "target_node_id"), id(rs, "parent_node_id"), id(rs, "after_node_id"),
            (Integer) rs.getObject("position"), id(rs, "base_document_id"), id(rs, "after_document_id"),
            rs.getString("title"), rs.getString("before_title"), rs.getString("content"), rs.getString("diff_preview"),
            parseJsonMap(rs.getString("stats")), parseJsonMap(rs.getString("before_tree_state")),
            rs.getString("status"), rs.getObject("created_at", OffsetDateTime.class));

    private ChangeItem getChangeItem(String changeSetId, String itemId) {
        return jdbc.query("SELECT * FROM workspace_change_item WHERE change_set_id=? AND id=?",
                CHANGE_ITEM, uuid(changeSetId), uuid(itemId)).stream().findFirst()
                .orElseThrow(() -> new BizException("404", "变更项不存在"));
    }

    private ChangeSet withItems(ChangeSet set) {
        List<ChangeItem> items = jdbc.query(
                "SELECT * FROM workspace_change_item WHERE change_set_id=? ORDER BY seq",
                CHANGE_ITEM, uuid(set.id()));
        return new ChangeSet(set.id(), set.projectId(), set.sessionId(), set.sourceSessionId(),
                set.runId(), set.applyMode(), set.status(), set.summary(), items, set.createdAt(), set.resolvedAt());
    }

    private String writeJson(Map<String, Object> map) {
        try {
            return json.writeValueAsString(map != null ? map : Map.of());
        } catch (JsonProcessingException e) {
            throw new IllegalStateException("无法序列化工作区变更元数据", e);
        }
    }

    private Map<String, Object> parseJsonMap(String raw) {
        if (blank(raw)) return Map.of();
        try {
            return json.readValue(raw, new TypeReference<>() {});
        } catch (Exception e) {
            return Map.of();
        }
    }

    private static String asString(Object value) {
        return value == null ? null : String.valueOf(value);
    }
}
