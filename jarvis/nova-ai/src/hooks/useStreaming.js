/**
 * useStreaming — small helper for binding a streaming text source to React.
 * Tracks accumulated text, current cursor blink flag, and provides a clean
 * abort handle.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

export function useStreaming() {
  const [text, setText] = useState('');
  const [active, setActive] = useState(false);
  const acRef = useRef(null);

  const start = useCallback(() => {
    setText('');
    setActive(true);
    if (acRef.current) { try { acRef.current.abort(); } catch {} }
    const ac = new AbortController();
    acRef.current = ac;
    return ac;
  }, []);

  const append = useCallback((tok) => {
    setText((prev) => prev + String(tok || ''));
  }, []);

  const setAll = useCallback((full) => {
    setText(String(full || ''));
  }, []);

  const finish = useCallback(() => {
    setActive(false);
    acRef.current = null;
  }, []);

  const cancel = useCallback(() => {
    if (acRef.current) { try { acRef.current.abort(); } catch {} }
    acRef.current = null;
    setActive(false);
  }, []);

  useEffect(() => () => { if (acRef.current) { try { acRef.current.abort(); } catch {} } }, []);

  return { text, active, start, append, setAll, finish, cancel, signal: () => acRef.current?.signal };
}
