import React, { useState, useEffect, useCallback } from 'react';

const API = 'http://127.0.0.1:8950/api';

// Tab definitions
const TABS = [
  { id: 'overview', label: '▣ Overview' },
  { id: 'activity', label: '▸ Activity' },
  { id: 'health', label: '◉ Health' },
  { id: 'scheduler', label: '◷ Scheduler' },
  { id: 'guardian', label: '⛨ Guardian' },
  { id: 'recovery', label: '⌬ Recovery' },
];

const CAT_ICONS = {
  system:   '◈',
  action:   '▸',
  security: '⛨',
  success:  '▣',
  error:    '✕',
};
const catIcon = (cat) => CAT_ICONS[cat?.toLowerCase()] || '▸';

export default function ActivityDashboard({ onClose }) {
  const [tab, setTab] = useState('overview');
  const [feed, setFeed] = useState([]);
  const [processes, setProcesses] = useState([]);
  const [stats, setStats] = useState({});
  const [health, setHealth] = useState(null);
  const [schedulerStatus, setSchedulerStatus] = useState({});
  const [scheduledTasks, setScheduledTasks] = useState([]);
  const [guardianStatus, setGuardianStatus] = useState({});
  const [guardianDecisions, setGuardianDecisions] = useState([]);
  const [recoveryStatus, setRecoveryStatus] = useState({});
  const [recoveryHistory, setRecoveryHistory] = useState([]);
  const [time, setTime] = useState('');

  // ── Fetch everything ────────────────────────
  const refresh = useCallback(() => {
    fetch(`${API}/activity/feed?count=100`).then(r => r.json()).then(setFeed).catch(() => {});
    fetch(`${API}/activity/processes`).then(r => r.json()).then(setProcesses).catch(() => {});
    fetch(`${API}/activity/stats`).then(r => r.json()).then(setStats).catch(() => {});
    fetch(`${API}/health/detailed`).then(r => r.json()).then(setHealth).catch(() => {});
    fetch(`${API}/scheduler/status`).then(r => r.json()).then(setSchedulerStatus).catch(() => {});
    fetch(`${API}/scheduler/tasks?active_only=true`).then(r => r.json()).then(setScheduledTasks).catch(() => {});
    fetch(`${API}/guardian/status`).then(r => r.json()).then(setGuardianStatus).catch(() => {});
    fetch(`${API}/guardian/decisions?count=50`).then(r => r.json()).then(setGuardianDecisions).catch(() => {});
    fetch(`${API}/recovery/status`).then(r => r.json()).then(setRecoveryStatus).catch(() => {});
    fetch(`${API}/recovery/history?count=50`).then(r => r.json()).then(setRecoveryHistory).catch(() => {});
    fetch(`${API}/scheduler/time`).then(r => r.json()).then(d => setTime(d.now || '')).catch(() => {});
  }, []);

  useEffect(() => {
    refresh();
    const iv = setInterval(refresh, 5000);
    return () => clearInterval(iv);
  }, [refresh]);

  // ── Time formatter ──────────────────────────
  const fmt = (ts) => {
    if (!ts) return '—';
    try {
      if (typeof ts === 'number') return new Date(ts * 1000).toLocaleTimeString();
      return new Date(ts).toLocaleTimeString();
    } catch { return String(ts); }
  };

  const fmtFull = (ts) => {
    if (!ts) return '—';
    try {
      if (typeof ts === 'number') return new Date(ts * 1000).toLocaleString();
      return new Date(ts).toLocaleString();
    } catch { return String(ts); }
  };

  // ── Renders ─────────────────────────────────
  const renderOverview = () => {
    const services = health?.services || {};
    const allHealthy = health?.all_healthy;

    return (
      <div className="dash-overview">
        {/* Status cards row */}
        <div className="dash-cards">
          <div className={`dash-card ${allHealthy ? 'card-ok' : 'card-warn'}`}>
            <div className="card-icon">{allHealthy ? '◉' : '▲'}</div>
            <div className="card-label">System Health</div>
            <div className="card-value">{allHealthy ? 'All OK' : 'Degraded'}</div>
          </div>
          <div className="dash-card">
            <div className="card-icon">▸</div>
            <div className="card-label">Activities</div>
            <div className="card-value">{stats.total || 0}</div>
          </div>
          <div className="dash-card">
            <div className="card-icon">⌁</div>
            <div className="card-label">Processes</div>
            <div className="card-value">{processes.length}</div>
          </div>
          <div className="dash-card">
            <div className="card-icon">◷</div>
            <div className="card-label">Scheduled</div>
            <div className="card-value">{schedulerStatus.active_tasks || 0}</div>
          </div>
          <div className="dash-card">
            <div className="card-icon">✕</div>
            <div className="card-label">Blocked</div>
            <div className="card-value">{guardianStatus.blocked || 0}</div>
          </div>
        </div>

        {/* Service status */}
        <div className="dash-section">
          <h3>Service Status</h3>
          <div className="service-grid">
            {Object.entries(services).map(([name, svc]) => (
              <div key={name} className={`service-item ${svc.healthy ? '' : 'svc-down'}`}>
                <span className="svc-dot">{svc.healthy ? '●' : '✕'}</span>
                <span className="svc-name">{name}</span>
                <span className="svc-msg">{svc.message}</span>
                {svc.latency_ms > 0 && <span className="svc-latency">{svc.latency_ms}ms</span>}
              </div>
            ))}
          </div>
        </div>

        {/* Recent activity preview */}
        <div className="dash-section">
          <h3>Recent Activity</h3>
          <div className="feed-list">
            {feed.slice(0, 8).map((item, i) => (
              <div key={i} className={`feed-item cat-${item.category}`}>
                <span className="feed-time">{fmt(item.ts)}</span>
                <span className="feed-cat"><span className="cat-icon">{catIcon(item.category)}</span> {item.category?.toUpperCase()}</span>
                <span className="feed-summary">{item.summary}</span>
              </div>
            ))}
            {feed.length === 0 && <div className="feed-empty">No activity yet</div>}
          </div>
        </div>

        {/* CST Time */}
        <div className="dash-section time-section">
          <span className="time-label">◷ CST:</span>
          <span className="time-value">{time ? fmtFull(time) : '...'}</span>
        </div>
      </div>
    );
  };

  const renderActivity = () => (
    <div className="dash-activity">
      <div className="dash-section">
        <h3>Active Processes</h3>
        {processes.length === 0 ? (
          <div className="feed-empty">No active processes</div>
        ) : (
          <div className="feed-list">
            {processes.map((p, i) => (
              <div key={i} className="feed-item cat-process">
                <span className="feed-time">{fmt(p.ts)}</span>
                <span className="feed-summary">{p.summary}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="dash-section">
        <h3>Activity Feed</h3>
        <div className="feed-list scrollable">
          {feed.map((item, i) => (
            <div key={i} className={`feed-item cat-${item.category}`}>
              <span className="feed-time">{fmt(item.ts)}</span>
                <span className="feed-cat"><span className="cat-icon">{catIcon(item.category)}</span> {item.category?.toUpperCase()}</span>
              <span className="feed-summary">{item.summary}</span>
              {item.reasoning && (
                <div className="feed-reasoning">│ {item.reasoning}</div>
              )}
            </div>
          ))}
          {feed.length === 0 && <div className="feed-empty">No activity yet</div>}
        </div>
      </div>

      {stats.by_category && (
        <div className="dash-section">
          <h3>Statistics</h3>
          <div className="stat-grid">
            {Object.entries(stats.by_category).map(([cat, count]) => (
              <div key={cat} className="stat-item">
                <span className="stat-cat">{cat}</span>
                <span className="stat-count">{count}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );

  const renderHealth = () => {
    const services = health?.services || {};
    return (
      <div className="dash-health">
        <div className="dash-section">
          <h3>Service Health</h3>
          <div className="health-grid">
            {Object.entries(services).map(([name, svc]) => (
              <div key={name} className={`health-card ${svc.healthy ? 'h-ok' : 'h-down'}`}>
                <div className="h-icon">{svc.healthy ? '◉' : '✕'}</div>
                <div className="h-name">{name}</div>
                <div className="h-msg">{svc.message}</div>
                <div className="h-meta">
                  {svc.latency_ms > 0 && <span>{svc.latency_ms}ms</span>}
                  <span>{fmt(svc.ts)}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {health?.consecutive_failures && Object.keys(health.consecutive_failures).length > 0 && (
          <div className="dash-section">
            <h3>▲ Consecutive Failures</h3>
            {Object.entries(health.consecutive_failures).map(([svc, count]) => (
              <div key={svc} className="failure-item">
                <span>{svc}</span>
                <span className="failure-count">{count} failures</span>
              </div>
            ))}
          </div>
        )}

        <button className="dash-btn" onClick={() => {
          fetch(`${API}/health/check`, { method: 'POST' }).then(refresh);
        }}>Run Health Check Now</button>
      </div>
    );
  };

  const renderScheduler = () => (
    <div className="dash-scheduler">
      <div className="dash-section">
        <h3>Scheduler Status</h3>
        <div className="kv-grid">
          <span>Running:</span><span>{schedulerStatus.running ? '● Yes' : '○ No'}</span>
          <span>Timezone:</span><span>{schedulerStatus.timezone || 'CST'}</span>
          <span>Current Time:</span><span>{fmtFull(schedulerStatus.current_time)}</span>
          <span>Total Tasks:</span><span>{schedulerStatus.total_tasks || 0}</span>
          <span>Active Tasks:</span><span>{schedulerStatus.active_tasks || 0}</span>
        </div>
      </div>

      <div className="dash-section">
        <h3>Scheduled Tasks</h3>
        {scheduledTasks.length === 0 ? (
          <div className="feed-empty">No scheduled tasks</div>
        ) : (
          <div className="feed-list">
            {scheduledTasks.map((t) => (
              <div key={t.id} className="sched-item">
                <div className="sched-name">{t.name}</div>
                <div className="sched-meta">
                  <span className="sched-action">{t.action}</span>
                  <span className="sched-time">Fires: {fmtFull(t.run_at)}</span>
                  {t.repeat_seconds > 0 && (
                    <span className="sched-repeat">Every {t.repeat_seconds}s</span>
                  )}
                </div>
                <button className="dash-btn-sm danger" onClick={() => {
                  fetch(`${API}/scheduler/tasks/${t.id}`, { method: 'DELETE' }).then(refresh);
                }}>Remove</button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );

  const renderGuardian = () => (
    <div className="dash-guardian">
      <div className="dash-section">
        <h3>Guardian Status</h3>
        <div className="kv-grid">
          <span>Total Checks:</span><span>{guardianStatus.total_checks || 0}</span>
          <span>Blocked:</span><span className="text-danger">{guardianStatus.blocked || 0}</span>
          <span>Allowed Dirs:</span><span>{(guardianStatus.allowed_dirs || []).join(', ')}</span>
          <span>Cmd Timeout:</span><span>{guardianStatus.command_timeout || 30}s</span>
        </div>
      </div>

      <div className="dash-section">
        <h3>Recent Decisions</h3>
        <div className="feed-list scrollable">
          {guardianDecisions.map((d, i) => (
            <div key={i} className={`feed-item ${d.allowed ? 'g-allow' : 'g-block'}`}>
              <span className="feed-time">{fmt(d.ts)}</span>
              <span className={`g-badge ${d.allowed ? '' : 'blocked'}`}>
                {d.allowed ? '●' : '✕'}
              </span>
              <span className="feed-summary">{d.action}: {d.reason}</span>
              {d.path && <span className="g-path">{d.path}</span>}
            </div>
          ))}
          {guardianDecisions.length === 0 && <div className="feed-empty">No decisions yet</div>}
        </div>
      </div>
    </div>
  );

  const renderRecovery = () => (
    <div className="dash-recovery">
      <div className="dash-section">
        <h3>Recovery Engine</h3>
        <div className="kv-grid">
          <span>Running:</span><span>{recoveryStatus.running ? '● Yes' : '○ No'}</span>
          <span>Total Recoveries:</span><span>{recoveryStatus.total_recoveries || 0}</span>
        </div>
        {recoveryStatus.retry_counts && Object.keys(recoveryStatus.retry_counts).length > 0 && (
          <div style={{ marginTop: 10 }}>
            <h4>Retry Counts</h4>
            {Object.entries(recoveryStatus.retry_counts).map(([svc, count]) => (
              <div key={svc} className="failure-item">
                <span>{svc}: {count} retries</span>
                <button className="dash-btn-sm" onClick={() => {
                  fetch(`${API}/recovery/reset/${svc}`, { method: 'POST' }).then(refresh);
                }}>Reset</button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="dash-section">
        <h3>Recovery History</h3>
        <div className="feed-list scrollable">
          {recoveryHistory.map((r, i) => (
            <div key={i} className={`feed-item ${r.success ? 'r-ok' : 'r-fail'}`}>
              <span className="feed-time">{fmt(r.ts)}</span>
              <span>{r.success ? '▣' : '✕'}</span>
              <span className="feed-summary">{r.service}: {r.action}</span>
              <span className="feed-msg">{r.message}</span>
            </div>
          ))}
          {recoveryHistory.length === 0 && <div className="feed-empty">No recovery attempts</div>}
        </div>
      </div>
    </div>
  );

  const RENDER_MAP = {
    overview: renderOverview,
    activity: renderActivity,
    health: renderHealth,
    scheduler: renderScheduler,
    guardian: renderGuardian,
    recovery: renderRecovery,
  };

  return (
    <div className="dashboard">
      <div className="dash-header">
        <h2>◆ Nova Activity Dashboard</h2>
        <button className="dash-close" onClick={onClose}>✕</button>
      </div>

      <div className="dash-tabs">
        {TABS.map(t => (
          <button
            key={t.id}
            className={`dash-tab ${tab === t.id ? 'active' : ''}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="dash-body">
        {RENDER_MAP[tab]?.()}
      </div>
    </div>
  );
}
