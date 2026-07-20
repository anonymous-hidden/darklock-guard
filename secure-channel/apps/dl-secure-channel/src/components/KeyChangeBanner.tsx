/**
 * KeyChangeBanner — loud, unmissable warning when a contact's identity key changes.
 *
 * NON-NEGOTIABLE: This banner BLOCKS messaging until the user explicitly
 * re-verifies the contact. There is no "dismiss" or "accept anyway" button.
 * The only action is "Verify Now" which opens the verification flow.
 */
import { useNavigate } from "react-router-dom";

interface Props {
  contactUserId: string;
  contactName?: string;
}

export default function KeyChangeBanner({ contactUserId, contactName }: Props) {
  const navigate = useNavigate();
  const displayName = contactName || contactUserId;

  return (
    <div className="bg-red-600 text-white px-4 py-3 flex items-center gap-3 border-b-2 border-red-800 animate-pulse">
      <svg
        className="w-6 h-6 flex-shrink-0"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z"
        />
      </svg>
      <div className="flex-1">
        <p className="font-bold text-sm">
          Identity Key Changed — Messaging Blocked
        </p>
        <p className="text-xs opacity-90">
          <span className="font-semibold">{displayName}</span>'s security key has
          changed. This could mean their device was replaced — or someone is
          attempting a man-in-the-middle attack. Verify their identity before
          continuing.
        </p>
      </div>
      <button
        onClick={() =>
          navigate(`/verify/${contactUserId}`, { state: { keyChange: true } })
        }
        className="bg-white text-red-700 font-bold px-4 py-1.5 rounded text-sm hover:bg-red-100 transition-colors flex-shrink-0"
      >
        Verify Now
      </button>
    </div>
  );
}
