CREATE TABLE IF NOT EXISTS ai_trace_event (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    run_id VARCHAR(80) NOT NULL,
    trace_id VARCHAR(120),
    event_id VARCHAR(120) NOT NULL,
    session_id UUID,
    span_id VARCHAR(160),
    parent_span_id VARCHAR(160),
    kind VARCHAR(50),
    phase VARCHAR(50),
    name VARCHAR(255),
    agent_name VARCHAR(120),
    tool_name VARCHAR(120),
    provider VARCHAR(80),
    model VARCHAR(160),
    summary TEXT,
    input_summary JSONB,
    output_summary JSONB,
    metadata JSONB DEFAULT '{}',
    token_usage JSONB DEFAULT '{}',
    cost_estimate NUMERIC(18, 8),
    input_chars INTEGER,
    output_chars INTEGER,
    status VARCHAR(50),
    error_code VARCHAR(120),
    error TEXT,
    sampled BOOLEAN NOT NULL DEFAULT TRUE,
    started_at TIMESTAMP WITH TIME ZONE,
    ended_at TIMESTAMP WITH TIME ZONE,
    duration_ms BIGINT,
    event_timestamp TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_ai_trace_event_run_id ON ai_trace_event(run_id);
CREATE INDEX IF NOT EXISTS idx_ai_trace_event_session ON ai_trace_event(session_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_trace_event_phase ON ai_trace_event(phase);
CREATE INDEX IF NOT EXISTS idx_ai_trace_event_kind ON ai_trace_event(kind);
CREATE INDEX IF NOT EXISTS idx_ai_trace_event_created_at ON ai_trace_event(created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uk_ai_trace_event_event_id ON ai_trace_event(event_id);
