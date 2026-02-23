/**
 * LinkifiedText — Renders text with clickable URLs.
 * Shows an external link warning modal before opening links.
 */
import React, { useState, Fragment } from "react";
import { ExternalLink, AlertTriangle, Shield } from "lucide-react";

// URL regex: matches http(s) and bare domain URLs
const URL_REGEX = /(?:https?:\/\/|www\.)[\w\-._~:/?#[\]@!$&'()*+,;=%]+/gi;

// Trusted domains that don't need a warning
const TRUSTED_DOMAINS = new Set([
  "darklock.app",
  "darklock.net",
  "github.com",
]);

function getDomain(url: string): string {
  try {
    const normalized = url.startsWith("http") ? url : `https://${url}`;
    return new URL(normalized).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

interface LinkifiedTextProps {
  text: string;
  className?: string;
}

export default function LinkifiedText({ text, className = "" }: LinkifiedTextProps) {
  const [warningUrl, setWarningUrl] = useState<string | null>(null);

  const parts: (string | { url: string; display: string })[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  const regex = new RegExp(URL_REGEX.source, "gi");
  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }
    const url = match[0];
    const href = url.startsWith("http") ? url : `https://${url}`;
    parts.push({ url: href, display: url });
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  const handleLinkClick = (e: React.MouseEvent, url: string) => {
    e.preventDefault();
    e.stopPropagation();
    const domain = getDomain(url);
    if (TRUSTED_DOMAINS.has(domain)) {
      window.open(url, "_blank", "noopener,noreferrer");
    } else {
      setWarningUrl(url);
    }
  };

  const handleConfirmOpen = () => {
    if (warningUrl) {
      window.open(warningUrl, "_blank", "noopener,noreferrer");
      setWarningUrl(null);
    }
  };

  return (
    <>
      <span className={className}>
        {parts.map((part, i) =>
          typeof part === "string" ? (
            <Fragment key={i}>{part}</Fragment>
          ) : (
            <a
              key={i}
              href={part.url}
              onClick={(e) => handleLinkClick(e, part.url)}
              className="text-dl-accent hover:underline cursor-pointer inline-flex items-center gap-0.5"
              title={part.url}
            >
              {part.display}
              <ExternalLink size={10} className="opacity-50 shrink-0" />
            </a>
          )
        )}
      </span>

      {/* External Link Warning Modal */}
      {warningUrl && (
        <>
          <div className="fixed inset-0 z-[60] bg-black/60" onClick={() => setWarningUrl(null)} />
          <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
            <div className="w-full max-w-sm bg-[#1a1d27] border border-white/[0.08] rounded-2xl shadow-2xl p-6 space-y-4">
              {/* Header */}
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-amber-500/10 flex items-center justify-center">
                  <AlertTriangle size={20} className="text-amber-400" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-white/90">External Link</h3>
                  <p className="text-[11px] text-white/40">You are about to leave Darklock</p>
                </div>
              </div>

              {/* URL preview */}
              <div className="bg-white/[0.03] border border-white/[0.06] rounded-lg px-3 py-2.5">
                <p className="text-[10px] text-white/25 uppercase tracking-wider mb-1">Destination</p>
                <p className="text-xs text-white/60 break-all font-mono">{warningUrl}</p>
                <p className="text-xs text-white/30 mt-1 flex items-center gap-1">
                  <Shield size={10} />
                  {getDomain(warningUrl)}
                </p>
              </div>

              {/* Warning */}
              <p className="text-[11px] text-white/30 leading-relaxed">
                This link takes you to an external website. Make sure you trust this site before proceeding. Darklock is not responsible for external content.
              </p>

              {/* Actions */}
              <div className="flex justify-end gap-3 pt-1">
                <button
                  onClick={() => setWarningUrl(null)}
                  className="px-4 py-2 rounded-lg text-sm text-white/40 hover:text-white/60 hover:bg-white/[0.04] transition-all"
                >
                  Cancel
                </button>
                <button
                  onClick={handleConfirmOpen}
                  className="px-5 py-2 rounded-lg bg-dl-accent text-white text-sm font-medium hover:bg-dl-accent/80 transition-all"
                >
                  Open Link
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </>
  );
}
