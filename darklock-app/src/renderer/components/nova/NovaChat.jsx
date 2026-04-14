import React, { useState, useRef, useEffect } from 'react';
import { useNovaStore } from '../../store/novaStore';

function md(text) {
  if (!text) return '';
  return text
    .replace(/```(\w*)\n([\s\S]*?)```/g, (_, l, c) => `<pre class="bg-bg-primary rounded p-2 my-1 text-[11px] overflow-x-auto"><code>${c.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').trim()}</code></pre>`)
    .replace(/`([^`]+)`/g, '<code class="bg-bg-primary px-1 rounded text-accent text-[11px]">$1</code>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/\n/g, '<br>');
}

export default function NovaChat() {
  const messages = useNovaStore(s => s.commandCenterMessages);
  const sendMessage = useNovaStore(s => s.sendMessage);
  const isThinking = useNovaStore(s => s.isThinking);
  const connected = useNovaStore(s => s.connected);
  const [input, setInput] = useState('');
  const bottomRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  const handleSend = () => {
    if (!input.trim() || isThinking) return;
    sendMessage(input.trim());
    setInput('');
  };

  return (
    <div className="bg-bg-secondary rounded-xl border border-border flex flex-col h-full">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <h3 className="text-sm font-semibold text-text-primary flex items-center gap-2">
          <span>💬</span> Talk to Nova
          <span className={`w-2 h-2 rounded-full ${connected ? 'bg-success' : 'bg-danger'}`} />
        </h3>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3 min-h-0">
        {messages.length === 0 ? (
          <div className="flex items-center justify-center h-full text-text-muted text-xs">
            <div className="text-center">
              <div className="text-3xl mb-3">💬</div>
              <div className="font-medium text-text-secondary mb-1">Chat with Nova</div>
              <div>Ask her anything, give commands, or just talk.</div>
              <div className="mt-3 space-y-1">
                {[
                  "How are you feeling today?",
                  "What do you remember about me?",
                  "Turn on the lights",
                  "What's on my schedule?"
                ].map((s, i) => (
                  <button
                    key={i}
                    onClick={() => { setInput(s); inputRef.current?.focus(); }}
                    className="block w-full text-left px-3 py-1.5 bg-bg-primary rounded text-[11px] text-text-secondary hover:text-accent hover:bg-accent/10 transition-colors"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          </div>
        ) : (
          messages.map((msg, i) => (
            <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[85%] px-3 py-2 rounded-xl text-xs ${
                msg.role === 'user'
                  ? 'bg-accent text-white rounded-br-sm'
                  : 'bg-bg-primary text-text-primary rounded-bl-sm'
              }`}>
                {msg.role === 'assistant' ? (
                  <div dangerouslySetInnerHTML={{ __html: md(msg.content) }} />
                ) : (
                  msg.content
                )}
              </div>
            </div>
          ))
        )}

        {isThinking && (
          <div className="flex justify-start">
            <div className="bg-bg-primary rounded-xl rounded-bl-sm px-3 py-2">
              <div className="flex gap-1">
                <span className="w-2 h-2 bg-accent rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                <span className="w-2 h-2 bg-accent rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                <span className="w-2 h-2 bg-accent rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
              </div>
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="p-3 border-t border-border">
        <div className="flex gap-2">
          <input
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && !e.shiftKey && handleSend()}
            placeholder={connected ? "Message Nova..." : "Nova is offline..."}
            disabled={!connected}
            className="flex-1 bg-bg-primary text-text-primary text-xs rounded-lg px-3 py-2.5 border border-border focus:border-accent outline-none disabled:opacity-50"
          />
          <button
            onClick={handleSend}
            disabled={!input.trim() || isThinking || !connected}
            className="px-4 py-2.5 bg-accent text-white text-xs rounded-lg hover:bg-accent-hover disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
}
