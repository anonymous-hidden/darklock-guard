import React, { useState, useEffect, useRef } from 'react';

const API = 'http://127.0.0.1:8950/api';

function barColor(val) {
  if (val > 85) return '#f38ba8';
  if (val > 60) return '#f9e2af';
  return '#a6e3a1';
}

function MetricBar({ label, value, color, detail }) {
  return (
    <div className="sys-metric">
      <div className="sys-row">
        <span className="sys-label">{label}</span>
        <div className="sys-track">
          <div
            className="sys-fill"
            style={{ width: `${Math.min(100, Math.max(0, value ?? 0))}%`, background: color }}
          />
        </div>
        <span className="sys-val">{value != null ? `${Math.round(value)}%` : '—'}</span>
      </div>
      {detail && <div className="sys-detail">{detail}</div>}
    </div>
  );
}

export default function SystemPanel({ onClose }) {
  const [snap, setSnap] = useState(null);
  const [history, setHistory] = useState([]);
  const timerRef = useRef(null);

  const poll = () => {
    fetch(`${API}/system/snapshot`)
      .then(r => r.json())
      .then(d => {
        setSnap(d);
        setHistory(h => [...h.slice(-59), d]);
      })
      .catch(() => {});
  };

  useEffect(() => {
    poll();
    timerRef.current = setInterval(poll, 3000);
    return () => clearInterval(timerRef.current);
  }, []);

  const cpu = snap?.cpu?.percent ?? null;
  const ram = snap?.ram?.percent ?? null;
  const gpu = snap?.gpu?.utilization ?? null;
  const vramPct = snap?.gpu?.vram_total_mb
    ? Math.round((snap.gpu.vram_used_mb / snap.gpu.vram_total_mb) * 100)
    : null;
  const disk = snap?.disk?.percent ?? null;

  const W = 200;
  const H = 52;

  const sparkline = (key, color) => {
    if (history.length < 2) return null;
    const vals = history.map(s => {
      if (key === 'cpu') return s?.cpu?.percent ?? 0;
      if (key === 'ram') return s?.ram?.percent ?? 0;
      if (key === 'gpu') return s?.gpu?.utilization ?? 0;
      return 0;
    });
    const pts = vals.map((v, i) => {
      const x = (i / (vals.length - 1)) * W;
      const y = H - (v / 100) * H;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(' ');
    return <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" opacity="0.85" />;
  };

  return (
    <div className="sys-panel">
      <div className="sys-panel-header">
        <span>System Monitor</span>
        <button className="modal-close" onClick={onClose}>✕</button>
      </div>

      <div className="sys-metrics">
        <MetricBar
          label="CPU"
          value={cpu}
          color={barColor(cpu)}
          detail={[
            snap?.cpu?.freq_mhz ? `${Math.round(snap.cpu.freq_mhz)} MHz` : null,
            snap?.cpu?.temp_c ? `${snap.cpu.temp_c}°C` : null,
            snap?.cpu?.cores ? `${snap.cpu.cores} cores` : null,
          ].filter(Boolean).join(' · ')}
        />
        <MetricBar
          label="RAM"
          value={ram}
          color={barColor(ram ?? 0)}
          detail={snap?.ram
            ? `${snap.ram.used_gb?.toFixed(1) ?? '?'} GB / ${snap.ram.total_gb?.toFixed(1) ?? '?'} GB`
            : null}
        />
        <MetricBar
          label="GPU"
          value={gpu}
          color={gpu != null ? (gpu > 85 ? '#f38ba8' : gpu > 60 ? '#f9e2af' : '#cba6f7') : '#6c7086'}
          detail={[
            snap?.gpu?.name || null,
            snap?.gpu?.temp_c ? `${snap.gpu.temp_c}°C` : null,
          ].filter(Boolean).join(' · ') || (snap && !snap.gpu ? 'No GPU detected' : null)}
        />
        <MetricBar
          label="VRAM"
          value={vramPct}
          color={vramPct != null ? (vramPct > 90 ? '#f38ba8' : vramPct > 80 ? '#f9e2af' : '#94e2d5') : '#6c7086'}
          detail={snap?.gpu?.vram_total_mb
            ? `${snap.gpu.vram_used_mb} MB / ${snap.gpu.vram_total_mb} MB`
            : null}
        />
        <MetricBar
          label="Disk"
          value={disk}
          color={disk != null ? (disk > 90 ? '#f38ba8' : disk > 75 ? '#f9e2af' : '#6c7086') : '#6c7086'}
          detail={snap?.disk
            ? `${snap.disk.used_gb?.toFixed(0) ?? '?'} GB / ${snap.disk.total_gb?.toFixed(0) ?? '?'} GB`
            : null}
        />
      </div>

      <div className="sys-sparkline-wrap">
        <svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
          {sparkline('cpu', '#a6e3a1')}
          {sparkline('ram', '#89b4fa')}
          {sparkline('gpu', '#cba6f7')}
        </svg>
        <div className="sys-sparkline-legend">
          <span style={{ color: '#a6e3a1' }}>■ CPU</span>
          <span style={{ color: '#89b4fa' }}>■ RAM</span>
          <span style={{ color: '#cba6f7' }}>■ GPU</span>
        </div>
      </div>

      {snap != null && (
        <div className="sys-footer">
          {snap.uptime_hours != null && `Uptime ${snap.uptime_hours.toFixed(1)}h`}
          {snap.process_count != null && ` · ${snap.process_count} processes`}
        </div>
      )}
    </div>
  );
}
