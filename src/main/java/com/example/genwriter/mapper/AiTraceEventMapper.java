package com.example.genwriter.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.example.genwriter.model.entity.AiTraceEventEntity;
import org.apache.ibatis.annotations.*;

import java.time.OffsetDateTime;
import java.util.List;

@Mapper
public interface AiTraceEventMapper extends BaseMapper<AiTraceEventEntity> {

    @Insert("""
            INSERT INTO ai_trace_event (
                run_id, trace_id, event_id, session_id, span_id, parent_span_id,
                kind, phase, name, agent_name, tool_name, provider, model, summary,
                input_summary, output_summary, metadata, token_usage, cost_estimate,
                input_chars, output_chars, status, error_code, error, sampled,
                started_at, ended_at, duration_ms, event_timestamp, created_at
            ) VALUES (
                #{runId}, #{traceId}, #{eventId}, CAST(NULLIF(#{sessionId}, '') AS uuid),
                #{spanId}, #{parentSpanId}, #{kind}, #{phase}, #{name}, #{agentName},
                #{toolName}, #{provider}, #{model}, #{summary},
                CAST(#{inputSummary} AS jsonb), CAST(#{outputSummary} AS jsonb),
                CAST(#{metadata} AS jsonb), CAST(#{tokenUsage} AS jsonb), #{costEstimate},
                #{inputChars}, #{outputChars}, #{status}, #{errorCode}, #{error}, #{sampled},
                #{startedAt}, #{endedAt}, #{durationMs}, #{eventTimestamp}, #{createdAt}
            )
            ON CONFLICT (event_id) DO NOTHING
            """)
    int insertEvent(AiTraceEventEntity event);

    @Select("""
            SELECT id, run_id AS runId, trace_id AS traceId, event_id AS eventId,
                   session_id AS sessionId, span_id AS spanId, parent_span_id AS parentSpanId,
                   kind, phase, name, agent_name AS agentName, tool_name AS toolName,
                   provider, model, summary, input_summary::text AS inputSummary,
                   output_summary::text AS outputSummary, metadata::text AS metadata,
                   token_usage::text AS tokenUsage, cost_estimate AS costEstimate,
                   input_chars AS inputChars, output_chars AS outputChars, status,
                   error_code AS errorCode, error, sampled, started_at AS startedAt,
                   ended_at AS endedAt, duration_ms AS durationMs,
                   event_timestamp AS eventTimestamp, created_at AS createdAt
            FROM ai_trace_event
            ORDER BY created_at DESC
            LIMIT #{limit}
            """)
    List<AiTraceEventEntity> selectRecent(@Param("limit") int limit);

    @Select("""
            SELECT DISTINCT ON (run_id)
                   id, run_id AS runId, trace_id AS traceId, event_id AS eventId,
                   session_id AS sessionId, span_id AS spanId, parent_span_id AS parentSpanId,
                   kind, phase, name, agent_name AS agentName, tool_name AS toolName,
                   provider, model, summary, input_summary::text AS inputSummary,
                   output_summary::text AS outputSummary, metadata::text AS metadata,
                   token_usage::text AS tokenUsage, cost_estimate AS costEstimate,
                   input_chars AS inputChars, output_chars AS outputChars, status,
                   error_code AS errorCode, error, sampled, started_at AS startedAt,
                   ended_at AS endedAt, duration_ms AS durationMs,
                   event_timestamp AS eventTimestamp, created_at AS createdAt
            FROM ai_trace_event
            ORDER BY run_id, created_at DESC
            LIMIT #{limit}
            """)
    List<AiTraceEventEntity> selectRecentRuns(@Param("limit") int limit);

    @Select("""
            SELECT id, run_id AS runId, trace_id AS traceId, event_id AS eventId,
                   session_id AS sessionId, span_id AS spanId, parent_span_id AS parentSpanId,
                   kind, phase, name, agent_name AS agentName, tool_name AS toolName,
                   provider, model, summary, input_summary::text AS inputSummary,
                   output_summary::text AS outputSummary, metadata::text AS metadata,
                   token_usage::text AS tokenUsage, cost_estimate AS costEstimate,
                   input_chars AS inputChars, output_chars AS outputChars, status,
                   error_code AS errorCode, error, sampled, started_at AS startedAt,
                   ended_at AS endedAt, duration_ms AS durationMs,
                   event_timestamp AS eventTimestamp, created_at AS createdAt
            FROM ai_trace_event
            WHERE run_id = #{runId}
            ORDER BY COALESCE(event_timestamp, created_at), created_at
            """)
    List<AiTraceEventEntity> selectByRunId(@Param("runId") String runId);

    @Select("""
            SELECT id, run_id AS runId, trace_id AS traceId, event_id AS eventId,
                   session_id AS sessionId, span_id AS spanId, parent_span_id AS parentSpanId,
                   kind, phase, name, agent_name AS agentName, tool_name AS toolName,
                   provider, model, summary, input_summary::text AS inputSummary,
                   output_summary::text AS outputSummary, metadata::text AS metadata,
                   token_usage::text AS tokenUsage, cost_estimate AS costEstimate,
                   input_chars AS inputChars, output_chars AS outputChars, status,
                   error_code AS errorCode, error, sampled, started_at AS startedAt,
                   ended_at AS endedAt, duration_ms AS durationMs,
                   event_timestamp AS eventTimestamp, created_at AS createdAt
            FROM ai_trace_event
            WHERE session_id = CAST(#{sessionId} AS uuid)
            ORDER BY created_at DESC
            LIMIT #{limit}
            """)
    List<AiTraceEventEntity> selectBySessionId(@Param("sessionId") String sessionId, @Param("limit") int limit);

    @Select("SELECT COUNT(*) FROM ai_trace_event WHERE created_at >= #{since}")
    long countSince(@Param("since") OffsetDateTime since);

    @Select("""
            SELECT COUNT(*) FROM ai_trace_event
            WHERE created_at >= #{since}
              AND (phase = 'ERROR' OR status = 'ERROR')
            """)
    long countErrorsSince(@Param("since") OffsetDateTime since);

    @Select("""
            SELECT COALESCE(AVG(duration_ms), 0) FROM ai_trace_event
            WHERE created_at >= #{since}
              AND duration_ms IS NOT NULL
            """)
    double avgDurationSince(@Param("since") OffsetDateTime since);

    @Delete("DELETE FROM ai_trace_event WHERE created_at < #{before}")
    int deleteBefore(@Param("before") OffsetDateTime before);
}
