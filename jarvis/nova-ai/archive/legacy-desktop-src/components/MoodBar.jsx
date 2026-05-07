import React from 'react';

const FEELING_EMOJIS = {
  enthusiastic: '🤩',
  content:      '😊',
  focused:      '🧐',
  warm:         '🥰',
  tired:        '😴',
  curious:      '🤔',
};

const DIM_META = {
  mood:         { label: 'Mood',         color: '#00d4ff' },
  energy:       { label: 'Energy',       color: '#a6e3a1' },
  curiosity:    { label: 'Curiosity',    color: '#f9e2af' },
  patience:     { label: 'Patience',     color: '#cba6f7' },
  satisfaction: { label: 'Satisfaction',  color: '#94e2d5' },
  warmth:       { label: 'Warmth',       color: '#f38ba8' },
};

export default function MoodBar({ emotion }) {
  if (!emotion?.state) return null;

  const feeling = emotion.feeling || 'content';
  const s = emotion.state;
  const emoji = FEELING_EMOJIS[feeling] || '🤖';

  return (
    <div className="mood-indicator">
      <span className="mood-emoji">{emoji}</span>
      <div className="mood-tooltip">
        <div className="mood-tooltip-title">Nova is feeling <strong>{feeling}</strong></div>
        <div className="mood-tooltip-bars">
          {Object.entries(DIM_META).map(([key, { label, color }]) => {
            const val = s[key] ?? 0.5;
            return (
              <div key={key} className="mood-tooltip-row">
                <span className="mood-tooltip-label">{label}</span>
                <div className="mood-tooltip-track">
                  <div className="mood-tooltip-fill" style={{ width: `${val * 100}%`, background: color }} />
                </div>
                <span className="mood-tooltip-val">{Math.round(val * 100)}%</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
