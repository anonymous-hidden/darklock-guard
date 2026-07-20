/* ──────────────────────────────────────────────────────────
 *  EmojiPicker — tabbed emoji / GIF / sticker picker
 * ────────────────────────────────────────────────────────── */

import { useState, useRef, useEffect, useCallback } from 'react';
import { Smile, Image as ImageIcon, Search, X } from './Icons';
import './EmojiPicker.css';

/* Inline Sticker icon — not in Icons.tsx */
function Sticker({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M15.5 3H5a2 2 0 0 0-2 2v14c0 1.1.9 2 2 2h14a2 2 0 0 0 2-2V8.5L15.5 3Z" />
      <path d="M14 3v4a2 2 0 0 0 2 2h4" />
      <path d="M8 13h0" /><path d="M16 13h0" /><path d="M10 17c.5.3 1.2.5 2 .5s1.5-.2 2-.5" />
    </svg>
  );
}

/* ── Emoji data (common set, grouped by category) ──────── */
const EMOJI_CATEGORIES: { name: string; icon: string; emojis: string[] }[] = [
  {
    name: 'Smileys', icon: '😀',
    emojis: [
      '😀','😃','😄','😁','😆','😅','🤣','😂','🙂','🙃',
      '😉','😊','😇','🥰','😍','🤩','😘','😗','😚','😙',
      '🥲','😋','😛','😜','🤪','😝','🤑','🤗','🤭','🫢',
      '🤫','🤔','🫡','🤐','🤨','😐','😑','😶','🫥','😏',
      '😒','🙄','😬','🤥','😌','😔','😪','🤤','😴','😷',
      '🤒','🤕','🤢','🤮','🥵','🥶','🥴','😵','🤯','🤠',
      '🥳','🥸','😎','🤓','🧐','😕','🫤','😟','🙁','☹️',
      '😮','😯','😲','😳','🥺','🥹','😦','😧','😨','😰',
      '😥','😢','😭','😱','😖','😣','😞','😓','😩','😫',
      '🥱','😤','😡','😠','🤬','😈','👿','💀','☠️','💩',
    ],
  },
  {
    name: 'Gestures', icon: '👋',
    emojis: [
      '👋','🤚','🖐️','✋','🖖','🫱','🫲','🫳','🫴','👌',
      '🤌','🤏','✌️','🤞','🫰','🤟','🤘','🤙','👈','👉',
      '👆','🖕','👇','☝️','🫵','👍','👎','✊','👊','🤛',
      '🤜','👏','🙌','🫶','👐','🤲','🤝','🙏','✍️','💪',
      '🦾','🦿','🦵','🦶','👂','🦻','👃','🧠','🫀','🫁',
      '👀','👁️','👅','👄','💋','🫂','👤','👥','🗣️','👶',
    ],
  },
  {
    name: 'Hearts', icon: '❤️',
    emojis: [
      '❤️','🧡','💛','💚','💙','💜','🖤','🤍','🤎','💔',
      '❤️‍🔥','❤️‍🩹','❣️','💕','💞','💓','💗','💖','💘','💝',
      '💟','♥️','🫶','💑','💏','👩‍❤️‍👨','👩‍❤️‍👩','👨‍❤️‍👨','💐','🌹',
    ],
  },
  {
    name: 'Animals', icon: '🐶',
    emojis: [
      '🐶','🐱','🐭','🐹','🐰','🦊','🐻','🐼','🐻‍❄️','🐨',
      '🐯','🦁','🐮','🐷','🐸','🐵','🙈','🙉','🙊','🐒',
      '🐔','🐧','🐦','🐤','🐣','🐥','🦆','🦅','🦉','🦇',
      '🐺','🐗','🐴','🦄','🐝','🐛','🦋','🐌','🐞','🐜',
      '🪲','🐢','🐍','🦎','🦖','🦕','🐙','🦑','🦐','🦞',
      '🦀','🐳','🐋','🐬','🦭','🐟','🐠','🐡','🦈','🐊',
    ],
  },
  {
    name: 'Food', icon: '🍔',
    emojis: [
      '🍏','🍎','🍐','🍊','🍋','🍌','🍉','🍇','🍓','🫐',
      '🍈','🍒','🍑','🥭','🍍','🥥','🥝','🍅','🍆','🥑',
      '🥦','🥬','🥒','🌶️','🫑','🌽','🥕','🧄','🧅','🥔',
      '🍠','🥐','🥖','🍞','🥨','🥯','🧀','🥚','🍳','🧈',
      '🥓','🥩','🍗','🍖','🦴','🌭','🍔','🍟','🍕','🫓',
      '🥪','🌮','🌯','🫔','🥙','🧆','🥚','🍝','🍜','🍲',
    ],
  },
  {
    name: 'Objects', icon: '💡',
    emojis: [
      '⌚','📱','💻','⌨️','🖥️','🖨️','🖱️','🖲️','🕹️','🗜️',
      '💽','💾','💿','📀','📼','📷','📸','📹','🎥','📽️',
      '🎞️','📞','☎️','📟','📠','📺','📻','🎙️','🎚️','🎛️',
      '🧭','⏱️','⏲️','⏰','🕰️','⌛','⏳','🔋','🔌','💡',
      '🔦','🕯️','🪔','🧯','🛢️','💸','💵','💴','💶','💷',
      '🪙','💰','💳','🔑','🗝️','🔒','🔓','🔏','🔐','🛡️',
    ],
  },
  {
    name: 'Symbols', icon: '✨',
    emojis: [
      '✨','🌟','⭐','🔥','💥','⚡','🌈','☀️','🌤️','⛅',
      '🌥️','☁️','🌦️','🌧️','⛈️','🌩️','❄️','☃️','⛄','🌊',
      '💧','💦','🫧','🎄','🎃','🎆','🎇','🧨','✨','🎈',
      '🎉','🎊','🎋','🎍','🎎','🎏','🎐','🎑','🧧','🎀',
      '🎁','🏆','🥇','🥈','🥉','⚽','🏀','🏈','⚾','🥎',
      '🎾','🏐','🏉','🥏','🎳','🏏','🏑','🏒','🥍','🏓',
    ],
  },
];

