import { useEffect, useMemo, useRef, useState } from 'react';
import '../styles/global.css';

const KIND_LABELS = {
  SUPERVISOR: '调度',
  WORKER: '智能体',
  LLM: '模型',
  TOOL: '工具',
  RAG: '检索',
  MEMORY: '记忆',
  STATUS: '状态',
  ERROR: '错误',
};

const LEGACY_NODE_KIND = {
  PLANNING: 'SUPERVISOR',
  THINKING: 'WORKER',
  TOOL_CALL: 'TOOL',
  EXECUTION: 'WORKER',
  RESULT: 'STATUS',
  ERROR: 'ERROR',
};

const LEGACY_STATUS_PHASE = {
  STARTED: 'STARTED',
  RUNNING: 'RUNNING',
  COMPLETED: 'COMPLETED',
  ERROR: 'ERROR',
};

const PHASE_TO_STATUS = {
  STARTED: 'STARTED',
  RUNNING: 'RUNNING',
  COMPLETED: 'COMPLETED',
  ERROR: 'ERROR',
};

const formatDuration = (ms) => {
  if (!ms) return '';
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
};

const parseBracketStatus = (text) => {
  if (!text || typeof text !== 'string') return null;
  const match = text.match(/^【(.+?)】(.+)$/);
  if (match) return { stage: match[1], description: match[2] };
  const onlyStage = text.match(/^【(.+?)】$/);
  if (onlyStage) return { stage: onlyStage[1], description: '' };
  return null;
};

const formatValue = (value) => {
  if (value == null || value === '') return null;
  if (Array.isArray(value)) {
    if (value.length === 0) return null;
    return value.map((item, index) => (
      <div key={index} className="trace-list-item">
        {formatValue(item)}
      </div>
    ));
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value).filter(([, v]) => v != null && v !== '');
    if (entries.length === 0) return null;
    return entries.map(([k, v]) => (
      <div key={k} className="trace-detail-kv">
        <span className="trace-detail-key">{k}</span>
        <span className="trace-detail-value">
          {typeof v === 'object' ? formatValue(v) : String(v)}
        </span>
      </div>
    ));
  }
  return String(value);
};

const buildTree = (nodes = []) => {
  const ordered = nodes
    .filter(Boolean)
    .map((node, index) => ({
      ...node,
      spanId: node.spanId || `trace-${index}`,
      firstIndex: node.firstIndex ?? index,
      children: [],
    }))
    .sort((a, b) => (a.firstIndex ?? 0) - (b.firstIndex ?? 0));

  const nodeMap = new Map(ordered.map((node) => [node.spanId, node]));
  const roots = [];

  nodeMap.forEach((node) => {
    if (node.parentSpanId && nodeMap.has(node.parentSpanId)) {
      nodeMap.get(node.parentSpanId).children.push(node);
    } else {
      roots.push(node);
    }
  });

  const sortTree = (items) => {
    items.sort((a, b) => (a.firstIndex ?? 0) - (b.firstIndex ?? 0));
    items.forEach((item) => sortTree(item.children || []));
  };

  sortTree(roots);
  return roots;
};

const flattenTrace = (nodes) => {
  const rows = [];
  const walk = (items) => {
    items.forEach((item) => {
      rows.push(item);
      walk(item.children || []);
    });
  };
  walk(nodes);
  return rows;
};

const mergeTraceEvents = (events = []) => {
  const bySpan = new Map();
  events.forEach((event, index) => {
    const spanId = event.spanId || event.eventId || `trace-${index}`;
    const existing = bySpan.get(spanId) || {
      spanId,
      firstIndex: index,
    };

    bySpan.set(spanId, {
      ...existing,
      ...event,
      spanId,
      parentSpanId: event.parentSpanId ?? existing.parentSpanId,
      input: event.input ?? existing.input,
      output: event.output ?? existing.output,
      metadata: event.metadata ?? existing.metadata,
      error: event.error ?? existing.error,
      startedAt: event.startedAt ?? existing.startedAt,
      endedAt: event.endedAt ?? existing.endedAt,
      durationMs: event.durationMs ?? existing.durationMs,
      toolName: event.toolName ?? event.metadata?.toolName ?? existing.toolName,
      reasoningContent: event.reasoningContent ?? existing.reasoningContent,
      firstIndex: existing.firstIndex,
      latestIndex: index,
    });
  });

  return buildTree(Array.from(bySpan.values()));
};

