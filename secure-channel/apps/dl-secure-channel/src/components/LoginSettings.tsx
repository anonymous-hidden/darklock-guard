/* ──────────────────────────────────────────────────────────
 *  Login Screen Settings — customize the login screen
 * ────────────────────────────────────────────────────────── */

import React, { useRef, useState } from 'react';
import {
  useLoginScreenStore,
  BG_GRADIENTS,
  type LoginBgMode,
  type LoginLogoStyle,
  type LoginAnimation,
  type LoginLayout,
  type LoginCardStyle,
} from '../stores/loginScreenStore';
import {
  X, Lock, Key, Fingerprint, Eye, Upload, Image, Settings,
} from './Icons';
import ridgelineScImg from '../assets/ridgeline-sc.png';
import './LoginSettings.css';

type Tab = 'background' | 'logo' | 'text' | 'card' | 'inputs' | 'button' | 'layout' | 'footer';

const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'background', label: 'Background' },
  { id: 'logo',       label: 'Logo' },
  { id: 'text',       label: 'Text' },
  { id: 'card',       label: 'Card' },
  { id: 'inputs',     label: 'Inputs' },
  { id: 'button',     label: 'Button' },
  { id: 'layout',     label: 'Layout' },
  { id: 'footer',     label: 'Footer' },
];

const BG_MODES: Array<{ value: LoginBgMode; label: string }> = [
  { value: 'default',  label: 'Default' },
  { value: 'solid',    label: 'Solid' },
  { value: 'gradient', label: 'Gradient' },
  { value: 'image',    label: 'Image' },
];

const LOGO_STYLES: Array<{ value: LoginLogoStyle; label: string }> = [
  { value: 'shield',      label: 'Shield' },
  { value: 'lock',        label: 'Lock' },
  { value: 'key',         label: 'Key' },
  { value: 'fingerprint', label: 'Fingerprint' },
  { value: 'eye',         label: 'Eye' },
  { value: 'image',       label: 'Custom' },
];

const ANIMS: Array<{ value: LoginAnimation; label: string }> = [
  { value: 'none',  label: 'None' },
  { value: 'pulse', label: 'Pulse' },
  { value: 'glow',  label: 'Glow' },
  { value: 'float', label: 'Float' },
];

const LAYOUTS: Array<{ value: LoginLayout; label: string }> = [
  { value: 'center', label: 'Center' },
  { value: 'top',    label: 'Top' },
  { value: 'bottom', label: 'Bottom' },
];

const CARD_STYLES: Array<{ value: LoginCardStyle; label: string }> = [
  { value: 'solid', label: 'Solid' },
  { value: 'glass', label: 'Glass' },
  { value: 'none',  label: 'None' },
];

const COLOR_PRESETS = [
  '#6366f1', '#8b5cf6', '#06b6d4', '#ec4899', '#22d3ee',
  '#34d399', '#f97316', '#ef4444', '#a3e635', '#fbbf24',
  '#f472b6', '#ffffff', '#e8e8f0', '#94a3b8', '#64748b',
];

const BG_COLORS = [
  '#0a0a0f', '#0f0f14', '#111318', '#0f172a', '#0c1a12',
  '#1a0a1a', '#1a0c0c', '#1a140a', '#0a1a1a', '#1c1a2e',
  '#282828', '#18181b', '#0d1117', '#000000',
];

interface Props {
  onClose: () => void;
}

