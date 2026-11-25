CREATE TABLE IF NOT EXISTS app_preference (
    key VARCHAR(100) PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS workspace_change_set (
    id UUID PRIMARY KEY,
    project_id UUID NOT NULL REFERENCES project(id) ON DELETE CASCADE,
    session_id UUID REFERENCES task_session(id) ON DELETE SET NULL,
    source_session_id UUID,
    run_id VARCHAR(80),
    apply_mode VARCHAR(30) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    summary TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    resolved_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_workspace_change_set_project
    ON workspace_change_set(project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_workspace_change_set_session
    ON workspace_change_set(session_id, created_at DESC);

CREATE TABLE IF NOT EXISTS workspace_change_item (
    id UUID PRIMARY KEY,
    change_set_id UUID NOT NULL REFERENCES workspace_change_set(id) ON DELETE CASCADE,
    seq INTEGER NOT NULL,
    action VARCHAR(30) NOT NULL,
    target_node_id UUID,
    parent_node_id UUID,
    after_node_id UUID,
    position INTEGER,
    base_document_id UUID,
    after_document_id UUID,
    title VARCHAR(500) NOT NULL DEFAULT '',
    before_title VARCHAR(500) NOT NULL DEFAULT '',
    content TEXT NOT NULL DEFAULT '',
    diff_preview TEXT NOT NULL DEFAULT '',
    stats JSONB NOT NULL DEFAULT '{}'::jsonb,
    before_tree_state JSONB NOT NULL DEFAULT '{}'::jsonb,
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_workspace_change_item_set
    ON workspace_change_item(change_set_id, seq);
