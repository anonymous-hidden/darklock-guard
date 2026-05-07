import React, { useState, useRef, useEffect, useCallback } from 'react';

/* ------------------------------------------------------------------ */
/* Expression evaluator — shunting yard + RPN, supports +-*\/^,        */
/* unary -, parens, x as variable, and a small math function library. */
/* ------------------------------------------------------------------ */

const FUNCS = {
  sin: Math.sin, cos: Math.cos, tan: Math.tan,
  asin: Math.asin, acos: Math.acos, atan: Math.atan,
  sinh: Math.sinh, cosh: Math.cosh, tanh: Math.tanh,
  log: Math.log10, ln: Math.log, exp: Math.exp,
  sqrt: Math.sqrt, abs: Math.abs, floor: Math.floor, ceil: Math.ceil, round: Math.round,
  sign: Math.sign,
};
const CONSTS = { pi: Math.PI, e: Math.E, tau: Math.PI * 2 };
const PREC = { '+': 1, '-': 1, '*': 2, '/': 2, '%': 2, '^': 4, 'u-': 5 };
const RIGHT = new Set(['^', 'u-']);

function tokenize(input) {
  const tokens = [];
  const s = String(input).replace(/\s+/g, '');
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (/[0-9.]/.test(c)) {
      let j = i;
      while (j < s.length && /[0-9.eE+\-]/.test(s[j])) {
        // handle exponent sign
        if ((s[j] === '+' || s[j] === '-') && !/[eE]/.test(s[j-1])) break;
        j++;
      }
      tokens.push({ type: 'num', value: Number(s.slice(i, j)) });
      i = j;
    } else if (/[a-zA-Z]/.test(c)) {
      let j = i;
      while (j < s.length && /[a-zA-Z0-9_]/.test(s[j])) j++;
      tokens.push({ type: 'ident', value: s.slice(i, j) });
      i = j;
    } else if ('+-*/%^()'.includes(c)) {
      tokens.push({ type: 'op', value: c });
      i++;
    } else if (c === ',') {
      tokens.push({ type: 'comma' });
      i++;
    } else {
      throw new Error(`unexpected char "${c}"`);
    }
  }
  return tokens;
}

function toRPN(tokens) {
  const out = [];
  const ops = [];
  let prev = null;
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.type === 'num') out.push(t);
    else if (t.type === 'ident') {
      // function if next is '('
      if (tokens[i+1]?.type === 'op' && tokens[i+1]?.value === '(') ops.push({ type: 'func', value: t.value });
      else out.push({ type: 'var', value: t.value });
    }
    else if (t.type === 'op') {
      const v = t.value;
      if (v === '(') ops.push(t);
      else if (v === ')') {
        while (ops.length && ops[ops.length-1].value !== '(') out.push(ops.pop());
        ops.pop();
        if (ops.length && ops[ops.length-1].type === 'func') out.push(ops.pop());
      } else {
        let op = v;
        // detect unary minus
        if (v === '-' && (!prev || prev.type === 'op' || prev.type === 'comma')) op = 'u-';
        while (ops.length) {
          const top = ops[ops.length-1];
          if (top.value === '(') break;
          const tp = top.type === 'func' ? 99 : (PREC[top.value === 'u-' ? 'u-' : top.value] || 0);
          const cp = PREC[op] || 0;
          if (tp > cp || (tp === cp && !RIGHT.has(op))) out.push(ops.pop());
          else break;
        }
        ops.push({ type: 'op', value: op });
      }
    }
    prev = t;
  }
  while (ops.length) out.push(ops.pop());
  return out;
}

function evalRPN(rpn, vars = {}) {
  const stack = [];
  for (const t of rpn) {
    if (t.type === 'num') stack.push(t.value);
    else if (t.type === 'var') {
      if (t.value in vars)         stack.push(vars[t.value]);
      else if (t.value in CONSTS)  stack.push(CONSTS[t.value]);
      else throw new Error(`unknown identifier "${t.value}"`);
    }
    else if (t.type === 'func') {
      const f = FUNCS[t.value];
      if (!f) throw new Error(`unknown function "${t.value}"`);
      stack.push(f(stack.pop()));
    }
    else if (t.type === 'op') {
      if (t.value === 'u-') { stack.push(-stack.pop()); continue; }
      const b = stack.pop();
      const a = stack.pop();
      switch (t.value) {
        case '+': stack.push(a + b); break;
        case '-': stack.push(a - b); break;
        case '*': stack.push(a * b); break;
        case '/': stack.push(a / b); break;
        case '%': stack.push(a % b); break;
        case '^': stack.push(Math.pow(a, b)); break;
        default: throw new Error(`bad op ${t.value}`);
      }
    }
  }
  return stack[0];
}