export function LoginSettings({ onClose }: Props) {
  const store = useLoginScreenStore();
  const t = store.get();
  const set = store.set;
  const [tab, setTab] = useState<Tab>('background');
  const bgImgRef = useRef<HTMLInputElement>(null);
  const logoImgRef = useRef<HTMLInputElement>(null);

  const handleBgImage = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file?.type.startsWith('image/')) return;
    const objectUrl = URL.createObjectURL(file);
    const img = new window.Image();
    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      const MAX_W = 1920, MAX_H = 1080;
      let w = img.naturalWidth, h = img.naturalHeight;
      if (w > MAX_W || h > MAX_H) {
        const ratio = Math.min(MAX_W / w, MAX_H / h);
        w = Math.round(w * ratio);
        h = Math.round(h * ratio);
      }
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, 0, 0, w, h);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.82);
      set({ bgImage: dataUrl, bgMode: 'image' });
    };
    img.src = objectUrl;
    e.target.value = '';
  };

  const handleLogoImage = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file?.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = ev => {
      const url = ev.target?.result as string;
      if (url) set({ logoImage: url, logoStyle: 'image' });
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  return (
    <div className="lgs-overlay" onClick={onClose}>
      <div className="lgs" onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="lgs__header">
          <Settings size={15} />
          <span>Login Screen Settings</span>
          <button className="lgs__close" onClick={onClose}><X size={15} /></button>
        </div>

        {/* Tabs */}
        <div className="lgs__tabs">
          {TABS.map(tb => (
            <button
              key={tb.id}
              className={`lgs__tab${tab === tb.id ? ' lgs__tab--active' : ''}`}
              onClick={() => setTab(tb.id)}
            >
              {tb.label}
            </button>
          ))}
        </div>

        <div className="lgs__body">

          {/* ── Background ── */}
          {tab === 'background' && (
            <div className="lgs__section">
              <label className="lgs__label">Mode</label>
              <div className="lgs__seg">
                {BG_MODES.map(m => (
                  <button key={m.value} className={`lgs__seg-btn${t.bgMode === m.value ? ' lgs__seg-btn--sel' : ''}`}
                    onClick={() => set({ bgMode: m.value })}>
                    {m.label}
                  </button>
                ))}
              </div>

              {t.bgMode === 'solid' && (
                <>
                  <label className="lgs__label">Color</label>
                  <div className="lgs__swatches">
                    {BG_COLORS.map(c => (
                      <button key={c} className={`lgs__swatch${t.bgColor === c ? ' lgs__swatch--sel' : ''}`}
                        style={{ background: c }} onClick={() => set({ bgColor: c })} />
                    ))}
                    <input type="color" className="lgs__color-pick" value={t.bgColor}
                      onChange={e => set({ bgColor: e.target.value })} />
                  </div>
                </>
              )}

              {t.bgMode === 'gradient' && (
                <>
                  <label className="lgs__label">Gradient</label>
                  <div className="lgs__swatches lgs__swatches--wide">
                    {BG_GRADIENTS.map(g => (
                      <button key={g} className={`lgs__swatch lgs__swatch--wide${t.bgGradient === g ? ' lgs__swatch--sel' : ''}`}
                        style={{ background: g }} onClick={() => set({ bgGradient: g })} />
                    ))}
                  </div>
                </>
              )}

              {t.bgMode === 'image' && (
                <>
                  <input ref={bgImgRef} type="file" accept="image/*" hidden onChange={handleBgImage} />
                  <button className="lgs__upload-btn" onClick={() => bgImgRef.current?.click()}>
                    <Upload size={14} /> Upload Background
                  </button>
                  {t.bgImage && (
                    <div className="lgs__img-preview" style={{ backgroundImage: `url(${t.bgImage})` }} />
                  )}
                </>
              )}

              {t.bgMode !== 'default' && (
                <>
                  <label className="lgs__label">Overlay Opacity — {Math.round(t.bgOverlayOpacity * 100)}%</label>
                  <input type="range" min={0} max={100} value={Math.round(t.bgOverlayOpacity * 100)}
                    className="lgs__range" onChange={e => set({ bgOverlayOpacity: Number(e.target.value) / 100 })} />

                  <label className="lgs__label">Overlay Color</label>
                  <div className="lgs__color-row">
                    <input type="color" className="lgs__color-pick" value={t.bgOverlayColor}
                      onChange={e => set({ bgOverlayColor: e.target.value })} />
                    <span className="lgs__color-hex">{t.bgOverlayColor}</span>
                  </div>

                  <label className="lgs__label">Background Blur — {t.bgBlur}px</label>
                  <input type="range" min={0} max={30} value={t.bgBlur}
                    className="lgs__range" onChange={e => set({ bgBlur: Number(e.target.value) })} />
                </>
              )}
            </div>
          )}

          {/* ── Logo ── */}
          {tab === 'logo' && (
            <div className="lgs__section">
              <label className="lgs__label">Icon Style</label>
              <div className="lgs__icon-grid">
                {LOGO_STYLES.map(s => (
                  <button key={s.value}
                    className={`lgs__icon-card${t.logoStyle === s.value ? ' lgs__icon-card--sel' : ''}`}
                    onClick={() => set({ logoStyle: s.value })}>
                    {s.value === 'shield' && <img src={ridgelineScImg} width={20} height={20} style={{ objectFit: 'contain' }} />}
                    {s.value === 'lock' && <Lock size={20} />}
                    {s.value === 'key' && <Key size={20} />}
                    {s.value === 'fingerprint' && <Fingerprint size={20} />}
                    {s.value === 'eye' && <Eye size={20} />}
                    {s.value === 'image' && <Image size={20} />}
                    <span>{s.label}</span>
                  </button>
                ))}
              </div>

              {t.logoStyle === 'image' && (
                <>
                  <input ref={logoImgRef} type="file" accept="image/*" hidden onChange={handleLogoImage} />
                  <button className="lgs__upload-btn" onClick={() => logoImgRef.current?.click()}>
                    <Upload size={14} /> Upload Logo
                  </button>
                  {t.logoImage && (
                    <div className="lgs__img-preview lgs__img-preview--small"
                      style={{ backgroundImage: `url(${t.logoImage})` }} />
                  )}
                </>
              )}

              <label className="lgs__label">Icon Color</label>
              <div className="lgs__swatches">
                {COLOR_PRESETS.map(c => (
                  <button key={c} className={`lgs__swatch${t.logoColor === c ? ' lgs__swatch--sel' : ''}`}
                    style={{ background: c }} onClick={() => set({ logoColor: c })} />
                ))}
                <input type="color" className="lgs__color-pick" value={t.logoColor}
                  onChange={e => set({ logoColor: e.target.value })} />
              </div>

              <label className="lgs__label">Icon Size — {t.logoSize}px</label>
              <input type="range" min={20} max={80} value={t.logoSize}
                className="lgs__range" onChange={e => set({ logoSize: Number(e.target.value) })} />

              <label className="lgs__label">Background Color</label>
              <div className="lgs__color-row">
                <input type="color" className="lgs__color-pick" value={t.logoBgColor}
                  onChange={e => set({ logoBgColor: e.target.value })} />
                <span className="lgs__color-hex">{t.logoBgColor}</span>
              </div>

              <label className="lgs__label">Background Opacity — {Math.round(t.logoBgOpacity * 100)}%</label>
              <input type="range" min={0} max={100} value={Math.round(t.logoBgOpacity * 100)}
                className="lgs__range" onChange={e => set({ logoBgOpacity: Number(e.target.value) / 100 })} />

              <label className="lgs__label">Background Radius — {t.logoBgRadius}px</label>
              <input type="range" min={0} max={40} value={t.logoBgRadius}
                className="lgs__range" onChange={e => set({ logoBgRadius: Number(e.target.value) })} />

              <label className="lgs__label">Animation</label>
              <div className="lgs__seg">
                {ANIMS.map(a => (
                  <button key={a.value} className={`lgs__seg-btn${t.logoAnimation === a.value ? ' lgs__seg-btn--sel' : ''}`}
                    onClick={() => set({ logoAnimation: a.value })}>
                    {a.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* ── Text ── */}
          {tab === 'text' && (
            <div className="lgs__section">
              <label className="lgs__label">Title</label>
              <input className="lgs__text-input" value={t.titleText}
                onChange={e => set({ titleText: e.target.value })} placeholder="Secure Channel" maxLength={40} />

              <label className="lgs__label">Subtitle</label>
              <input className="lgs__text-input" value={t.subtitleText}
                onChange={e => set({ subtitleText: e.target.value })} placeholder="Ridgeline encrypted direct messaging" maxLength={80} />

              <label className="lgs__label">Title Size — {t.titleSize}px</label>
              <input type="range" min={16} max={40} value={t.titleSize}
                className="lgs__range" onChange={e => set({ titleSize: Number(e.target.value) })} />

              <label className="lgs__label">Title Color</label>
              <div className="lgs__swatches">
                {COLOR_PRESETS.map(c => (
                  <button key={c} className={`lgs__swatch${t.titleColor === c ? ' lgs__swatch--sel' : ''}`}
                    style={{ background: c }} onClick={() => set({ titleColor: c })} />
                ))}
                <input type="color" className="lgs__color-pick" value={t.titleColor}
                  onChange={e => set({ titleColor: e.target.value })} />
              </div>

              <label className="lgs__label">Subtitle Color</label>
              <div className="lgs__swatches">
                {COLOR_PRESETS.map(c => (
                  <button key={c} className={`lgs__swatch${t.subtitleColor === c ? ' lgs__swatch--sel' : ''}`}
                    style={{ background: c }} onClick={() => set({ subtitleColor: c })} />
                ))}
                <input type="color" className="lgs__color-pick" value={t.subtitleColor}
                  onChange={e => set({ subtitleColor: e.target.value })} />
              </div>
            </div>
          )}

          {/* ── Card ── */}
          {tab === 'card' && (
            <div className="lgs__section">
              <label className="lgs__label">Style</label>
              <div className="lgs__seg">
                {CARD_STYLES.map(s => (
                  <button key={s.value} className={`lgs__seg-btn${t.cardStyle === s.value ? ' lgs__seg-btn--sel' : ''}`}
                    onClick={() => set({ cardStyle: s.value })}>
                    {s.label}
                  </button>
                ))}
              </div>

              {t.cardStyle !== 'none' && (
                <>
                  <label className="lgs__label">Background Color</label>
                  <div className="lgs__color-row">
                    <input type="color" className="lgs__color-pick" value={t.cardBg}
                      onChange={e => set({ cardBg: e.target.value })} />
                    <span className="lgs__color-hex">{t.cardBg}</span>
                  </div>

                  <label className="lgs__label">Background Opacity — {Math.round(t.cardBgOpacity * 100)}%</label>
                  <input type="range" min={0} max={100} value={Math.round(t.cardBgOpacity * 100)}
                    className="lgs__range" onChange={e => set({ cardBgOpacity: Number(e.target.value) / 100 })} />

                  <label className="lgs__label">Border Color</label>
                  <div className="lgs__color-row">
                    <input type="color" className="lgs__color-pick" value={t.cardBorder === 'transparent' ? '#000000' : t.cardBorder}
                      onChange={e => set({ cardBorder: e.target.value })} />
                    <span className="lgs__color-hex">{t.cardBorder}</span>
                    <button className="lgs__mini-btn" onClick={() => set({ cardBorder: 'transparent' })}>None</button>
                  </div>

                  <label className="lgs__label">Border Radius — {t.cardRadius}px</label>
                  <input type="range" min={0} max={32} value={t.cardRadius}
                    className="lgs__range" onChange={e => set({ cardRadius: Number(e.target.value) })} />

                  <label className="lgs__label">Shadow Depth — {t.cardShadow}px</label>
                  <input type="range" min={0} max={60} value={t.cardShadow}
                    className="lgs__range" onChange={e => set({ cardShadow: Number(e.target.value) })} />
                </>
              )}

              {t.cardStyle === 'glass' && (
                <>
                  <label className="lgs__label">Backdrop Blur — {t.cardBlur}px</label>
                  <input type="range" min={0} max={30} value={t.cardBlur}
                    className="lgs__range" onChange={e => set({ cardBlur: Number(e.target.value) })} />
                </>
              )}

              {t.cardStyle !== 'none' && (
                <>
                  <label className="lgs__label">Glow Size — {t.cardGlow}px</label>
                  <input type="range" min={0} max={40} value={t.cardGlow}
                    className="lgs__range" onChange={e => set({ cardGlow: Number(e.target.value) })} />

                  {t.cardGlow > 0 && (
                    <>
                      <label className="lgs__label">Glow Color</label>
                      <div className="lgs__swatches">
                        {COLOR_PRESETS.map(c => (
                          <button key={c} className={`lgs__swatch${t.cardGlowColor === c ? ' lgs__swatch--sel' : ''}`}
                            style={{ background: c }} onClick={() => set({ cardGlowColor: c })} />
                        ))}
                        <input type="color" className="lgs__color-pick" value={t.cardGlowColor}
                          onChange={e => set({ cardGlowColor: e.target.value })} />
                      </div>
                    </>
                  )}
                </>
              )}
            </div>
          )}

          {/* ── Inputs ── */}
          {tab === 'inputs' && (
            <div className="lgs__section">
              <label className="lgs__label">Background</label>
              <div className="lgs__color-row">
                <input type="color" className="lgs__color-pick" value={t.inputBg}
                  onChange={e => set({ inputBg: e.target.value })} />
                <span className="lgs__color-hex">{t.inputBg}</span>
              </div>

              <label className="lgs__label">Border</label>
              <div className="lgs__color-row">
                <input type="color" className="lgs__color-pick" value={t.inputBorder === 'rgba(255,255,255,0.08)' ? '#222222' : t.inputBorder}
                  onChange={e => set({ inputBorder: e.target.value })} />
                <span className="lgs__color-hex">{t.inputBorder}</span>
              </div>

              <label className="lgs__label">Border Radius — {t.inputRadius}px</label>
              <input type="range" min={0} max={24} value={t.inputRadius}
                className="lgs__range" onChange={e => set({ inputRadius: Number(e.target.value) })} />

              <label className="lgs__label">Text Color</label>
              <div className="lgs__swatches">
                {COLOR_PRESETS.map(c => (
                  <button key={c} className={`lgs__swatch${t.inputTextColor === c ? ' lgs__swatch--sel' : ''}`}
                    style={{ background: c }} onClick={() => set({ inputTextColor: c })} />
                ))}
                <input type="color" className="lgs__color-pick" value={t.inputTextColor}
                  onChange={e => set({ inputTextColor: e.target.value })} />
              </div>
            </div>
          )}

          {/* ── Button ── */}
          {tab === 'button' && (
            <div className="lgs__section">
              <label className="lgs__label">Button Color</label>
              <div className="lgs__swatches">
                {COLOR_PRESETS.map(c => (
                  <button key={c} className={`lgs__swatch${t.buttonColor === c ? ' lgs__swatch--sel' : ''}`}
                    style={{ background: c }} onClick={() => set({ buttonColor: c })} />
                ))}
                <input type="color" className="lgs__color-pick" value={t.buttonColor}
                  onChange={e => set({ buttonColor: e.target.value })} />
              </div>

              <label className="lgs__label">Button Text</label>
              <div className="lgs__swatches">
                {COLOR_PRESETS.map(c => (
                  <button key={c} className={`lgs__swatch${t.buttonTextColor === c ? ' lgs__swatch--sel' : ''}`}
                    style={{ background: c }} onClick={() => set({ buttonTextColor: c })} />
                ))}
                <input type="color" className="lgs__color-pick" value={t.buttonTextColor}
                  onChange={e => set({ buttonTextColor: e.target.value })} />
              </div>

              <label className="lgs__label">Radius — {t.buttonRadius}px</label>
              <input type="range" min={0} max={24} value={t.buttonRadius}
                className="lgs__range" onChange={e => set({ buttonRadius: Number(e.target.value) })} />

              <label className="lgs__label">Accent Color</label>
              <div className="lgs__swatches">
                {COLOR_PRESETS.map(c => (
                  <button key={c} className={`lgs__swatch${t.accentColor === c ? ' lgs__swatch--sel' : ''}`}
                    style={{ background: c }} onClick={() => set({ accentColor: c })} />
                ))}
                <input type="color" className="lgs__color-pick" value={t.accentColor}
                  onChange={e => set({ accentColor: e.target.value })} />
              </div>
            </div>
          )}

          {/* ── Layout ── */}
          {tab === 'layout' && (
            <div className="lgs__section">
              <label className="lgs__label">Card Position</label>
              <div className="lgs__seg">
                {LAYOUTS.map(l => (
                  <button key={l.value} className={`lgs__seg-btn${t.layout === l.value ? ' lgs__seg-btn--sel' : ''}`}
                    onClick={() => set({ layout: l.value })}>
                    {l.label}
                  </button>
                ))}
              </div>

              <label className="lgs__label">Card Max Width — {t.cardMaxWidth}px</label>
              <input type="range" min={280} max={600} value={t.cardMaxWidth}
                className="lgs__range" onChange={e => set({ cardMaxWidth: Number(e.target.value) })} />
            </div>
          )}

          {/* ── Footer ── */}
          {tab === 'footer' && (
            <div className="lgs__section">
              <label className="lgs__label">
                <span>Show Encryption Badge</span>
                <input type="checkbox" checked={t.showEncBadge}
                  onChange={e => set({ showEncBadge: e.target.checked })} className="lgs__check" />
              </label>

              <label className="lgs__label">Custom Footer Text</label>
              <input className="lgs__text-input" value={t.footerText}
                onChange={e => set({ footerText: e.target.value })} placeholder="Optional footer message..." maxLength={80} />

              <label className="lgs__label">Footer Color</label>
              <div className="lgs__swatches">
                {COLOR_PRESETS.map(c => (
                  <button key={c} className={`lgs__swatch${t.footerColor === c ? ' lgs__swatch--sel' : ''}`}
                    style={{ background: c }} onClick={() => set({ footerColor: c })} />
                ))}
                <input type="color" className="lgs__color-pick" value={t.footerColor}
                  onChange={e => set({ footerColor: e.target.value })} />
              </div>
            </div>
          )}
        </div>

        {/* ── Reset ── */}
        <div className="lgs__footer">
          <button className="lgs__reset-btn" onClick={() => { store.reset(); }}>
            Reset All
          </button>
        </div>
      </div>
    </div>
  );
}
