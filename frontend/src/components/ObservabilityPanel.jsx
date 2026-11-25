import { useCallback, useEffect, useMemo, useState } from 'react';
import * as observabilityApi from '../api/observability';

const formatDuration = (value) => {
  if (value == null) return '-';
  if (value < 1000) return `${Math.round(value)}ms`;
  return `${(value / 1000).toFixed(1)}s`;
};

const formatTime = (value) => {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString();
};

const statusLabel = (status) => {
  const normalized = (status || '').toLowerCase();
  if (normalized === 'critical') return 'Critical';
  if (normalized === 'warning') return 'Warning';
  if (normalized === 'error') return 'Error';
  return 'Healthy';
};

const eventOffset = (event, firstTs) => {
  const ts = event.startedAt || event.timestamp || firstTs;
  return Math.max(0, ts - firstTs);
};

const ObservabilityPanel = ({ onBack }) => {
  const [dashboard, setDashboard] = useState(null);
  const [selectedRunId, setSelectedRunId] = useState('');
  const [loadedRunDetail, setRunDetail] = useState(null);
  const [filter, setFilter] = useState('all');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const runDetail = loadedRunDetail?.runId === selectedRunId ? loadedRunDetail : null;

  const loadDashboard = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await observabilityApi.getDashboard(80);
      setDashboard(data);
      const firstRun = data?.runs?.[0]?.runId || '';
      setSelectedRunId((current) => current || firstRun);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const initial = setTimeout(loadDashboard, 0);
    const timer = setInterval(loadDashboard, 15000);
    return () => {
      clearTimeout(initial);
      clearInterval(timer);
    };
  }, [loadDashboard]);

  useEffect(() => {
    if (!selectedRunId) return;
    let cancelled = false;
    async function loadRun() {
      try {
        const detail = await observabilityApi.getRunDetail(selectedRunId);
        if (!cancelled) setRunDetail(detail);
      } catch (e) {
        if (!cancelled) setError(e.message);
      }
    }
    loadRun();
    const timer = setInterval(loadRun, 15000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [selectedRunId]);

  const events = useMemo(() => {
    const list = runDetail?.events || [];
    if (filter === 'all') return list;
    if (filter === 'error') return list.filter((e) => e.phase === 'ERROR' || e.status === 'ERROR');
    return list.filter((e) => (e.kind || '').toLowerCase() === filter);
  }, [runDetail, filter]);

  const firstTs = useMemo(() => {
    const timestamps = (runDetail?.events || [])
      .map((e) => e.startedAt || e.timestamp)
      .filter(Boolean);
    return timestamps.length ? Math.min(...timestamps) : 0;
  }, [runDetail]);

  const totalDuration = Math.max(runDetail?.totalDurationMs || 1, 1);
  const health = dashboard?.health;

  return (
    <div className="observability-shell">
      <header className="observability-header">
        <div>
          <button className="panel-back-btn" onClick={onBack}>←</button>
          <span className="observability-kicker">AI Observability</span>
          <h1>运行可观测性</h1>
        </div>
        <button className="observability-refresh" onClick={loadDashboard} disabled={loading}>
          {loading ? '刷新中' : '刷新'}
        </button>
      </header>

      {error && <div className="observability-error">{error}</div>}

      <section className="observability-metrics">
        <div className={`observability-health ${health?.status || 'healthy'}`}>
          <span>Health</span>
          <strong>{statusLabel(health?.status)}</strong>
        </div>
        <div>
          <span>Events / 1h</span>
          <strong>{health?.eventsLastHour ?? 0}</strong>
        </div>
        <div>
          <span>Error Rate</span>
          <strong>{(health?.errorRatePercent ?? 0).toFixed(2)}%</strong>
        </div>
        <div>
          <span>Avg Duration</span>
          <strong>{formatDuration(health?.avgDurationMs)}</strong>
        </div>
      </section>

      <div className="observability-layout">
        <aside className="observability-runs">
          <div className="observability-section-title">Runs</div>
          {(dashboard?.runs || []).map((run) => (
            <button
              key={run.runId}
              className={`observability-run ${selectedRunId === run.runId ? 'active' : ''}`}
              onClick={() => setSelectedRunId(run.runId)}
            >
              <span className={`run-dot ${(run.lastStatus || '').toLowerCase()}`} />
              <span className="run-main">
                <strong>{run.lastName || 'AI run'}</strong>
                <small>{run.model || run.provider || run.runId}</small>
              </span>
              <span className="run-time">{formatDuration(run.durationMs)}</span>
            </button>
          ))}
          {(!dashboard?.runs || dashboard.runs.length === 0) && (
            <div className="observability-empty">暂无运行数据</div>
          )}
        </aside>

        <section className="observability-detail">
          <div className="observability-detail-head">
            <div>
              <span className="observability-section-title">Trace Waterfall</span>
              <h2>{selectedRunId || '未选择运行'}</h2>
            </div>
            <div className="trace-filters">
              {['all', 'worker', 'tool', 'rag', 'memory', 'error'].map((item) => (
                <button
                  key={item}
                  className={filter === item ? 'active' : ''}
                  onClick={() => setFilter(item)}
                >
                  {item}
                </button>
              ))}
            </div>
          </div>

          <div className="trace-waterfall">
            {events.map((event) => {
              const offset = eventOffset(event, firstTs);
              const width = Math.max(2, ((event.durationMs || 80) / totalDuration) * 100);
              const left = Math.min(92, (offset / totalDuration) * 100);
              return (
                <div key={event.eventId} className={`trace-row ${(event.status || '').toLowerCase()}`}>
                  <div className="trace-row-label">
                    <strong>{event.name || event.kind}</strong>
                    <small>{event.kind} · {event.phase}</small>
                  </div>
                  <div className="trace-row-track">
                    <span
                      className="trace-row-bar"
                      style={{ left: `${left}%`, width: `${Math.min(width, 100 - left)}%` }}
                    />
                  </div>
                  <div className="trace-row-meta">
                    <span>{formatDuration(event.durationMs)}</span>
                    <small>{formatTime(event.timestamp)}</small>
                  </div>
                </div>
              );
            })}
            {events.length === 0 && (
              <div className="observability-empty">该筛选下暂无事件</div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
};

export default ObservabilityPanel;
