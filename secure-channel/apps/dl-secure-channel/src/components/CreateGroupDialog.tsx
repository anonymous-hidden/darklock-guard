/**
 * CreateGroupDialog — create a new encrypted group chat.
 */
import { useState } from "react";
import { createGroup } from "../lib/tauri";
import type { ContactDto, GroupDto } from "../types";

interface Props {
  contacts: ContactDto[];
  onClose: () => void;
  onCreated: (group: GroupDto) => void;
}

export default function CreateGroupDialog({ contacts, onClose, onCreated }: Props) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [selectedMembers, setSelectedMembers] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggleMember = (userId: string) => {
    const next = new Set(selectedMembers);
    if (next.has(userId)) {
      next.delete(userId);
    } else {
      next.add(userId);
    }
    setSelectedMembers(next);
  };

  const handleCreate = async () => {
    if (!name.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const group = await createGroup(
        name.trim(),
        description.trim() || undefined,
        Array.from(selectedMembers)
      );
      onCreated(group);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  // Filter out contacts with pending key changes
  const safeContacts = contacts.filter((c) => !c.key_change_pending);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="dl-card max-w-md w-full mx-4 p-6 space-y-4 max-h-[80vh] overflow-y-auto">
        <h2 className="text-lg font-bold text-white">Create Group</h2>

        <div className="space-y-3">
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Group name"
            className="dl-input w-full"
            autoFocus
          />
          <input
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Description (optional)"
            className="dl-input w-full"
          />
        </div>

        <div>
          <p className="text-sm text-gray-400 mb-2">
            Add members ({selectedMembers.size} selected)
          </p>
          <div className="space-y-1 max-h-48 overflow-y-auto">
            {safeContacts.map((c) => (
              <label
                key={c.contact_user_id}
                className="flex items-center gap-2 px-3 py-2 rounded hover:bg-gray-800 cursor-pointer"
              >
                <input
                  type="checkbox"
                  checked={selectedMembers.has(c.contact_user_id)}
                  onChange={() => toggleMember(c.contact_user_id)}
                  className="accent-indigo-500"
                />
                <span className="text-sm text-white">
                  {c.display_name || c.contact_user_id}
                </span>
                {c.verified_fingerprint && (
                  <span className="text-green-500 text-xs">✓ verified</span>
                )}
              </label>
            ))}
            {safeContacts.length === 0 && (
              <p className="text-xs text-gray-500 italic px-3">
                No verified contacts available
              </p>
            )}
          </div>
        </div>

        {error && <p className="text-sm text-red-400">{error}</p>}

        <div className="flex gap-3 justify-end">
          <button onClick={onClose} className="dl-btn-ghost px-4 py-2 text-sm">
            Cancel
          </button>
          <button
            onClick={handleCreate}
            disabled={loading || !name.trim()}
            className="dl-btn-primary px-4 py-2 text-sm"
          >
            {loading ? "Creating..." : "Create Group"}
          </button>
        </div>
      </div>
    </div>
  );
}
