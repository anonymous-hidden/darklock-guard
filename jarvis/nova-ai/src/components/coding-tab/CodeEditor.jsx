import React, { useEffect, useRef, useState, useCallback } from 'react';
import Editor from '@monaco-editor/react';
import clsx from 'clsx';

const LANGUAGE_BY_EXT = {
  '.js':   'javascript',
  '.jsx':  'javascript',
  '.ts':   'typescript',
  '.tsx':  'typescript',
  '.json': 'json',
  '.md':   'markdown',
  '.css':  'css',
  '.html': 'html',
  '.py':   'python',
  '.sh':   'shell',
  '.yml':  'yaml',
  '.yaml': 'yaml',
};

function detectLanguage(path) {
  if (!path) return 'plaintext';
  const i = path.lastIndexOf('.');
  if (i < 0) return 'plaintext';
  return LANGUAGE_BY_EXT[path.slice(i).toLowerCase()] || 'plaintext';
}

export default function CodeEditor({ filePath, onCursorChange, onContentChange }) {
  const [content, setContent]   = useState('');
  const [original, setOriginal] = useState('');
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState(null);
  const [savedAt, setSavedAt]   = useState(null);
  const editorRef = useRef(null);
  const saveTimer = useRef(null);

  const dirty = content !== original;

  // Load file when filePath changes
  useEffect(() => {
    if (!filePath) {
      setContent(''); setOriginal(''); setError(null);
      onContentChange?.({ filePath: null, content: '' });
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const r = await window.nova?.files?.read?.(filePath);
        if (cancelled) return;
        if (r?.ok) {
          setContent(r.content); setOriginal(r.content);
          onContentChange?.({ filePath, content: r.content });
        } else {
          setError(r?.error || 'read failed');
        }
      } catch (err) {
        if (!cancelled) setError(String(err?.message || err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filePath]);

  // Debounced auto-save
  useEffect(() => {
    if (!filePath || !dirty) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      try {
        const r = await window.nova?.files?.write?.(filePath, content);
        if (r?.ok) {
          setOriginal(content);
          setSavedAt(new Date());
        }
      } catch {}
    }, 1000);
    return () => { if (saveTimer.current) clearTimeout(saveTimer.current); };
  }, [filePath, content, dirty]);

  const handleMount = useCallback((editor) => {
    editorRef.current = editor;
    editor.onDidChangeCursorPosition((e) => {
      onCursorChange?.({ line: e.position.lineNumber, column: e.position.column });
    });
  }, [onCursorChange]);

  const handleChange = useCallback((val) => {
    const v = val ?? '';
    setContent(v);
    onContentChange?.({ filePath, content: v });
  }, [filePath, onContentChange]);

  // Public: insert text at cursor (called by AICodeAssistant)
  useEffect(() => {
    window.__novaCodeEditor = {
      insertAtCursor(text) {
        const ed = editorRef.current;
        if (!ed) return;
        const sel = ed.getSelection();
        ed.executeEdits('nova-insert', [{ range: sel, text: String(text || ''), forceMoveMarkers: true }]);
        ed.focus();
      },
      replaceAll(text) {
        const ed = editorRef.current;
        if (!ed) return;
        ed.setValue(String(text || ''));
        ed.focus();
      },
    };
    return () => { delete window.__novaCodeEditor; };
  }, []);

  if (!filePath) {
    return (
      <div className="flex-1 flex items-center justify-center text-nova-muted text-sm bg-nova-bg">
        Select a file from the tree to start editing.
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col min-w-0">
      <header className="flex items-center justify-between px-3 py-1.5 bg-nova-panel border-b border-nova-border text-[12px]">
        <div className="flex items-center gap-2 min-w-0">
          <span className="truncate text-nova-text font-mono">{filePath}</span>
          {dirty && <span title="unsaved changes" className="w-1.5 h-1.5 rounded-full bg-nova-warn" />}
        </div>
        <div className="text-[10.5px] text-nova-muted font-mono">
          {loading ? 'loading…' : (savedAt ? `saved ${savedAt.toLocaleTimeString([], { hour12: false })}` : (dirty ? 'unsaved' : 'idle'))}
        </div>
      </header>
      {error ? (
        <div className="p-4 text-sm text-nova-err">{error}</div>
      ) : (
        <Editor
          height="100%"
          theme="vs-dark"
          language={detectLanguage(filePath)}
          value={content}
          onChange={handleChange}
          onMount={handleMount}
          options={{
            fontSize: 13,
            fontFamily: '"JetBrains Mono", ui-monospace, monospace',
            minimap: { enabled: false },
            wordWrap: 'on',
            scrollBeyondLastLine: false,
            tabSize: 2,
            renderWhitespace: 'selection',
            smoothScrolling: true,
          }}
        />
      )}
    </div>
  );
}
