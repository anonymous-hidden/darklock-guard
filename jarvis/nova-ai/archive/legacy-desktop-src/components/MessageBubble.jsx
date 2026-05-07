import React, { useState } from 'react';

const API = 'http://127.0.0.1:8950/api';

/**
 * Simple markdown → HTML converter (no external dep in the bundle).
 * Handles: code blocks, inline code, bold, italic, links, lists.
 */
function renderMarkdown(text) {
  if (!text) return '';
  let html = text
    // Code blocks
    .replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) =>
      `<pre><code class="language-${lang || 'text'}">${escHtml(code.trim())}</code></pre>`)
    // Inline code
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    // Bold
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    // Italic
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    // Links
    .replace(/\[(.+?)\]\((.+?)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
    // Line breaks → <br> (but not inside <pre>)
    .replace(/\n/g, '<br>');

  return html;
}

function escHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export default function MessageBubble({ role, content, isStreaming, imageUrl, proactive, category, convId, userMsg }) {
  const [feedbackSent, setFeedbackSent] = useState(null); // 'positive' | 'negative' | null
  const avatarLabel = role === 'user' ? 'U' : role === 'assistant' ? 'N' : '!';
  const proactiveClass = proactive ? ` proactive proactive-${category || 'thought'}` : '';

  const sendFeedback = async (signal) => {
    if (feedbackSent) return;
    setFeedbackSent(signal);
    try {
      await fetch(`${API}/learning/feedback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conv_id: convId || 0,
          signal,
          user_msg: userMsg || '',
          nova_msg: content || '',
          category: 'general',
        }),
      });
    } catch { /* silent */ }
  };

  return (
    <div className={`message-row ${role}${proactiveClass}`}>
      {role !== 'system' && (
        <div className="message-avatar">{proactive ? '◆' : avatarLabel}</div>
      )}
      <div className="message-bubble">
        {proactive && <span className="proactive-label">{category === 'alert' ? '▲ Alert' : 'Nova'}</span>}
        {imageUrl && <img className="message-image" src={imageUrl} alt="Uploaded" />}
        <span dangerouslySetInnerHTML={{ __html: renderMarkdown(content) }} />
        {isStreaming && <span className="streaming-cursor" />}
        {role === 'assistant' && !isStreaming && !proactive && content && (
          <div className="feedback-buttons">
            <button
              className={`fb-btn fb-up ${feedbackSent === 'positive' ? 'active' : ''}`}
              onClick={() => sendFeedback('positive')}
              title="Good response"
              disabled={!!feedbackSent}
            >▲</button>
            <button
              className={`fb-btn fb-down ${feedbackSent === 'negative' ? 'active' : ''}`}
              onClick={() => sendFeedback('negative')}
              title="Bad response"
              disabled={!!feedbackSent}
            >▼</button>
          </div>
        )}
      </div>
    </div>
  );
}
