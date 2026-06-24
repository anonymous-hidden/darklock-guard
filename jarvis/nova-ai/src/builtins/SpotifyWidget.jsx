import React, { useEffect, useState, useCallback, useRef } from 'react';

const CHAT_WS = 'ws://127.0.0.1:8951/ws/chat';

function fmtClock(sec) {
  const n = Math.max(0, Number(sec) || 0);
  const m = Math.floor(n / 60);
  const s = Math.floor(n % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

/**
 * SpotifyWidget — sleek now-playing display + transport.
 *
 * Features:
 *   • Album art with subtle blurred backdrop
 *   • Animated EQ bars while playing
 *   • Transport (prev/play/next), volume slider
 *   • Lyrics panel when lyrics are supplied by the player/local source
 *   • Per-song Jarvis listening cue when lyrics are not available
 *   • Robust launch chain (snap / flatpak / xdg-open spotify://)
 */
export default function SpotifyWidget() {
  const [track, setTrack] = useState(null);
  const [err,   setErr]   = useState(null);
  const [busy,  setBusy]  = useState(false);
  const [vol,   setVol]   = useState(70);
  const [novaSays, setNovaSays] = useState('');
  const [novaPending, setNovaPending] = useState(false);
  const lastDescribedRef = useRef('');

  const hasIpc = typeof window !== 'undefined' && !!window.nova?.isElectron;

  const refresh = useCallback(async () => {
    if (!hasIpc) { setErr('no-ipc'); return; }
    try {
      const r = await window.nova.control.spotify('now-playing');
      if (r?.ok && (r.track?.title || r.track?.artist)) {
        setTrack(r.track);
        if (Number.isFinite(r.track?.volumePct)) {
          setVol(Math.max(0, Math.min(100, Math.round(r.track.volumePct))));
        }
        setErr(null);
      } else {
        setTrack(null);
        setErr(r?.error || 'no-player');
      }
    } catch (e) {
      setTrack(null);
      setErr(String(e?.message || e));
    }
  }, [hasIpc]);

  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => {
    if (!hasIpc) return;
    const t = setInterval(refresh, 3000);
    return () => clearInterval(t);
  }, [refresh, hasIpc]);

  const cmd = async (action, arg) => {
    if (!hasIpc) return;
    setBusy(true);
    try { await window.nova.control.spotify(arg ? { action, value: arg } : action); }
    catch {}
    finally { setBusy(false); refresh(); }
  };

  const launch = async () => {
    if (!hasIpc) return;
    setBusy(true);
    try {
      const r = await window.nova.control.openApp('spotify');
      if (!r?.ok) setErr(r?.error || 'launch failed');
    } catch (e) { setErr(String(e?.message || e)); }
    finally { setTimeout(() => { setBusy(false); refresh(); }, 1800); }
  };

  const lyricsText = [track?.lyrics, track?.syncedLyrics, track?.plainLyrics]
    .find((value) => typeof value === 'string' && value.trim().length > 0)?.trim() || '';

  /* Per-song Jarvis cue — fires when the track key changes and no lyrics are available. */
  useEffect(() => {
    if (!track?.title || !track?.artist) return;
    if (lyricsText) { setNovaSays(''); setNovaPending(false); return; }
    const key = `${track.title} | ${track.artist}`;
    if (lastDescribedRef.current === key) return;
    lastDescribedRef.current = key;
    setNovaSays('');
    setNovaPending(true);
    let done = false;
    let ws;
    try { ws = new WebSocket(CHAT_WS); } catch { setNovaPending(false); return; }
    const timer = setTimeout(() => { if (!done) { done = true; try { ws.close(); } catch {} setNovaPending(false); } }, 14000);
    const prompt =
      `You are Jarvis. Lyrics were not supplied by an authorized local source, so do not quote or reconstruct lyrics. ` +
      `In ONE short sentence (max 16 words), give Cayden a quick, warm listening cue for this song: ` +
      `"${track.title}" by ${track.artist}${track.album ? ` (album: ${track.album})` : ''}. ` +
      `No quotes around the song. No markdown. No <thinking> blocks. Just the sentence.`;
    ws.onopen = () => ws.send(JSON.stringify({ type: 'message', content: prompt }));
    ws.onmessage = (ev) => {
      if (done) return;
      let msg; try { msg = JSON.parse(ev.data); } catch { return; }
      if (msg.type === 'done') {
        done = true; clearTimeout(timer);
        const clean = (msg.full_response || '').replace(/<thinking>[\s\S]*?<\/thinking>/gi, '').trim();
        setNovaSays(clean.replace(/^["']|["']$/g, ''));
        setNovaPending(false);
        try { ws.close(); } catch {}
      }
    };
    ws.onerror = () => { if (!done) { done = true; clearTimeout(timer); setNovaPending(false); } };
    return () => { clearTimeout(timer); try { ws?.close(); } catch {} };
  }, [track?.title, track?.artist, track?.album, lyricsText]);

  const playing = track && (track.status === 'Playing' || track.status === 'playing');
  const title = String(track?.title || 'Unknown title');
  const longTitle = title.length > 28;
  const positionSec = Math.max(0, Number(track?.positionSec) || 0);
  const lengthSec = Math.max(0, Number(track?.lengthSec) || 0);
  const progressPct = lengthSec > 0 ? Math.max(0, Math.min(100, (positionSec / lengthSec) * 100)) : 0;

  /* ── No IPC bridge ─────────────────────────────────── */
  if (!hasIpc) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-3 text-center px-6 bg-nova-bg text-nova-text">
        <div className="w-14 h-14 rounded-full bg-nova-panel border border-nova-border flex items-center justify-center text-2xl text-nova-err">!</div>
        <div className="font-display text-sm text-nova-err">IPC bridge unavailable</div>
      </div>
    );
  }

  /* ── No player ─────────────────────────────────────── */
  if (!track) {
    const isPlayerctlError = err && err !== 'no-player' && err !== 'no-ipc';
    return (
      <div className="h-full p-5 flex flex-col items-center justify-center gap-4 bg-gradient-to-b from-nova-bg to-nova-panel/40 text-nova-text">
        <div className="w-20 h-20 rounded-full bg-gradient-to-br from-emerald-500/30 to-nova-panel border border-nova-ok/40 flex items-center justify-center text-4xl text-nova-ok shadow-[0_0_30px_-5px_rgba(34,197,94,0.4)]">
          ♫
        </div>
        <div className="text-center">
          <div className="font-display text-base">Spotify isn't running</div>
          <div className="text-[11px] text-nova-muted mt-0.5 max-w-[260px]">
            Hit Launch — Jarvis will try snap, flatpak, and the native command.
          </div>
        </div>
        {isPlayerctlError && (
          <div className="text-[10px] text-nova-err font-mono max-w-[280px] text-center bg-nova-err/10 border border-nova-err/30 rounded px-2 py-1">
            {err}
          </div>
        )}
        <div className="flex gap-2">
          <button disabled={busy} onClick={launch} className="px-4 py-1.5 rounded-md bg-gradient-to-br from-nova-ok to-emerald-600 text-white text-xs hover:from-emerald-400 disabled:opacity-50 shadow-md">
            {busy ? 'Launching…' : '▶ Launch Spotify'}
          </button>
          <button onClick={refresh} className="nova-btn text-xs">Retry</button>
        </div>
      </div>
    );
  }

  /* ── Now playing ───────────────────────────────────── */
  return (
    <div className="h-full relative flex flex-col bg-nova-bg text-nova-text overflow-hidden">
      {/* Blurred art backdrop */}
      {track?.art && (
        <div
          className="absolute inset-0 opacity-25 blur-2xl scale-110 pointer-events-none"
          style={{ backgroundImage: `url(${track.art})`, backgroundSize: 'cover', backgroundPosition: 'center' }}
        />
      )}
      <div className="absolute inset-0 bg-gradient-to-b from-nova-bg/60 via-nova-bg/80 to-nova-bg pointer-events-none" />

      <div className="relative z-10 flex-1 flex flex-col p-3 gap-2.5">
        <div className="flex items-center justify-between">
          <div className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full border border-nova-accent/40 bg-nova-accent/10 text-[9.5px] font-mono text-nova-accent tracking-wide">
            ✦ NOW PLAYING
          </div>
          <div className={`text-[9.5px] font-mono px-2 py-0.5 rounded-full border ${playing ? 'text-nova-ok border-nova-ok/40 bg-nova-ok/10' : 'text-nova-muted border-nova-border bg-nova-panel/50'}`}>
            {playing ? 'LIVE' : 'PAUSED'}
          </div>
        </div>

        {/* Art + meta */}
        <div className="flex gap-3 items-center">
          <div className="relative w-24 h-24 rounded-xl bg-nova-panel2 border border-nova-border overflow-hidden shrink-0 shadow-xl ring-1 ring-white/5">
            {track?.art ? (
              <img src={track.art} alt="" className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-4xl text-nova-ok">♫</div>
            )}
            {playing && (
              <div className="absolute bottom-1 left-1 flex gap-0.5 items-end h-3">
                {[0, 1, 2].map((i) => (
                  <span key={i} className="w-1 bg-nova-ok rounded-sm origin-bottom"
                    style={{ animation: `nova-eq 0.9s ease-in-out ${i * 0.15}s infinite`, height: '100%' }} />
                ))}
              </div>
            )}
          </div>

          <div className="flex-1 min-w-0">
            <div className="font-display text-base leading-tight overflow-hidden" title={track.title}>
              {longTitle ? (
                <div className="inline-block whitespace-nowrap pr-6 animate-[nova-marquee_10s_linear_infinite]">{title}</div>
              ) : (
                <span className="truncate block">{title}</span>
              )}
            </div>
            <div className="text-xs text-nova-muted truncate mt-0.5" title={track.artist}>
              {track.artist || 'Unknown artist'}
            </div>
            <div className="text-[10.5px] text-nova-muted truncate mt-1">{track.album || ''}</div>
            <div className={`mt-1.5 inline-flex items-center gap-1 text-[10px] font-mono ${playing ? 'text-nova-ok' : 'text-nova-muted'}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${playing ? 'bg-nova-ok animate-pulse' : 'bg-nova-muted'}`} />
              {playing ? 'PLAYING' : (track.status || 'PAUSED').toUpperCase()}
            </div>
          </div>
        </div>

        <div className="bg-nova-panel/60 border border-nova-border/60 rounded-lg px-2 py-1.5 backdrop-blur">
          <div className="flex items-center justify-between text-[9.5px] font-mono text-nova-muted">
            <span>progress</span>
            <span>{lengthSec > 0 ? `${Math.round(progressPct)}%` : 'live stream'}</span>
          </div>
          <div className="mt-1 h-1.5 rounded-full bg-nova-panel2/90 overflow-hidden">
            <div
              className="h-full rounded-full bg-gradient-to-r from-nova-accent via-cyan-400 to-nova-ok transition-[width] duration-300"
              style={{ width: `${progressPct}%` }}
            />
          </div>
          <div className="mt-1 flex items-center justify-between text-[9px] font-mono text-nova-muted">
            <span>{fmtClock(positionSec)}</span>
            <span>{lengthSec > 0 ? fmtClock(lengthSec) : '--:--'}</span>
          </div>
        </div>

        {/* Lyrics or Jarvis's live listening cue */}
        <div className="bg-nova-panel/60 border border-nova-border/60 rounded-lg px-2 py-1.5 backdrop-blur min-h-[36px] max-h-24 overflow-y-auto">
          <div className="text-[9.5px] font-mono text-nova-accent2 mb-0.5 flex items-center gap-1">
            ✦ {lyricsText ? 'LYRICS' : 'NOVA'} {novaPending && <span className="animate-pulse">listening…</span>}
          </div>
          <div className="text-[11.5px] leading-snug text-nova-text/90 whitespace-pre-wrap">
            {lyricsText || novaSays || (novaPending ? '' : 'No local lyrics available for this track yet.')}
          </div>
        </div>

        {/* Transport */}
        <div className="flex justify-center gap-2">
          <button disabled={busy} onClick={() => cmd('previous')} className="nova-btn text-base px-3.5 py-1.5" title="Previous">⏮</button>
          <button disabled={busy} onClick={() => cmd('toggle')}
            className="px-5 py-2 min-w-[60px] rounded-md bg-gradient-to-br from-nova-ok to-emerald-600 hover:from-emerald-400 text-white text-lg shadow-md disabled:opacity-50"
            title={playing ? 'Pause' : 'Play'}>
            {playing ? '⏸' : '⏵'}
          </button>
          <button disabled={busy} onClick={() => cmd('next')} className="nova-btn text-base px-3.5 py-1.5" title="Next">⏭</button>
        </div>

        {/* Volume */}
        <div className="flex items-center gap-2 text-[10px] text-nova-muted">
          <span>🔈</span>
          <input
            type="range" min="0" max="100" value={vol}
            onChange={(e) => setVol(Number(e.target.value))}
            onMouseUp={(e) => cmd('volume', Number(e.target.value))}
            onTouchEnd={(e) => cmd('volume', Number(e.target.value))}
            className="flex-1 h-1.5 rounded-lg appearance-none cursor-pointer nova-slider"
            style={{ background: `linear-gradient(to right, #3ddc84 0%, #3ddc84 ${vol}%, rgba(35,35,47,0.95) ${vol}%, rgba(35,35,47,0.95) 100%)` }}
          />
          <span>🔊</span>
          <span className="w-7 text-right tabular-nums">{vol}%</span>
        </div>

        {/* Footer */}
        <div className="flex gap-2 mt-auto">
          <button onClick={launch} className="nova-btn text-[11px] flex-1">Open Spotify</button>
          <button onClick={refresh} className="nova-btn text-[11px] flex-1">Refresh</button>
        </div>
      </div>

      <style>{`
        @keyframes nova-eq {
          0%, 100% { transform: scaleY(0.3); }
          50% { transform: scaleY(1); }
        }
        @keyframes nova-marquee {
          0% { transform: translateX(0); }
          100% { transform: translateX(-40%); }
        }
        .nova-slider::-webkit-slider-thumb {
          -webkit-appearance: none;
          width: 12px;
          height: 12px;
          border-radius: 999px;
          background: #3ddc84;
          border: 1px solid rgba(10, 10, 15, 0.7);
          box-shadow: 0 0 0 2px rgba(61, 220, 132, 0.2);
        }
        .nova-slider::-moz-range-thumb {
          width: 12px;
          height: 12px;
          border-radius: 999px;
          background: #3ddc84;
          border: 1px solid rgba(10, 10, 15, 0.7);
          box-shadow: 0 0 0 2px rgba(61, 220, 132, 0.2);
        }
      `}</style>
    </div>
  );
}
