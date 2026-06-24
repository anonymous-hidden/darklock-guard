import React from 'react';
import MessageBubble from './MessageBubble.jsx';

/**
 * Message bubble with a blinking cursor at the end while streaming.
 * Reuses MessageBubble visually but appends the cursor.
 */
export default function StreamingMessage({ message }) {
  return <MessageBubble message={{ ...message, _streaming: true }} />;
}
