import { useState } from 'react';
import {
  BookOpen,
  Terminal,
  Shield,
  Settings,
  Globe,
  Lock,
  FileText,
  ChevronRight,
  Copy,
  Check,
} from 'lucide-react';

const sections = [
  {
    id: 'quickstart',
    title: 'Quick Start',
    icon: Terminal,
    content: `## Quick Start

### 1. Download & Install

Download the installer for your platform from the [Download](/download) page, or install via CLI on Linux:

\`\`\`bash
curl -fsSL https://get.darklock.net | bash
\`\`\`

### 2. Run the Setup Wizard

Launch Darklock Guard. The first-run wizard will guide you through:

1. **Choose mode** — Local (fully offline) or Connected (link to your account)
2. **Create vault password** — A strong master password protects your encrypted vault
3. **Initialize baseline** — The service scans your protected paths and creates a signed integrity baseline

### 3. Verify Protection

After setup, bring up the desktop app and check the **Status** page. You should see:
- Service: **Running**
- Vault: **Unlocked**
- Baseline: **Valid** (with file count and last scan time)
- Event log: **Intact** (chain verified)`,
  },
  {
    id: 'architecture',
    title: 'Architecture',
    icon: Settings,
    content: `## Architecture

Darklock Guard is composed of three layers:

### Guard Service (Rust)
A background daemon that handles all security operations:
- **Encrypted Vault** — DLOCK02 format with Argon2 key derivation
- **Integrity Scanner** — BLAKE3 hashing of protected files, signed with Ed25519
- **File Watcher** — Real-time file system monitoring
- **Event Log** — Hash-chained, signed audit log with rotation
- **IPC Server** — Unix domain socket with HMAC challenge/response authentication

### Desktop App (Tauri + React)
A lightweight management UI that communicates with the service over IPC:
- Status overview, event viewer, settings editor
- Setup wizard for first-run configuration
- Update manager with signed release verification

### Platform API (Optional)
A web service for connected mode:
- Device linking and heartbeat monitoring
- Remote action dispatch (lock, scan, wipe)
- Event log uploading and dashboard visualization
- User authentication with Argon2id + TOTP 2FA`,
  },
  {
    id: 'vault',
    title: 'Vault & Encryption',
    icon: Lock,
    content: `## Vault & Encryption

### DLOCK02 File Format

The vault uses a custom binary format:

| Offset | Size | Description |
|--------|------|-------------|
| 0 | 7 | Magic bytes \`DLOCK02\` |
| 7 | 1 | Version byte |
| 8 | 16 | Argon2 salt |
| 24 | 24 | XChaCha20-Poly1305 nonce |
| 48 | N | Encrypted payload |
| 48+N | 16 | AEAD authentication tag |

### Key Derivation

Master password → Argon2id(m=64MB, t=3, p=4) → 32-byte key

### Vault Contents

The encrypted payload contains JSON with:
- \`device_key\` — Ed25519 signing key pair (for baselines and event log)
- \`ipc_secret\` — 32-byte HMAC secret for IPC authentication
- \`settings\` — Guard configuration (protected paths, scan interval, etc.)
- \`linked_device\` — Platform device credentials (connected mode only)`,
  },
  {
    id: 'ipc',
    title: 'IPC Protocol',
    icon: FileText,
    content: `## IPC Protocol

The guard service exposes two Unix domain sockets:

### Status Socket (Read-only)
\`/run/darklock-guard/status.sock\`

Any local process can read service status without authentication.

**Request:** \`{ "type": "Status" }\`
**Response:** \`{ "running": true, "vault_unlocked": true, "baseline_files": 1024, ... }\`

### Command Socket (Authenticated)
\`/run/darklock-guard/command.sock\`

Requires HMAC challenge/response using the vault's IPC secret.

**Authentication flow:**
1. Client sends \`{ "type": "Auth" }\`
2. Service responds with 32-byte random challenge
3. Client computes \`HMAC-SHA256(ipc_secret, challenge)\` and sends it back
4. Service verifies and grants a session token

**Available commands after authentication:**
- \`GetSettings\` / \`UpdateSettings\`
- \`TriggerScan\`
- \`GetEvents\`
- \`GetBaseline\`
- \`Lock\` / \`Unlock\``,
  },
  {
    id: 'connected',
    title: 'Connected Mode',
    icon: Globe,
    content: `## Connected Mode

### Linking a Device

1. Sign in to your Darklock account on the web dashboard
2. Go to **Devices** → **Link New Device**
3. Copy the 6-digit link code
4. In the desktop app, open **Settings** → **Connected Mode** → paste the link code
5. The service exchanges Ed25519 public keys with the platform

### Heartbeat

Linked devices send a heartbeat every 60 seconds:
\`\`\`json
{
  "device_id": "uuid",
  "timestamp": "ISO-8601",
  "status": { "service": "running", "vault": "locked", "baseline_valid": true },
  "signature": "ed25519-sig-of-payload"
}
\`\`\`

### Remote Actions

From the web dashboard you can:
- **Trigger Scan** — Immediately verify integrity baseline
- **Lock Vault** — Lock the vault on a remote device
- **Request Logs** — Pull recent event log entries

Commands are stored server-side and polled by the device on next heartbeat.`,
  },
  {
    id: 'security',
    title: 'Security Model',
    icon: Shield,
    content: `## Security Model

### Threat Model

Darklock Guard protects against:
- Unauthorized modification of protected files (malware, ransomware, insider threat)
- Tampering with the integrity baseline or event log
- Compromise of the guard service binary
- Extraction of vault contents from disk

### Cryptographic Guarantees

| Component | Algorithm | Purpose |
|-----------|-----------|---------|
| Password hashing | Argon2id (64MB, t=3) | Vault key derivation |
| Vault encryption | XChaCha20-Poly1305 | Authenticated encryption |
| File hashing | BLAKE3 | Integrity verification |
| Signatures | Ed25519 | Baseline & event signing |
| IPC auth | HMAC-SHA256 | Command socket authentication |
| Event chain | SHA-256 | Hash-chained audit log |

### What We Don't Protect Against

- Physical access with disk encryption keys
- Kernel-level rootkits that intercept file I/O
- Modification of the running service process in memory
- Compromise of the vault password (use a strong password)`,
  },
];

