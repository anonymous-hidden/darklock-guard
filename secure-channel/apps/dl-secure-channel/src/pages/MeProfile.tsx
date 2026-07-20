import { useState } from 'react';
import { useProfileStore, PRESENCE_COLORS, type PresenceStatus } from '../stores/profileStore';
import { useAuthStore } from '../stores/authStore';
import { useTagStore, TAG_MAP } from '../stores/tagStore';
import { NAMEPLATE_MAP } from '../components/ProfileEditor';
import { Settings as SettingsIcon, Edit, ChevronDown, Globe } from '../components/Icons';
import { Avatar, Badge, Button } from '../components/Shared';
import { CustomStatusBubble } from '../components/CustomStatusBubble';
import { SpotifyActivityCard } from '../components/SpotifyActivityCard';
import './MeProfile.css';

const PRESENCE_OPTIONS: { value: PresenceStatus; label: string; color: string }[] = [
  { value: 'online',    label: 'Online',         color: PRESENCE_COLORS.online },
  { value: 'idle',      label: 'Idle',           color: PRESENCE_COLORS.idle },
  { value: 'dnd',       label: 'Do Not Disturb', color: PRESENCE_COLORS.dnd },
  { value: 'invisible', label: 'Invisible',      color: PRESENCE_COLORS.invisible },
];

export function MeProfile() {
  const [statusOpen, setStatusOpen] = useState(false);

  const profile      = useProfileStore();
  const selectedTags = useProfileStore(s => s.selectedTags);
  const sectionOrder = useProfileStore(s => s.sectionOrder) ?? ['tags', 'status', 'bio', 'links'];
  const displayName  = useAuthStore(s => s.displayName);
  const userId       = useAuthStore(s => s.userId);
  const setScreen    = useAuthStore(s => s.setScreen);
  const userTags     = useTagStore(s => userId ? (s.userTags[userId] ?? []) : []);

  const currentPresence = PRESENCE_OPTIONS.find(o => o.value === profile.presence) ?? PRESENCE_OPTIONS[0];
  const name = profile.displayName || displayName || 'User';
  const customStatus = profile.customStatusExpiresAt && new Date(profile.customStatusExpiresAt).getTime() <= Date.now()
    ? ''
    : profile.customStatus;

  /* ── Section renderers (matches ProfilePopup) ───────── */
  const selectedTagDefs = selectedTags.map(id => TAG_MAP[id]).filter(Boolean);

  const sectionMap: Record<string, React.ReactNode> = {
    tags: selectedTagDefs.length > 0 ? (
      <div className="me-profile__tags">
        {selectedTagDefs.map(tag => (
          <span key={tag.id} className="me-profile__tag"
            style={{ background: tag.color, color: tag.textColor ?? '#fff' }}>
            {tag.label}
          </span>
        ))}
      </div>
    ) : null,

    status: null,

    bio: profile.bio ? (
      <div className="me-profile__bio-section">
        <h4 className="me-profile__heading">About Me</h4>
        <p className="me-profile__bio">{profile.bio}</p>
      </div>
    ) : null,

    links: profile.links && profile.links.length > 0 ? (
      <div className="me-profile__links-section">
        <h4 className="me-profile__heading">Links</h4>
        <div className="me-profile__links">
          {profile.links.map(link => (
            <a key={link.id} className="me-profile__link" href={link.url} target="_blank" rel="noopener noreferrer">
              <Globe size={14} />
              <span>{link.label || link.url}</span>
            </a>
          ))}
        </div>
      </div>
    ) : null,
  };

  const visibleSections = sectionOrder.filter(id => sectionMap[id] != null);

  return (
    <div className="me-profile">
      {/* ── Top bar ───────────────────────────────── */}
      <div className="me-profile__topbar">
        <span className="me-profile__topbar-title">You</span>
        <button className="me-profile__gear" onClick={() => setScreen('settings')}>
          <SettingsIcon size={22} />
        </button>
      </div>

      {/* ── Scrollable body ──────────────────────── */}
      <div className="me-profile__body">

        {/* Banner */}
        <div
          className="me-profile__banner"
          style={profile.banner
            ? { backgroundImage: `url(${profile.banner})`, backgroundSize: profile.bannerFit, backgroundRepeat: 'no-repeat', backgroundColor: '#0f1118' }
            : profile.nameplate && NAMEPLATE_MAP[profile.nameplate]
              ? { background: NAMEPLATE_MAP[profile.nameplate].gradient }
              : { background: `linear-gradient(${profile.gradientAngle ?? 135}deg, ${profile.accentColor}, ${profile.accentColor2 || profile.accentColor + '66'})` }
          }
        />

        {/* Avatar + presence */}
        <div className="me-profile__avatar-area">
          <div className="me-profile__avatar-ring">
            {profile.avatar
              ? <img src={profile.avatar} alt="" className="me-profile__avatar-img" />
              : <Avatar name={name} size={80} />
            }
            <span className="me-profile__presence-dot" style={{ backgroundColor: currentPresence.color }} />
          </div>
          <div className="me-profile__status-bubble">
            <CustomStatusBubble status={customStatus} />
          </div>
        </div>

        {/* Card body */}
        <div className="me-profile__card">
          {/* Identity */}
          <div className="me-profile__identity">
            <h1 className="me-profile__name" style={{ color: profile.usernameColor }}>{name}</h1>
            <span className="me-profile__username">@{profile.username || userId?.slice(0, 12)}</span>
            {profile.pronouns && <Badge variant="default">{profile.pronouns}</Badge>}
          </div>

          {/* Tags inline */}
          {selectedTagDefs.length > 0 && (
            <div className="me-profile__tags">
              {selectedTagDefs.map(tag => (
                <span key={tag.id} className="me-profile__tag"
                  style={{ background: tag.color, color: tag.textColor ?? '#fff' }}>
                  {tag.label}
                </span>
              ))}
            </div>
          )}

          {/* Edit Profile button */}
          <Button
            variant="secondary"
            size="md"
            icon={<Edit size={16} />}
            className="me-profile__edit-btn"
            onClick={() => setScreen('settings')}
          >
            Edit Profile
          </Button>

          <SpotifyActivityCard />

          {/* Divider + sections */}
          {visibleSections.filter(id => id !== 'tags' && id !== 'status').map(sectionId => (
            <div key={sectionId} className="me-profile__section">
              {sectionMap[sectionId]}
            </div>
          ))}

          {/* Presence selector */}
          <div className="me-profile__section me-profile__presence-section">
            <h4 className="me-profile__heading">Status</h4>
            <button className="me-profile__presence-trigger" onClick={() => setStatusOpen(!statusOpen)}>
              <span className="me-profile__presence-indicator" style={{ backgroundColor: currentPresence.color }} />
              <span className="me-profile__presence-label">{currentPresence.label}</span>
              <ChevronDown size={14} className={`me-profile__chevron${statusOpen ? ' me-profile__chevron--open' : ''}`} />
            </button>
            {statusOpen && (
              <div className="me-profile__presence-dropdown">
                {PRESENCE_OPTIONS.map(opt => (
                  <button
                    key={opt.value}
                    className={`me-profile__presence-option${opt.value === profile.presence ? ' me-profile__presence-option--active' : ''}`}
                    onClick={() => { profile.setPresence(opt.value); setStatusOpen(false); }}
                  >
                    <span className="me-profile__presence-indicator" style={{ backgroundColor: opt.color }} />
                    <span>{opt.label}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
