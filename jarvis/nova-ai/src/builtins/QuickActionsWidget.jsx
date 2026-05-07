import React, { useState, useCallback } from 'react';

const ACTIONS = [
  { id: 'vol-up',       label: 'Volume Up',       icon: '🔊', desc: '+10%'          },
  { id: 'vol-down',     label: 'Volume Down',      icon: '🔉', desc: '-10%'          },
  { id: 'vol-mute',     label: 'Mute / Unmute',    icon: '🔇', desc: 'Toggle mute'   },
  { id: 'bright-up',    label: 'Brightness Up',    icon: '🔆', desc: '+10%'          },
  { id: 'bright-down',  label: 'Brightness Down',  icon: '🔅', desc: '-10%'          },
  { id: 'screenshot',   label: 'Screenshot',       icon: '📷', desc: 'Full screen'   },
  { id: 'screenshot-w', label: 'Screenshot Window',icon: '🖼', desc: 'Active window'  },
  { id: 'lock',         label: 'Lock Screen',      icon: '🔒', desc: 'Lock session'  },
  { id: 'sleep',        label: 'Sleep',            icon: '💤', desc: 'Suspend system' },
  { id: 'reboot',       label: 'Reboot',           icon: '🔄', desc: 'Restart now'   },
  { id: 'shutdown',     label: 'Shut Down',        icon: '⏻',  desc: 'Power off'     },
  { id: 'do-not-dist',  label: 'Do Not Disturb',   icon: '🔕', desc: 'Toggle DND'    },
];

const CONFIRM_IDS = new Set(['reboot', 'shutdown', 'sleep']);

export default function QuickActionsWidget() {
  const publish = (action, summary) => {
    try { window.nova?.bus?.publish?.('widget:event', { widget: 'quick-actions', action, summary }); } catch {}
  };

  const [pending,  setPending]  = useState(null);  // id awaiting confirm
  const [feedback, setFeedback] = useState('');

  const flash = (msg) => {
    setFeedback(msg);
    setTimeout(() => setFeedback(''), 2500);
  };

  const run = useCallback(async (id) => {
    if (CONFIRM_IDS.has(id) && pending !== id) {
      setPending(id);
      return;
    }
    setPending(null);
    try {
      const result = await window.nova?.quickActions?.run?.(id);
      publish(id, result?.message ?? `Ran: ${id}`);
      flash(result?.message ?? `✓ ${id}`);
    } catch (e) {
      flash(`✗ ${e?.message ?? 'IPC error'}`);
    }
  }, [pending]);

  const cancel = () => setPending(null);

  return (
    <div className="flex flex-col gap-3 h-full p-3 text-nova-text text-sm font-nova select-none">
      <header className="flex items-center justify-between shrink-0">
        <span className="text-xs font-semibold uppercase tracking-widest text-nova-accent">
          ⚡ Quick Actions
        </span>
        {feedback && (
          <span className="text-xs text-nova-ok truncate max-w-[55%]">{feedback}</span>
        )}
      </header>

      {/* confirm banner */}
      {pending && (
        <div className="rounded-lg border border-nova-warn/40 bg-nova-warn/10 px-3 py-2 flex items-center gap-3 shrink-0">
          <span className="text-nova-warn text-xs flex-1">
            Confirm: <strong>{ACTIONS.find(a => a.id === pending)?.label}</strong>?
          </span>
          <button
            onClick={() => run(pending)}
            className="text-xs px-2 py-0.5 rounded bg-nova-warn/80 hover:bg-nova-warn text-nova-bg font-semibold transition-colors"
          >
            Yes
          </button>
          <button
            onClick={cancel}
            className="text-xs px-2 py-0.5 rounded bg-nova-panel hover:bg-nova-border text-nova-muted transition-colors"
          >
            No
          </button>
        </div>
      )}

      <div className="grid grid-cols-3 gap-2 overflow-y-auto">
        {ACTIONS.map(({ id, label, icon, desc }) => (
          <button
            key={id}
            onClick={() => run(id)}
            className={`
              flex flex-col items-center justify-center gap-1 rounded-xl border
              px-2 py-3 transition-all duration-150 group
              ${pending === id
                ? 'border-nova-warn/60 bg-nova-warn/10 text-nova-warn'
                : 'border-nova-border bg-nova-panel/40 hover:bg-nova-panel hover:border-nova-accent/40 text-nova-text'}
            `}
          >
            <span className="text-xl leading-none">{icon}</span>
            <span className="text-[11px] font-medium text-center leading-tight">{label}</span>
            <span className="text-[9px] text-nova-muted text-center leading-tight">{desc}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
