/**
 * VaultLockOverlay — shown when the vault auto-locks.
 * Requires password re-entry to continue.
 */
import { useState } from "react";
import { unlockVault } from "../lib/tauri";

interface Props {
  onUnlocked: () => void;
}

export default function VaultLockOverlay({ onUnlocked }: Props) {
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleUnlock = async () => {
    if (!password) return;
    setLoading(true);
    setError(null);
    try {
      await unlockVault(password);
      setPassword("");
      onUnlocked();
    } catch (e) {
      setError("Wrong password. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-md">
      <div className="dl-card max-w-sm w-full mx-4 p-8 space-y-6 text-center">
        <div className="mx-auto w-16 h-16 rounded-full bg-indigo-900/50 flex items-center justify-center">
          <svg
            className="w-8 h-8 text-indigo-400"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
            />
          </svg>
        </div>
        <div>
          <h2 className="text-xl font-bold text-white">Vault Locked</h2>
          <p className="text-sm text-gray-400 mt-1">
            Your session has been locked for security. Enter your password to
            continue.
          </p>
        </div>

        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleUnlock()}
          placeholder="Password"
          className="dl-input w-full text-center"
          autoFocus
        />

        {error && <p className="text-sm text-red-400">{error}</p>}

        <button
          onClick={handleUnlock}
          disabled={loading || !password}
          className="dl-btn-primary w-full py-2.5 font-semibold"
        >
          {loading ? "Unlocking..." : "Unlock"}
        </button>
      </div>
    </div>
  );
}