const RECENT_KEY = 'dl-emoji-recent';
const MAX_RECENT = 28;

function loadRecent(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function saveRecent(list: string[]) {
  localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, MAX_RECENT)));
}

/* ── Sticker data (text-art stickers) ──────────────────── */
const STICKERS = [
  { id: 'shrug', label: '¯\\_(ツ)_/¯' },
  { id: 'lenny', label: '( ͡° ͜ʖ ͡°)' },
  { id: 'tableFlip', label: '(╯°□°)╯︵ ┻━┻' },
  { id: 'tableBack', label: '┬─┬ノ( º _ ºノ)' },
  { id: 'disapproval', label: 'ಠ_ಠ' },
  { id: 'bear', label: 'ʕ•ᴥ•ʔ' },
  { id: 'sparkles', label: '(ﾉ◕ヮ◕)ﾉ*:・ﾟ✧' },
  { id: 'fight', label: '(ง •̀_•́)ง' },
  { id: 'cry', label: '(ಥ﹏ಥ)' },
  { id: 'happy', label: '(◕‿◕)' },
  { id: 'cat', label: '(=^・^=)' },
  { id: 'music', label: '♪(´ε` )' },
  { id: 'wave', label: '( ´ ▽ ` )ﾉ' },
  { id: 'angry', label: '(ノಠ益ಠ)ノ彡┻━┻' },
  { id: 'love', label: '(づ ̄ ³ ̄)づ' },
  { id: 'confused', label: '(⊙_☉)' },
  { id: 'cool', label: '(⌐■_■)' },
  { id: 'deal', label: '( •_•)>⌐■-■' },
  { id: 'thinking', label: '(¬‿¬)' },
  { id: 'whatever', label: '┐(´∀`)┌' },
];

/* ── GIF search (Giphy) ────────────────────────────────── */
const GIPHY_API_KEY = String(import.meta.env.VITE_GIPHY_API_KEY ?? '').trim();
const GIPHY_BASE = 'https://api.giphy.com/v1/gifs';

