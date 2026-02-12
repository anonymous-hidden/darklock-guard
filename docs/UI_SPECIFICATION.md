# Darklock Guard v2 - UI/UX Specification

**Version:** 2.0.0  
**Date:** January 29, 2026  
**Design System:** Darklock Cyberpunk Premium

---

## 1. Design Philosophy

### Core Principles
1. **Premium Security Aesthetic:** Cyberpunk-inspired with professional polish, not gamified
2. **Radical Honesty:** Never fake capabilities; show real state always
3. **Fail-Visible:** Errors, warnings, and degraded states are prominent, not hidden
4. **Zero Dead Buttons:** Every interactive element works or explains why it can't
5. **Trust Through Transparency:** Security operations visible in real-time (event log streaming)

### Design Language
- **Tone:** Professional, confident, protective (not alarmist)
- **Motion:** Purposeful animations (status changes, security events), not decorative
- **Data Density:** Dense for power users, but layered (overview → details on demand)
- **Dark-First:** Security professionals work at night; optimize for low-light environments

---

## 2. Design Tokens

### Color Palette (From Website Theme)

```css
/* Primary Backgrounds */
--bg-primary: #0a0e17;        /* Main app background */
--bg-secondary: #0f1420;      /* Sidebar, panels */
--bg-tertiary: #151c2c;       /* Cards, elevated surfaces */
--bg-card: rgba(21, 28, 44, 0.7);  /* Translucent cards */
--bg-card-solid: #1a2235;     /* Opaque cards */

/* Accent Colors (Cyberpunk Trio) */
--accent-primary: #00f0ff;    /* Cyan - primary actions, active states */
--accent-secondary: #7c3aed;  /* Purple - secondary actions, highlights */
--accent-tertiary: #ec4899;   /* Pink - tertiary accents, warnings */
--accent-gradient: linear-gradient(135deg, #00f0ff 0%, #7c3aed 50%, #ec4899 100%);

/* Text Hierarchy */
--text-primary: #ffffff;      /* Headings, primary content */
--text-secondary: #94a3b8;    /* Body text, labels */
--text-muted: #64748b;        /* Hints, disabled text */

/* Semantic Colors */
--success: #10b981;           /* Protected, healthy, success actions */
--warning: #f59e0b;           /* Degraded, needs attention */
--error: #ef4444;             /* Critical, unsafe, failed */
--info: #00f0ff;              /* Informational, neutral status */

/* State-Specific Colors */
--zerotrust: #ec4899;         /* Zero-Trust mode indicator (pink) */
--safemode: #f59e0b;          /* Safe Mode indicator (amber) */
--disconnected: #64748b;      /* Disconnected state (muted) */

/* Borders & Dividers */
--border-color: rgba(148, 163, 184, 0.1);  /* Default borders */
--border-glow: rgba(0, 240, 255, 0.3);     /* Active/focus borders */

/* Elevation & Shadows */
--shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.3);
--shadow-md: 0 4px 6px -1px rgba(0, 0, 0, 0.4);
--shadow-lg: 0 10px 15px -3px rgba(0, 0, 0, 0.5);
--shadow-xl: 0 20px 25px -5px rgba(0, 0, 0, 0.5);
--shadow-glow: 0 0 30px rgba(0, 240, 255, 0.2);  /* Accent glow for important elements */
```

### Typography

```css
/* Font Families */
--font-sans: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
--font-mono: 'JetBrains Mono', 'Fira Code', monospace;  /* For IDs, hashes, logs */

/* Font Sizes */
--text-xs: 0.75rem;      /* 12px - tiny labels, badge text */
--text-sm: 0.875rem;     /* 14px - body text, table cells */
--text-base: 1rem;       /* 16px - default body */
--text-lg: 1.125rem;     /* 18px - subheadings */
--text-xl: 1.25rem;      /* 20px - section headings */
--text-2xl: 1.5rem;      /* 24px - page headings */
--text-3xl: 1.875rem;    /* 30px - hero text */

/* Font Weights */
--font-normal: 400;
--font-medium: 500;
--font-semibold: 600;
--font-bold: 700;

/* Line Heights */
--leading-tight: 1.25;
--leading-normal: 1.5;
--leading-relaxed: 1.75;
```

### Spacing & Layout

```css
/* Spacing Scale */
--space-xs: 0.25rem;   /* 4px */
--space-sm: 0.5rem;    /* 8px */
--space-md: 1rem;      /* 16px */
--space-lg: 1.5rem;    /* 24px */
--space-xl: 2rem;      /* 32px */
--space-2xl: 3rem;     /* 48px */
--space-3xl: 4rem;     /* 64px */

/* Border Radius */
--radius-sm: 0.375rem;  /* 6px - badges, small buttons */
--radius-md: 0.5rem;    /* 8px - buttons, inputs */
--radius-lg: 0.75rem;   /* 12px - cards, panels */
--radius-xl: 1rem;      /* 16px - modals, large cards */
--radius-full: 9999px;  /* Circular elements */

/* Layout Constants */
--sidebar-width: 240px;
--topbar-height: 64px;
--content-max-width: 1400px;
```

### Animations & Transitions

```css
/* Timing Functions */
--transition-fast: 150ms ease;
--transition-base: 250ms ease;
--transition-slow: 400ms ease;

/* Animation Presets */
--anim-slide-in: slide-in 300ms cubic-bezier(0.16, 1, 0.3, 1);
--anim-fade-in: fade-in 200ms ease-out;
--anim-scale-in: scale-in 200ms cubic-bezier(0.16, 1, 0.3, 1);

/* Pulse for live indicators */
@keyframes pulse-glow {
    0%, 100% { opacity: 1; box-shadow: 0 0 10px var(--accent-primary); }
    50% { opacity: 0.7; box-shadow: 0 0 20px var(--accent-primary); }
}
```

---

## 3. Layout Structure

### Application Shell

```
┌──────────────────────────────────────────────────────┐
│ TOPBAR (64px height)                                 │
│ [Logo] [Breadcrumb] ············ [Status] [Profile] │
├──────┬───────────────────────────────────────────────┤
│      │                                               │
│      │                                               │
│  S   │         MAIN CONTENT AREA                     │
│  I   │         (Scrollable)                          │
│  D   │                                               │
│  E   │                                               │
│  B   │                                               │
│  A   │                                               │
│  R   │                                               │
│      │                                               │
│ 240  │                                               │
│  px  │                                               │
│      │                                               │
└──────┴───────────────────────────────────────────────┘
```

### Topbar Components

**Left Section:**
- Logo + "Darklock Guard" wordmark (20px height)
- Breadcrumb trail (Home > Protection > Scans)

**Right Section:**
- **Global Status Indicator** - Live connection state with pulsing glow
  - Connected: Cyan glow, "PROTECTED" 
  - Zero-Trust: Pink glow, "ZERO-TRUST MODE"
  - Safe Mode: Amber glow, "SAFE MODE"
  - Disconnected: Gray, "DISCONNECTED"
- Profile Avatar → Dropdown (Settings, Lock, Logout)

### Sidebar Navigation

**Structure:**
```
[DARKLOCK GUARD LOGO]

─────────────────
MAIN
─────────────────
→ Status              [Shield Icon]
  Protection          [Lock Icon]
  Scans               [Search Icon]
  Events              [List Icon]

─────────────────
FEATURES
─────────────────
  Device Control      [USB Icon]
  Updates             [Download Icon]
  
─────────────────
SYSTEM
─────────────────
  Settings            [Gear Icon]
  Support & About     [Info Icon]

─────────────────
[Beta Badge]
v2.0.0
```

