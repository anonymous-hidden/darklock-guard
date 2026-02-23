/**
 * CreateServerDialog — create a new IDS-backed server (the + button).
 */
import { useState } from "react";
import { useServerStore } from "@/store/serverStore";
import { useLayoutStore } from "@/store/layoutStore";
import type { ServerDto } from "../types";

interface Props {
  onClose: () => void;
  onCreated?: (server: ServerDto) => void;
}

export default function CreateServerDialog({ onClose, onCreated }: Props) {
  const createServer = useServerStore((s) => s.createServer);
  const setActiveServer = useLayoutStore((s) => s.setActiveServer);

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleCreate = async () => {
    if (!name.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const server = await createServer(name.trim(), description.trim() || undefined);
      console.log("[CreateServerDialog] server created:", server.id, server.name);
      setActiveServer(server.id);
      onCreated?.(server);
      onClose();
    } catch (e) {
      console.error("[CreateServerDialog] error:", e);
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") handleCreate();
    if (e.key === "Escape") onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="dl-card max-w-md w-full mx-4 p-6 space-y-4">
        <div>
          <h2 className="text-lg font-bold text-white">Create a Server</h2>
          <p className="text-xs text-white/40 mt-1">
            Your server is where you and your team hang out. Make yours and start talking.
          </p>
        </div>

        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-white/60 mb-1 uppercase tracking-wide">
              Server Name <span className="text-red-400">*</span>
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="e.g. My Awesome Server"
              className="dl-input w-full"
              autoFocus
              maxLength={100}
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-white/60 mb-1 uppercase tracking-wide">
              Description <span className="text-white/30">(optional)</span>
            </label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="What's this server about?"
              className="dl-input w-full"
              maxLength={500}
            />
          </div>
        </div>

        {error && (
          <p className="text-sm text-red-400 bg-red-400/10 rounded px-3 py-2">{error}</p>
        )}

        <div className="flex gap-3 justify-end pt-1">
          <button onClick={onClose} className="dl-btn-ghost px-4 py-2 text-sm">
            Cancel
          </button>
          <button
            onClick={handleCreate}
            disabled={loading || !name.trim()}
            className="dl-btn-primary px-4 py-2 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? "Creating…" : "Create Server"}
          </button>
        </div>
      </div>
    </div>
  );
}
