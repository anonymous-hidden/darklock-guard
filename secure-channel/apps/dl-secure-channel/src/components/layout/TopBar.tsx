/**
 * TopBar — Chat header with contact name, verification status, call/search/info buttons.
 */
import { useState } from "react";
import {
  Hash,
  Search,
  Users,
  ShieldCheck,
  ShieldAlert,
  Lock,
  AtSign,
  Pin,
} from "lucide-react";

import { useChatStore } from "@/store/chatStore";
import { useLayoutStore } from "@/store/layoutStore";
import { verifyContact, getContacts } from "@/lib/tauri";

export default function TopBar() {
  const { activeContactId, contacts, setContacts } = useChatStore();
  const { toggleRightPanel, rightPanelOpen, togglePinPanel, pinPanelOpen } = useLayoutStore();
  const [verifying, setVerifying] = useState(false);

  const currentContact = contacts.find((c) => c.contact_user_id === activeContactId);

  const handleTrust = async () => {
    if (!activeContactId) return;
    setVerifying(true);
    try {
      await verifyContact(activeContactId);
      const updated = await getContacts();
      setContacts(updated);
    } catch (err) {
      console.error("Verify failed:", err);
    } finally {
      setVerifying(false);
    }
  };

  if (!activeContactId) {
    return (
      <div className="topbar topbar--empty">
        <div className="topbar__title">
          <Hash size={20} className="text-dl-muted" />
          <span className="text-dl-muted">Select a conversation</span>
        </div>
      </div>
    );
  }

  const displayName = currentContact?.display_name ?? activeContactId;

  return (
    <div className="topbar">
      {/* Left section */}
      <div className="topbar__left">
        <AtSign size={20} className="text-dl-muted shrink-0" />
        <span className="topbar__name">{displayName}</span>

        {/* Verification badge */}
        {currentContact?.verified_fingerprint ? (
          <span className="topbar__badge topbar__badge--verified">
            <ShieldCheck size={12} />
            Verified
          </span>
        ) : (
          <span className="topbar__badge topbar__badge--unverified">
            <ShieldAlert size={12} />
            Not verified
            {!currentContact?.key_change_pending && (
              <button
                onClick={handleTrust}
                disabled={verifying}
                className="topbar__trust-btn"
              >
                {verifying ? "…" : "Trust"}
              </button>
            )}
          </span>
        )}

        {currentContact?.key_change_pending && (
          <span className="topbar__badge topbar__badge--danger">
            ⚠ Key changed
          </span>
        )}

        {/* E2E indicator */}
        <span className="topbar__e2e">
          <Lock size={10} />
          E2E
        </span>
      </div>

      {/* Right section — action buttons */}
      <div className="topbar__actions">
        <button
          className={`topbar__action ${pinPanelOpen ? "topbar__action--active" : ""}`}
          title="Pinned Messages"
          onClick={togglePinPanel}
        >
          <Pin size={18} />
        </button>
        <button
          className={`topbar__action ${rightPanelOpen ? "topbar__action--active" : ""}`}
          title="Member List"
          onClick={toggleRightPanel}
        >
          <Users size={18} />
        </button>

        {/* Search within chat */}
        <div className="topbar__search-box">
          <input
            type="text"
            placeholder="Search"
            className="topbar__search-input"
          />
          <Search size={14} className="topbar__search-icon" />
        </div>
      </div>
    </div>
  );
}