function compile(expr) {
  const rpn = toRPN(tokenize(expr));
  return (vars) => evalRPN(rpn, vars);
}

/* ------------------------------------------------------------------ */
/* UI                                                                  */
/* ------------------------------------------------------------------ */

const KEYS = [
  ['(', ')', '%', 'C', '⌫'],
  ['7', '8', '9', '/',  '^'],
  ['4', '5', '6', '*',  'sqrt('],
  ['1', '2', '3', '-',  'sin('],
  ['0', '.', 'pi', '+', 'cos('],
];

export default function CalculatorWidget() {
  const [tab, setTab] = useState('calc');
  const [expr, setExpr] = useState('');
  const [history, setHistory] = useState([]);

  // Graph state
  const [graphExpr, setGraphExpr] = useState('sin(x)');
  const [xMin, setXMin] = useState(-10);
  const [xMax, setXMax] = useState(10);
  const [yMin, setYMin] = useState(-2);
  const [yMax, setYMax] = useState(2);
  const [autoY, setAutoY] = useState(true);
  const [graphErr, setGraphErr] = useState(null);
  const canvasRef = useRef(null);

  /* ---------------- calc input ---------------- */
  const press = (k) => {
    if (k === 'C')   return setExpr('');
    if (k === '⌫')  return setExpr((e) => e.slice(0, -1));
    setExpr((e) => e + k);
  };

  const compute = () => {
    try {
      const fn = compile(expr);
      const v = fn({});
      setHistory((h) => [{ expr, value: v }, ...h].slice(0, 12));
      setExpr(String(v));
    } catch (e) {
      setHistory((h) => [{ expr, value: NaN, error: String(e?.message || e) }, ...h].slice(0, 12));
    }
  };

  /* ---------------- graph rendering ---------------- */
  const drawGraph = useCallback(() => {
    const c = canvasRef.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    const W = c.clientWidth, H = c.clientHeight;
    c.width = W * dpr; c.height = H * dpr;
    const ctx = c.getContext('2d');
    ctx.scale(dpr, dpr);

    let fn;
    try { fn = compile(graphExpr); setGraphErr(null); }
    catch (e) { setGraphErr(String(e?.message || e)); ctx.clearRect(0, 0, W, H); return; }

    // Sample once to compute auto-Y
    const N = Math.max(200, W);
    const xs = new Array(N);
    const ys = new Array(N);
    for (let i = 0; i < N; i++) {
      const x = xMin + (i / (N - 1)) * (xMax - xMin);
      xs[i] = x;
      let y;
      try { y = fn({ x }); } catch { y = NaN; }
      ys[i] = y;
    }
    let yLo = yMin, yHi = yMax;
    if (autoY) {
      const finite = ys.filter((y) => Number.isFinite(y));
      if (finite.length) {
        yLo = Math.min(...finite);
        yHi = Math.max(...finite);
        const pad = (yHi - yLo) * 0.1 || 1;
        yLo -= pad; yHi += pad;
      } else { yLo = -1; yHi = 1; }
    }

    // background
    ctx.fillStyle = '#0a0a0f';
    ctx.fillRect(0, 0, W, H);

    // grid
    ctx.strokeStyle = '#1f1f2c';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let gx = Math.ceil(xMin); gx <= Math.floor(xMax); gx++) {
      const px = ((gx - xMin) / (xMax - xMin)) * W;
      ctx.moveTo(px, 0); ctx.lineTo(px, H);
    }
    for (let gy = Math.ceil(yLo); gy <= Math.floor(yHi); gy++) {
      const py = H - ((gy - yLo) / (yHi - yLo)) * H;
      ctx.moveTo(0, py); ctx.lineTo(W, py);
    }
    ctx.stroke();

    // axes
    ctx.strokeStyle = '#3a3a4d';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    if (xMin <= 0 && xMax >= 0) {
      const p0 = ((0 - xMin) / (xMax - xMin)) * W;
      ctx.moveTo(p0, 0); ctx.lineTo(p0, H);
    }
    if (yLo <= 0 && yHi >= 0) {
      const p0 = H - ((0 - yLo) / (yHi - yLo)) * H;
      ctx.moveTo(0, p0); ctx.lineTo(W, p0);
    }
    ctx.stroke();

    // curve
    ctx.strokeStyle = '#00d4ff';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    let drawing = false;
    for (let i = 0; i < N; i++) {
      const x = xs[i], y = ys[i];
      if (!Number.isFinite(y)) { drawing = false; continue; }
      const px = ((x - xMin) / (xMax - xMin)) * W;
      const py = H - ((y - yLo) / (yHi - yLo)) * H;
      if (!drawing) { ctx.moveTo(px, py); drawing = true; }
      else ctx.lineTo(px, py);
    }
    ctx.stroke();
  }, [graphExpr, xMin, xMax, yMin, yMax, autoY]);

  useEffect(() => { if (tab === 'graph') drawGraph(); }, [tab, drawGraph]);
  useEffect(() => {
    if (tab !== 'graph') return;
    const h = () => drawGraph();
    window.addEventListener('resize', h);
    return () => window.removeEventListener('resize', h);
  }, [tab, drawGraph]);

  return (
    <div className="h-full flex flex-col text-nova-text bg-nova-bg">
      <div className="flex border-b border-nova-border">
        {['calc', 'graph'].map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={`flex-1 py-1.5 text-[11px] font-display tracking-widest uppercase ${tab===t ? 'text-nova-accent border-b-2 border-nova-accent' : 'text-nova-muted'}`}>
            {t}
          </button>
        ))}
      </div>

      {tab === 'calc' ? (
        <div className="flex-1 flex flex-col p-3 gap-2 min-h-0">
          <div className="flex-1 overflow-auto bg-nova-panel rounded p-2 font-mono text-[11.5px] space-y-1 min-h-0">
            {history.length === 0 && <div className="text-nova-muted text-[11px]">No history yet.</div>}
            {history.map((h, i) => (
              <div key={i} className="flex justify-between gap-2">
                <span className="text-nova-muted truncate">{h.expr}</span>
                <span className={h.error ? 'text-nova-err' : 'text-nova-accent'}>{h.error ? 'err' : String(h.value)}</span>
              </div>
            ))}
          </div>
          <input
            value={expr}
            onChange={(e) => setExpr(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') compute(); }}
            className="nova-input text-right text-lg font-mono"
            placeholder="expression"
          />
          <div className="grid grid-cols-5 gap-1">
            {KEYS.flat().map((k) => (
              <button key={k} onClick={() => press(k)} className="bg-nova-panel hover:bg-nova-panel2 border border-nova-border rounded py-1.5 text-sm font-mono">
                {k}
              </button>
            ))}
            <button onClick={compute} className="col-span-5 nova-btn-primary py-2 text-sm">=</button>
          </div>
        </div>
      ) : (
        <div className="flex-1 flex flex-col p-3 gap-2 min-h-0">
          <div className="flex gap-2 items-center">
            <span className="text-[11px] text-nova-muted font-mono">y =</span>
            <input value={graphExpr} onChange={(e) => setGraphExpr(e.target.value)} className="nova-input text-sm font-mono flex-1" />
          </div>
          <div className="grid grid-cols-4 gap-2 text-[11px]">
            {[
              ['xMin', xMin, setXMin], ['xMax', xMax, setXMax],
              ['yMin', yMin, setYMin], ['yMax', yMax, setYMax],
            ].map(([label, val, set]) => (
              <label key={label} className="flex flex-col">
                <span className="text-nova-muted">{label}</span>
                <input type="number" value={val} disabled={(label==='yMin'||label==='yMax') && autoY} onChange={(e) => set(Number(e.target.value))} className="nova-input text-xs" />
              </label>
            ))}
          </div>
          <label className="flex items-center gap-2 text-[11px] text-nova-muted">
            <input type="checkbox" checked={autoY} onChange={(e) => setAutoY(e.target.checked)} /> auto-fit Y axis
          </label>
          {graphErr && <div className="text-[11px] text-nova-err font-mono">{graphErr}</div>}
          <div className="flex-1 min-h-0 bg-nova-bg border border-nova-border rounded overflow-hidden">
            <canvas ref={canvasRef} className="w-full h-full" />
          </div>
        </div>
      )}
    </div>
  );
}