function CodeBlock({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="relative group">
      <pre className="bg-dark-950 rounded-lg px-4 py-3 text-sm overflow-x-auto">
        <code className="text-brand-400">{code}</code>
      </pre>
      <button
        onClick={() => { navigator.clipboard.writeText(code); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
        className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity text-dark-500 hover:text-white"
      >
        {copied ? <Check className="w-4 h-4 text-green-400" /> : <Copy className="w-4 h-4" />}
      </button>
    </div>
  );
}

function renderMarkdown(md: string) {
  // Extremely simplified markdown renderer for docs
  const lines = md.split('\n');
  const elements: JSX.Element[] = [];
  let inCode = false;
  let codeBlock = '';
  let inTable = false;
  let tableRows: string[][] = [];

  const flushTable = () => {
    if (tableRows.length > 0) {
      const [header, ...body] = tableRows;
      elements.push(
        <div key={`table-${elements.length}`} className="overflow-x-auto mb-4">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-dark-800">
                {header.map((h, i) => <th key={i} className="text-left px-3 py-2 text-dark-300 font-medium">{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {body.map((row, ri) => (
                <tr key={ri} className="border-b border-dark-800/50">
                  {row.map((cell, ci) => (
                    <td key={ci} className="px-3 py-2 text-dark-400">
                      {cell.startsWith('`') && cell.endsWith('`') ? (
                        <code className="text-brand-400 bg-brand-600/10 px-1.5 py-0.5 rounded text-xs">{cell.slice(1, -1)}</code>
                      ) : cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
      tableRows = [];
      inTable = false;
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (line.startsWith('```')) {
      if (inCode) {
        elements.push(<CodeBlock key={`code-${i}`} code={codeBlock.trim()} />);
        codeBlock = '';
        inCode = false;
      } else {
        flushTable();
        inCode = true;
      }
      continue;
    }
    if (inCode) { codeBlock += line + '\n'; continue; }

    if (line.startsWith('|') && line.endsWith('|')) {
      const cells = line.split('|').slice(1, -1).map((c) => c.trim());
      if (cells.every((c) => /^[-:]+$/.test(c))) continue; // separator row
      inTable = true;
      tableRows.push(cells);
      continue;
    } else if (inTable) {
      flushTable();
    }

    if (line.startsWith('### ')) {
      elements.push(<h3 key={i} className="text-lg font-semibold mt-8 mb-3">{line.slice(4)}</h3>);
    } else if (line.startsWith('## ')) {
      elements.push(<h2 key={i} className="text-2xl font-bold mt-2 mb-4">{line.slice(3)}</h2>);
    } else if (/^\d+\.\s/.test(line)) {
      elements.push(
        <div key={i} className="flex gap-3 mb-2 text-sm text-dark-400">
          <span className="text-brand-400 font-medium">{line.match(/^\d+/)![0]}.</span>
          <span dangerouslySetInnerHTML={{ __html: formatInline(line.replace(/^\d+\.\s/, '')) }} />
        </div>
      );
    } else if (line.startsWith('- ')) {
      elements.push(
        <div key={i} className="flex gap-2 mb-1.5 text-sm text-dark-400">
          <span className="mt-1.5 w-1 h-1 rounded-full bg-brand-500 flex-shrink-0" />
          <span dangerouslySetInnerHTML={{ __html: formatInline(line.slice(2)) }} />
        </div>
      );
    } else if (line.trim() === '') {
      elements.push(<div key={i} className="h-3" />);
    } else {
      elements.push(<p key={i} className="text-sm text-dark-400 leading-relaxed mb-2" dangerouslySetInnerHTML={{ __html: formatInline(line) }} />);
    }
  }
  flushTable();
  return elements;
}

function formatInline(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, '<strong class="text-dark-200 font-semibold">$1</strong>')
    .replace(/`(.+?)`/g, '<code class="text-brand-400 bg-brand-600/10 px-1 py-0.5 rounded text-xs">$1</code>')
    .replace(/\[(.+?)\]\((.+?)\)/g, '<a href="$2" class="text-brand-400 hover:underline">$1</a>');
}

export default function DocsPage() {
  const [active, setActive] = useState('quickstart');

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
      <div className="flex gap-8">
        {/* Sidebar */}
        <aside className="hidden lg:block w-64 flex-shrink-0">
          <div className="sticky top-24">
            <h3 className="text-xs uppercase tracking-wider text-dark-500 font-semibold mb-4">Documentation</h3>
            <nav className="space-y-1">
              {sections.map((s) => (
                <button
                  key={s.id}
                  onClick={() => setActive(s.id)}
                  className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-all ${
                    active === s.id
                      ? 'bg-brand-600/10 text-brand-400'
                      : 'text-dark-400 hover:text-white hover:bg-dark-800/50'
                  }`}
                >
                  <s.icon className="w-4 h-4 flex-shrink-0" />
                  {s.title}
                  {active === s.id && <ChevronRight className="w-3 h-3 ml-auto" />}
                </button>
              ))}
            </nav>
          </div>
        </aside>

        {/* Mobile select */}
        <div className="lg:hidden w-full mb-6">
          <select
            value={active}
            onChange={(e) => setActive(e.target.value)}
            className="input-field w-full"
          >
            {sections.map((s) => (
              <option key={s.id} value={s.id}>{s.title}</option>
            ))}
          </select>
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="glass-card p-8">
            {renderMarkdown(sections.find((s) => s.id === active)!.content)}
          </div>
        </div>
      </div>
    </div>
  );
}
