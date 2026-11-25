package com.example.genwriter.service.workspace;

import com.example.genwriter.model.dto.workspace.WorkspaceModels.ChangeItem;
import com.example.genwriter.model.dto.workspace.WorkspaceModels.ChangeSet;
import com.example.genwriter.model.dto.workspace.WorkspaceModels.ContentNode;
import com.example.genwriter.model.enums.AssistantMode;
import com.example.genwriter.model.enums.GhostwriteApplyMode;
import lombok.Getter;

import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.locks.ReentrantLock;

/**
 * Per-run execution state for workspace-aware Chat/Ghostwrite interactions.
 * Holds frozen mode & apply preferences plus an in-memory overlay view for STAGED_CANDIDATE runs.
 */
@Getter
public class WorkspaceExecutionSession {

    private final String runId;
    private final String projectId;
    private final String sessionId;
    private final String activeNodeId;
    private final String activeUnsavedPreview;
    private final AssistantMode mode;
    private final GhostwriteApplyMode applyMode;
    private final boolean webSearchEnabled;
    private final List<String> knowledgeBaseIds;
    private final ReentrantLock lock = new ReentrantLock(true);

    private String changeSetId;
    private ChangeSet latestChangeSet;
    private int nextSeq = 1;
    private final List<ChangeItem> recordedItems = new ArrayList<>();
    private final List<Map<String, String>> collectedSources = new ArrayList<>();
    private final List<String> touchedNodeIds = new ArrayList<>();

    /** Overlay used in STAGED_CANDIDATE mode so reads within the same turn see staged mutations. */
    private boolean overlayInitialized = false;
    private String projectName;
    private String projectDescription;
    private String rootId;
    private final Map<String, StagedNode> overlayNodes = new LinkedHashMap<>();

    public WorkspaceExecutionSession(String runId,
                                     String projectId,
                                     String sessionId,
                                     String activeNodeId,
                                     String activeUnsavedPreview,
                                     AssistantMode mode,
                                     GhostwriteApplyMode applyMode,
                                     boolean webSearchEnabled,
                                     List<String> knowledgeBaseIds) {
        this.runId = runId;
        this.projectId = projectId;
        this.sessionId = sessionId;
        this.activeNodeId = activeNodeId;
        this.activeUnsavedPreview = activeUnsavedPreview;
        this.mode = mode != null ? mode : AssistantMode.CHAT;
        this.applyMode = applyMode != null ? applyMode : GhostwriteApplyMode.DIRECT_SNAPSHOT;
        this.webSearchEnabled = webSearchEnabled;
        this.knowledgeBaseIds = knowledgeBaseIds != null ? List.copyOf(knowledgeBaseIds) : List.of();
    }

    public int nextSeq() {
        return nextSeq++;
    }

    public void setChangeSetId(String changeSetId) {
        this.changeSetId = changeSetId;
    }

    public void setLatestChangeSet(ChangeSet latestChangeSet) {
        this.latestChangeSet = latestChangeSet;
    }

    public void recordItem(ChangeItem item) {
        this.recordedItems.add(item);
        if (item.targetNodeId() != null && !this.touchedNodeIds.contains(item.targetNodeId())) {
            this.touchedNodeIds.add(item.targetNodeId());
        }
    }

    public void addSources(List<Map<String, String>> sources) {
        if (sources == null || sources.isEmpty()) return;
        for (Map<String, String> src : sources) {
            if (src == null) continue;
            String url = src.getOrDefault("url", "");
            boolean duplicate = !url.isBlank() && collectedSources.stream()
                    .anyMatch(existing -> url.equals(existing.get("url")));
            if (!duplicate) {
                collectedSources.add(Map.of(
                        "title", src.getOrDefault("title", ""),
                        "url", url));
            }
        }
    }

    public List<ChangeItem> getRecordedItemsSnapshot() {
        return List.copyOf(recordedItems);
    }

    public List<Map<String, String>> getCollectedSourcesSnapshot() {
        return Collections.unmodifiableList(new ArrayList<>(collectedSources));
    }

    public void initOverlay(String projectName, String projectDescription, String rootId,
                            List<ContentNode> nodes, Map<String, String> contentsByNodeId) {
        this.projectName = projectName;
        this.projectDescription = projectDescription;
        this.rootId = rootId;
        this.overlayNodes.clear();
        for (ContentNode node : nodes) {
            this.overlayNodes.put(node.id(), new StagedNode(
                    node.id(),
                    node.projectId(),
                    node.parentId(),
                    node.title(),
                    node.position(),
                    node.root(),
                    node.currentDocumentId(),
                    node.version(),
                    node.summary(),
                    contentsByNodeId.getOrDefault(node.id(), ""),
                    false,
                    false));
        }
        this.overlayInitialized = true;
    }

    public static final class StagedNode {
        public String id;
        public String projectId;
        public String parentId;
        public String title;
        public int position;
        public boolean root;
        public String baseDocumentId;
        public int version;
        public String summary;
        public String content;
        public boolean modified;
        public boolean deleted;

        public StagedNode(String id, String projectId, String parentId, String title, int position,
                          boolean root, String baseDocumentId, int version, String summary,
                          String content, boolean modified, boolean deleted) {
            this.id = id;
            this.projectId = projectId;
            this.parentId = parentId;
            this.title = title;
            this.position = position;
            this.root = root;
            this.baseDocumentId = baseDocumentId;
            this.version = version;
            this.summary = summary;
            this.content = content;
            this.modified = modified;
            this.deleted = deleted;
        }
    }
}