interface GifResult {
  id: string;
  title: string;
  previewUrl: string;
  url: string;
  bannerUrl: string;
}

function toGifResults(data: { data?: Array<Record<string, any>> }, fallbackTitle: string): GifResult[] {
  return (data.data ?? [])
    .map((gif) => ({
      id: String(gif.id ?? ''),
      title: String(gif.title || fallbackTitle),
      previewUrl: String(gif.images?.fixed_height_small?.url ?? gif.images?.fixed_height?.url ?? ''),
      url: String(gif.images?.original?.url ?? gif.images?.fixed_height?.url ?? ''),
      // Small animated rendition keeps profile banner data URLs within the
      // profile service's strict payload limit.
      bannerUrl: String(gif.images?.fixed_height_small?.url ?? gif.images?.fixed_height?.url ?? ''),
    }))
    .filter((gif) => gif.id && gif.previewUrl && gif.url);
}

async function fetchGifs(endpoint: 'search' | 'trending', query = ''): Promise<GifResult[]> {
  if (!GIPHY_API_KEY) {
    throw new Error('GIF search is not configured. Add VITE_GIPHY_API_KEY to the Ridgeline environment.');
  }

  const params = new URLSearchParams({
    api_key: GIPHY_API_KEY,
    limit: '20',
    rating: 'pg-13',
  });
  if (endpoint === 'search') params.set('q', query);

  const response = await fetch(`${GIPHY_BASE}/${endpoint}?${params}`, {
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) {
    throw new Error('GIF search is temporarily unavailable.');
  }

  return toGifResults(await response.json(), query || 'GIF');
}

async function searchGifs(query: string): Promise<GifResult[]> {
  return query.trim() ? fetchGifs('search', query) : fetchGifs('trending');
}

async function trendingGifs(): Promise<GifResult[]> {
  return fetchGifs('trending');
}

/* ── Component ─────────────────────────────────────────── */

type Tab = 'emoji' | 'gif' | 'sticker';

interface Props {
  onSelectEmoji: (emoji: string) => void;
  onSelectGif: (url: string, bannerUrl?: string) => void;
  onSelectSticker: (text: string) => void;
  onClose: () => void;
  initialTab?: Tab;
  gifOnly?: boolean;
  embedded?: boolean;
  closeOnGifSelect?: boolean;
}

export function EmojiPicker({
  onSelectEmoji,
  onSelectGif,
  onSelectSticker,
  onClose,
  initialTab = 'emoji',
  gifOnly = false,
  embedded = false,
  closeOnGifSelect = true,
}: Props) {
  const [tab, setTab] = useState<Tab>(gifOnly ? 'gif' : initialTab);
  const [search, setSearch] = useState('');
  const [recent, setRecent] = useState(loadRecent);
  const [gifs, setGifs] = useState<GifResult[]>([]);
  const [gifLoading, setGifLoading] = useState(false);
  const [gifError, setGifError] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  // Load trending GIFs when switching to gif tab
  useEffect(() => {
    if (tab === 'gif' && gifs.length === 0) {
      setGifLoading(true);
      setGifError(null);
      trendingGifs()
        .then(setGifs)
        .catch((error: unknown) => {
          setGifs([]);
          setGifError(error instanceof Error ? error.message : 'GIF search is temporarily unavailable.');
        })
        .finally(() => setGifLoading(false));
    }
  }, [tab]);

  // Debounced GIF search
  const handleGifSearch = useCallback((q: string) => {
    setSearch(q);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      setGifLoading(true);
      setGifError(null);
      try {
        setGifs(await searchGifs(q));
      } catch (error) {
        setGifs([]);
        setGifError(error instanceof Error ? error.message : 'GIF search is temporarily unavailable.');
      } finally {
        setGifLoading(false);
      }
    }, 400);
  }, []);

  const pickEmoji = (emoji: string) => {
    onSelectEmoji(emoji);
    const updated = [emoji, ...recent.filter(e => e !== emoji)].slice(0, MAX_RECENT);
    setRecent(updated);
    saveRecent(updated);
  };

  // Filter emojis by search
  const filteredCategories = search.trim()
    ? EMOJI_CATEGORIES.map(cat => ({
        ...cat,
        emojis: cat.emojis.filter(() => cat.name.toLowerCase().includes(search.toLowerCase())),
      })).filter(cat => cat.emojis.length > 0)
    : EMOJI_CATEGORIES;

  return (
    <div className={`emoji-picker${embedded ? ' emoji-picker--embedded' : ''}`} ref={panelRef}>
      {/* Tabs */}
      <div className="emoji-picker__tabs">
        {!gifOnly && <button className={`emoji-picker__tab${tab === 'emoji' ? ' emoji-picker__tab--active' : ''}`} onClick={() => { setTab('emoji'); setSearch(''); }}>
          <Smile size={16} /> Emoji
        </button>}
        <button className={`emoji-picker__tab${tab === 'gif' ? ' emoji-picker__tab--active' : ''}`} onClick={() => { setTab('gif'); setSearch(''); }}>
          <ImageIcon size={16} /> {gifOnly ? 'Choose a GIF' : 'GIF'}
        </button>
        {!gifOnly && <button className={`emoji-picker__tab${tab === 'sticker' ? ' emoji-picker__tab--active' : ''}`} onClick={() => { setTab('sticker'); setSearch(''); }}>
          <Sticker size={16} /> Sticker
        </button>}
        <button className="emoji-picker__close" onClick={onClose}>
          <X size={14} />
        </button>
      </div>

      {/* Search */}
      {tab !== 'sticker' && (
        <div className="emoji-picker__search">
          <Search size={14} />
          <input
            type="text"
            placeholder={tab === 'emoji' ? 'Search emojis…' : 'Search GIFs…'}
            value={search}
            onChange={e => tab === 'gif' ? handleGifSearch(e.target.value) : setSearch(e.target.value)}
            autoFocus
          />
        </div>
      )}

      {/* Body */}
      <div className="emoji-picker__body">
        {/* Emoji Tab */}
        {tab === 'emoji' && (
          <>
            {recent.length > 0 && !search && (
              <div className="emoji-picker__cat">
                <div className="emoji-picker__cat-label">Recently Used</div>
                <div className="emoji-picker__grid">
                  {recent.map((e, i) => (
                    <button key={`r-${i}`} className="emoji-picker__emoji" onClick={() => pickEmoji(e)}>{e}</button>
                  ))}
                </div>
              </div>
            )}
            {filteredCategories.map(cat => (
              <div key={cat.name} className="emoji-picker__cat">
                <div className="emoji-picker__cat-label">{cat.name}</div>
                <div className="emoji-picker__grid">
                  {cat.emojis.map((e, i) => (
                    <button key={`${cat.name}-${i}`} className="emoji-picker__emoji" onClick={() => pickEmoji(e)}>{e}</button>
                  ))}
                </div>
              </div>
            ))}
          </>
        )}

        {/* GIF Tab */}
        {tab === 'gif' && (
          <div className="emoji-picker__gif-grid">
            {gifLoading && <div className="emoji-picker__loading">Loading…</div>}
            {!gifLoading && gifError && <div className="emoji-picker__empty">{gifError}</div>}
            {!gifLoading && !gifError && gifs.length === 0 && <div className="emoji-picker__empty">No GIFs found</div>}
            {gifs.map(g => (
              <button key={g.id} className="emoji-picker__gif" onClick={() => { onSelectGif(g.url, g.bannerUrl); if (closeOnGifSelect) onClose(); }}>
                <img src={g.previewUrl} alt={g.title} loading="lazy" />
              </button>
            ))}
          </div>
        )}

        {/* Sticker Tab */}
        {tab === 'sticker' && (
          <div className="emoji-picker__sticker-grid">
            {STICKERS.map(s => (
              <button
                key={s.id}
                className="emoji-picker__sticker"
                onClick={() => { onSelectSticker(s.label); onClose(); }}
                title={s.id}
              >
                {s.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