const summarizeLegacyOutput = (node) => {
  if (!node || node.status !== 'COMPLETED') return null;
  const output = node.output;
  if (typeof output === 'string') return output || null;
  if (!output || typeof output !== 'object') return null;

  if (Array.isArray(output.steps) && output.steps.length > 0) {
    return `计划执行: ${output.steps.join(' → ')}`;
  }
  if (output.searchRounds != null) {
    const suffix = output.sourcesCount ? `，${output.sourcesCount} 个来源` : '';
    return `执行 ${output.searchRounds} 次搜索${suffix}`;
  }
  if (output.draftLength != null) return `生成草稿 ${output.draftLength} 字`;
  if (output.polishedLength != null) return `润色完成 ${output.polishedLength} 字`;
  if (output.outlineLength != null) return `生成大纲 ${output.outlineLength} 字`;
  if (output.outputLength != null) return `生成回答 ${output.outputLength} 字`;
  if (output.length != null) return `${output.length} 字`;
  if (typeof output.reasoning === 'string' && output.reasoning.trim()) return output.reasoning;
  return null;
};

const normalizeChainNodes = (chainNodes = []) => buildTree(
  chainNodes.map((node, index) => ({
    spanId: node.nodeId || `legacy-${index}`,
    parentSpanId: node.parentId || null,
    kind: LEGACY_NODE_KIND[node.nodeType] || 'STATUS',
    phase: LEGACY_STATUS_PHASE[node.status] || 'RUNNING',
    name: node.nodeName || KIND_LABELS[LEGACY_NODE_KIND[node.nodeType] || 'STATUS'] || '执行步骤',
    summary: summarizeLegacyOutput(node),
    input: node.input,
    output: node.output,
    error: node.error,
    durationMs: node.duration,
    reasoningContent: node.reasoningContent,
    firstIndex: index,
  }))
);

const normalizeThinkingSteps = (thinkingSteps = [], isStreaming = false) => buildTree(
  thinkingSteps.map((step, index) => {
    const parsed = parseBracketStatus(step?.text);
    const isLatest = index === thinkingSteps.length - 1;
    return {
      spanId: `step-${index}`,
      kind: 'STATUS',
      phase: isStreaming && isLatest ? 'RUNNING' : 'COMPLETED',
      name: parsed?.stage || '状态更新',
      summary: parsed?.description || step?.text || '处理中',
      output: step?.data ?? null,
      firstIndex: index,
    };
  })
);

