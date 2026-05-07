import React, { useState, useEffect, useRef, useCallback } from 'react';

// Build a 16-bit mono WAV blob from Float32 PCM samples at the given sample rate
function buildWav(samples, sampleRate) {
  const len    = samples.length;
  const buf    = new ArrayBuffer(44 + len * 2);
  const view   = new DataView(buf);
  const write  = (o, s) => { for (let i = 0; i < s.length; i++) view.setUint8(o + i, s.charCodeAt(i)); };
  write(0,  'RIFF');
  view.setUint32(4,  36 + len * 2, true);
  write(8,  'WAVE');
  write(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1,  true);         // PCM
  view.setUint16(22, 1,  true);         // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2,  true);
  view.setUint16(32, 2,  true);
  view.setUint16(34, 16, true);
  write(36, 'data');
  view.setUint32(40, len * 2, true);
  for (let i = 0; i < len; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Blob([buf], { type: 'audio/wav' });
}

// ─── Holographic sphere generation ────────────────────────────
// Generate icosphere vertices and edges for the wireframe sphere
function generateIcosphere(subdivisions = 2) {
  const t = (1 + Math.sqrt(5)) / 2;
  let verts = [
    [-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0],
    [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t],
    [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1],
  ];
  let faces = [
    [0,11,5],[0,5,1],[0,1,7],[0,7,10],[0,10,11],
    [1,5,9],[5,11,4],[11,10,2],[10,7,6],[7,1,8],
    [3,9,4],[3,4,2],[3,2,6],[3,6,8],[3,8,9],
    [4,9,5],[2,4,11],[6,2,10],[8,6,7],[9,8,1],
  ];
  // Normalize initial verts
  verts = verts.map(v => { const l = Math.hypot(...v); return v.map(c => c / l); });
  // Subdivide
  for (let s = 0; s < subdivisions; s++) {
    const midCache = {};
    const newFaces = [];
    const getMid = (i, j) => {
      const key = Math.min(i,j) + ':' + Math.max(i,j);
      if (midCache[key] !== undefined) return midCache[key];
      const a = verts[i], b = verts[j];
      const m = [(a[0]+b[0])/2, (a[1]+b[1])/2, (a[2]+b[2])/2];
      const l = Math.hypot(...m);
      verts.push(m.map(c => c / l));
      midCache[key] = verts.length - 1;
      return midCache[key];
    };
    for (const [a,b,c] of faces) {
      const ab = getMid(a,b), bc = getMid(b,c), ca = getMid(c,a);
      newFaces.push([a,ab,ca],[b,bc,ab],[c,ca,bc],[ab,bc,ca]);
    }
    faces = newFaces;
  }
  // Build edge set
  const edgeSet = new Set();
  for (const [a,b,c] of faces) {
    [a+':'+b, b+':'+c, c+':'+a].forEach(e => {
      const [i,j] = e.split(':').map(Number);
      edgeSet.add(Math.min(i,j) + ':' + Math.max(i,j));
    });
  }
  const edges = [...edgeSet].map(e => e.split(':').map(Number));
  return { verts, edges, faces };
}

// Generate floating particles that orbit the sphere
function generateParticles(count, minR, maxR) {
  const particles = [];
  for (let i = 0; i < count; i++) {
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    const r = minR + Math.random() * (maxR - minR);
    particles.push({
      theta, phi, r,
      speed: 0.0003 + Math.random() * 0.001,
      phiSpeed: (Math.random() - 0.5) * 0.0004,
      size: 1 + Math.random() * 2.5,
      brightness: 0.3 + Math.random() * 0.7,
      pulse: Math.random() * Math.PI * 2,
    });
  }
  return particles;
}

// Pre-generate geometry once
const _sphere = generateIcosphere(2);
const _outerParticles = generateParticles(120, 1.15, 1.8);
const _innerParticles = generateParticles(60, 0.2, 0.9);

// ─── Holographic sphere renderer ──────────────────────────────
function createHolosphereRenderer(canvas) {
  if (!canvas) return null;
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  const cx = W / 2, cy = H / 2;
  const baseRadius = Math.min(W, H) * 0.28;

  let rotX = 0, rotY = 0, rotZ = 0;
  let time = 0;

  // 3D → 2D projection with rotation
  function project(x, y, z) {
    // Rotate Y
    let x1 = x * Math.cos(rotY) + z * Math.sin(rotY);
    let z1 = -x * Math.sin(rotY) + z * Math.cos(rotY);
    // Rotate X
    let y1 = y * Math.cos(rotX) - z1 * Math.sin(rotX);
    let z2 = y * Math.sin(rotX) + z1 * Math.cos(rotX);
    // Rotate Z
    let x2 = x1 * Math.cos(rotZ) - y1 * Math.sin(rotZ);
    let y2 = x1 * Math.sin(rotZ) + y1 * Math.cos(rotZ);
    // Perspective
    const perspective = 3.5;
    const scale = perspective / (perspective + z2);
    return { x: cx + x2 * baseRadius * scale, y: cy + y2 * baseRadius * scale, z: z2, scale };
  }

  function getColors(status) {
    if (status === 'speaking') return { base: [0, 230, 180], glow: [0, 255, 200], accent: [100, 255, 220] };
    if (status === 'thinking') return { base: [255, 180, 40], glow: [255, 200, 80], accent: [255, 220, 120] };
    if (status === 'muted') return { base: [70, 70, 90], glow: [90, 90, 110], accent: [100, 100, 130] };
    // listening / idle — cyan like JARVIS
    return { base: [0, 180, 255], glow: [0, 220, 255], accent: [120, 230, 255] };
  }

  function draw(analyser, status, audioLevel) {
    time += 0.016;
    rotY += 0.003;
    rotX = Math.sin(time * 0.15) * 0.15;
    rotZ = Math.cos(time * 0.1) * 0.05;

    // Get frequency data for reactive displacement
    let freqData = null;
    if (analyser) {
      freqData = new Uint8Array(analyser.frequencyBinCount);
      analyser.getByteFrequencyData(freqData);
    }
    const avgFreq = freqData ? freqData.reduce((a, b) => a + b, 0) / freqData.length / 255 : 0;
    const reactivity = status === 'muted' ? 0 : (audioLevel * 2 + avgFreq) * 0.5;

    ctx.clearRect(0, 0, W, H);
    const { base, glow, accent } = getColors(status);

    // ── Background glow ──
    const bgGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, baseRadius * 2.2);
    bgGrad.addColorStop(0, `rgba(${glow[0]},${glow[1]},${glow[2]},${0.06 + reactivity * 0.06})`);
    bgGrad.addColorStop(0.5, `rgba(${glow[0]},${glow[1]},${glow[2]},${0.015 + reactivity * 0.02})`);
    bgGrad.addColorStop(1, 'transparent');
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, W, H);

    // ── Outer particles (orbiting) ──
    ctx.shadowBlur = 0;
    for (const p of _outerParticles) {
      p.theta += p.speed;
      p.phi += p.phiSpeed;
      const px = p.r * Math.sin(p.phi) * Math.cos(p.theta);
      const py = p.r * Math.cos(p.phi);
      const pz = p.r * Math.sin(p.phi) * Math.sin(p.theta);
      const proj = project(px, py, pz);
      const pulseBright = 0.5 + 0.5 * Math.sin(time * 2 + p.pulse);
      const alpha = p.brightness * pulseBright * (0.15 + proj.scale * 0.3);
      const sz = p.size * proj.scale * (1 + reactivity * 0.5);

      ctx.fillStyle = `rgba(${accent[0]},${accent[1]},${accent[2]},${alpha})`;
      ctx.beginPath();
      ctx.arc(proj.x, proj.y, sz, 0, Math.PI * 2);
      ctx.fill();
    }

    // ── Wireframe sphere edges ──
    const projVerts = _sphere.verts.map((v, i) => {
      // Audio-reactive displacement
      let disp = 1;
      if (freqData && status !== 'muted') {
        const fi = Math.floor((i / _sphere.verts.length) * freqData.length);
        disp = 1 + (freqData[fi] / 255) * 0.12 * reactivity;
      }
      // Slight breathing
      disp *= 1 + Math.sin(time * 1.5 + i * 0.1) * 0.015;
      return project(v[0] * disp, v[1] * disp, v[2] * disp);
    });

    ctx.lineCap = 'round';
    for (const [i, j] of _sphere.edges) {
      const a = projVerts[i], b = projVerts[j];
      const depthAlpha = Math.max(0, Math.min(1, (a.z + b.z + 2) / 4));
      const alpha = 0.03 + depthAlpha * (0.18 + reactivity * 0.12);
      ctx.strokeStyle = `rgba(${base[0]},${base[1]},${base[2]},${alpha})`;
      ctx.lineWidth = 0.4 + depthAlpha * 0.8;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }

    // ── Sphere vertices (glowing nodes) ──
    for (let i = 0; i < projVerts.length; i++) {
      const v = projVerts[i];
      const depthAlpha = Math.max(0, Math.min(1, (v.z + 1) / 2));
      if (depthAlpha < 0.2) continue; // skip back-facing for performance
      const nodeAlpha = 0.1 + depthAlpha * (0.5 + reactivity * 0.3);
      const nodeSz = (0.5 + depthAlpha * 1.5) * v.scale * (1 + reactivity * 0.4);
      ctx.fillStyle = `rgba(${accent[0]},${accent[1]},${accent[2]},${nodeAlpha})`;
      ctx.beginPath();
      ctx.arc(v.x, v.y, nodeSz, 0, Math.PI * 2);
      ctx.fill();
    }

    // ── Inner particles (core energy) ──
    for (const p of _innerParticles) {
      p.theta += p.speed * 1.5;
      p.phi += p.phiSpeed * 1.2;
      const disp = 1 + reactivity * 0.3;
      const px = p.r * disp * Math.sin(p.phi) * Math.cos(p.theta);
      const py = p.r * disp * Math.cos(p.phi);
      const pz = p.r * disp * Math.sin(p.phi) * Math.sin(p.theta);
      const proj = project(px, py, pz);
      const pulseBright = 0.5 + 0.5 * Math.sin(time * 3 + p.pulse);
      const alpha = p.brightness * pulseBright * (0.2 + reactivity * 0.4);
      const sz = p.size * 0.8 * proj.scale;

      ctx.fillStyle = `rgba(${glow[0]},${glow[1]},${glow[2]},${alpha})`;
      ctx.beginPath();
      ctx.arc(proj.x, proj.y, sz, 0, Math.PI * 2);
      ctx.fill();
    }

    // ── Core glow (center) ──
    const coreSize = baseRadius * (0.15 + reactivity * 0.08);
    const coreGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, coreSize);
    coreGrad.addColorStop(0, `rgba(${glow[0]},${glow[1]},${glow[2]},${0.3 + reactivity * 0.3})`);
    coreGrad.addColorStop(0.5, `rgba(${base[0]},${base[1]},${base[2]},${0.08 + reactivity * 0.08})`);
    coreGrad.addColorStop(1, 'transparent');
    ctx.fillStyle = coreGrad;
    ctx.beginPath();
    ctx.arc(cx, cy, coreSize, 0, Math.PI * 2);
    ctx.fill();

    // ── Energy arcs (random lightning tendrils) ──
    if (status !== 'muted' && reactivity > 0.05) {
      const arcCount = Math.floor(2 + reactivity * 4);
      for (let a = 0; a < arcCount; a++) {
        const angle = time * 0.5 + a * (Math.PI * 2 / arcCount);
        const arcR = baseRadius * (0.9 + Math.sin(time * 2 + a) * 0.2);
        ctx.strokeStyle = `rgba(${accent[0]},${accent[1]},${accent[2]},${0.05 + reactivity * 0.15})`;
        ctx.lineWidth = 0.5 + reactivity;
        ctx.beginPath();
        const segments = 8;
        for (let s = 0; s <= segments; s++) {
          const t2 = s / segments;
          const a2 = angle + t2 * 0.8;
          const r2 = arcR * (1 + (Math.random() - 0.5) * 0.15 * reactivity);
          const ax = cx + Math.cos(a2) * r2;
          const ay = cy + Math.sin(a2) * r2;
          if (s === 0) ctx.moveTo(ax, ay);
          else ctx.lineTo(ax, ay);
        }
        ctx.stroke();
      }
    }
  }

  return draw;
}