**Interaction States:**
- **Active:** Left border (4px cyan), bg-tertiary, text-primary
- **Hover:** bg-secondary, text-primary
- **Inactive:** text-secondary
- **Disabled:** text-muted + tooltip on hover explaining why

**Badge Indicators:**
- New events: Small cyan dot on "Events"
- Update available: Amber dot on "Updates"
- Attention needed: Red dot on section

---

## 4. Screen-by-Screen Specifications

### 4.1 Status (Dashboard)

**Purpose:** At-a-glance security posture and recent activity

**Layout:**
```
┌─────────────────────────────────────────────────────┐
│ STATUS                                   [Refresh]  │
├─────────────────────────────────────────────────────┤
│                                                     │
│ ┌─────────────────────────────────────────────┐   │
│ │ PROTECTION STATUS                            │   │
│ │ ┌─────────┐ ┌─────────┐ ┌─────────┐        │   │
│ │ │ Vault   │ │ Guard   │ │ Updates │        │   │
│ │ │ 🔒 OK   │ │ 🛡️ ON  │ │ ✓ Current│       │   │
│ │ └─────────┘ └─────────┘ └─────────┘        │   │
│ └─────────────────────────────────────────────┘   │
│                                                     │
│ ┌─────────────────────────────────────────────┐   │
│ │ SECURITY PROFILE                             │   │
│ │ Local • Zero-Trust                           │   │
│ │ [!] Ultra-sensitive: vault locks on suspend  │   │
│ └─────────────────────────────────────────────┘   │
│                                                     │
│ ┌─────────────────────────────────────────────┐   │
│ │ RECENT EVENTS (Last 24h)                     │   │
│ │ ● 14:23 — File scan completed (0 threats)    │   │
│ │ ● 12:05 — Vault unlocked by user             │   │
│ │ ● 09:17 — Update check (no updates)          │   │
│ │ [View All Events →]                          │   │
│ └─────────────────────────────────────────────┘   │
│                                                     │
│ ┌────────────┐ ┌────────────┐                     │
│ │ QUICK      │ │ DEVICE     │                     │
│ │ SCAN       │ │ INFO       │                     │
│ │ [Scan Now] │ │ Device ID  │                     │
│ └────────────┘ │ ABCD-1234  │                     │
│                └────────────┘                      │
└─────────────────────────────────────────────────────┘
```

**Components:**

1. **Status Cards (3-column grid)**
   - Card: `bg-card`, `border: 1px solid border-color`, `radius-lg`
   - Icon: Large (32px), accent-primary
   - Title: `text-sm`, `text-secondary`
   - Status: `text-2xl`, `font-bold`, color based on state
   - States:
     - Healthy: Green text, no border glow
     - Degraded: Amber text, amber border-glow
     - Critical: Red text, pulsing red border-glow

2. **Security Profile Banner**
   - Background: `bg-card` with gradient if Zero-Trust (pink glow)
   - Mode badge: Pill-shaped, `bg-accent-primary` (cyan) or `bg-zerotrust` (pink)
   - Warning icon + message if special mode active

3. **Recent Events List**
   - Live-updating (new events slide in from top)
   - Each event: timestamp (monospace) + icon + description
   - Severity colors: Info (cyan), Warning (amber), Error (red)
   - "View All" button links to Events screen

4. **Quick Action Cards**
   - Large button with icon + label
   - Hover: `scale(1.02)` + `shadow-glow`
   - Disabled: Gray + tooltip ("Scan in progress" or "No scan engine loaded")

**State Variations:**

- **Normal Mode:**
  - Status cards all green/cyan
  - No warning banners
  - All features enabled

- **Zero-Trust Mode:**
  - Top banner: Pink gradient, "⚠️ ZERO-TRUST MODE ACTIVE - Vault locks on suspend, extra validation required"
  - Status indicator in topbar: Pink pulsing
  - Some features restricted (tooltip explains)

- **Safe Mode:**
  - Top banner: Amber gradient, "⚠️ SAFE MODE - Service detected crash loop, limited functionality"
  - All protection features show "Unavailable in Safe Mode" with [Exit Safe Mode] button
  - Events log still accessible (read-only)

- **Disconnected (Local-Only):**
  - Gray "OFFLINE" badge
  - Cloud features disabled/hidden
  - Tooltip: "Connected features unavailable in Local mode"

---

### 4.2 Protection

**Purpose:** Configure vault, encryption, and security policies

**Layout:**
```
┌─────────────────────────────────────────────────────┐
│ PROTECTION                          [Lock Vault]   │
├─────────────────────────────────────────────────────┤
│                                                     │
│ ┌─────────────────────────────────────────────┐   │
│ │ VAULT STATUS                                 │   │
│ │ 🔓 Unlocked                                  │   │
│ │ Last unlocked: 2h 15m ago                    │   │
│ │                                              │   │
│ │ [Lock Now]  [Change Password]  [Settings]   │   │
│ └─────────────────────────────────────────────┘   │
│                                                     │
│ ┌─────────────────────────────────────────────┐   │
│ │ SECURITY PROFILE                             │   │
│ │                                              │   │
│ │ ● Standard                                   │   │
│ │   Normal security (recommended)              │   │
│ │                                              │   │
│ │ ○ Zero-Trust                                 │   │
│ │   Ultra-secure: vault locks on suspend,      │   │
│ │   crash loop protection, extra validation    │   │
│ │   [!] May interrupt workflow                 │   │
│ │                                              │   │
│ │ [Apply Changes]                              │   │
│ └─────────────────────────────────────────────┘   │
│                                                     │
│ ┌─────────────────────────────────────────────┐   │
│ │ AUTO-LOCK SETTINGS                           │   │
│ │                                              │   │
│ │ Lock vault after:                            │   │
│ │ [▼ 15 minutes of inactivity]                │   │
│ │                                              │   │
│ │ ☑ Lock on system suspend                     │   │
│ │ ☑ Lock on screen lock                        │   │
│ │ ☐ Lock on lid close (Zero-Trust only)       │   │
│ └─────────────────────────────────────────────┘   │
│                                                     │
│ ┌─────────────────────────────────────────────┐   │
│ │ DEVICE BINDING                               │   │
│ │                                              │   │
│ │ Device ID: ABCD-1234-EFGH-5678               │   │
│ │ Bound on: Jan 15, 2026                       │   │
│ │                                              │   │
│ │ [Copy ID]  [Regenerate (Advanced)]          │   │
│ │                                              │   │
│ │ ⓘ This device ID binds your vault to this   │   │
│ │   hardware. Keep it safe for recovery.       │   │
│ └─────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────┘
```

**Key Components:**

1. **Vault Status Card**
   - Lock icon: Animated (open → closed transition)
   - Status badge: Large, colored (green = unlocked, red = locked)
   - Timestamp: Relative time since last state change
   - Action buttons: Primary style if vault unlocked

2. **Security Profile Selector**
   - Radio buttons with detailed descriptions
   - Warning badge for Zero-Trust (amber background)
   - "Apply Changes" button only enabled if changed

3. **Auto-Lock Settings**
   - Dropdown for timeout (5m, 15m, 30m, 1h, Never)
   - Checkboxes for trigger conditions
   - Some checkboxes conditionally enabled (e.g., lid close only in Zero-Trust)
   - Tooltip on disabled: "Available only in Zero-Trust mode"

4. **Device Binding Card**
   - Monospace Device ID (selectable text)
   - Copy button with success feedback
   - Info box explaining purpose
   - "Regenerate" in red (requires confirmation modal)

**State Variations:**

- **Vault Locked:**
  - Lock icon closed
  - Most actions disabled except "Unlock"
  - Explanation: "Unlock vault to change settings"

