/**
 * VerifyContactDialog — fingerprint comparison dialog.
 *
 * Displays both users' fingerprints side-by-side for manual comparison.
 * Supports numeric format (Signal-style safety numbers) and hex format.
 * Users must explicitly confirm the fingerprints match.
 */
import { useState } from "react";
import { verifyContact } from "../lib/tauri";

interface Props {
  contactUserId: string;
  contactName?: string;
  myFingerprint: string;
  theirFingerprint: string;
  onClose: () => void;
  onVerified: () => void;
}

export default function VerifyContactDialog({
  contactUserId,
  contactName,
  myFingerprint,
  theirFingerprint,
  onClose,
  onVerified,
}: Props) {
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const displayName = contactName || contactUserId;

  const handleVerify = async () => {
    setConfirming(true);
    setError(null);
    try {
      await verifyContact(contactUserId, theirFingerprint);
      onVerified();
    } catch (e) {
      setError(String(e));
    } finally {
      setConfirming(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="dl-card max-w-md w-full mx-4 p-6 space-y-4">
        <h2 className="text-lg font-bold text-white">
          Verify {displayName}
        </h2>
        <p className="text-sm text-gray-400">
          Compare the security numbers below with {displayName} using an
          independent channel (in-person, phone call, or video chat). They must
          match exactly.
        </p>

        <div className="space-y-3">
          <div>
            <p className="text-xs font-semibold text-indigo-400 mb-1">
              Your fingerprint
            </p>
            <code className="block bg-gray-900 text-green-400 text-xs p-3 rounded font-mono leading-relaxed select-all">
              {myFingerprint}
            </code>
          </div>
          <div>
            <p className="text-xs font-semibold text-indigo-400 mb-1">
              {displayName}'s fingerprint
            </p>
            <code className="block bg-gray-900 text-green-400 text-xs p-3 rounded font-mono leading-relaxed select-all">
              {theirFingerprint}
            </code>
          </div>
        </div>

        {error && (
          <p className="text-sm text-red-400">{error}</p>
        )}

        <div className="flex gap-3 justify-end">
          <button
            onClick={onClose}
            className="dl-btn-ghost px-4 py-2 text-sm"
          >
            Cancel
          </button>
          <button
            onClick={handleVerify}
            disabled={confirming}
            className="dl-btn-primary px-4 py-2 text-sm font-semibold"
          >
            {confirming ? "Verifying..." : "I confirm they match"}
          </button>
        </div>
      </div>
    </div>
  );
}