const API_BASE = 'http://127.0.0.1:8950';

export default function VoiceCall({ onClose }) {
  const [status, setStatus]         = useState('idle');
  const [transcript, setTranscript] = useState('');
  const [response, setResponse]     = useState('');
  const [errorMsg, setErrorMsg]     = useState('');
  const [muted, setMuted]           = useState(false);
  const [callTime, setCallTime]     = useState(0);
  const [audioLevel, setAudioLevel] = useState(0);

  const activeRef       = useRef(true);
  const mutedRef        = useRef(false);
  const convIdRef       = useRef(null);
  const streamRef       = useRef(null);
  const recorderRef     = useRef(null);
  const chunksRef       = useRef([]);
  const silenceTimerRef = useRef(null);
  const speechTimerRef  = useRef(null);
  const listenRef       = useRef(null);
  const speakAbortRef   = useRef(null);
  const analyserRef     = useRef(null);
  const animFrameRef    = useRef(null);
  const ctxRef          = useRef(null);
  const canvasRef       = useRef(null);
  const vizFrameRef     = useRef(null);
  const holoDrawRef     = useRef(null);
  const statusRef       = useRef('idle');
  const audioLevelRef   = useRef(0);

  useEffect(() => { mutedRef.current = muted; }, [muted]);
  useEffect(() => { statusRef.current = status; }, [status]);
  useEffect(() => { audioLevelRef.current = audioLevel; }, [audioLevel]);

  // Call timer
  useEffect(() => {
    const t = setInterval(() => setCallTime(c => c + 1), 1000);
    return () => clearInterval(t);
  }, []);

  // Create holosphere renderer once canvas is available
  useEffect(() => {
    if (canvasRef.current) {
      const renderer = createHolosphereRenderer(canvasRef.current);
      holoDrawRef.current = renderer;
    }
  }, []);

  // Canvas visualizer loop — runs every frame
  useEffect(() => {
    const loop = () => {
      if (holoDrawRef.current) {
        holoDrawRef.current(analyserRef.current, statusRef.current, audioLevelRef.current);
      }
      vizFrameRef.current = requestAnimationFrame(loop);
    };
    vizFrameRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(vizFrameRef.current);
  }, []);

  useEffect(() => {
    activeRef.current = true;

    // ── Speak via backend TTS ──────────────────────────
    const speak = async (text) => {
      if (!activeRef.current) return;
      setStatus('speaking');
      setResponse(text);
      speakAbortRef.current?.abort();
      const ctrl = new AbortController();
      speakAbortRef.current = ctrl;
      try {
        await fetch(`${API_BASE}/api/tts`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text }),
          signal: ctrl.signal,
        });
      } catch {}
      if (!activeRef.current) return;
      setTranscript('');
      setResponse('');
      listenRef.current?.();
    };

    // ── Listen: record then transcribe ─────────────────────
    const listen = async () => {
      if (!activeRef.current) return;
      if (mutedRef.current) { setStatus('muted'); return; }

      setStatus('listening');
      setTranscript('');

      // Get mic stream
      let stream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      } catch (err) {
        setStatus('error');
        setErrorMsg(`Mic access failed: ${err.message}`);
        return;
      }
      if (!activeRef.current) { stream.getTracks().forEach(t => t.stop()); return; }
      streamRef.current = stream;

      // AudioContext at 16kHz — must match what we want for STT.
      // Default system rate (48kHz) causes empty MediaRecorder output on Linux/PipeWire.
      const ctx      = new AudioContext({ sampleRate: 16000 });
      ctxRef.current = ctx;
      const source   = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser);
      analyserRef.current = analyser;
      const dataArray = new Uint8Array(analyser.frequencyBinCount);

      // MediaRecorder — prefer webm, fallback to whatever is supported
      let mimeType = '';
      for (const mt of ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/ogg']) {
        if (MediaRecorder.isTypeSupported(mt)) { mimeType = mt; break; }
      }
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : {});
      recorderRef.current = recorder;
      chunksRef.current   = [];

      recorder.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };

      recorder.onstop = async () => {
        cancelAnimationFrame(animFrameRef.current);
        clearTimeout(silenceTimerRef.current);
        clearTimeout(speechTimerRef.current);
        stream.getTracks().forEach(t => t.stop());
        try { await ctx.close(); } catch {}

        if (!activeRef.current || mutedRef.current) return;

        const blob = new Blob(chunksRef.current, { type: mimeType || 'audio/webm' });
        if (blob.size < 500) { if (activeRef.current) listen(); return; }

        setStatus('thinking');

        // Convert recorded audio to PCM WAV for reliable server-side STT.
        // OfflineAudioContext decodes webm/opus → PCM, then buildWav writes proper WAV header.
        let wavBlob;
        try {
          const arrayBuf = await blob.arrayBuffer();
          // Use OfflineAudioContext to decode & resample in one step
          // Allocate enough for 60s at 16kHz (the actual output will be shorter)
          const offDecode = new OfflineAudioContext(1, 16000 * 60, 16000);
          const decoded = await offDecode.decodeAudioData(arrayBuf);
          // Now render to get 16kHz mono PCM
          const frameCount = Math.ceil(decoded.duration * 16000);
          const offRender = new OfflineAudioContext(1, frameCount, 16000);
          const bufferSrc = offRender.createBufferSource();
          bufferSrc.buffer = decoded;
          bufferSrc.connect(offRender.destination);
          bufferSrc.start(0);
          const rendered = await offRender.startRendering();
          wavBlob = buildWav(rendered.getChannelData(0), 16000);
          console.log('[VoiceCall] WAV:', wavBlob.size, 'bytes, duration:', decoded.duration.toFixed(2) + 's');
        } catch (decodeErr) {
          console.error('[VoiceCall] WAV conversion failed, sending raw:', decodeErr);
          wavBlob = blob;
        }

        const formData = new FormData();
        formData.append('file', wavBlob, 'audio.wav');

        try {
          const r  = await fetch(`${API_BASE}/api/stt`, { method: 'POST', body: formData });
          const d  = await r.json();
          const said = (d.text || '').trim();
          if (!said) { if (activeRef.current) listen(); return; }

          setTranscript(said);
          const cr  = await fetch(`${API_BASE}/api/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              message: said,
              voice_mode: true,
              conversation_id: convIdRef.current,
            }),
          });
          const cd = await cr.json();
          if (cd.conversation_id) convIdRef.current = cd.conversation_id;
          if (activeRef.current) speak(cd.response || "I didn't catch that.");
        } catch (err) {
          if (activeRef.current) speak('Sorry, I had trouble connecting.');
        }
      };

      // Collect in 100ms chunks for lower latency
      recorder.start(100);

      // ── VAD — adaptive noise gate with proper timing ──────
      // Calibrate noise floor from first ~0.5s, then detect speech above it.
      // Stop recording after 1.5s of silence following speech.
      let speechDetected = false;
      let silenceMs      = 0;
      const SILENCE_GATE = 2500;   // 2.5s of silence after speech → stop
      const SPEECH_MULT  = 2.0;    // speech must be 2× above noise floor
      const MIN_THRESH   = 0.010;  // absolute minimum RMS threshold
      let noiseFloor     = 0;
      let calSamples     = 0;
      let calSum         = 0;
      const CAL_FRAMES   = 60;     // ~1s calibration at 60fps
      let lastTickTime   = performance.now();

      const tick = () => {
        if (!activeRef.current) return;
        const now = performance.now();
        const dt  = now - lastTickTime;   // actual ms since last frame
        lastTickTime = now;

        analyser.getByteTimeDomainData(dataArray);
        let rms = 0;
        for (let i = 0; i < dataArray.length; i++) {
          const v = (dataArray[i] - 128) / 128;
          rms += v * v;
        }
        rms = Math.sqrt(rms / dataArray.length);
        setAudioLevel(rms);

        // Calibrate noise floor during first ~30 frames
        if (calSamples < CAL_FRAMES) {
          calSum += rms;
          calSamples++;
          if (calSamples === CAL_FRAMES) {
            noiseFloor = calSum / CAL_FRAMES;
            console.log('[VAD] noise floor calibrated:', noiseFloor.toFixed(4));
          }
          animFrameRef.current = requestAnimationFrame(tick);
          return;
        }

        const threshold = Math.max(noiseFloor * SPEECH_MULT, MIN_THRESH);
        const loud = rms > threshold;

        if (loud) { speechDetected = true; silenceMs = 0; }
        else if (speechDetected) {
          silenceMs += dt;  // use actual elapsed time, not assumed 16ms
          if (silenceMs >= SILENCE_GATE) {
            console.log('[VAD] silence detected, stopping recording');
            if (recorder.state === 'recording') recorder.stop();
            return;
          }
        }
        animFrameRef.current = requestAnimationFrame(tick);
      };
      animFrameRef.current = requestAnimationFrame(tick);

      // Hard timeout: 30s max recording
      silenceTimerRef.current = setTimeout(() => {
        console.log('[VAD] hard timeout reached (30s)');
        if (recorder.state === 'recording') recorder.stop();
      }, 30000);
    };

    listenRef.current = listen;
    const timer = setTimeout(() => listenRef.current?.(), 300);

    return () => {
      activeRef.current = false;
      clearTimeout(timer);
      clearTimeout(silenceTimerRef.current);
      clearTimeout(speechTimerRef.current);
      cancelAnimationFrame(animFrameRef.current);
      try { if (recorderRef.current?.state === 'recording') recorderRef.current.stop(); } catch {}
      streamRef.current?.getTracks().forEach(t => t.stop());
      try { ctxRef.current?.close(); } catch {}
      speakAbortRef.current?.abort();
      fetch(`${API_BASE}/api/tts/stop`, { method: 'POST' }).catch(() => {});
    };
  }, []);

  const toggleMute = useCallback(() => {
    setMuted(prev => {
      const nowMuted = !prev;
      mutedRef.current = nowMuted;
      if (nowMuted) {
        cancelAnimationFrame(animFrameRef.current);
        clearTimeout(silenceTimerRef.current);
        try { if (recorderRef.current?.state === 'recording') recorderRef.current.stop(); } catch {}
        streamRef.current?.getTracks().forEach(t => t.stop());
        try { ctxRef.current?.close(); } catch {}
      } else {
        setTimeout(() => listenRef.current?.(), 100);
      }
      return nowMuted;
    });
  }, []);

  const handleEnd = useCallback(() => {
    activeRef.current = false;
    cancelAnimationFrame(animFrameRef.current);
    clearTimeout(silenceTimerRef.current);
    try { if (recorderRef.current?.state === 'recording') recorderRef.current.stop(); } catch {}
    streamRef.current?.getTracks().forEach(t => t.stop());
    try { ctxRef.current?.close(); } catch {}
    speakAbortRef.current?.abort();
    fetch('/api/tts/stop', { method: 'POST' }).catch(() => {});
    onClose();
  }, [onClose]);

  const statusLabel = {
    idle:      'INITIALIZING',
    listening: 'LISTENING',
    thinking:  'PROCESSING',
    speaking:  'SPEAKING',
    muted:     'MIC OFFLINE',
    error:     'ERROR',
  }[status] ?? 'INITIALIZING';

  const orbStatus = (muted && (status === 'listening' || status === 'idle')) ? 'muted' : status;

  const fmtTime = (s) => {
    const m = Math.floor(s / 60).toString().padStart(2, '0');
    const sec = (s % 60).toString().padStart(2, '0');
    return `${m}:${sec}`;
  };

  return (
    <div className="vc-overlay">
      {/* Ambient hex grid background */}
      <div className="vc-hex-grid" />

      {/* Top HUD bar */}
      <div className="vc-hud-top">
        <div className="vc-hud-left">
          <span className={`vc-dot-live ${muted ? 'vc-dot-muted' : ''}`} />
          <span className="vc-name">NOVA</span>
          <span className="vc-version">v3.0</span>
        </div>
        <div className="vc-hud-right">
          <span className="vc-timer">{fmtTime(callTime)}</span>
          <span className={`vc-status-badge vc-badge-${orbStatus}`}>{statusLabel}</span>
        </div>
      </div>

      {/* Scanline decorations */}
      <div className="vc-scanline" />

      {/* Central holographic sphere */}
      <div className="vc-holo-wrap">
        <canvas ref={canvasRef} className="vc-holo-canvas" width={700} height={700} />
      </div>

      <div className="vc-status-wrap">
        {status === 'error' ? (
          <p className="vc-error-text">{errorMsg}</p>
        ) : (
          <>
            {(status === 'listening' || status === 'thinking') && transcript && (
              <p className="vc-transcript-text">
                <span className="vc-transcript-label">YOU</span>
                {transcript}
              </p>
            )}
            {status === 'speaking' && response && (
              <p className="vc-response-text">
                <span className="vc-transcript-label">NOVA</span>
                {response.slice(0, 200) + (response.length > 200 ? '\u2026' : '')}
              </p>
            )}
          </>
        )}
      </div>

      <div className="vc-controls">
        <button className={`vc-mute-btn ${muted ? 'vc-mute-active' : ''}`} onClick={toggleMute}
          title={muted ? 'Unmute mic' : 'Mute mic'}>
          {muted ? (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="22" height="22">
              <line x1="2" y1="2" x2="22" y2="22"/>
              <path d="M18.89 13.23A7.12 7.12 0 0019 12M5 10v2a7 7 0 0012 0M12 1a4 4 0 014 4v4M8 8v4a4 4 0 006.86 2.86M12 19v3M9 22h6"/>
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="22" height="22">
              <rect x="9" y="1" width="6" height="12" rx="3"/>
              <path d="M5 10v2a7 7 0 0014 0v-2M12 19v3M9 22h6"/>
            </svg>
          )}
          <span className="vc-btn-label">{muted ? 'UNMUTE' : 'MUTE'}</span>
        </button>

        <button className="vc-end-btn" onClick={handleEnd} title="End call">
          <svg viewBox="0 0 24 24" fill="currentColor" width="26" height="26">
            <path d="M6.62 10.79a15.05 15.05 0 006.59 6.59l2.2-2.2a1 1 0 011.01-.24 11.5 11.5 0 003.58.57 1 1 0 011 1V21a1 1 0 01-1 1A17 17 0 013 5a1 1 0 011-1h3.5a1 1 0 011 1c0 1.26.2 2.47.57 3.58a1 1 0 01-.25 1.01l-2.2 2.2z"/>
          </svg>
          <span className="vc-btn-label">END</span>
        </button>
      </div>

      {/* Bottom HUD line */}
      <div className="vc-hud-bottom">
        <span>NEURAL ENGINE ACTIVE</span>
        <span>LOCAL • ENCRYPTED • PRIVATE</span>
      </div>
    </div>
  );
}
