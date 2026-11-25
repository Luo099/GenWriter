package com.example.genwriter.service.workspace;

import com.example.genwriter.exception.BizException;
import com.example.genwriter.message.SseMessage;
import com.example.genwriter.model.dto.response.DocumentDTO;
import com.example.genwriter.model.dto.workspace.WorkspaceModels.*;
import com.example.genwriter.model.enums.AssistantMode;
import com.example.genwriter.model.enums.GhostwriteApplyMode;
import com.example.genwriter.service.SseService;
import com.example.genwriter.service.WorkspaceService;
import com.example.genwriter.service.workspace.TextPatchEngine.DiffResult;
import com.example.genwriter.service.workspace.TextPatchEngine.PatchApplication;
import com.example.genwriter.service.workspace.TextPatchEngine.PatchHunk;
import com.example.genwriter.service.workspace.WorkspaceExecutionSession.StagedNode;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.Deque;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;

/**
 * Unified gateway for reading and mutating workspace chapters under both DIRECT_SNAPSHOT and STAGED_CANDIDATE modes.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class WorkspaceMutationGateway {

    private final WorkspaceService workspaceService;
    private final SseService sseService;

    public enum TreeAction {
        CREATE, RENAME, MOVE, DELETE
    }

    public record OutlineNodeView(String nodeId, String parentId, int depth, String title,
                                  int version, String documentId, int lineCount, int charCount,
                                  boolean root, boolean active, boolean stagedModified, String summary) {}

    public record OutlineView(String projectId, String projectName, String description,
                              String activeNodeId, List<OutlineNodeView> nodes) {}

    public record ChapterView(String nodeId, String title, String documentId, int version,
                              TextPatchEngine.ReadWindow window, boolean activeUnsavedNotice) {}

    public record SearchHit(String nodeId, String title, int lineNumber, String excerpt) {}

    public record MutationOutcome(String changeSetId, ChangeItem item, String nodeId, String title,
                                  String documentId, int version, DiffResult diff,
                                  GhostwriteApplyMode applyMode) {}

    public OutlineView outline(WorkspaceExecutionSession session, boolean includeSummaries) {
        session.getLock().lock();
        try {
            ensureViewReady(session);
            List<ViewNode> ordered = orderedViewNodes(session);
            Map<String, Integer> depths = new HashMap<>();
            List<OutlineNodeView> views = new ArrayList<>(ordered.size());
            for (ViewNode entry : ordered) {
                int depth = entry.root() ? 0 : depths.getOrDefault(entry.parentId(), 0) + 1;
                depths.put(entry.id(), depth);
                views.add(new OutlineNodeView(
                        entry.id(),
                        entry.parentId(),
                        depth,
                        entry.title(),
                        entry.version(),
                        entry.documentId(),
                        TextPatchEngine.countLines(entry.content()),
                        entry.content().length(),
                        entry.root(),
                        Objects.equals(entry.id(), session.getActiveNodeId()),
                        entry.modified(),
                        includeSummaries ? entry.summary() : ""
                ));
            }
            return new OutlineView(session.getProjectId(), session.getProjectName(),
                    session.getProjectDescription(), session.getActiveNodeId(), views);
        } finally {
            session.getLock().unlock();
        }
    }

    public ChapterView readChapter(WorkspaceExecutionSession session, String nodeIdOrTitle,
                                   int startLine, int lineCount, boolean headingsOnly) {
        session.getLock().lock();
        try {
            ensureViewReady(session);
            ViewNode target = resolveNode(session, nodeIdOrTitle);
            String effectiveContent = target.content();
            boolean unsavedNotice = false;
            if (session.getMode() == AssistantMode.CHAT
                    && Objects.equals(target.id(), session.getActiveNodeId())
                    && session.getActiveUnsavedPreview() != null) {
                effectiveContent = session.getActiveUnsavedPreview();
                unsavedNotice = true;
            }
            TextPatchEngine.ReadWindow window = TextPatchEngine.readWindow(effectiveContent, startLine, lineCount);
            if (headingsOnly) {
                String outlineText = window.headingsOutline().isBlank()
                        ? "(当前章节不含 Markdown # 标题)"
                        : window.headingsOutline();
                window = new TextPatchEngine.ReadWindow(1, window.totalLines(), window.totalLines(),
                        window.totalChars(), false, outlineText, window.headingsOutline());
            }
            return new ChapterView(target.id(), target.title(), target.documentId(),
                    target.version(), window, unsavedNotice);
        } finally {
            session.getLock().unlock();
        }
    }

    public String readFullChapterText(WorkspaceExecutionSession session, String nodeIdOrTitle) {
        session.getLock().lock();
        try {
            ensureViewReady(session);
            ViewNode target = resolveNode(session, nodeIdOrTitle);
            if (session.getMode() == AssistantMode.CHAT
                    && Objects.equals(target.id(), session.getActiveNodeId())
                    && session.getActiveUnsavedPreview() != null) {
                return session.getActiveUnsavedPreview();
            }
            return target.content();
        } finally {
            session.getLock().unlock();
        }
    }

    public List<SearchHit> search(WorkspaceExecutionSession session, String query,
                                  String nodeIdOrTitle, boolean regex, int maxMatches) {
        session.getLock().lock();
        try {
            ensureViewReady(session);
            List<ViewNode> scope = (nodeIdOrTitle != null && !nodeIdOrTitle.isBlank())
                    ? List.of(resolveNode(session, nodeIdOrTitle))
                    : orderedViewNodes(session);
            List<SearchHit> results = new ArrayList<>();
            int cap = Math.max(1, Math.min(maxMatches, 50));
            for (ViewNode entry : scope) {
                if (results.size() >= cap) break;
                String text = entry.content();
                if (session.getMode() == AssistantMode.CHAT
                        && Objects.equals(entry.id(), session.getActiveNodeId())
                        && session.getActiveUnsavedPreview() != null) {
                    text = session.getActiveUnsavedPreview();
                }
                for (TextPatchEngine.SearchMatch match : TextPatchEngine.search(text, query, regex, cap - results.size())) {
                    results.add(new SearchHit(entry.id(), entry.title(), match.lineNumber(), match.snippet()));
                }
            }
            return results;
        } finally {
            session.getLock().unlock();
        }
    }

    public MutationOutcome patchChapter(WorkspaceExecutionSession session, String nodeIdOrTitle,
                                        String expectedDocumentId, String title,
                                        List<PatchHunk> hunks, String reason) {
        requireGhostwrite(session);
        session.getLock().lock();
        try {
            ensureViewReady(session);
            ViewNode target = resolveNode(session, nodeIdOrTitle);
            verifyExpectedDoc(target, expectedDocumentId);

            PatchApplication applied = TextPatchEngine.applyHunks(target.content(), hunks);
            String resolvedTitle = isBlank(title) ? target.title() : title.trim();
            return commitContentMutation(session, target, "PATCH_CONTENT", resolvedTitle,
                    applied.updatedContent(), applied.diff(), reason);
        } finally {
            session.getLock().unlock();
        }
    }

    public MutationOutcome writeChapter(WorkspaceExecutionSession session, String nodeIdOrTitle,
                                        String expectedDocumentId, String title,
                                        String content, String reason) {
        requireGhostwrite(session);
        session.getLock().lock();
        try {
            ensureViewReady(session);
            ViewNode target = resolveNode(session, nodeIdOrTitle);
            verifyExpectedDoc(target, expectedDocumentId);

            String normalized = TextPatchEngine.normalizeLineEndings(content);
            DiffResult diff = TextPatchEngine.computeDiff(target.title(), target.content(), normalized);
            String resolvedTitle = isBlank(title) ? target.title() : title.trim();
            return commitContentMutation(session, target, "WRITE_CONTENT", resolvedTitle,
                    normalized, diff, reason);
        } finally {
            session.getLock().unlock();
        }
    }

    public MutationOutcome mutateTree(WorkspaceExecutionSession session, TreeAction action,
                                      String nodeIdOrTitle, String parentIdOrTitle, String afterNodeIdOrTitle,
                                      Integer position, String title, String initialContent, String reason) {
        requireGhostwrite(session);
        session.getLock().lock();
        try {
            ensureViewReady(session);
            return switch (action) {
                case CREATE -> handleCreateNode(session, parentIdOrTitle, afterNodeIdOrTitle, title, initialContent, reason);
                case RENAME -> handleRenameNode(session, nodeIdOrTitle, title, reason);
                case MOVE -> handleMoveNode(session, nodeIdOrTitle, parentIdOrTitle, position, reason);
                case DELETE -> handleDeleteNode(session, nodeIdOrTitle, reason);
            };
        } finally {
            session.getLock().unlock();
        }
    }

    private MutationOutcome commitContentMutation(WorkspaceExecutionSession session, ViewNode target,
                                                  String action, String resolvedTitle, String nextContent,
                                                  DiffResult diff, String reason) {
        String changeSetId = ensureChangeSet(session);
        int seq = session.nextSeq();
        Map<String, Object> stats = buildStats(diff, reason);

        if (session.getApplyMode() == GhostwriteApplyMode.DIRECT_SNAPSHOT) {
            DocumentDTO saved = workspaceService.applyAgentSnapshot(
                    session.getProjectId(), target.id(), target.documentId(),
                    resolvedTitle, nextContent, reason, session.getSessionId());
            ChangeItem item = workspaceService.appendChangeItem(
                    session.getProjectId(), changeSetId, seq, action,
                    target.id(), null, null, null,
                    target.documentId(), saved.getId(), resolvedTitle, target.title(),
                    nextContent, diff.unifiedDiff(), stats, Map.of(), "APPLIED");
            session.recordItem(item);
            refreshChangeSetSummary(session);
            publishWorkspaceEvent(session, SseMessage.Type.WORKSPACE_UPDATED, target.id(), action);
            return new MutationOutcome(changeSetId, item, target.id(), resolvedTitle,
                    saved.getId(), saved.getVersion(), diff, GhostwriteApplyMode.DIRECT_SNAPSHOT);
        }

        // STAGED_CANDIDATE: persist PENDING item and update in-memory overlay so subsequent reads see it.
        ChangeItem item = workspaceService.appendChangeItem(
                session.getProjectId(), changeSetId, seq, action,
                target.id(), null, null, null,
                target.documentId(), null, resolvedTitle, target.title(),
                nextContent, diff.unifiedDiff(), stats, Map.of(), "PENDING");
        StagedNode staged = session.getOverlayNodes().get(target.id());
        if (staged != null) {
            staged.title = resolvedTitle;
            staged.content = nextContent;
            staged.modified = true;
            staged.version = staged.version + 1;
        }
        session.recordItem(item);
        refreshChangeSetSummary(session);
        publishWorkspaceEvent(session, SseMessage.Type.WORKSPACE_CHANGESET_UPDATED, target.id(), action);
        return new MutationOutcome(changeSetId, item, target.id(), resolvedTitle,
                target.documentId(), staged != null ? staged.version : target.version() + 1,
                diff, GhostwriteApplyMode.STAGED_CANDIDATE);
    }

    private MutationOutcome handleCreateNode(WorkspaceExecutionSession session, String parentIdOrTitle,
                                             String afterNodeIdOrTitle, String title,
                                             String initialContent, String reason) {
        if (isBlank(title)) {
            throw new IllegalArgumentException("新建章节必须提供 title");
        }
        String parentId = isBlank(parentIdOrTitle)
                ? session.getRootId()
                : resolveNode(session, parentIdOrTitle).id();
        String afterId = null;
        if (!isBlank(afterNodeIdOrTitle)) {
            ViewNode after = resolveNode(session, afterNodeIdOrTitle);
            if (!Objects.equals(after.parentId(), parentId)) {
                throw new IllegalArgumentException("afterNodeId 不属于指定的 parentId");
            }
            afterId = after.id();
        }
        String normalizedContent = TextPatchEngine.normalizeLineEndings(initialContent);
        DiffResult diff = TextPatchEngine.computeDiff(title.trim(), "", normalizedContent);
        String changeSetId = ensureChangeSet(session);
        int seq = session.nextSeq();
        String virtualNodeId = UUID.randomUUID().toString();
        Map<String, Object> stats = buildStats(diff, reason);

        if (session.getApplyMode() == GhostwriteApplyMode.DIRECT_SNAPSHOT) {
            WorkspaceService.NodeContent created = workspaceService.createAgentNode(
                    session.getProjectId(), virtualNodeId, parentId, afterId,
                    title.trim(), normalizedContent, reason, session.getSessionId());
            String afterDocId = created.document() != null ? created.document().getId() : null;
            int version = created.document() != null ? created.document().getVersion() : 0;
            ChangeItem item = workspaceService.appendChangeItem(
                    session.getProjectId(), changeSetId, seq, "CREATE_NODE",
                    created.node().id(), parentId, afterId, created.node().position(),
                    null, afterDocId, created.node().title(), "",
                    normalizedContent, diff.unifiedDiff(), stats, Map.of(), "APPLIED");
            session.recordItem(item);
            refreshChangeSetSummary(session);
            publishWorkspaceEvent(session, SseMessage.Type.WORKSPACE_UPDATED, created.node().id(), "CREATE_NODE");
            return new MutationOutcome(changeSetId, item, created.node().id(), created.node().title(),
                    afterDocId, version, diff, GhostwriteApplyMode.DIRECT_SNAPSHOT);
        }

        // STAGED_CANDIDATE: insert virtual node into overlay
        List<StagedNode> siblings = stagedChildren(session, parentId);
        int insertion = siblings.size();
        if (afterId != null) {
            StagedNode afterNode = session.getOverlayNodes().get(afterId);
            if (afterNode != null) {
                insertion = afterNode.position + 1;
            }
        }
        for (StagedNode sibling : siblings) {
            if (sibling.position >= insertion) sibling.position++;
        }
        StagedNode created = new StagedNode(
                virtualNodeId, session.getProjectId(), parentId, title.trim(), insertion, false,
                null, normalizedContent.isEmpty() ? 0 : 1, "", normalizedContent, true, false);
        session.getOverlayNodes().put(virtualNodeId, created);

        ChangeItem item = workspaceService.appendChangeItem(
                session.getProjectId(), changeSetId, seq, "CREATE_NODE",
                virtualNodeId, parentId, afterId, insertion,
                null, null, title.trim(), "",
                normalizedContent, diff.unifiedDiff(), stats, Map.of(), "PENDING");
        session.recordItem(item);
        refreshChangeSetSummary(session);
        publishWorkspaceEvent(session, SseMessage.Type.WORKSPACE_CHANGESET_UPDATED, virtualNodeId, "CREATE_NODE");
        return new MutationOutcome(changeSetId, item, virtualNodeId, title.trim(),
                null, created.version, diff, GhostwriteApplyMode.STAGED_CANDIDATE);
    }

    private MutationOutcome handleRenameNode(WorkspaceExecutionSession session, String nodeIdOrTitle,
                                             String title, String reason) {
        if (isBlank(title)) {
            throw new IllegalArgumentException("重命名必须提供新标题 title");
        }
        ViewNode target = resolveNode(session, nodeIdOrTitle);
        if (target.root()) {
            throw new IllegalArgumentException("正文根节点不能重命名");
        }
        String newTitle = title.trim();
        String changeSetId = ensureChangeSet(session);
        int seq = session.nextSeq();
        DiffResult diff = TextPatchEngine.computeDiff(target.title(), target.title(), newTitle);
        Map<String, Object> stats = buildStats(diff, reason);

        if (session.getApplyMode() == GhostwriteApplyMode.DIRECT_SNAPSHOT) {
            ContentNode updated = workspaceService.renameNode(session.getProjectId(), target.id(), new NodeRequest(newTitle, null, null));
            ChangeItem item = workspaceService.appendChangeItem(
                    session.getProjectId(), changeSetId, seq, "RENAME_NODE",
                    target.id(), target.parentId(), null, target.position(),
                    target.documentId(), target.documentId(), updated.title(), target.title(),
                    "", diff.unifiedDiff(), stats, Map.of(), "APPLIED");
            session.recordItem(item);
            refreshChangeSetSummary(session);
            publishWorkspaceEvent(session, SseMessage.Type.WORKSPACE_UPDATED, target.id(), "RENAME_NODE");
            return new MutationOutcome(changeSetId, item, target.id(), updated.title(),
                    target.documentId(), target.version(), diff, GhostwriteApplyMode.DIRECT_SNAPSHOT);
        }

        ChangeItem item = workspaceService.appendChangeItem(
                session.getProjectId(), changeSetId, seq, "RENAME_NODE",
                target.id(), target.parentId(), null, target.position(),
                target.documentId(), null, newTitle, target.title(),
                "", diff.unifiedDiff(), stats, Map.of(), "PENDING");
        StagedNode staged = session.getOverlayNodes().get(target.id());
        if (staged != null) {
            staged.title = newTitle;
            staged.modified = true;
        }
        session.recordItem(item);
        refreshChangeSetSummary(session);
        publishWorkspaceEvent(session, SseMessage.Type.WORKSPACE_CHANGESET_UPDATED, target.id(), "RENAME_NODE");
        return new MutationOutcome(changeSetId, item, target.id(), newTitle,
                target.documentId(), target.version(), diff, GhostwriteApplyMode.STAGED_CANDIDATE);
    }

    private MutationOutcome handleMoveNode(WorkspaceExecutionSession session, String nodeIdOrTitle,
                                           String parentIdOrTitle, Integer position, String reason) {
        ViewNode moving = resolveNode(session, nodeIdOrTitle);
        if (moving.root()) {
            throw new IllegalArgumentException("正文根节点不能移动");
        }
        String parentId = isBlank(parentIdOrTitle)
                ? moving.parentId()
                : resolveNode(session, parentIdOrTitle).id();
        List<ViewNode> ordered = orderedViewNodes(session);
        Map<String, ViewNode> byId = new HashMap<>();
        ordered.forEach(n -> byId.put(n.id(), n));
        for (ViewNode cursor = byId.get(parentId); cursor != null; cursor = byId.get(cursor.parentId())) {
            if (cursor.id().equals(moving.id())) {
                throw new IllegalArgumentException("不能将节点移动到自身或子节点内");
            }
        }

        Map<String, Object> beforeState = Map.of(
                "parentId", Objects.toString(moving.parentId(), ""),
                "position", moving.position());
        String changeSetId = ensureChangeSet(session);
        int seq = session.nextSeq();
        int targetPos = position != null ? Math.max(0, position) : 0;
        DiffResult diff = new DiffResult("", 0, 0, 0, 0);
        Map<String, Object> stats = buildStats(diff, reason);

        if (session.getApplyMode() == GhostwriteApplyMode.DIRECT_SNAPSHOT) {
            ContentNode moved = workspaceService.moveNode(session.getProjectId(), moving.id(),
                    new MoveRequest(parentId, targetPos));
            ChangeItem item = workspaceService.appendChangeItem(
                    session.getProjectId(), changeSetId, seq, "MOVE_NODE",
                    moving.id(), parentId, null, moved.position(),
                    moving.documentId(), moving.documentId(), moving.title(), moving.title(),
                    "", "", stats, beforeState, "APPLIED");
            session.recordItem(item);
            refreshChangeSetSummary(session);
            publishWorkspaceEvent(session, SseMessage.Type.WORKSPACE_UPDATED, moving.id(), "MOVE_NODE");
            return new MutationOutcome(changeSetId, item, moving.id(), moving.title(),
                    moving.documentId(), moving.version(), diff, GhostwriteApplyMode.DIRECT_SNAPSHOT);
        }

        StagedNode staged = session.getOverlayNodes().get(moving.id());
        if (staged != null) {
            String oldParent = staged.parentId;
            List<StagedNode> newSiblings = stagedChildren(session, parentId).stream()
                    .filter(s -> !s.id.equals(moving.id()))
                    .collect(java.util.stream.Collectors.toCollection(ArrayList::new));
            int clamped = Math.min(targetPos, newSiblings.size());
            staged.parentId = parentId;
            staged.modified = true;
            newSiblings.add(clamped, staged);
            for (int i = 0; i < newSiblings.size(); i++) {
                newSiblings.get(i).position = i;
            }
            if (!Objects.equals(oldParent, parentId)) {
                List<StagedNode> oldSiblings = stagedChildren(session, oldParent);
                for (int i = 0; i < oldSiblings.size(); i++) {
                    oldSiblings.get(i).position = i;
                }
            }
            targetPos = clamped;
        }
        ChangeItem item = workspaceService.appendChangeItem(
                session.getProjectId(), changeSetId, seq, "MOVE_NODE",
                moving.id(), parentId, null, targetPos,
                moving.documentId(), null, moving.title(), moving.title(),
                "", "", stats, beforeState, "PENDING");
        session.recordItem(item);
        refreshChangeSetSummary(session);
        publishWorkspaceEvent(session, SseMessage.Type.WORKSPACE_CHANGESET_UPDATED, moving.id(), "MOVE_NODE");
        return new MutationOutcome(changeSetId, item, moving.id(), moving.title(),
                moving.documentId(), moving.version(), diff, GhostwriteApplyMode.STAGED_CANDIDATE);
    }

    private MutationOutcome handleDeleteNode(WorkspaceExecutionSession session, String nodeIdOrTitle, String reason) {
        ViewNode target = resolveNode(session, nodeIdOrTitle);
        if (target.root()) {
            throw new IllegalArgumentException("正文根节点不能删除");
        }
        Set<String> deleting = new HashSet<>();
        deleting.add(target.id());
        for (ViewNode entry : orderedViewNodes(session)) {
            if (deleting.contains(entry.parentId())) {
                deleting.add(entry.id());
            }
        }
        Map<String, Object> beforeState = Map.of(
                "parentId", Objects.toString(target.parentId(), ""),
                "deletedNodeIds", new ArrayList<>(deleting));
        DiffResult diff = TextPatchEngine.computeDiff(target.title(), target.content(), "");
        Map<String, Object> stats = buildStats(diff, reason);
        String changeSetId = ensureChangeSet(session);
        int seq = session.nextSeq();

        if (session.getApplyMode() == GhostwriteApplyMode.DIRECT_SNAPSHOT) {
            workspaceService.deleteNode(session.getProjectId(), target.id());
            ChangeItem item = workspaceService.appendChangeItem(
                    session.getProjectId(), changeSetId, seq, "DELETE_NODE",
                    target.id(), target.parentId(), null, target.position(),
                    target.documentId(), null, target.title(), target.title(),
                    "", diff.unifiedDiff(), stats, beforeState, "APPLIED");
            session.recordItem(item);
            refreshChangeSetSummary(session);
            publishWorkspaceEvent(session, SseMessage.Type.WORKSPACE_UPDATED, target.id(), "DELETE_NODE");
            return new MutationOutcome(changeSetId, item, target.id(), target.title(),
                    null, target.version(), diff, GhostwriteApplyMode.DIRECT_SNAPSHOT);
        }

        for (String id : deleting) {
            StagedNode staged = session.getOverlayNodes().get(id);
            if (staged != null) {
                staged.deleted = true;
                staged.modified = true;
            }
        }
        ChangeItem item = workspaceService.appendChangeItem(
                session.getProjectId(), changeSetId, seq, "DELETE_NODE",
                target.id(), target.parentId(), null, target.position(),
                target.documentId(), null, target.title(), target.title(),
                "", diff.unifiedDiff(), stats, beforeState, "PENDING");
        session.recordItem(item);
        refreshChangeSetSummary(session);
        publishWorkspaceEvent(session, SseMessage.Type.WORKSPACE_CHANGESET_UPDATED, target.id(), "DELETE_NODE");
        return new MutationOutcome(changeSetId, item, target.id(), target.title(),
                null, target.version(), diff, GhostwriteApplyMode.STAGED_CANDIDATE);
    }

    private void ensureViewReady(WorkspaceExecutionSession session) {
        if (session.getApplyMode() == GhostwriteApplyMode.STAGED_CANDIDATE && session.isOverlayInitialized()) {
            return;
        }
        WorkspaceService.ProjectOverview overview = workspaceService.getProjectOverview(session.getProjectId());
        Map<String, String> contents = new LinkedHashMap<>();
        for (ContentNode node : overview.nodes()) {
            if (node.currentDocumentId() != null) {
                DocumentDTO doc = workspaceService.snapshot(node.currentDocumentId());
                contents.put(node.id(), Objects.toString(doc.getContent(), ""));
            } else {
                contents.put(node.id(), "");
            }
        }
        session.initOverlay(overview.name(), overview.description(), overview.rootId(), overview.nodes(), contents);
    }

    private List<ViewNode> orderedViewNodes(WorkspaceExecutionSession session) {
        Map<String, List<StagedNode>> children = new HashMap<>();
        for (StagedNode entry : session.getOverlayNodes().values()) {
            if (entry.deleted) continue;
            children.computeIfAbsent(Objects.toString(entry.parentId, ""), ignored -> new ArrayList<>()).add(entry);
        }
        children.values().forEach(list -> list.sort(Comparator.comparingInt(s -> s.position)));
        Deque<Iterator<StagedNode>> stack = new ArrayDeque<>();
        stack.push(children.getOrDefault("", List.of()).iterator());
        List<ViewNode> ordered = new ArrayList<>();
        while (!stack.isEmpty()) {
            if (!stack.peek().hasNext()) {
                stack.pop();
                continue;
            }
            StagedNode next = stack.peek().next();
            ordered.add(new ViewNode(next.id, next.parentId, next.title, next.position, next.root,
                    next.baseDocumentId, next.version, next.summary, next.content, next.modified));
            stack.push(children.getOrDefault(next.id, List.of()).iterator());
        }
        return ordered;
    }

    private List<StagedNode> stagedChildren(WorkspaceExecutionSession session, String parentId) {
        return session.getOverlayNodes().values().stream()
                .filter(n -> !n.deleted && Objects.equals(n.parentId, parentId))
                .sorted(Comparator.comparingInt(n -> n.position))
                .toList();
    }

    private ViewNode resolveNode(WorkspaceExecutionSession session, String nodeIdOrTitle) {
        List<ViewNode> nodes = orderedViewNodes(session);
        if (isBlank(nodeIdOrTitle)) {
            if (!isBlank(session.getActiveNodeId())) {
                for (ViewNode n : nodes) {
                    if (n.id().equals(session.getActiveNodeId())) return n;
                }
            }
            throw new BizException("400", "未指定目标章节 nodeId，请先调用 workspace_outline 查看章节列表");
        }
        String key = nodeIdOrTitle.trim();
        for (ViewNode n : nodes) {
            if (n.id().equals(key)) return n;
        }
        List<ViewNode> titleMatches = nodes.stream().filter(n -> n.title().equals(key)).toList();
        if (titleMatches.size() == 1) {
            return titleMatches.get(0);
        }
        if (titleMatches.size() > 1) {
            throw new IllegalArgumentException("存在多个同名章节「" + key + "」，请改用精确的 nodeId");
        }
        throw new BizException("404", "未找到章节节点: " + key);
    }

    private void verifyExpectedDoc(ViewNode target, String expectedDocumentId) {
        if (isBlank(expectedDocumentId)) return;
        String current = isBlank(target.documentId()) ? null : target.documentId();
        if (!Objects.equals(current, expectedDocumentId.trim())) {
            throw new BizException("409", "章节「" + target.title() + "」正文已变更（当前版本 V"
                    + target.version() + "），请先重新 workspace_read 后再修改");
        }
    }

    private String ensureChangeSet(WorkspaceExecutionSession session) {
        if (session.getChangeSetId() == null) {
            ChangeSet created = workspaceService.createChangeSet(
                    session.getProjectId(), session.getSessionId(), session.getRunId(),
                    session.getApplyMode().name(), "");
            session.setChangeSetId(created.id());
            session.setLatestChangeSet(created);
        }
        return session.getChangeSetId();
    }

    private void refreshChangeSetSummary(WorkspaceExecutionSession session) {
        if (session.getChangeSetId() == null) return;
        String summary = buildRunSummary(session.getRecordedItemsSnapshot());
        workspaceService.updateChangeSetSummary(session.getProjectId(), session.getChangeSetId(), summary);
        session.setLatestChangeSet(workspaceService.getChangeSet(session.getProjectId(), session.getChangeSetId()));
    }

    private String buildRunSummary(List<ChangeItem> items) {
        if (items.isEmpty()) return "";
        int created = 0, patched = 0, rewritten = 0, treeOps = 0;
        for (ChangeItem item : items) {
            switch (item.action()) {
                case "CREATE_NODE" -> created++;
                case "PATCH_CONTENT" -> patched++;
                case "WRITE_CONTENT" -> rewritten++;
                default -> treeOps++;
            }
        }
        List<String> parts = new ArrayList<>();
        if (created > 0) parts.add("新建 " + created + " 章");
        if (patched > 0) parts.add("局部修改 " + patched + " 处");
        if (rewritten > 0) parts.add("整章重写 " + rewritten + " 处");
        if (treeOps > 0) parts.add("目录调整 " + treeOps + " 次");
        return String.join(" · ", parts);
    }

    private Map<String, Object> buildStats(DiffResult diff, String reason) {
        Map<String, Object> stats = new LinkedHashMap<>();
        stats.put("addedLines", diff.addedLines());
        stats.put("removedLines", diff.removedLines());
        stats.put("beforeChars", diff.beforeChars());
        stats.put("afterChars", diff.afterChars());
        if (reason != null && !reason.isBlank()) {
            stats.put("reason", reason);
        }
        return stats;
    }

    private void publishWorkspaceEvent(WorkspaceExecutionSession session, SseMessage.Type type,
                                       String nodeId, String action) {
        if (session.getSessionId() == null || session.getSessionId().isBlank()) return;
        try {
            Map<String, Object> data = new LinkedHashMap<>();
            data.put("projectId", session.getProjectId());
            data.put("nodeId", nodeId);
            data.put("action", action);
            data.put("applyMode", session.getApplyMode().name());
            data.put("changeSetId", session.getChangeSetId());
            if (session.getLatestChangeSet() != null) {
                data.put("changeSet", session.getLatestChangeSet());
            }
            sseService.publish(session.getSessionId(), SseMessage.builder()
                    .type(type)
                    .payload(SseMessage.Payload.builder()
                            .data(data)
                            .build())
                    .build());
        } catch (Exception e) {
            log.debug("发布工作区变更 SSE 事件失败: {}", e.getMessage());
        }
    }

    private static void requireGhostwrite(WorkspaceExecutionSession session) {
        if (session == null || session.getMode() != AssistantMode.GHOSTWRITE) {
            throw new BizException("403", "当前为对话模式（只读），禁止修改工作区文章");
        }
    }

    private static boolean isBlank(String value) {
        return value == null || value.isBlank();
    }

    private record ViewNode(String id, String parentId, String title, int position, boolean root,
                            String documentId, int version, String summary, String content, boolean modified) {}
}
