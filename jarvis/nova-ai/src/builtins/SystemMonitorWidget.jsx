import React, { useEffect, useState, useRef } from 'react';

const HISTORY_LEN = 60;

function Bar({ label, pct, sub, color = 'bg-nova-accent' }) {
  const p = Math.max(0, Math.min(100, Math.round(pct || 0)));
  return (
    <div>
      <div className="flex justify-between text-[11px] text-nova-muted mb-0.5">
        <span>{label}</span>
        <span className="font-mono">{p}%{sub ? ` · ${sub}` : ''}</span>
      </div>
      <div className="h-1.5 rounded bg-nova-panel2 overflow-hidden">
        <div className={`h-full ${color}`} style={{ width: `${p}%` }} />
      </div>
    </div>
  );
}

function Sparkline({ data, color = '#00d4ff' }) {
  const ref = useRef(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    const W = c.clientWidth, H = c.clientHeight;
    c.width = W * dpr; c.height = H * dpr;
    const ctx = c.getContext('2d');
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, W, H);
    if (!data?.length) return;
    const max = Math.max(...data, 100);
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    data.forEach((v, i) => {
      const x = (i / (data.length - 1 || 1)) * W;
      const y = H - (v / max) * (H - 2) - 1;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.stroke();
  }, [data, color]);
  return <canvas ref={ref} className="w-full h-8" />;
}

export default function SystemMonitorWidget() {
  const [stats, setStats] = useState(null);
  const [err, setErr] = useState(null);
  const [history, setHistory] = useState({ cpu: [], mem: [] });
  const lastAlertRef = useRef({ at: 0, key: '' });

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const r = await window.nova?.control?.stats?.();
        if (cancelled) return;
        if (r?.ok) {
          setStats(r);
          setErr(null);
          setHistory((h) => ({
            cpu: [...h.cpu, r.cpu.pct].slice(-HISTORY_LEN),
            mem: [...h.mem, r.memory.pct].slice(-HISTORY_LEN),
          }));

          const now = Date.now();
          const gpuPct = r.gpu?.pct;
          const alertKey = r.cpu.pct >= 90 ? 'cpu' : r.memory.pct >= 90 ? 'memory' : gpuPct >= 90 ? 'vram' : '';
          if (alertKey && (now - lastAlertRef.current.at > 60_000 || lastAlertRef.current.key !== alertKey)) {
            lastAlertRef.current = { at: now, key: alertKey };
            const summary = alertKey === 'cpu'
              ? `System load high: CPU at ${r.cpu.pct}%`
              : alertKey === 'memory'
                ? `System memory high: RAM at ${r.memory.pct}%`
                : `GPU memory high: VRAM at ${gpuPct}%`;
            try {
              window.nova?.bus?.publish?.('widget:event', {
                widget: 'sysmon', action: 'alert', summary,
              });
            } catch {}
          }
        } else setErr(r?.error || 'failed');
      } catch (e) { if (!cancelled) setErr(String(e?.message || e)); }
    };
    tick();
    const t = setInterval(tick, 1500);
    return () => { cancelled = true; clearInterval(t); };
  }, []);

  if (err) return <div className="p-4 text-sm text-nova-err">Stats unavailable: {err}</div>;
  if (!stats) return <div className="p-4 text-sm text-nova-muted">Reading sensors…</div>;

  const up = Math.floor(stats.uptimeSec);
  const upStr = `${Math.floor(up / 86400)}d ${Math.floor((up % 86400) / 3600)}h ${Math.floor((up % 3600) / 60)}m`;

  return (
    <div className="h-full p-3 flex flex-col gap-2 bg-nova-bg text-nova-text">
      <header className="flex justify-between items-baseline">
        <div className="font-display text-sm">{stats.hostname}</div>
        <div className="text-[10.5px] text-nova-muted font-mono">{stats.platform}/{stats.arch} · up {upStr}</div>
      </header>

      <Bar label={`CPU · ${stats.cpu.count} cores`} pct={stats.cpu.pct} sub={`load ${stats.cpu.load1.toFixed(2)}`} color="bg-nova-accent" />
      <div className="bg-nova-panel rounded p-2"><Sparkline data={history.cpu} color="#00d4ff" /></div>

      <Bar label="Memory" pct={stats.memory.pct} sub={`${stats.memory.usedGB} / ${stats.memory.totalGB} GB`} color="bg-nova-accent2" />
      <div className="bg-nova-panel rounded p-2"><Sparkline data={history.mem} color="#7c5cff" /></div>

      {stats.gpu && (
        <Bar
          label={`VRAM${stats.gpu.name ? ` · ${stats.gpu.name}` : ''}`}
          pct={stats.gpu.pct}
          sub={`${stats.gpu.usedGB} / ${stats.gpu.totalGB} GB`}
          color="bg-nova-warn"
        />
      )}

      {stats.disk && (
        <Bar label="Disk /" pct={stats.disk.pct} sub={`${stats.disk.usedGB} / ${stats.disk.totalGB} GB`} color="bg-nova-ok" />
      )}

      <div className="text-[10.5px] text-nova-muted font-mono mt-auto truncate">{stats.cpu.model}</div>
    </div>
  );
}