- **Safe Mode:**
  - All settings grayed out
  - Banner: "Protection settings unavailable in Safe Mode. [Exit Safe Mode]"

---

### 4.3 Scans

**Purpose:** File integrity scanning and threat detection

**Layout:**
```
┌─────────────────────────────────────────────────────┐
│ SCANS                              [New Scan ▼]    │
├─────────────────────────────────────────────────────┤
│                                                     │
│ ┌─────────────────────────────────────────────┐   │
│ │ SCAN STATUS                                  │   │
│ │ ○ Idle                                       │   │
│ │ No scan running                              │   │
│ │                                              │   │
│ │ [Quick Scan]  [Full Scan]  [Custom...]      │   │
│ └─────────────────────────────────────────────┘   │
│                                                     │
│ ┌─────────────────────────────────────────────┐   │
│ │ SCAN HISTORY                                 │   │
│ │ ┌─────────────────────────────────────────┐ │   │
│ │ │ Date         Type      Files   Threats  │ │   │
│ │ ├─────────────────────────────────────────┤ │   │
│ │ │ Jan 29 14:23 Quick     1,423   0 ✓     │ │   │
│ │ │ Jan 28 10:15 Full     12,567   1 ⚠️    │ │   │
│ │ │ Jan 27 18:45 Custom    3,891   0 ✓     │ │   │
│ │ └─────────────────────────────────────────┘ │   │
│ │ [View Details] on hover                      │   │
│ └─────────────────────────────────────────────┘   │
│                                                     │
│ ⓘ File integrity scanning not yet implemented.     │
│   This screen shows planned UI only.                │
└─────────────────────────────────────────────────────┘
```

**States:**

1. **Idle (No Scan Running):**
   - Status: Gray circle, "Idle"
   - Action buttons enabled

2. **Scan in Progress:**
   - Status: Cyan pulsing circle, "Scanning..."
   - Progress bar: `0% ━━━━━━━━ 100%`
   - Live counters: Files scanned, Threats found
   - [Cancel] button (secondary, destructive)

3. **Not Implemented (Current State):**
   - Info banner at bottom: Blue background
   - "This feature is planned but not yet available. UI preview only."
   - All action buttons show tooltip: "Scan engine not implemented yet"

**Honesty Rule:** If no scan engine exists, **do not fake it**. Show empty state with roadmap link.

---

### 4.4 Events (Audit Log)

**Purpose:** Real-time security event stream with filtering

**Layout:**
```
┌─────────────────────────────────────────────────────┐
│ EVENTS                [Filter ▼] [Export] [Clear]  │
├─────────────────────────────────────────────────────┤
│                                                     │
│ ┌───────────────────────────────────────────────┐ │
│ │ [Search events..............................]  │ │
│ │ Filters: [All] [Info] [Warning] [Error]     │ │
│ └───────────────────────────────────────────────┘ │
│                                                     │
│ ┌─────────────────────────────────────────────┐   │
│ │ EVENT LOG (Live)                   ● LIVE   │   │
│ │ ┌───────────────────────────────────────┐   │   │
│ │ │ 14:23:45  ●  File scan completed      │   │   │
│ │ │              0 threats detected        │   │   │
│ │ │              [View Details]            │   │   │
│ │ ├───────────────────────────────────────┤   │   │
│ │ │ 12:05:12  ●  Vault unlocked           │   │   │
│ │ │              User: admin               │   │   │
│ │ ├───────────────────────────────────────┤   │   │
│ │ │ 09:17:03  ⚠️  Update check failed     │   │   │
│ │ │              Network timeout           │   │   │
│ │ │              [Retry]                   │   │   │
│ │ ├───────────────────────────────────────┤   │   │
│ │ │ 08:45:22  🛡️  Service started         │   │   │
│ │ │              Version 2.0.0             │   │   │
│ │ └───────────────────────────────────────┘   │   │
│ │                                             │   │
│ │ [Load More (Older Events)]                  │   │
│ └─────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────┘
```

**Key Features:**

1. **Live Indicator**
   - Pulsing cyan dot when connected
   - "LIVE" badge in topbar
   - New events slide in from top with highlight animation

2. **Event Cards**
   - Timestamp: Monospace, `text-muted`
   - Severity icon: Colored dot (info=cyan, warning=amber, error=red)
   - Event type: Bold, `text-primary`
   - Details: `text-secondary`, collapsible
   - Actions: Inline buttons for contextual actions

3. **Filters**
   - Chip-style toggles (active = filled, inactive = outline)
   - Search: Real-time filter as you type
   - Dropdown for time range (Last hour, Today, 7 days, All)

4. **Export**
   - Modal: "Export Events"
   - Format: [JSON] [CSV]
   - Range: Date picker
   - [Download] button

**State Variations:**

- **Disconnected:**
  - "LIVE" changes to "OFFLINE" (gray)
  - Events cached locally, no new updates
  - Info banner: "Reconnect to receive live events"

