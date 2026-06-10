import { useState } from 'react';
import '../styles/global.css';

const STATUS_CONFIG = {
  STARTED: { label: '开始' },
  RUNNING: { label: '运行中' },
  COMPLETED: { label: '完成' },
  ERROR: { label: '错误' },
};

const formatDuration = (ms) => {
  if (!ms) return '';
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
};

const formatNum = (n) => {
  if (n == null) return '';
  return Number(n).toLocaleString();
};

const WORKER_LABELS = {
  intent_recognition: '意图识别',
  outline: '大纲生成',
  draft: '正文写作',
  polish: '润色优化',
  review: '内容评审',
  researcher: '网络调研',
  direct_answer: '直接回答',
};

const VERDICT_LABELS = {
  PASS: '通过',
  REVISE_DRAFT: '需修改草稿',
  REVISE_POLISH: '需修改润色',
};

const getOutputSummary = (node) => {
  if (!node || node.status !== 'COMPLETED') return null;
  const { nodeType, output } = node;
  if (!output || typeof output !== 'object') return null;

  // Planning node: show planned steps
  if (nodeType === 'PLANNING' && output.steps && Array.isArray(output.steps)) {
    const stepLabels = output.steps.map(s => WORKER_LABELS[s] || s);
    return `计划执行: ${stepLabels.join(' → ')}`;
  }
  if (nodeType === 'PLANNING' && output.reasoning) {
    return output.reasoning;
  }

  // Worker execution wrapper from SupervisorNode
  if (output.worker) {
    const workerName = output.worker;
    if (workerName === 'intent_recognition' && output.intent) {
      const type = output.writingType || '';
      return `识别为 ${output.intent}${type ? ` (${type})` : ''}`;
    }
    if (workerName === 'researcher' && output.searchRounds != null) {
      const parts = [`执行 ${output.searchRounds} 次搜索`];
      if (output.sourcesCount) parts.push(`${output.sourcesCount} 个来源`);
      return parts.join('，');
    }
    if (workerName === 'review' && output.verdict) {
      const verdict = VERDICT_LABELS[output.verdict] || output.verdict;
      const fb = output.feedback ? ` — ${output.feedback}` : '';
      return `${verdict}${fb}`;
    }
    if (workerName === 'draft' && output.draftLength != null) return `生成草稿 ${formatNum(output.draftLength)} 字`;
    if (workerName === 'polish' && output.polishedLength != null) return `润色完成 ${formatNum(output.polishedLength)} 字`;
    if (workerName === 'outline' && output.outlineLength != null) return `生成大纲 ${formatNum(output.outlineLength)} 字`;
    if (workerName === 'direct_answer' && output.outputLength != null) return `生成回答 ${formatNum(output.outputLength)} 字`;
    if (output.draftLength != null) return `生成草稿 ${formatNum(output.draftLength)} 字`;
    if (output.polishedLength != null) return `润色完成 ${formatNum(output.polishedLength)} 字`;
    if (output.outlineLength != null) return `生成大纲 ${formatNum(output.outlineLength)} 字`;
    if (output.outputLength != null) return `生成回答 ${formatNum(output.outputLength)} 字`;
  }

  // Direct worker outputs
  if (nodeType === 'THINKING' && output.intent) {
    const type = output.writingType || '';
    return `识别为 ${output.intent}${type ? ` (${type})` : ''}`;
  }
  if (nodeType === 'THINKING' && output.score != null) {
    const verdict = VERDICT_LABELS[output.verdict] || output.verdict || '';
    const fb = output.feedback ? ` — ${output.feedback}` : '';
    return `评分 ${output.score}/10${verdict ? ` — ${verdict}` : ''}${fb}`;
  }
  if (nodeType === 'TOOL_CALL' && output.searchRounds != null) {
    const parts = [`执行 ${output.searchRounds} 次搜索`];
    if (output.reportLength) parts.push(`生成 ${formatNum(output.reportLength)} 字报告`);
    if (output.sourcesCount) parts.push(`${output.sourcesCount} 个来源`);
    return parts.join('，');
  }
  if (output.length != null) {
    return `${formatNum(output.length)} 字`;
  }
  if (output.newSteps && Array.isArray(output.newSteps)) {
    const stepLabels = output.newSteps.map(s => WORKER_LABELS[s] || s);
    return `调整为: ${stepLabels.join(' → ')}`;
  }

  return null;
};

const formatOutput = (output) => {
  if (output == null) return null;
  if (typeof output === 'string') return output || null;
  if (typeof output === 'object') {
    const entries = Object.entries(output).filter(([, v]) => v != null);
    if (entries.length === 0) return null;
    return entries.map(([k, v]) => (
      <div key={k} className="chain-node-detail-kv">
        <span className="chain-node-detail-key">{k}</span>
        <span className="chain-node-detail-value">
          {typeof v === 'object' ? JSON.stringify(v) : String(v)}
        </span>
      </div>
    ));
  }
  const str = String(output);
  return str === 'null' || str === 'undefined' ? null : str;
};

const ChainNodeItem = ({ node, isLast }) => {
  const [expanded, setExpanded] = useState(false);
  const statusConfig = STATUS_CONFIG[node.status] || STATUS_CONFIG.STARTED;
  const hasDetails = node.input || node.output || node.error || node.reasoningContent;
  const isRunning = node.status === 'STARTED' || node.status === 'RUNNING';
  const outputSummary = getOutputSummary(node);
  const statusClass = (node.status || 'STARTED').toLowerCase();

  return (
    <div
      className={`chain-node-item chain-node-status-${statusClass} ${isRunning ? 'chain-node-running' : ''}`}
      data-terminal={isLast ? 'true' : undefined}
    >
      <div className="chain-node-content">
        <div className="chain-node-header" onClick={() => hasDetails && setExpanded(!expanded)}>
          <div className="chain-node-title-row">
            <span className="chain-node-name">{node.nodeName}</span>
            {isRunning && (
              <span className="chain-node-running-text">{statusConfig.label}</span>
            )}
          </div>
          <div className="chain-node-meta">
            {node.duration != null && node.duration > 0 && (
              <span className="chain-node-duration">
                {formatDuration(node.duration)}
              </span>
            )}
            {hasDetails && (
              <span className={`chain-node-expand-icon ${expanded ? 'expanded' : ''}`}>
                <svg width="8" height="8" viewBox="0 0 10 10" fill="none">
                  <path d={expanded ? 'M2 7L5 4L8 7' : 'M2 3.5L5 6.5L8 3.5'} stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </span>
            )}
          </div>
        </div>
        {outputSummary && (
          <div className="chain-node-summary">{outputSummary}</div>
        )}
        {expanded && hasDetails && (
          <div className="chain-node-details">
            {node.error && (
              <div className="chain-node-error-section">
                <span className="chain-node-detail-label">错误信息</span>
                <div className="chain-node-error-text">{node.error}</div>
              </div>
            )}
            {node.input && formatOutput(node.input) && (
              <div className="chain-node-detail-section">
                <span className="chain-node-detail-label">输入参数</span>
                <div className="chain-node-detail-body">{formatOutput(node.input)}</div>
              </div>
            )}
            {node.output && formatOutput(node.output) && (
              <div className="chain-node-detail-section">
                <span className="chain-node-detail-label">输出结果</span>
                <div className="chain-node-detail-body">{formatOutput(node.output)}</div>
              </div>
            )}
            {node.reasoningContent && (
              <div className="chain-node-detail-section chain-node-reasoning">
                <span className="chain-node-detail-label">模型思考过程</span>
                <div className="chain-node-reasoning-body">{node.reasoningContent}</div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default ChainNodeItem;
