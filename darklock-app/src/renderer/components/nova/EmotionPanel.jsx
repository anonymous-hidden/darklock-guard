import React, { useEffect, useRef, useState } from 'react';
import { useNovaStore } from '../../store/novaStore';

const MOOD_COLORS = {
  enthusiastic: '#f0b232',
  content: '#23a55a',
  focused: '#5865f2',
  warm: '#eb459e',
  tired: '#80848e',
  curious: '#00b4d8',
};

const MOOD_EMOJIS = {
  enthusiastic: '⚡',
  content: '😊',
  focused: '🎯',
  warm: '💛',
  tired: '😴',
  curious: '🔍',
};

function EmotionBar({ label, value, color }) {
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="w-20 text-text-muted capitalize">{label}</span>
      <div className="flex-1 h-2 bg-bg-primary rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-700 ease-out"
          style={{ width: `${(value || 0) * 100}%`, backgroundColor: color }}
        />
      </div>
      <span className="w-8 text-right text-text-secondary">{Math.round((value || 0) * 100)}%</span>
    </div>
  );
}

export default function EmotionPanel() {
  const emotion = useNovaStore(s => s.emotion);
  const refreshEmotion = useNovaStore(s => s.refreshEmotion);
  const [animPulse, setAnimPulse] = useState(false);

  useEffect(() => {
    if (emotion) {
      setAnimPulse(true);
      const t = setTimeout(() => setAnimPulse(false), 600);
      return () => clearTimeout(t);
    }
  }, [emotion?.mood, emotion?.energy]);

  const dominant = emotion?.dominant_feeling || 'content';
  const dominantColor = MOOD_COLORS[dominant] || '#5865f2';
  const dominantEmoji = MOOD_EMOJIS[dominant] || '🤖';

  return (
    <div className="bg-bg-secondary rounded-xl p-4 border border-border">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-text-primary flex items-center gap-2">
          <span>🧠</span> Nova's Emotional State
        </h3>
        <button
          onClick={refreshEmotion}
          className="text-xs text-text-muted hover:text-text-primary transition-colors"
          title="Refresh"
        >↻</button>
      </div>

      {/* Dominant feeling orb */}
      <div className="flex items-center gap-3 mb-4 p-3 rounded-lg" style={{ backgroundColor: dominantColor + '15' }}>
        <div
          className={`w-12 h-12 rounded-full flex items-center justify-center text-xl transition-all duration-300 ${animPulse ? 'scale-110' : 'scale-100'}`}
          style={{ backgroundColor: dominantColor + '30', boxShadow: `0 0 20px ${dominantColor}40` }}
        >
          {dominantEmoji}
        </div>
        <div>
          <div className="text-sm font-medium text-text-primary capitalize">
            Feeling {dominant}
          </div>
          <div className="text-xs text-text-muted">
            {dominant === 'enthusiastic' && "Energized and eager to help"}
            {dominant === 'content' && "Balanced and at ease"}
            {dominant === 'focused' && "Locked in and concentrating"}
            {dominant === 'warm' && "Warm and caring today"}
            {dominant === 'tired' && "Running low on energy"}
            {dominant === 'curious' && "Curious and wants to explore"}
          </div>
        </div>
      </div>

      {/* Emotion bars */}
      <div className="space-y-2">
        <EmotionBar label="Mood" value={emotion?.mood} color="#23a55a" />
        <EmotionBar label="Energy" value={emotion?.energy} color="#f0b232" />
        <EmotionBar label="Curiosity" value={emotion?.curiosity} color="#00b4d8" />
        <EmotionBar label="Patience" value={emotion?.patience} color="#5865f2" />
        <EmotionBar label="Satisfaction" value={emotion?.satisfaction} color="#eb459e" />
        <EmotionBar label="Warmth" value={emotion?.warmth} color="#fe7f2d" />
      </div>
    </div>
  );
}
