/**
 * ContactList — sidebar contact list with verified badges and key-change indicators.
 */
import type { ContactDto } from "../types";
import VerifiedBadge from "./VerifiedBadge";

interface Props {
  contacts: ContactDto[];
  activeContactId?: string;
  onSelect: (contact: ContactDto) => void;
}

export default function ContactList({ contacts, activeContactId, onSelect }: Props) {
  if (contacts.length === 0) {
    return (
      <div className="px-4 py-8 text-center text-gray-500 text-sm">
        No contacts yet. Add one to start chatting.
      </div>
    );
  }

  return (
    <div className="space-y-0.5">
      {contacts.map((c) => {
        const isActive = c.contact_user_id === activeContactId;
        const displayName = c.display_name || c.contact_user_id;

        return (
          <button
            key={c.contact_user_id}
            onClick={() => onSelect(c)}
            className={`w-full text-left px-3 py-2.5 rounded-lg flex items-center gap-2 transition-colors ${
              isActive
                ? "bg-indigo-600/20 text-indigo-300"
                : "hover:bg-gray-800 text-gray-300"
            } ${c.key_change_pending ? "border-l-2 border-red-500" : ""}`}
          >
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="text-sm font-medium truncate">
                  {displayName}
                </span>
                <VerifiedBadge
                  verified={!!c.verified_fingerprint}
                  fingerprint={c.fingerprint}
                />
              </div>
              {c.key_change_pending && (
                <p className="text-xs text-red-400 mt-0.5">
                  Key changed — verify identity
                </p>
              )}
            </div>
          </button>
        );
      })}
    </div>
  );
}
