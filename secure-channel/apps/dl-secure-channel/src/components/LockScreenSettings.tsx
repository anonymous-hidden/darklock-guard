import { useRef, useState } from 'react';
import {
  useLockScreenStore,
  type LockBackground,
  type LockIconStyle,
  type LockAnimation,
} from '../stores/lockScreenStore';
import { X, Lock, Key, Fingerprint, Eye, Palette, Upload } from './Icons';
import ridgelineScImg from '../assets/ridgeline-sc.png';
import './LockScreenSettings.css';

const RidgelineScIcon = ({ size, className }: { size?: number; className?: string }) => (
  <img src={ridgelineScImg} width={size} height={size} className={className} style={{ objectFit: 'contain', display: 'block' }} />
);

interface Props {
  convId:  string;
  onClose: () => void;
}

const BG_MODES: Array<{ value: LockBackground; label: string }> = [
  { value: 'default',  label: 'Default' },
  { value: 'solid',    label: 'Solid Color' },
  { value: 'gradient', label: 'Gradient' },
  { value: 'blur',     label: 'Blur' },
  { value: 'image',    label: 'Image' },
];

const BG_SOLIDS = [
  '#0f0f14', '#111318', '#0f172a', '#0c1a12', '#1a0a1a', '#1a0c0c',
  '#1a140a', '#0a1a1a', '#1c1a2e', '#282828', '#18181b', '#0d1117',
];

const BG_GRADIENTS = [
  'linear-gradient(160deg, #0f0c29, #302b63, #24243e)',
  'linear-gradient(160deg, #0a2e1a, #0f4c2a)',
  'linear-gradient(160deg, #2e0a0a, #4c1515)',
  'linear-gradient(160deg, #1a0533, #3d0a47)',
  'linear-gradient(160deg, #080a2e, #0e1560)',
  'linear-gradient(160deg, #1a120a, #2e1e0a)',
  'linear-gradient(135deg, #0a0a2a, #1a0a3a, #2a0a1a)',
  'linear-gradient(160deg, #3a2a1a, #1a1a1a)',
];

const ICON_STYLES: Array<{ value: LockIconStyle; label: string; Icon: typeof Lock }> = [
  { value: 'default',     label: 'Lock',                     Icon: Lock },
  { value: 'shield',      label: 'Ridgeline',               Icon: RidgelineScIcon as unknown as typeof Lock },
  { value: 'key',         label: 'Key',                      Icon: Key },
  { value: 'fingerprint', label: 'Fingerprint', Icon: Fingerprint },
  { value: 'eye',         label: 'Eye',         Icon: Eye },
];

const ANIMATIONS: Array<{ value: LockAnimation; label: string }> = [
  { value: 'none',  label: 'None' },
  { value: 'pulse', label: 'Pulse' },
  { value: 'glow',  label: 'Glow' },
  { value: 'float', label: 'Float' },
];

const COLOR_PRESETS = [
  '#6366f1', '#8b5cf6', '#06b6d4', '#ec4899', '#22d3ee',
  '#34d399', '#f97316', '#ef4444', '#a3e635', '#fbbf24',
  '#f472b6', '#ffffff', '#e8e8f0', '#94a3b8', '#64748b',
];

type Tab = 'background' | 'icon' | 'text' | 'box' | 'button';

