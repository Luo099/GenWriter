CREATE TABLE IF NOT EXISTS project_knowledge_base (
    project_id UUID NOT NULL REFERENCES project(id) ON DELETE CASCADE,
    kb_id UUID NOT NULL REFERENCES knowledge_base(id) ON DELETE CASCADE,
    PRIMARY KEY (project_id, kb_id)
);

CREATE INDEX IF NOT EXISTS idx_project_knowledge_base_kb ON project_knowledge_base(kb_id);
