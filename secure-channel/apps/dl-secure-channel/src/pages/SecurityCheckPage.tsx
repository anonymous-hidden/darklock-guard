/**
 * Security Check wizard — runs device integrity & environment risk analysis
 * before enabling decryption / session usage.
 */
import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import {
  Shield,
  ShieldCheck,
  ShieldAlert,
  ShieldX,
  Loader2,
  Lock,
  ArrowRight,
  AlertTriangle,
} from "lucide-react";
import { runSecurityCheck } from "@/lib/tauri";
import { useAuthStore } from "@/store/authStore";
import { useSettingsStore } from "@/store/settingsStore";
import type { SecurityCheckResult, RiskSignal } from "@/types";

const RISK_COLORS: Record<string, string> = {
  low: "text-dl-success",
  medium: "text-dl-warning",
  high: "text-dl-danger",
  critical: "text-dl-danger",
};

const RISK_BG: Record<string, string> = {
  low: "bg-dl-success/10 border-dl-success/20",
  medium: "bg-dl-warning/10 border-dl-warning/20",
  high: "bg-dl-danger/10 border-dl-danger/20",
  critical: "bg-dl-danger/10 border-dl-danger/20",
};

const MODE_LABELS: Record<string, string> = {
  normal: "Normal Mode",
  privacy: "Privacy Mode — padding & batching enabled",
  high_security: "High-Security Mode — password re-entry + clipboard blocked",
};

const RISK_ICONS: Record<string, React.ReactNode> = {
  low: <ShieldCheck className="w-12 h-12 text-dl-success" />,
  medium: <Shield className="w-12 h-12 text-dl-warning" />,
  high: <ShieldAlert className="w-12 h-12 text-dl-danger" />,
  critical: <ShieldX className="w-12 h-12 text-dl-danger" />,
};

export default function SecurityCheckPage() {
  const navigate = useNavigate();
  const setSecurityCheckComplete = useAuthStore((s) => s.setSecurityCheckComplete);
  const loadSettings = useSettingsStore((s) => s.loadSettings);

  const [phase, setPhase] = useState<"checking" | "result">("checking");
  const [result, setResult] = useState<SecurityCheckResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await runSecurityCheck();
        if (!cancelled) {
          setResult(r);
          setPhase("result");
        }
      } catch (err) {
        if (!cancelled) setError(String(err));
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const handleContinue = () => {
    setSecurityCheckComplete(true);
    // Load the logged-in user's settings immediately so sidebar, avatar,
    // status etc. all reflect THIS account's data — not a previous user's.
    loadSettings();
    navigate("/", { replace: true });
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-dl-bg">
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-lg mx-4"
      >
        <div className="dl-card">
          {/* Checking phase */}
          {phase === "checking" && !error && (
            <div className="flex flex-col items-center gap-4 py-8">
              <div className="relative">
                <Shield className="w-16 h-16 text-dl-accent animate-pulse-slow" />
                <div className="absolute inset-0 flex items-center justify-center">
                  <Loader2 className="w-6 h-6 text-dl-accent animate-spin" />
                </div>
              </div>
              <h2 className="text-lg font-semibold">Security Check</h2>
              <p className="text-sm text-dl-text-dim text-center max-w-xs">
                Analyzing device integrity and environment risk before enabling
                decryption...
              </p>
              <div className="flex flex-col gap-2 w-full max-w-xs text-sm text-dl-text-dim">
                <CheckStep label="Device integrity" />
                <CheckStep label="Environment analysis" />
                <CheckStep label="Risk scoring" />
              </div>
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="flex flex-col items-center gap-4 py-8">
              <ShieldX className="w-16 h-16 text-dl-danger" />
              <h2 className="text-lg font-semibold text-dl-danger">
                Security Check Failed
              </h2>
              <p className="text-sm text-dl-text-dim text-center">{error}</p>
              <button onClick={() => window.location.reload()} className="dl-btn-primary">
                Retry
              </button>
            </div>
          )}

          {/* Result phase */}
          {phase === "result" && result && (
            <div className="space-y-6">
              <div className="flex flex-col items-center gap-3">
                {RISK_ICONS[result.risk_level]}
                <h2 className="text-lg font-semibold">
                  Security Check Complete
                </h2>
                <div
                  className={`dl-badge border ${RISK_BG[result.risk_level]} ${RISK_COLORS[result.risk_level]}`}
                >
                  Risk: {result.risk_level.toUpperCase()} (score: {result.total_score})
                </div>
              </div>

              {/* Recommended mode */}
              <div className="p-3 rounded-lg bg-dl-elevated text-sm">
                <span className="font-medium text-dl-text">Recommended: </span>
                <span className="text-dl-text-dim">
                  {MODE_LABELS[result.recommended_mode]}
                </span>
              </div>

              {/* Signals list */}
              {result.signals.length > 0 && (
                <div className="space-y-2">
                  <h3 className="text-sm font-medium text-dl-text-dim">Signals detected:</h3>
                  {result.signals.map((sig, i) => (
                    <SignalRow key={i} signal={sig} />
                  ))}
                </div>
              )}

              {/* Require re-auth */}
              {result.require_reauth && (
                <div className="flex items-center gap-2 p-3 rounded-lg bg-dl-danger/10 border border-dl-danger/20 text-sm text-dl-danger">
                  <AlertTriangle size={16} />
                  High risk detected — password re-entry required to proceed.
                </div>
              )}

              <button onClick={handleContinue} className="dl-btn-primary w-full py-2.5">
                <Lock size={16} />
                {result.require_reauth ? "Re-authenticate & Continue" : "Continue"}
                <ArrowRight size={16} />
              </button>
            </div>
          )}
        </div>
      </motion.div>
    </div>
  );
}

function CheckStep({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2">
      <Loader2 className="w-3 h-3 animate-spin text-dl-accent" />
      <span>{label}</span>
    </div>
  );
}

function SignalRow({ signal }: { signal: RiskSignal }) {
  return (
    <div className={`p-2.5 rounded-lg border ${RISK_BG[signal.severity]}`}>
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">{signal.name.replace(/_/g, " ")}</span>
        <span className={`text-xs font-medium ${RISK_COLORS[signal.severity]}`}>
          +{signal.score}
        </span>
      </div>
      <p className="text-xs text-dl-text-dim mt-0.5">{signal.description}</p>
    </div>
  );
}
