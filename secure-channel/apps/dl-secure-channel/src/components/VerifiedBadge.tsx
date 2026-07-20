/**
 * VerifiedBadge — small shield icon shown next to verified contacts.
 * Clicking it shows the fingerprint comparison.
 */

interface Props {
  verified: boolean;
  fingerprint?: string;
  size?: "sm" | "md";
}

export default function VerifiedBadge({
  verified,
  fingerprint,
  size = "sm",
}: Props) {
  const px = size === "sm" ? "w-4 h-4" : "w-5 h-5";

  if (!verified) {
    return (
      <span
        className={`inline-flex items-center ${px} text-yellow-500`}
        title="Not verified — tap to verify"
      >
        <svg fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
          />
        </svg>
      </span>
    );
  }

  return (
    <span
      className={`inline-flex items-center ${px} text-green-500`}
      title={fingerprint ? `Verified: ${fingerprint}` : "Verified"}
    >
      <svg fill="currentColor" viewBox="0 0 24 24">
        <path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm-2 16l-4-4 1.41-1.41L10 14.17l6.59-6.59L18 9l-8 8z" />
      </svg>
    </span>
  );
}