export function LockScreenSettings({ convId, onClose }: Props) {
  const store  = useLockScreenStore();
  const theme  = store.getTheme(convId);
  const set    = (patch: Parameters<typeof store.setTheme>[1]) => store.setTheme(convId, patch);
  const [tab, setTab] = useState<Tab>('background');
  const imgInputRef = useRef<HTMLInputElement>(null);

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = ev => {
      const url = ev.target?.result as string;
      if (url) set({ bgImage: url, bgMode: 'image' });
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const TABS: Array<{ id: Tab; label: string }> = [
    { id: 'background', label: 'Background' },
    { id: 'icon',       label: 'Icon' },
    { id: 'text',       label: 'Text' },
    { id: 'box',        label: 'Box' },
    { id: 'button',     label: 'Button' },
  ];

  return (
    <div className="lss-overlay" onClick={onClose}>
      <div className="lss" onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="lss__header">
          <Palette size={15} />
          <span>Lock Screen Style</span>
          <button className="lss__close" onClick={onClose}><X size={15} /></button>
        </div>

        {/* Tabs */}
        <div className="lss__tabs">
          {TABS.map(t => (
            <button
              key={t.id}
              className={`lss__tab${tab === t.id ? ' lss__tab--active' : ''}`}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="lss__body">

          {/* ── Background ──────────────────────── */}
          {tab === 'background' && (
            <div className="lss__section">
              <label className="lss__label">Mode</label>
              <div className="lss__seg">
                {BG_MODES.map(m => (
                  <button
                    key={m.value}
                    className={`lss__seg-btn${theme.bgMode === m.value ? ' lss__seg-btn--sel' : ''}`}
                    onClick={() => set({ bgMode: m.value })}
                  >
                    {m.label}
                  </button>
                ))}
              </div>

              {theme.bgMode === 'solid' && (
                <>
                  <label className="lss__label">Color</label>
                  <div className="lss__swatches">
                    {BG_SOLIDS.map(c => (
                      <button
                        key={c}
                        className={`lss__swatch${theme.bgValue === c ? ' lss__swatch--sel' : ''}`}
                        style={{ background: c }}
                        onClick={() => set({ bgValue: c })}
                      />
                    ))}
                    <input
                      type="color"
                      className="lss__color-pick"
                      value={theme.bgValue || '#0f0f14'}
                      onChange={e => set({ bgValue: e.target.value })}
                    />
                  </div>
                </>
              )}

              {theme.bgMode === 'gradient' && (
                <>
                  <label className="lss__label">Gradient</label>
                  <div className="lss__swatches lss__swatches--wide">
                    {BG_GRADIENTS.map(g => (
                      <button
                        key={g}
                        className={`lss__swatch lss__swatch--wide${theme.bgValue === g ? ' lss__swatch--sel' : ''}`}
                        style={{ background: g }}
                        onClick={() => set({ bgValue: g })}
                      />
                    ))}
                  </div>
                </>
              )}

              {theme.bgMode === 'blur' && (
                <>
                  <label className="lss__label">Blur Intensity — {theme.blurAmount}px</label>
                  <input
                    type="range" min={1} max={30} value={theme.blurAmount}
                    className="lss__range"
                    onChange={e => set({ blurAmount: Number(e.target.value) })}
                  />
                </>
              )}

              {theme.bgMode === 'image' && (
                <>
                  <input ref={imgInputRef} type="file" accept="image/*" hidden onChange={handleImageUpload} />
                  <button className="lss__upload-btn" onClick={() => imgInputRef.current?.click()}>
                    <Upload size={14} /> Upload Image
                  </button>
                  {theme.bgImage && (
                    <div className="lss__img-preview" style={{ backgroundImage: `url(${theme.bgImage})` }} />
                  )}
                </>
              )}

              {theme.bgMode !== 'default' && (
                <>
                  <label className="lss__label">Overlay Opacity — {Math.round(theme.overlayOpacity * 100)}%</label>
                  <input
                    type="range" min={0} max={100} value={Math.round(theme.overlayOpacity * 100)}
                    className="lss__range"
                    onChange={e => set({ overlayOpacity: Number(e.target.value) / 100 })}
                  />
                  <label className="lss__label">Overlay Color</label>
                  <div className="lss__color-row">
                    <input
                      type="color"
                      className="lss__color-pick"
                      value={theme.overlayColor}
                      onChange={e => set({ overlayColor: e.target.value })}
                    />
                    <span className="lss__color-hex">{theme.overlayColor}</span>
                  </div>
                </>
              )}
            </div>
          )}

          {/* ── Icon ────────────────────────────── */}
          {tab === 'icon' && (
            <div className="lss__section">
              <label className="lss__label">Icon Style</label>
              <div className="lss__icon-grid">
                {ICON_STYLES.map(s => (
                  <button
                    key={s.value}
                    className={`lss__icon-card${theme.iconStyle === s.value ? ' lss__icon-card--sel' : ''}`}
                    onClick={() => set({ iconStyle: s.value })}
                  >
                    <s.Icon size={20} />
                    <span>{s.label}</span>
                  </button>
                ))}
              </div>

              <label className="lss__label">Icon Color</label>
              <div className="lss__swatches">
                {COLOR_PRESETS.map(c => (
                  <button
                    key={c}
                    className={`lss__swatch${theme.iconColor === c ? ' lss__swatch--sel' : ''}`}
                    style={{ background: c }}
                    onClick={() => set({ iconColor: c })}
                  />
                ))}
                <input
                  type="color"
                  className="lss__color-pick"
                  value={theme.iconColor}
                  onChange={e => set({ iconColor: e.target.value })}
                />
              </div>

              <label className="lss__label">Icon Size — {theme.iconSize}px</label>
              <input
                type="range" min={20} max={64} value={theme.iconSize}
                className="lss__range"
                onChange={e => set({ iconSize: Number(e.target.value) })}
              />

              <label className="lss__label">Animation</label>
              <div className="lss__seg">
                {ANIMATIONS.map(a => (
                  <button
                    key={a.value}
                    className={`lss__seg-btn${theme.iconAnimation === a.value ? ' lss__seg-btn--sel' : ''}`}
                    onClick={() => set({ iconAnimation: a.value })}
                  >
                    {a.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* ── Text ────────────────────────────── */}
          {tab === 'text' && (
            <div className="lss__section">
              <label className="lss__label">Title</label>
              <input
                className="lss__text-input"
                value={theme.title}
                onChange={e => set({ title: e.target.value })}
                placeholder="Chat Locked"
                maxLength={40}
              />

              <label className="lss__label">Description</label>
              <input
                className="lss__text-input"
                value={theme.description}
                onChange={e => set({ description: e.target.value })}
                placeholder="Enter your PIN to open this conversation"
                maxLength={80}
              />

              <label className="lss__label">Text Color</label>
              <div className="lss__swatches">
                {COLOR_PRESETS.map(c => (
                  <button
                    key={c}
                    className={`lss__swatch${theme.textColor === c ? ' lss__swatch--sel' : ''}`}
                    style={{ background: c }}
                    onClick={() => set({ textColor: c })}
                  />
                ))}
                <input
                  type="color"
                  className="lss__color-pick"
                  value={theme.textColor}
                  onChange={e => set({ textColor: e.target.value })}
                />
              </div>
            </div>
          )}

          {/* ── Box ─────────────────────────────── */}
          {tab === 'box' && (
            <div className="lss__section">
              <label className="lss__label">Box Background</label>
              <div className="lss__color-row">
                <input
                  type="color"
                  className="lss__color-pick"
                  value={theme.boxBg}
                  onChange={e => set({ boxBg: e.target.value })}
                />
                <span className="lss__color-hex">{theme.boxBg}</span>
              </div>

              <label className="lss__label">Box Border</label>
              <div className="lss__color-row">
                <input
                  type="color"
                  className="lss__color-pick"
                  value={theme.boxBorder.startsWith('rgba') ? '#ffffff' : theme.boxBorder}
                  onChange={e => set({ boxBorder: e.target.value })}
                />
                <span className="lss__color-hex">{theme.boxBorder}</span>
              </div>

              <label className="lss__label">Border Radius — {theme.boxRadius}px</label>
              <input
                type="range" min={0} max={32} value={theme.boxRadius}
                className="lss__range"
                onChange={e => set({ boxRadius: Number(e.target.value) })}
              />

              <label className="lss__label">Box Glow — {theme.boxGlow}px</label>
              <input
                type="range" min={0} max={40} value={theme.boxGlow}
                className="lss__range"
                onChange={e => set({ boxGlow: Number(e.target.value) })}
              />

              {theme.boxGlow > 0 && (
                <>
                  <label className="lss__label">Glow Color</label>
                  <div className="lss__swatches">
                    {COLOR_PRESETS.map(c => (
                      <button
                        key={c}
                        className={`lss__swatch${theme.boxGlowColor === c ? ' lss__swatch--sel' : ''}`}
                        style={{ background: c }}
                        onClick={() => set({ boxGlowColor: c })}
                      />
                    ))}
                    <input
                      type="color"
                      className="lss__color-pick"
                      value={theme.boxGlowColor}
                      onChange={e => set({ boxGlowColor: e.target.value })}
                    />
                  </div>
                </>
              )}

              <div className="lss__divider" />
              <label className="lss__label" style={{ fontSize: '13px', fontWeight: 700 }}>Glass Effect</label>

              <label className="lss__label">Backdrop Blur — {theme.boxBlur}px</label>
              <input
                type="range" min={0} max={30} value={theme.boxBlur}
                className="lss__range"
                onChange={e => set({ boxBlur: Number(e.target.value) })}
              />

              <label className="lss__label">Box Opacity — {Math.round(theme.boxOpacity * 100)}%</label>
              <input
                type="range" min={0} max={100} value={Math.round(theme.boxOpacity * 100)}
                className="lss__range"
                onChange={e => set({ boxOpacity: Number(e.target.value) / 100 })}
              />

              {theme.boxBlur > 0 && (
                <div className="lss__glass-presets">
                  <label className="lss__label">Glass Presets</label>
                  <div className="lss__swatches">
                    <button className="lss__preset-btn" onClick={() => set({ boxBlur: 12, boxOpacity: 0.15, boxBorder: 'rgba(255,255,255,0.18)' })}>Frosted</button>
                    <button className="lss__preset-btn" onClick={() => set({ boxBlur: 20, boxOpacity: 0.05, boxBorder: 'rgba(255,255,255,0.1)' })}>Clear Glass</button>
                    <button className="lss__preset-btn" onClick={() => set({ boxBlur: 8, boxOpacity: 0.35, boxBorder: 'rgba(255,255,255,0.12)' })}>Tinted</button>
                    <button className="lss__preset-btn" onClick={() => set({ boxBlur: 0, boxOpacity: 1 })}>Solid</button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── Button ──────────────────────────── */}
          {tab === 'button' && (
            <div className="lss__section">
              <label className="lss__label">Button Color</label>
              <div className="lss__swatches">
                {COLOR_PRESETS.map(c => (
                  <button
                    key={c}
                    className={`lss__swatch${theme.buttonColor === c ? ' lss__swatch--sel' : ''}`}
                    style={{ background: c }}
                    onClick={() => set({ buttonColor: c })}
                  />
                ))}
                <input
                  type="color"
                  className="lss__color-pick"
                  value={theme.buttonColor}
                  onChange={e => set({ buttonColor: e.target.value })}
                />
              </div>

              <label className="lss__label">Button Text Color</label>
              <div className="lss__swatches">
                {['#ffffff', '#000000', '#e8e8f0', '#111111', '#f1f5f9'].map(c => (
                  <button
                    key={c}
                    className={`lss__swatch${theme.buttonText === c ? ' lss__swatch--sel' : ''}`}
                    style={{ background: c }}
                    onClick={() => set({ buttonText: c })}
                  />
                ))}
                <input
                  type="color"
                  className="lss__color-pick"
                  value={theme.buttonText}
                  onChange={e => set({ buttonText: e.target.value })}
                />
              </div>
            </div>
          )}

        </div>

        {/* Footer */}
        <div className="lss__footer">
          <button className="lss__reset" onClick={() => { store.resetTheme(convId); }}>
            Reset to Default
          </button>
        </div>
      </div>
    </div>
  );
}
