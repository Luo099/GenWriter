package com.example.genwriter.model.entity;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.math.BigDecimal;
import java.time.OffsetDateTime;

@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@TableName("ai_trace_event")
public class AiTraceEventEntity {

    @TableId(value = "id", type = IdType.ASSIGN_UUID)
    private String id;
    private String runId;
    private String traceId;
    private String eventId;
    private String sessionId;
    private String spanId;
    private String parentSpanId;
    private String kind;
    private String phase;
    private String name;
    private String agentName;
    private String toolName;
    private String provider;
    private String model;
    private String summary;
    private String inputSummary;
    private String outputSummary;
    private String metadata;
    private String tokenUsage;
    private BigDecimal costEstimate;
    private Integer inputChars;
    private Integer outputChars;
    private String status;
    private String errorCode;
    private String error;
    private Boolean sampled;
    private OffsetDateTime startedAt;
    private OffsetDateTime endedAt;
    private Long durationMs;
    private OffsetDateTime eventTimestamp;
    private OffsetDateTime createdAt;
}
