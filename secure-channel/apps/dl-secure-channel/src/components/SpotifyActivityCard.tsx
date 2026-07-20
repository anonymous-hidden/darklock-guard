import { useEffect, useMemo, useState } from 'react';
import { type SpotifyActivity, useSpotifyStore } from '../stores/spotifyStore';
import { SpotifyLogo } from './SpotifyLogo';
import './SpotifyActivityCard.css';

interface SpotifyActivityCardProps {
  activity?: SpotifyActivity | null;
  compact?: boolean;
  popover?: boolean;
}

function formatDuration(value: number): string {
  const totalSeconds = Math.max(0, Math.floor(value / 1000));
  const seconds = totalSeconds % 60;
  const minutes = Math.floor(totalSeconds / 60) % 60;
  const hours = Math.floor(totalSeconds / 3600);
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
    : `${minutes}:${String(seconds).padStart(2, '0')}`;
}

export function SpotifyActivityCard({ activity: activityProp, compact = false, popover = false }: SpotifyActivityCardProps) {
  const storedActivity = useSpotifyStore(s => s.activity);
  const activity = activityProp === undefined ? storedActivity : activityProp;
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!activity?.is_playing) return;
    const interval = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(interval);
  }, [activity?.is_playing, activity?.track_id]);

  const progress = useMemo(() => {
    if (!activity) return 0;
    const elapsed = activity.is_playing ? Math.max(0, now - activity.sampled_at) : 0;
    return Math.min(activity.duration_ms, Math.max(0, activity.progress_ms + elapsed));
  }, [activity, now]);

  if (!activity || !activity.track_id || !activity.external_url) return null;

  const openTrack = () => {
    void window.electronAPI?.spotifyOpenTrack?.(activity.external_url);
  };
  const progressPercent = activity.duration_ms > 0 ? Math.min(100, (progress / activity.duration_ms) * 100) : 0;

  return (
    <section className={`spotify-activity${compact ? ' spotify-activity--compact' : ''}${popover ? ' spotify-activity--popover' : ''}`} aria-label="Spotify listening activity">
      <div className="spotify-activity__heading">
        <SpotifyLogo size={16} className="spotify-activity__logo" label="Spotify" />
        <span>Listening to Spotify</span>
        {!activity.is_playing && <span className="spotify-activity__paused">Paused</span>}
      </div>
      <div className="spotify-activity__content">
        {activity.artwork_url ? (
          <img className="spotify-activity__art" src={activity.artwork_url} alt={`Album artwork for ${activity.album || activity.title}`} />
        ) : (
          <div className="spotify-activity__art spotify-activity__art--empty" aria-hidden="true" />
        )}
        <div className="spotify-activity__details">
          <p className="spotify-activity__title" title={activity.title}>{activity.title}</p>
          <p className="spotify-activity__artists" title={activity.artists.join(', ')}>{activity.artists.join(', ')}</p>
          {activity.album && <p className="spotify-activity__album" title={activity.album}>{activity.album}</p>}
          {!popover && <>
          <div className="spotify-activity__progress" aria-label={`${formatDuration(progress)} of ${formatDuration(activity.duration_ms)}`}>
            <span className="spotify-activity__progress-track"><span style={{ width: `${progressPercent}%` }} /></span>
            <span className="spotify-activity__time">{formatDuration(progress)} / {formatDuration(activity.duration_ms)}</span>
          </div>
          <button type="button" className="spotify-activity__open" onClick={openTrack}>Open in Spotify</button>
          </>}
        </div>
      </div>
      {popover && <>
        <div className="spotify-activity__progress" aria-label={`${formatDuration(progress)} of ${formatDuration(activity.duration_ms)}`}>
          <span className="spotify-activity__progress-track"><span style={{ width: `${progressPercent}%` }} /></span>
        </div>
        <div className="spotify-activity__times"><span>{formatDuration(progress)}</span><span>{formatDuration(activity.duration_ms)}</span></div>
        <button type="button" className="spotify-activity__open" onClick={openTrack}>Open in Spotify</button>
      </>}
    </section>
  );
}
