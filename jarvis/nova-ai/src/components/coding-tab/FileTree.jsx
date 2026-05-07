import React, { useEffect, useState, useCallback } from 'react';
import clsx from 'clsx';

const FILE_ICONS = {
  '.js': '𝙅𝙎', '.jsx': '⚛',  '.ts': '𝙏𝙎', '.tsx': '⚛',
  '.json': '{}', '.md': '𝙈',  '.css': '#',
  '.html': '<>', '.py': '𝙋𝙮', '.sh': '$',
};

function ext(name) {
  const i = name.lastIndexOf('.');
  return i >= 0 ? name.slice(i) : '';
}

function FileIcon({ name }) {
  const e = ext(name).toLowerCase();
  return <span className="inline-block w-5 text-center text-[10.5px] text-nova-muted font-mono">{FILE_ICONS[e] || '·'}</span>;
}

function Node({ node, depth, openSet, toggle, onOpen, activePath }) {
  const isDir = node.type === 'dir';
  const open = openSet.has(node.path);
  const isActive = !isDir && activePath === node.path;

  return (
    <div>
      <div
        role="button"
        onClick={() => isDir ? toggle(node.path) : onOpen(node)}
        className={clsx(
          'flex items-center gap-1 px-2 py-0.5 rounded cursor-pointer text-sm select-none',
          'hover:bg-nova-panel2',
          isActive && 'bg-nova-accent/15 text-nova-accent',
        )}
        style={{ paddingLeft: 8 + depth * 12 }}
      >
        {isDir
          ? <span className="w-3 text-center text-nova-muted">{open ? '▾' : '▸'}</span>
          : <span className="w-3" />}
        {!isDir && <FileIcon name={node.name} />}
        <span className="truncate flex-1">{node.name}</span>
      </div>
      {isDir && open && node.children?.map((c) => (
        <Node key={c.path} node={c} depth={depth + 1} openSet={openSet} toggle={toggle} onOpen={onOpen} activePath={activePath} />
      ))}
    </div>
  );
}

export default function FileTree({ activePath, onOpen }) {
  const [tree, setTree] = useState([]);
  const [openSet, setOpenSet] = useState(() => new Set(['', 'src', 'electron']));
  const [error, setError] = useState(null);

  const refresh = useCallback(async () => {
    try {
      const r = await window.nova?.files?.listTree?.('');
      if (r?.ok) setTree(r.tree || []);
      else setError(r?.error || 'failed to read tree');
    } catch (err) {
      setError(String(err?.message || err));
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const toggle = useCallback((p) => {
    setOpenSet((prev) => {
      const next = new Set(prev);
      if (next.has(p)) next.delete(p); else next.add(p);
      return next;
    });
  }, []);

  return (
    <div className="h-full flex flex-col bg-nova-panel border-r border-nova-border">
      <header className="flex items-center justify-between px-3 py-2 border-b border-nova-border">
        <span className="font-display text-xs uppercase tracking-wider text-nova-accent">Files</span>
        <button onClick={refresh} className="text-[10.5px] text-nova-muted hover:text-nova-text">refresh</button>
      </header>
      <div className="flex-1 overflow-auto py-1">
        {error && <div className="px-3 py-2 text-xs text-nova-err">{error}</div>}
        {tree.map((n) => (
          <Node key={n.path} node={n} depth={0} openSet={openSet} toggle={toggle} onOpen={onOpen} activePath={activePath} />
        ))}
      </div>
    </div>
  );
}