- **Safe Mode:**
  - Events still visible (read-only)
  - No "Clear" button (can't modify)

- **Empty State:**
  - Illustration + "No events yet"
  - "Events will appear here as actions occur"

---

### 4.5 Device Control

**Purpose:** Manage USB device policies (future feature)

**Layout:**
```
┌─────────────────────────────────────────────────────┐
│ DEVICE CONTROL                                      │
├─────────────────────────────────────────────────────┤
│                                                     │
│ ┌─────────────────────────────────────────────┐   │
│ │ ⓘ PLANNED FEATURE                            │   │
│ │                                              │   │
│ │ Device control (USB policy enforcement) is   │   │
│ │ planned for a future release.                │   │
│ │                                              │   │
│ │ Planned capabilities:                        │   │
│ │ • Block unauthorized USB devices             │   │
│ │ • Whitelist trusted devices by serial       │   │
│ │ • Audit device connection events             │   │
│ │                                              │   │
│ │ [Track Progress on GitHub →]                │   │
│ └─────────────────────────────────────────────┘   │
│                                                     │
│ (Preview UI below - non-functional)                 │
│                                                     │
│ ┌─────────────────────────────────────────────┐   │
│ │ CONNECTED DEVICES                            │   │
│ │ ┌──────────────────────────────────────┐    │   │
│ │ │ [USB Icon] SanDisk USB 3.0           │    │   │
│ │ │ Serial: 1234ABCD • Allowed           │    │   │
│ │ └──────────────────────────────────────┘    │   │
│ │ (Grayed out - not implemented)               │   │
│ └─────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────┘
```

**Honesty Rule:** Large banner at top explains this is a planned feature with roadmap link. UI preview shown below (grayed) for feedback.

---

### 4.6 Updates

**Purpose:** Manage Darklock Guard software updates

**Layout:**
```
┌─────────────────────────────────────────────────────┐
│ UPDATES                         [Check Now]        │
├─────────────────────────────────────────────────────┤
│                                                     │
│ ┌─────────────────────────────────────────────┐   │
│ │ CURRENT VERSION                              │   │
│ │ v2.0.0                                       │   │
│ │ Released: Jan 15, 2026                       │   │
│ │ ✓ You're up to date                          │   │
│ └─────────────────────────────────────────────┘   │
│                                                     │
│ ┌─────────────────────────────────────────────┐   │
│ │ UPDATE SETTINGS                              │   │
│ │                                              │   │
│ │ ● Check automatically                        │   │
│ │ ○ Notify but don't download                  │   │
│ │ ○ Manual only                                │   │
│ │                                              │   │
│ │ ☑ Download updates over metered connections │   │
│ └─────────────────────────────────────────────┘   │
│                                                     │
│ ┌─────────────────────────────────────────────┐   │
│ │ RELEASE CHANNEL                              │   │
│ │ ● Stable (recommended)                       │   │
│ │ ○ Beta (early access, may be unstable)       │   │
│ └─────────────────────────────────────────────┘   │
│                                                     │
│ ┌─────────────────────────────────────────────┐   │
│ │ UPDATE HISTORY                               │   │
│ │ v2.0.0 — Jan 15, 2026                        │   │
│ │ v1.9.1 — Dec 20, 2025                        │   │
│ │ [View Changelog]                             │   │
│ └─────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────┘
```

**Update Flow (When Available):**

```
┌─────────────────────────────────────────────────────┐
│ UPDATE AVAILABLE                                    │
│                                                     │
│ v2.1.0 is now available                             │
│                                                     │
│ What's New:                                         │
│ • Fixed vault corruption on power loss              │
│ • Improved IPC authentication                       │
│ • New: Event log export                             │
│                                                     │
│ Release Notes: [View Full Changelog →]             │
│                                                     │
│ [Download & Install] [Remind Me Later] [Skip]      │
└─────────────────────────────────────────────────────┘
```

**Installing State:**

```
┌─────────────────────────────────────────────────────┐
│ INSTALLING UPDATE                                   │
│                                                     │
│ ● Downloading v2.1.0...                             │
│ [████████████████░░░░] 78%                          │
│                                                     │
│ ✓ Package verified (SHA-256 + signature)            │
│ ✓ Updater integrity check passed                    │
│ ⏳ Installing...                                     │
│                                                     │
│ The app will restart automatically.                 │
│ Your vault will remain locked during update.        │
│                                                     │
│ [Cancel Update]                                     │
└─────────────────────────────────────────────────────┘
```

**Post-Update (Success):**

```
┌─────────────────────────────────────────────────────┐
│ ✓ UPDATE SUCCESSFUL                                 │
│                                                     │
│ Darklock Guard v2.1.0 is now installed.             │
│                                                     │
│ [View Changelog] [Continue]                         │
└─────────────────────────────────────────────────────┘
```

**Post-Update (Rollback):**

```
┌─────────────────────────────────────────────────────┐
│ ⚠️ UPDATE ROLLED BACK                                │
│                                                     │
│ v2.1.0 failed post-install checks and was           │
│ automatically rolled back to v2.0.0.                 │
│                                                     │
│ Your data is safe. Please report this issue.        │
│                                                     │
│ Error: Service failed to start after update         │
│                                                     │
│ [Report Issue] [View Logs] [Dismiss]                │
└─────────────────────────────────────────────────────┘
```

**State Variations:**

- **Update Available:** Amber dot in sidebar, notification card at top of screen
- **Revoked Release:** Red banner, "This version was revoked for security reasons. Update immediately."
- **Disconnected:** "Cannot check for updates while offline"

---

### 4.7 Settings

**Purpose:** App preferences and advanced configuration

**Layout (Tabbed):**
```
┌─────────────────────────────────────────────────────┐
│ SETTINGS                                            │
├─────────────────────────────────────────────────────┤
│ [General] [Security] [Appearance] [Advanced]       │
├─────────────────────────────────────────────────────┤
│                                                     │
│ GENERAL TAB                                         │
│                                                     │
│ Launch at startup                                   │
│ ☑ Start Darklock Guard when I log in               │
│ ☑ Start minimized to system tray                   │
│                                                     │
│ Notifications                                       │
│ ☑ Show desktop notifications for critical events   │
│ ☐ Show notifications for all events                │
│                                                     │
│ Language                                            │
│ [English (US) ▼]                                    │
│                                                     │
│ ─────────────────────────────────────────────────  │
│                                                     │
│ SECURITY TAB                                        │
│                                                     │
│ Master Password                                     │
│ [Change Password...]                                │
│                                                     │
│ Two-Factor Authentication (Planned)                 │
│ ⓘ TOTP support coming in v2.1                      │
│ [Configure 2FA] (disabled)                          │
│                                                     │
│ Device Binding                                      │
│ Device ID: ABCD-1234 [Copy]                         │
│ [Regenerate Device ID...] (requires confirmation)   │
│                                                     │
│ ─────────────────────────────────────────────────  │
│                                                     │
│ APPEARANCE TAB                                      │
│                                                     │
│ Theme                                               │
│ ● Dark (Cyberpunk) — default                        │
│ ○ OLED Black — pure black backgrounds              │
│                                                     │
│ Accent Color                                        │
│ ● Cyan (default)                                    │
│ ○ Purple                                            │
│ ○ Pink                                              │
│                                                     │
│ Font Size                                           │
│ [─────●─────] Medium                                │
│                                                     │
│ Animations                                          │
│ ☑ Enable UI animations                             │
│ ☑ Reduce motion (accessibility)                    │
│                                                     │
│ ─────────────────────────────────────────────────  │
│                                                     │
│ ADVANCED TAB                                        │
│                                                     │
│ ⚠️ Advanced settings - for experts only             │
│                                                     │
│ IPC Socket Path                                     │
│ /var/run/darklock/guard.sock [Reset to default]    │
│                                                     │
│ Event Log Rotation                                  │
│ Rotate at: [50 MB ▼]                                │
│ Keep: [5 files ▼]                                   │
│                                                     │
│ Debug Mode                                          │
│ ☐ Enable verbose logging                           │
│ ⚠️ May impact performance and log sensitive data    │
│                                                     │
│ Data Management                                     │
│ [Export Vault Metadata...] [Clear Event Log...]    │
│                                                     │
└─────────────────────────────────────────────────────┘
```

**Key Principles:**

- **Tabs:** Horizontal tabs at top, underline indicator for active tab
- **Sections:** Clear headings with spacing
- **Dangerous Actions:** Red text + confirmation modal (e.g., "Regenerate Device ID")
- **Disabled Settings:** Gray + tooltip explaining why ("Feature not implemented" or "Requires Zero-Trust mode")

---

### 4.8 Support & About

**Purpose:** Help resources and app information

**Layout:**
```
┌─────────────────────────────────────────────────────┐
│ SUPPORT & ABOUT                                     │
├─────────────────────────────────────────────────────┤
│                                                     │
│ ┌─────────────────────────────────────────────┐   │
│ │ DARKLOCK GUARD                               │   │
│ │ [Shield Logo]                                │   │
│ │                                              │   │
│ │ Version 2.0.0                                │   │
│ │ Released: January 15, 2026                   │   │
│ │                                              │   │
│ │ © 2026 Darklock Security                     │   │
│ │ Licensed under MIT                           │   │
│ └─────────────────────────────────────────────┘   │
│                                                     │
│ ┌─────────────────────────────────────────────┐   │
│ │ SUPPORT                                      │   │
│ │ [📖 Documentation]  [💬 Discord]             │   │
│ │ [🐛 Report Bug]     [💡 Request Feature]     │   │
│ └─────────────────────────────────────────────┘   │
│                                                     │
│ ┌─────────────────────────────────────────────┐   │
│ │ SYSTEM INFORMATION                           │   │
│ │ OS: Linux 6.2.0 (Ubuntu 24.04)               │   │
│ │ Architecture: x86_64                         │   │
│ │ Service Status: Running (PID 1234)           │   │
│ │ Uptime: 2 days 4h 15m                        │   │
│ │                                              │   │
│ │ [Copy System Info] [View Logs]               │   │
│ └─────────────────────────────────────────────┘   │
│                                                     │
│ ┌─────────────────────────────────────────────┐   │
│ │ THIRD-PARTY LICENSES                         │   │
│ │ [View Open Source Licenses]                  │   │
│ └─────────────────────────────────────────────┘   │
│                                                     │
│ ┌─────────────────────────────────────────────┐   │
│ │ ⚠️ BETA SOFTWARE                             │   │
│ │                                              │   │
│ │ Darklock Guard v2 is in active development.  │   │
│ │ Expect bugs, breaking changes, and missing   │   │
│ │ features. Always keep backups.                │   │
│ │                                              │   │
│ │ [View Roadmap] [Known Issues]                │   │
│ └─────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────┘
```

**Beta Badge Microcopy:**
- Persistent amber "BETA" badge in sidebar footer
- Tooltip: "v2.0.0 is beta software. Report bugs to improve stability."

---

## 5. First-Run Wizard

**Purpose:** Onboard new users and set up vault

### Wizard Flow

```
Screen 1: Welcome
  ↓
Screen 2: Choose Mode (Local vs Connected)
  ↓
Screen 3: Create Vault (Password + Device Binding)
  ↓
Screen 4: Security Profile (Standard vs Zero-Trust)
  ↓
Screen 5: Complete + Optional Tour
```

---

### Screen 1: Welcome

```
┌─────────────────────────────────────────────────────┐
│                                                     │
│         [Darklock Shield Logo - Large]              │
│                                                     │
│           WELCOME TO DARKLOCK GUARD                 │
│                                                     │
│     Your personal security vault and system         │
│     protection toolkit.                             │
│                                                     │
│     This wizard will set up your vault in           │
│     under 2 minutes.                                │
│                                                     │
│                                                     │
│                    [Get Started →]                  │
│                    [Import Existing Vault]          │
│                                                     │
└─────────────────────────────────────────────────────┘
```

**Style:**
- Centered content
- Large logo (128px)
- Gradient text on heading
- "Get Started" button: Primary style (cyan glow)
- "Import" link: Secondary, text-only

---

### Screen 2: Choose Mode

```
┌─────────────────────────────────────────────────────┐
│                                                     │
│               CHOOSE YOUR MODE                      │
│                                                     │
│     How do you want to use Darklock Guard?          │
│                                                     │
│ ┌─────────────────────┐ ┌─────────────────────┐   │
│ │                     │ │                     │   │
│ │   💻 LOCAL ONLY     │ │   ☁️ CONNECTED       │   │
│ │                     │ │                     │   │
│ │ Everything stored   │ │ Sync vault across   │   │
│ │ on this device.     │ │ devices (coming     │   │
│ │ Maximum privacy.    │ │ soon).              │   │
│ │                     │ │                     │   │
│ │ ✓ No account needed │ │ • Requires account  │   │
│ │ ✓ Fully offline     │ │ • Cloud backup      │   │
│ │ ✓ Fast setup        │ │ • (Not yet ready)   │   │
│ │                     │ │                     │   │
│ │   [Choose Local]    │ │   [Coming Soon]     │   │
│ │                     │ │   (disabled)        │   │
│ └─────────────────────┘ └─────────────────────┘   │
│                                                     │
│                    [← Back]                         │
│                                                     │
└─────────────────────────────────────────────────────┘
```

**Interaction:**
- Two large cards, side-by-side
- Hover: `scale(1.03)` + glow
- "Connected" card: Grayed out, "Coming Soon" badge
- Tooltip on hover: "Connected mode (cloud sync) is planned for v2.2"

**Honesty:** If connected mode doesn't exist yet, **don't let user select it**. Show roadmap timeline.

---

### Screen 3: Create Vault

```
┌─────────────────────────────────────────────────────┐
│                                                     │
│              CREATE YOUR VAULT                      │
│                                                     │
│     Your vault protects secrets with strong         │
│     encryption. Choose a master password you'll     │
│     remember forever — there's no recovery.         │
│                                                     │
│ ┌─────────────────────────────────────────────┐   │
│ │ Master Password                              │   │
│ │ [...................................]  👁️   │   │
│ │                                              │   │
│ │ Strength: [████████░░░░] Strong              │   │
│ └─────────────────────────────────────────────┘   │
│                                                     │
│ ┌─────────────────────────────────────────────┐   │
│ │ Confirm Password                             │   │
│ │ [...................................]  👁️   │   │
│ └─────────────────────────────────────────────┘   │
│                                                     │
│ ┌─────────────────────────────────────────────┐   │
│ │ ⚠️ PASSWORD RECOVERY IS IMPOSSIBLE           │   │
│ │                                              │   │
│ │ If you forget this password, your vault is   │   │
│ │ permanently locked. Write it down somewhere  │   │
│ │ safe (not digitally).                        │   │
│ │                                              │   │
│ │ ☑ I understand there is no password recovery │   │
│ └─────────────────────────────────────────────┘   │
│                                                     │
│                [← Back]  [Create Vault →]           │
│                                                     │
└─────────────────────────────────────────────────────┘
```

**Password Strength Meter:**
- Real-time as user types
- Colors: Red (weak), Amber (medium), Green (strong)
- Criteria shown below:
  - ✓ At least 12 characters
  - ✓ Contains uppercase and lowercase
  - ✓ Contains numbers
  - ✓ Contains symbols

**"Create Vault" button:**
- Disabled until:
  - Passwords match
  - Strength ≥ "Strong"
  - Checkbox checked

---

### Screen 4: Security Profile

```
┌─────────────────────────────────────────────────────┐
│                                                     │
│            CHOOSE SECURITY PROFILE                  │
│                                                     │
│     How sensitive is your data?                     │
│                                                     │
│ ┌─────────────────────────────────────────────┐   │
│ │ ● STANDARD (Recommended)                     │   │
│ │                                              │   │
│ │   Balanced security and convenience.         │   │
│ │                                              │   │
│ │   • Vault locks after 15 min inactivity      │   │
│ │   • Locks on screen lock                     │   │
│ │   • Background protection                    │   │
│ │                                              │   │
│ │   Best for: Most users                       │   │
│ └─────────────────────────────────────────────┘   │
│                                                     │
│ ┌─────────────────────────────────────────────┐   │
│ │ ○ ZERO-TRUST (Maximum Security)              │   │
│ │                                              │   │
│ │   Ultra-secure, may interrupt workflow.      │   │
│ │                                              │   │
│ │   • Vault locks on ANY suspend/sleep         │   │
│ │   • Crash loop detection (auto Safe Mode)    │   │
│ │   • Extra validation for all operations      │   │
│ │   • May require frequent re-authentication   │   │
│ │                                              │   │
│ │   Best for: High-risk environments           │   │
│ │                                              │   │
│ │   ⚠️ This mode can be disruptive. You can    │   │
│ │      switch back anytime in Settings.        │   │
│ └─────────────────────────────────────────────┘   │
│                                                     │
│                [← Back]  [Continue →]               │
│                                                     │
└─────────────────────────────────────────────────────┘
```

**Radio Selection:**
- Standard: Pre-selected
- Zero-Trust: Warning icon + explanation

---

### Screen 5: Complete

```
┌─────────────────────────────────────────────────────┐
│                                                     │
│         ✓ YOUR VAULT IS READY                       │
│                                                     │
│     Darklock Guard is now protecting your system.   │
│                                                     │
│ ┌─────────────────────────────────────────────┐   │
│ │ 📝 IMPORTANT INFORMATION                     │   │
│ │                                              │   │
│ │ Device ID: ABCD-1234-EFGH-5678               │   │
│ │                                              │   │
│ │ This ID binds your vault to this hardware.   │   │
│ │ Keep it safe — you'll need it for recovery.  │   │
│ │                                              │   │
│ │ [Copy Device ID]  [Save to File]            │   │
│ └─────────────────────────────────────────────┘   │
│                                                     │
│ ┌─────────────────────────────────────────────┐   │
│ │ NEXT STEPS                                   │   │
│ │                                              │   │
│ │ ☐ Take a quick tour of the interface         │   │
│ │ ☐ Set up auto-lock preferences               │   │
│ │ ☐ Learn about event logging                  │   │
│ │                                              │   │
│ │ [Start Tour]  [Skip to Dashboard]            │   │
│ └─────────────────────────────────────────────┘   │
│                                                     │
└─────────────────────────────────────────────────────┘
```

**Actions:**
- "Start Tour" → Launch interactive tour overlays
- "Skip to Dashboard" → Go directly to Status screen

---

## 6. Interactive Tour Overlays

**Purpose:** Teach new users key features without overwhelming

### Tour Structure (5 Steps)

```
Step 1: Sidebar Navigation
  ↓
Step 2: Status Dashboard
  ↓
Step 3: Vault Lock/Unlock
  ↓
Step 4: Events Log
  ↓
Step 5: Settings & Help
```

**Overlay Design:**
```
┌─────────────────────────────────────────────────────┐
│                                                     │
│         ┌───────────────────────────────┐          │
│         │  [Element being highlighted]  │          │
│         │  (pulsing cyan border)        │          │
│         └───────────────────────────────┘          │
│                         │                           │
│                         ▼                           │
│         ┌───────────────────────────────┐          │
│         │ 💡 SIDEBAR NAVIGATION          │          │
│         │                                │          │
│         │ Use the sidebar to navigate    │          │
│         │ between features. The active   │          │
│         │ page is highlighted in cyan.   │          │
│         │                                │          │
│         │         [Next →] [Skip Tour]   │          │
│         │         Step 1 of 5            │          │
│         └───────────────────────────────┘          │
│                                                     │
└─────────────────────────────────────────────────────┘
```

**Interaction:**
- Spotlight effect: Darken everything except highlighted element
- Tooltip: Floating card with arrow pointing to element
- "Next" button: Advance to next step
- "Skip Tour" link: Dismiss and go to dashboard
- Progress indicator: "Step X of 5"

**Tour Steps:**

1. **Sidebar:** "This is your navigation hub"
2. **Status Cards:** "Your security posture at a glance"
3. **Lock Button:** "Lock your vault anytime from the topbar"
4. **Events:** "All security events are logged here in real-time"
5. **Settings:** "Customize your protection preferences"

---

## 7. Component Library

### 7.1 Buttons

**Primary Button (Call to Action):**
```css
.btn-primary {
    background: var(--accent-primary);
    color: #000; /* Black text on cyan */
    border: none;
    border-radius: var(--radius-md);
    padding: var(--space-sm) var(--space-lg);
    font-weight: var(--font-semibold);
    box-shadow: var(--shadow-glow);
    transition: var(--transition-base);
}
.btn-primary:hover {
    transform: translateY(-1px);
    box-shadow: var(--shadow-glow-strong);
}
.btn-primary:active {
    transform: translateY(0);
}
.btn-primary:disabled {
    background: var(--text-muted);
    color: var(--bg-secondary);
    box-shadow: none;
    cursor: not-allowed;
}
```

**Secondary Button (Less Prominent):**
```css
.btn-secondary {
    background: transparent;
    color: var(--accent-primary);
    border: 1px solid var(--accent-primary);
    border-radius: var(--radius-md);
    padding: var(--space-sm) var(--space-lg);
    font-weight: var(--font-medium);
    transition: var(--transition-base);
}
.btn-secondary:hover {
    background: rgba(0, 240, 255, 0.1);
    border-color: var(--accent-primary);
}
```

**Destructive Button (Danger Actions):**
```css
.btn-destructive {
    background: var(--error);
    color: #fff;
    border: none;
    /* ...same structure as primary... */
}
```

**Ghost Button (Minimal):**
```css
.btn-ghost {
    background: transparent;
    color: var(--text-secondary);
    border: none;
    padding: var(--space-sm) var(--space-md);
}
.btn-ghost:hover {
    color: var(--text-primary);
    background: var(--bg-tertiary);
}
```

---

### 7.2 Cards

**Base Card:**
```css
.card {
    background: var(--bg-card);
    backdrop-filter: blur(10px);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-lg);
    padding: var(--space-lg);
    box-shadow: var(--shadow-md);
    transition: var(--transition-base);
}
.card:hover {
    border-color: var(--border-glow);
    box-shadow: var(--shadow-lg);
}
```

**Status Card (With Icon):**
```html
<div class="card status-card">
    <div class="icon-wrapper">
        🔒
    </div>
    <div class="status-text">
        <span class="label">Vault</span>
        <span class="value status-ok">Locked</span>
    </div>
</div>
```

```css
.status-card {
    display: flex;
    align-items: center;
    gap: var(--space-md);
}
.icon-wrapper {
    font-size: 2rem;
}
.status-text {
    display: flex;
    flex-direction: column;
}
.label {
    font-size: var(--text-sm);
    color: var(--text-muted);
}
.value {
    font-size: var(--text-xl);
    font-weight: var(--font-bold);
}
.status-ok { color: var(--success); }
.status-warning { color: var(--warning); }
.status-error { color: var(--error); }
```

---

### 7.3 Badges

**Status Badge:**
```css
.badge {
    display: inline-flex;
    align-items: center;
    gap: var(--space-xs);
    padding: var(--space-xs) var(--space-sm);
    border-radius: var(--radius-full);
    font-size: var(--text-xs);
    font-weight: var(--font-semibold);
    text-transform: uppercase;
    letter-spacing: 0.05em;
}

.badge-success {
    background: rgba(16, 185, 129, 0.2);
    color: var(--success);
    border: 1px solid var(--success);
}
.badge-warning {
    background: rgba(245, 158, 11, 0.2);
    color: var(--warning);
    border: 1px solid var(--warning);
}
.badge-error {
    background: rgba(239, 68, 68, 0.2);
    color: var(--error);
    border: 1px solid var(--error);
}
.badge-info {
    background: rgba(0, 240, 255, 0.2);
    color: var(--info);
    border: 1px solid var(--info);
}
```

**Pulsing Live Badge:**
```css
.badge-live {
    background: rgba(0, 240, 255, 0.2);
    color: var(--info);
    animation: pulse-glow 2s ease-in-out infinite;
}
```

---

### 7.4 Tables

**Data Table:**
```html
<div class="table-wrapper">
    <table class="data-table">
        <thead>
            <tr>
                <th>Date</th>
                <th>Type</th>
                <th>Files</th>
                <th>Threats</th>
            </tr>
        </thead>
        <tbody>
            <tr class="clickable">
                <td>Jan 29 14:23</td>
                <td>Quick</td>
                <td>1,423</td>
                <td><span class="badge-success">0</span></td>
            </tr>
        </tbody>
    </table>
</div>
```

```css
.table-wrapper {
    overflow-x: auto;
}
.data-table {
    width: 100%;
    border-collapse: collapse;
}
.data-table th {
    text-align: left;
    padding: var(--space-sm) var(--space-md);
    color: var(--text-muted);
    font-size: var(--text-xs);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    border-bottom: 1px solid var(--border-color);
}
.data-table td {
    padding: var(--space-md);
    border-bottom: 1px solid var(--border-color);
    color: var(--text-secondary);
}
.data-table tr.clickable:hover {
    background: var(--bg-tertiary);
    cursor: pointer;
}
```

---

### 7.5 Modals & Dialogs

**Modal Overlay:**
```html
<div class="modal-overlay">
    <div class="modal">
        <div class="modal-header">
            <h3>Confirm Action</h3>
            <button class="btn-ghost close">✕</button>
        </div>
        <div class="modal-body">
            <p>Are you sure you want to regenerate your Device ID?</p>
            <p class="warning-text">This action cannot be undone.</p>
        </div>
        <div class="modal-footer">
            <button class="btn-secondary">Cancel</button>
            <button class="btn-destructive">Regenerate</button>
        </div>
    </div>
</div>
```

```css
.modal-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.8);
    backdrop-filter: blur(4px);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
    animation: fade-in 200ms ease-out;
}
.modal {
    background: var(--bg-card-solid);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-xl);
    max-width: 500px;
    width: 90%;
    box-shadow: var(--shadow-xl);
    animation: scale-in 200ms cubic-bezier(0.16, 1, 0.3, 1);
}
.modal-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: var(--space-lg);
    border-bottom: 1px solid var(--border-color);
}
.modal-body {
    padding: var(--space-xl);
}
.modal-footer {
    display: flex;
    justify-content: flex-end;
    gap: var(--space-md);
    padding: var(--space-lg);
    border-top: 1px solid var(--border-color);
}
```

---

### 7.6 Tooltips

**Hover Tooltip:**
```html
<button class="btn-primary" data-tooltip="This feature is not yet implemented">
    Scan Now
</button>
```

```css
[data-tooltip] {
    position: relative;
}
[data-tooltip]:hover::after {
    content: attr(data-tooltip);
    position: absolute;
    bottom: calc(100% + 8px);
    left: 50%;
    transform: translateX(-50%);
    background: var(--bg-card-solid);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-md);
    padding: var(--space-sm) var(--space-md);
    font-size: var(--text-xs);
    white-space: nowrap;
    z-index: 100;
    box-shadow: var(--shadow-lg);
    animation: fade-in 150ms ease-out;
}
[data-tooltip]:hover::before {
    content: '';
    position: absolute;
    bottom: calc(100% + 2px);
    left: 50%;
    transform: translateX(-50%);
    border: 6px solid transparent;
    border-top-color: var(--border-color);
    z-index: 100;
}
```

---

### 7.7 Input Fields

**Text Input:**
```css
.input {
    background: var(--bg-secondary);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-md);
    padding: var(--space-sm) var(--space-md);
    color: var(--text-primary);
    font-size: var(--text-base);
    transition: var(--transition-fast);
    width: 100%;
}
.input:focus {
    outline: none;
    border-color: var(--accent-primary);
    box-shadow: 0 0 0 3px rgba(0, 240, 255, 0.1);
}
.input:disabled {
    background: var(--bg-tertiary);
    color: var(--text-muted);
    cursor: not-allowed;
}
```

**Password Input (With Toggle):**
```html
<div class="input-group">
    <input type="password" class="input" placeholder="Enter password">
    <button class="input-addon" type="button">👁️</button>
</div>
```

```css
.input-group {
    position: relative;
    display: flex;
}
.input-addon {
    position: absolute;
    right: var(--space-sm);
    top: 50%;
    transform: translateY(-50%);
    background: transparent;
    border: none;
    cursor: pointer;
    padding: var(--space-xs);
    opacity: 0.5;
}
.input-addon:hover {
    opacity: 1;
}
```

---

### 7.8 Progress Bars

**Linear Progress:**
```html
<div class="progress">
    <div class="progress-bar" style="width: 65%"></div>
</div>
<span class="progress-label">65% complete</span>
```

```css
.progress {
    background: var(--bg-tertiary);
    border-radius: var(--radius-full);
    height: 8px;
    overflow: hidden;
    position: relative;
}
.progress-bar {
    background: var(--accent-gradient);
    height: 100%;
    transition: width 300ms ease;
    position: relative;
}
.progress-bar::after {
    content: '';
    position: absolute;
    inset: 0;
    background: linear-gradient(90deg, transparent, rgba(255,255,255,0.3), transparent);
    animation: progress-shimmer 1.5s infinite;
}
@keyframes progress-shimmer {
    0% { transform: translateX(-100%); }
    100% { transform: translateX(100%); }
}
```

---

### 7.9 Empty States

**Empty State Component:**
```html
<div class="empty-state">
    <div class="empty-icon">📭</div>
    <h3 class="empty-title">No Events Yet</h3>
    <p class="empty-description">
        Security events will appear here as actions occur.
    </p>
    <button class="btn-secondary">Learn About Events</button>
</div>
```

```css
.empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: var(--space-4xl) var(--space-xl);
    text-align: center;
}
.empty-icon {
    font-size: 4rem;
    opacity: 0.5;
    margin-bottom: var(--space-lg);
}
.empty-title {
    font-size: var(--text-xl);
    color: var(--text-primary);
    margin-bottom: var(--space-sm);
}
.empty-description {
    color: var(--text-muted);
    max-width: 400px;
    margin-bottom: var(--space-lg);
}
```

---

### 7.10 Loading States

**Spinner:**
```html
<div class="spinner"></div>
```

```css
.spinner {
    width: 40px;
    height: 40px;
    border: 3px solid var(--border-color);
    border-top-color: var(--accent-primary);
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
}
@keyframes spin {
    to { transform: rotate(360deg); }
}
```

**Skeleton Loader (For Content):**
```html
<div class="skeleton-card">
    <div class="skeleton-line" style="width: 60%"></div>
    <div class="skeleton-line" style="width: 80%"></div>
    <div class="skeleton-line" style="width: 40%"></div>
</div>
```

```css
.skeleton-line {
    height: 16px;
    background: linear-gradient(90deg, var(--bg-tertiary) 25%, var(--bg-card) 50%, var(--bg-tertiary) 75%);
    background-size: 200% 100%;
    border-radius: var(--radius-sm);
    margin-bottom: var(--space-sm);
    animation: skeleton-loading 1.5s infinite;
}
@keyframes skeleton-loading {
    0% { background-position: 200% 0; }
    100% { background-position: -200% 0; }
}
```

---

### 7.11 Error States

**Inline Error Message:**
```html
<div class="error-banner">
    <span class="error-icon">⚠️</span>
    <div class="error-content">
        <strong>Update Failed</strong>
        <p>SHA-256 hash mismatch. Package may be corrupted.</p>
    </div>
    <button class="btn-ghost">Retry</button>
</div>
```

```css
.error-banner {
    display: flex;
    align-items: center;
    gap: var(--space-md);
    background: rgba(239, 68, 68, 0.1);
    border: 1px solid var(--error);
    border-radius: var(--radius-lg);
    padding: var(--space-md);
    margin-bottom: var(--space-lg);
}
.error-icon {
    font-size: 1.5rem;
}
.error-content strong {
    color: var(--error);
}
.error-content p {
    color: var(--text-secondary);
    font-size: var(--text-sm);
    margin-top: var(--space-xs);
}
```

---

## 8. Microcopy & Messaging

### 8.1 Beta Software Warnings

**Sidebar Footer Badge:**
```
⚠️ BETA v2.0.0
```
Tooltip: "This is beta software. Expect bugs and breaking changes."

**First-Run Warning:**
```
⚠️ BETA SOFTWARE

Darklock Guard v2 is in active development. Expect bugs, 
breaking changes, and missing features. Always keep backups.

[View Roadmap] [Known Issues]
```

---

### 8.2 Zero-Trust Mode Warnings

**Activation Prompt:**
```
⚠️ Enable Zero-Trust Mode?

This mode provides maximum security but may interrupt your 
workflow:

• Vault locks on ANY suspend/sleep (even brief)
• Requires frequent re-authentication
• Auto-enters Safe Mode if service crashes

You can switch back anytime in Settings.

[Enable Zero-Trust] [Cancel]
```

**Active Mode Banner (Status Page):**
```
⚠️ ZERO-TRUST MODE ACTIVE

Ultra-secure mode: vault locks on suspend, extra validation 
required. [Switch to Standard Mode]
```

---

### 8.3 Safe Mode Warnings

**Auto-Entered Safe Mode:**
```
⚠️ SAFE MODE ACTIVATED

Darklock Guard detected repeated service crashes and entered 
Safe Mode automatically to protect your system.

Protection features are disabled. Event log remains accessible.

Possible causes:
• Corrupted vault file
• System resource exhaustion
• Bug in service code

[Exit Safe Mode] [View Crash Logs] [Report Issue]
```

**Manual Safe Mode Entry:**
```
You are now in Safe Mode.

Protection features disabled until you exit Safe Mode.

[Exit Safe Mode]
```

---

### 8.4 Rollback Messages

**Update Rolled Back:**
```
⚠️ UPDATE ROLLED BACK

v2.1.0 failed post-install checks and was automatically 
rolled back to v2.0.0.

Your data is safe. The service could not start after the 
update.

[View Error Logs] [Report Issue] [Dismiss]
```

---

### 8.5 Disconnected State

**Topbar Indicator:**
```
⚪ DISCONNECTED
```
Tooltip: "Service connection lost. Trying to reconnect..."

**Status Page Banner:**
```
⚠️ SERVICE DISCONNECTED

Cannot communicate with Darklock Guard service. Events and 
protection status unavailable.

[Restart Service] [View Logs]
```

---

### 8.6 Feature Not Implemented

**Tooltip on Disabled Button:**
```
This feature is not yet implemented. 
Track progress: github.com/darklock/guard/issues/42
```

**Empty Screen:**
```
ⓘ PLANNED FEATURE

[Feature name] is planned for a future release.

Planned capabilities:
• Feature 1
• Feature 2

[Track Progress on GitHub →]

(UI preview shown below for feedback)
```

---

### 8.7 Password Recovery Warning

**Vault Creation:**
```
⚠️ PASSWORD RECOVERY IS IMPOSSIBLE

If you forget this password, your vault is permanently locked. 
Write it down somewhere safe (not digitally).

☐ I understand there is no password recovery
```

---

### 8.8 Device ID Regeneration Warning

**Confirmation Modal:**
```
⚠️ Regenerate Device ID?

This will create a new Device ID and unbind your vault from 
the current hardware.

CRITICAL: You will need the NEW Device ID to recover your 
vault if you move it to another device.

• Your vault will remain encrypted
• You must save the new Device ID immediately
• Old Device ID becomes invalid

[Cancel] [Regenerate (Cannot Undo)]
```

---

## 9. Accessibility

### Keyboard Navigation
- **Tab Order:** Logical top-to-bottom, left-to-right
- **Focus Indicators:** 3px cyan outline on all interactive elements
- **Shortcuts:**
  - `Ctrl+L` — Lock vault
  - `Ctrl+,` — Open Settings
  - `Ctrl+E` — Open Events
  - `Esc` — Close modal/dialog

### Screen Readers
- All icons have `aria-label` attributes
- Status changes announced via `aria-live` regions
- Modals trap focus and announce title on open

### Color Contrast
- All text meets WCAG AA (4.5:1 minimum)
- Status colors distinguishable even for colorblind users (icons + text labels)

### Motion Preferences
- Respect `prefers-reduced-motion` media query
- Disable animations if user has motion sensitivity

---

## 10. Responsive Behavior

**Breakpoints:**
- Desktop: ≥1280px (default)
- Laptop: 1024px - 1279px (narrow sidebar)
- Tablet: 768px - 1023px (collapsible sidebar)
- Mobile: <768px (bottom nav bar instead of sidebar)

**Mobile Adjustments:**
- Sidebar collapses to hamburger menu
- Status cards stack vertically (1 column)
- Tables scroll horizontally
- Modals take full screen (minus top bar)

---

## 11. Design System Summary

### Token List (CSS Variables)

```css
/* Colors */
--bg-primary: #0a0e17;
--bg-secondary: #0f1420;
--bg-tertiary: #151c2c;
--bg-card: rgba(21, 28, 44, 0.7);
--accent-primary: #00f0ff;
--accent-secondary: #7c3aed;
--accent-tertiary: #ec4899;
--text-primary: #ffffff;
--text-secondary: #94a3b8;
--text-muted: #64748b;
--success: #10b981;
--warning: #f59e0b;
--error: #ef4444;
--zerotrust: #ec4899;
--safemode: #f59e0b;

/* Spacing */
--space-xs: 0.25rem;
--space-sm: 0.5rem;
--space-md: 1rem;
--space-lg: 1.5rem;
--space-xl: 2rem;
--space-2xl: 3rem;

/* Typography */
--font-sans: 'Inter', sans-serif;
--font-mono: 'JetBrains Mono', monospace;
--text-xs: 0.75rem;
--text-sm: 0.875rem;
--text-base: 1rem;
--text-lg: 1.125rem;
--text-xl: 1.25rem;
--text-2xl: 1.5rem;

/* Radius */
--radius-sm: 0.375rem;
--radius-md: 0.5rem;
--radius-lg: 0.75rem;
--radius-xl: 1rem;

/* Shadows */
--shadow-md: 0 4px 6px -1px rgba(0, 0, 0, 0.4);
--shadow-lg: 0 10px 15px -3px rgba(0, 0, 0, 0.5);
--shadow-glow: 0 0 30px rgba(0, 240, 255, 0.2);

/* Transitions */
--transition-fast: 150ms ease;
--transition-base: 250ms ease;
```

---

## 12. Implementation Checklist

### Phase 1: Foundation
- [ ] Set up Tauri project with design tokens
- [ ] Implement shell layout (topbar + sidebar + content)
- [ ] Create component library (buttons, cards, badges, inputs)
- [ ] Add dark mode CSS with cyberpunk theme

### Phase 2: Core Screens
- [ ] Status (Dashboard)
- [ ] Protection (Vault settings)
- [ ] Events (Log viewer with live updates)
- [ ] Settings (tabs with preferences)
- [ ] Support & About

### Phase 3: Wizard & Onboarding
- [ ] First-run wizard (5 screens)
- [ ] Interactive tour overlays (5 steps)
- [ ] Empty states for all screens

### Phase 4: Polish
- [ ] Animations & transitions
- [ ] Accessibility (keyboard nav, ARIA labels)
- [ ] Responsive design (mobile breakpoints)
- [ ] Error/loading states for all actions

### Phase 5: Integration
- [ ] Connect UI to IPC backend (status, vault, events)
- [ ] Real-time event log streaming
- [ ] Update flow integration (download, install, rollback)

---

## 13. Design Principles Recap

1. **No Dead Buttons:** Every button works or shows a tooltip explaining why it can't.
2. **Radical Honesty:** Never fake features. Show "Planned" banners with roadmap links.
3. **Fail-Visible:** Errors are prominent, not hidden. Users know exactly what's wrong.
4. **Trust Through Transparency:** Live event log, real-time status, no "trust me" messaging.
5. **Premium Aesthetic:** Cyberpunk-inspired dark theme with cyan/purple/pink accents, professional polish.
6. **Consistent State Indication:** Normal, Zero-Trust, Safe Mode, Disconnected all have distinct visual identities.

---

**End of UI Specification**

This specification provides a complete blueprint for building the Darklock Guard v2 Tauri interface. All components, screens, and interactions are defined with pixel-perfect detail. Implement this design to create a premium, honest, and trustworthy security application.