const TraceNodeItem = ({ node, depth = 0 }) => {
  const [expanded, setExpanded] = useState(depth < 1);
  const status = PHASE_TO_STATUS[node.phase] || 'RUNNING';
  const statusClass = status.toLowerCase();
  const hasChildren = node.children && node.children.length > 0;
  const hasDetails = node.input || node.output || node.metadata || node.error || node.reasoningContent;
  const isRunning = status === 'STARTED' || status === 'RUNNING';

  return (
    <div
      className={`trace-node trace-node-depth-${Math.min(depth, 4)} trace-node-status-${statusClass} ${isRunning ? 'trace-node-running' : ''}`}
    >
      <div className="trace-node-main" style={{ marginLeft: `${depth * 18}px` }}>
        <button
          className="trace-node-expander"
          onClick={() => setExpanded(!expanded)}
          disabled={!hasChildren && !hasDetails}
          title={expanded ? '收起' : '展开'}
        >
          {(hasChildren || hasDetails) ? (expanded ? '▾' : '▸') : ''}
        </button>
        <div className="trace-node-body">
          <div className="trace-node-title-row">
            <span className="trace-node-title">{node.name || KIND_LABELS[node.kind] || '执行步骤'}</span>
            {node.durationMs != null && node.durationMs > 0 && (
              <span className="trace-node-duration">{formatDuration(node.durationMs)}</span>
            )}
          </div>
          {node.summary && node.summary !== node.name && (
            <div className="trace-node-summary">{node.summary}</div>
          )}
        </div>
      </div>

      {expanded && hasDetails && (
        <div className="trace-node-details" style={{ marginLeft: `${depth * 18 + 30}px` }}>
          {node.error && (
            <div className="trace-detail-section trace-detail-error">
              <span className="trace-detail-label">错误</span>
              <div className="trace-detail-body">{node.error}</div>
            </div>
          )}
          {node.input && formatValue(node.input) && (
            <div className="trace-detail-section">
              <span className="trace-detail-label">输入摘要</span>
              <div className="trace-detail-body">{formatValue(node.input)}</div>
            </div>
          )}
          {node.output && formatValue(node.output) && (
            <div className="trace-detail-section">
              <span className="trace-detail-label">输出摘要</span>
              <div className="trace-detail-body">{formatValue(node.output)}</div>
            </div>
          )}
          {node.metadata && formatValue(node.metadata) && (
            <div className="trace-detail-section">
              <span className="trace-detail-label">元数据</span>
              <div className="trace-detail-body">{formatValue(node.metadata)}</div>
            </div>
          )}
          {node.reasoningContent && (
            <div className="trace-detail-section">
              <span className="trace-detail-label">模型思考</span>
              <div className="trace-detail-body trace-detail-reasoning">{node.reasoningContent}</div>
            </div>
          )}
        </div>
      )}

      {expanded && hasChildren && (
        <div className="trace-node-children">
          {node.children.map((child) => (
            <TraceNodeItem key={child.spanId || child.eventId} node={child} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  );
};

const ThinkingPanel = ({ traceEvents = [], chainNodes = [], thinkingSteps = [], isStreaming }) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(true);
  const contentRef = useRef(null);

  const sourceMode = traceEvents.length > 0
    ? 'trace'
    : chainNodes.length > 0
      ? 'legacy'
      : thinkingSteps.length > 0
        ? 'steps'
        : 'empty';

  const traceTree = useMemo(() => {
    if (sourceMode === 'trace') return mergeTraceEvents(traceEvents);
    if (sourceMode === 'legacy') return normalizeChainNodes(chainNodes);
    if (sourceMode === 'steps') return normalizeThinkingSteps(thinkingSteps, isStreaming);
    return [];
  }, [sourceMode, traceEvents, chainNodes, thinkingSteps, isStreaming]);

  const flatTrace = useMemo(() => flattenTrace(traceTree), [traceTree]);

  const stats = useMemo(() => {
    const completed = flatTrace.filter((n) => n.phase === 'COMPLETED').length;
    const errors = flatTrace.filter((n) => n.phase === 'ERROR' || n.kind === 'ERROR').length;
    const running = flatTrace.filter((n) => n.phase === 'STARTED' || n.phase === 'RUNNING').length;
    const tools = flatTrace.filter((n) => n.kind === 'TOOL').length;
    return { completed, errors, running, tools };
  }, [flatTrace]);

  useEffect(() => {
    if (contentRef.current && isExpanded && !isCollapsed) {
      contentRef.current.scrollTop = contentRef.current.scrollHeight;
    }
  }, [traceEvents, chainNodes, thinkingSteps, isExpanded, isCollapsed]);

  if (flatTrace.length === 0) return null;

  const latest = flatTrace[flatTrace.length - 1];
  const latestBaseText = latest?.summary || latest?.name || '执行中';
  const latestStatusText = latest?.phase === 'COMPLETED'
    ? `${latestBaseText} 已完成`
    : latest?.phase === 'ERROR'
      ? `${latestBaseText} 失败`
      : `${latestBaseText}...`;
  const statItems = [
    `${stats.completed} 步完成`,
    ...(stats.tools > 0 ? [`${stats.tools} 次工具`] : []),
    ...(stats.errors > 0 ? [`${stats.errors} 错误`] : []),
  ];

  return (
    <div className={`thinking-panel trace-panel ${isCollapsed ? 'thinking-panel-collapsed' : ''}`}>
      <div className="thinking-panel-header" onClick={() => setIsCollapsed(!isCollapsed)}>
        <div className="thinking-panel-header-left">
          <span className="thinking-panel-arrow">{isCollapsed ? '▸' : '▾'}</span>
          <span className="thinking-panel-title">执行轨迹</span>
          {isCollapsed && (
            <span className="thinking-panel-collapsed-summary">{latestStatusText}</span>
          )}
          {!isCollapsed && isStreaming && stats.running > 0 && (
            <span className="thinking-panel-live-badge">
              运行中
            </span>
          )}
          {!isCollapsed && (
            <span className="thinking-panel-stats">
              {statItems.join(' · ')}
            </span>
          )}
        </div>
        {!isCollapsed && flatTrace.length > 2 && (
          <button
            className="thinking-panel-toggle-btn"
            onClick={(e) => {
              e.stopPropagation();
              setIsExpanded(!isExpanded);
            }}
          >
            {isExpanded ? '紧凑显示' : '展开详情'}
          </button>
        )}
      </div>

      {!isCollapsed && (
        <div
          className={`thinking-panel-content ${isExpanded ? '' : 'thinking-panel-content-compact'}`}
          ref={contentRef}
          style={{ paddingTop: 0 }}
        >
          {traceTree.map((node) => (
            <TraceNodeItem key={node.spanId || node.eventId} node={node} />
          ))}
          {isStreaming && stats.running > 0 && (
            <div className="thinking-panel-loading">
              <span className="thinking-panel-loading-line" aria-hidden="true" />
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default ThinkingPanel;
