import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { useProfileStore, PRESENCE_COLORS, type PresenceStatus } from '../stores/profileStore';
import { useAuthStore } from '../stores/authStore';
import { TAG_MAP } from '../stores/tagStore';
import { getNameFontStyle, NAMEPLATE_MAP } from './ProfileEditor';
import { Edit, ChevronDown, Globe } from './Icons';
import { Avatar, Badge, Button } from './Shared';
import { CustomStatusBubble } from './CustomStatusBubble';
import { SpotifyActivityCard } from './SpotifyActivityCard';
import './ProfilePopup.css';

const PRESENCE_OPTIONS: { value: PresenceStatus; label: string; color: string }[] = [
  { value: 'online', label: 'Online', color: PRESENCE_COLORS.online },
  { value: 'idle', label: 'Idle', color: PRESENCE_COLORS.idle },
  { value: 'dnd', label: 'Do Not Disturb', color: PRESENCE_COLORS.dnd },
  { value: 'invisible', label: 'Invisible', color: PRESENCE_COLORS.invisible },
];

interface ProfilePopupProps {
  open: boolean;
  onClose: () => void;
}

export function ProfilePopup({ open, onClose }: ProfilePopupProps) {
  const [statusOpen, setStatusOpen] = useState(false);
  const [showFullBio, setShowFullBio] = useState(false);
  const popupRef = useRef<HTMLDivElement>(null);
  const profile = useProfileStore();
  const selectedTags = useProfileStore(state => state.selectedTags);
  const displayName = useAuthStore(state => state.displayName);
  const setScreen = useAuthStore(state => state.setScreen);
  const currentPresence = PRESENCE_OPTIONS.find(option => option.value === profile.presence) ?? PRESENCE_OPTIONS[0];
  const customStatus = profile.customStatusExpiresAt && new Date(profile.customStatusExpiresAt).getTime() <= Date.now()
    ? ''
    : profile.customStatus;
  const selectedTagDefs = selectedTags.map(id => TAG_MAP[id]).filter(Boolean);
  const name = profile.displayName || displayName || 'User';
  const bio = profile.bio ?? '';
  const links = profile.links ?? [];
  const bioNeedsClamp = bio.length > 170;

  useEffect(() => {
    if (!open) return;
    setShowFullBio(false);
    const handleClick = (event: MouseEvent) => {
      if (popupRef.current && !popupRef.current.contains(event.target as Node)) onClose();
    };
    const handleEsc = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    const timer = window.setTimeout(() => {
      document.addEventListener('mousedown', handleClick);
      document.addEventListener('keydown', handleEsc);
    }, 0);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleEsc);
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="profile-popup"
      ref={popupRef}
      role="dialog"
      aria-label="Your profile"
      style={{ '--profile-popup-accent': profile.accentColor } as CSSProperties}
      onClick={event => event.stopPropagation()}
    >
      <div
        className="profile-popup__banner"
        style={profile.banner
          ? { backgroundImage: `url(${profile.banner})`, backgroundSize: profile.bannerFit, backgroundRepeat: 'no-repeat', backgroundColor: '#0f1118' }
          : profile.nameplate && NAMEPLATE_MAP[profile.nameplate]
            ? { background: NAMEPLATE_MAP[profile.nameplate].gradient }
            : { background: `linear-gradient(${profile.gradientAngle}deg, ${profile.accentColor}, ${profile.accentColor2 || `${profile.accentColor}66`})` }
        }
      />

      <div className="profile-popup__avatar-ring">
        {profile.avatar
          ? <img src={profile.avatar} alt="" className="profile-popup__avatar-img" />
          : <Avatar name={name} size={52} />
        }
        <span className="profile-popup__presence-dot" style={{ backgroundColor: currentPresence.color }} />
      </div>
      <div className="profile-popup__status-bubble">
        <CustomStatusBubble compact status={customStatus} onClick={() => { onClose(); setScreen('settings'); }} />
      </div>

      <div className="profile-popup__card">
        <div className="profile-popup__identity">
          <div className="profile-popup__name-row">
            <span
              className="profile-popup__name"
              style={{ color: profile.usernameColor, ...getNameFontStyle(profile.displayNameFont) }}
            >
              {name}
            </span>
            {profile.pronouns && <Badge variant="default">{profile.pronouns}</Badge>}
          </div>
          {profile.username && <span className="profile-popup__username">@{profile.username}</span>}
          <div className="profile-popup__actions">
            <Button
              className="profile-popup__edit-profile"
              variant="primary"
              size="sm"
              icon={<Edit size={14} />}
              onClick={() => { onClose(); setScreen('settings'); }}
            >
              Edit Profile
            </Button>
          </div>
          {selectedTagDefs.length > 0 && <div className="profile-popup__tags">
            {selectedTagDefs.map(tag => <span key={tag.id} className="profile-popup__tag" title={tag.label} style={{ background: tag.color, color: tag.textColor ?? '#fff' }}>{tag.label}</span>)}
          </div>}
        </div>

        {bio && <section className="profile-popup__section profile-popup__about">
          <h4 className="profile-popup__section-heading">About Me</h4>
          <p className={`profile-popup__bio${bioNeedsClamp && !showFullBio ? ' profile-popup__bio--clamped' : ''}`}>{bio}</p>
          {bioNeedsClamp && <button type="button" className="profile-popup__show-more" onClick={() => setShowFullBio(value => !value)}>{showFullBio ? 'Show less' : 'Show more'}</button>}
        </section>}

        <SpotifyActivityCard compact popover />

        {links.length > 0 && <section className="profile-popup__section profile-popup__links-section">
          <h4 className="profile-popup__section-heading">Links</h4>
          <div className="profile-popup__links">
            {links.map(link => <span key={link.id} className="profile-popup__link" title={link.url}>
              <Globe size={13} />
              <span className="profile-popup__link-label">{link.label || link.url}</span>
              <span className="profile-popup__link-external" aria-hidden="true">Open</span>
            </span>)}
          </div>
        </section>}
        {links.length === 0 && <button type="button" className="profile-popup__add-connection" onClick={() => { onClose(); setScreen('settings'); }}>Add Connection</button>}

        <footer className="profile-popup__footer">
          <span className="profile-popup__footer-label">Set status</span>
          <div className="profile-popup__status-section">
            <button className="profile-popup__status-trigger" onClick={() => setStatusOpen(value => !value)} aria-expanded={statusOpen}>
              <span className="profile-popup__status-dot" style={{ backgroundColor: currentPresence.color }} />
              <span className="profile-popup__status-label">{currentPresence.label}</span>
              <ChevronDown size={14} className={`profile-popup__chevron ${statusOpen ? 'profile-popup__chevron--open' : ''}`} />
            </button>
            {statusOpen && <div className="profile-popup__status-dropdown">
              {PRESENCE_OPTIONS.map(option => <button key={option.value} className={`profile-popup__status-option ${option.value === profile.presence ? 'profile-popup__status-option--active' : ''}`} onClick={() => { profile.setPresence(option.value); setStatusOpen(false); }}>
                <span className="profile-popup__status-dot" style={{ backgroundColor: option.color }} />
                <span>{option.label}</span>
              </button>)}
            </div>}
          </div>
        </footer>
      </div>
    </div>
  );
}
