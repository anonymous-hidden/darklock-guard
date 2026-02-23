import { useEffect, useMemo, useState } from "react";
import { Plus, FolderPlus, Pencil, Trash2, Check, X } from "lucide-react";
import { useServerStore } from "@/store/serverStore";
import ChannelTree from "@/components/ChannelTree";
import type { ChannelDto } from "@/types";

type ChannelType = "text" | "voice" | "announcement" | "rules" | "stage" | "forum" | "private_encrypted" | "read_only_news";

export default function ChannelsTab({ serverId }: { serverId: string }) {
  const channels = useServerStore((s) => s.channels[serverId] ?? []);
  const fetchChannels = useServerStore((s) => s.fetchChannels);
  const createChannel = useServerStore((s) => s.createChannel);
  const updateChannel = useServerStore((s) => s.updateChannel);
  const deleteChannel = useServerStore((s) => s.deleteChannel);
  const reorderChannels = useServerStore((s) => s.reorderChannels);

  const [showCreate, setShowCreate] = useState(false);
  const [showCreateCategory, setShowCreateCategory] = useState(false);
  const [newName, setNewName] = useState("");
  const [newType, setNewType] = useState<ChannelType>("text");
  const [newTopic, setNewTopic] = useState("");
  const [newCategoryId, setNewCategoryId] = useState<string | null>(null);
  const [editing, setEditing] = useState<ChannelDto | null>(null);
  const [editName, setEditName] = useState("");
  const [editTopic, setEditTopic] = useState("");
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  useEffect(() => {
    fetchChannels(serverId).catch(console.error);
  }, [serverId, fetchChannels]);

  const categories = useMemo(
    () => channels.filter((c) => c.type === "category").sort((a, b) => a.position - b.position),
    [channels],
  );

  const handleCreate = async () => {
    if (!newName.trim()) return;
    await createChannel(serverId, newName.trim(), newType, newTopic.trim() || undefined, newCategoryId);
    setNewName("");
    setNewTopic("");
    setNewType("text");
    setNewCategoryId(null);
    setShowCreate(false);
  };

  const handleCreateCategory = async () => {
    if (!newName.trim()) return;
    await createChannel(serverId, newName.trim(), "category");
    setNewName("");
    setShowCreateCategory(false);
  };

  return (
    <div className="space-y-5 max-w-2xl">
      <div className="flex items-center gap-2">
        <button
          onClick={() => { setShowCreate(true); setShowCreateCategory(false); }}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-dl-accent text-white text-sm font-medium hover:bg-dl-accent/85"
        >
          <Plus size={14} /> Create Channel
        </button>
        <button
          onClick={() => { setShowCreateCategory(true); setShowCreate(false); }}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-white/[0.05] text-white/65 text-sm font-medium hover:bg-white/[0.08]"
        >
          <FolderPlus size={14} /> Create Category
        </button>
      </div>

      {showCreate && (
        <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-4 space-y-3">
          <h3 className="text-sm font-semibold text-white/80">New Channel</h3>
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Channel name"
            className="w-full bg-white/[0.04] border border-white/[0.08] rounded-lg px-3 py-2 text-sm text-white/80"
          />
          <input
            value={newTopic}
            onChange={(e) => setNewTopic(e.target.value)}
            placeholder="Topic (optional)"
            className="w-full bg-white/[0.04] border border-white/[0.08] rounded-lg px-3 py-2 text-sm text-white/80"
          />
          <div className="flex gap-2">
            <select
              value={newType}
              onChange={(e) => setNewType(e.target.value as ChannelType)}
              className="bg-white/[0.04] border border-white/[0.08] rounded-lg px-3 py-2 text-sm text-white/80"
            >
              <option value="text">Text</option>
              <option value="voice">Voice</option>
              <option value="stage">Stage</option>
              <option value="announcement">Announcement</option>
              <option value="rules">Rules</option>
              <option value="forum">Forum</option>
              <option value="private_encrypted">Private E2E</option>
              <option value="read_only_news">Read-only News</option>
            </select>
            <select
              value={newCategoryId ?? ""}
              onChange={(e) => setNewCategoryId(e.target.value || null)}
              className="bg-white/[0.04] border border-white/[0.08] rounded-lg px-3 py-2 text-sm text-white/80"
            >
              <option value="">No category</option>
              {categories.map((cat) => (
                <option key={cat.id} value={cat.id}>{cat.name}</option>
              ))}
            </select>
          </div>
          <div className="flex justify-end gap-2">
            <button onClick={() => setShowCreate(false)} className="px-3 py-1.5 text-sm text-white/45 hover:text-white/70">Cancel</button>
            <button onClick={handleCreate} className="px-3 py-1.5 rounded bg-dl-accent text-white text-sm">Create</button>
          </div>
        </div>
      )}

      {showCreateCategory && (
        <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-4 space-y-3">
          <h3 className="text-sm font-semibold text-white/80">New Category</h3>
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Category name"
            className="w-full bg-white/[0.04] border border-white/[0.08] rounded-lg px-3 py-2 text-sm text-white/80"
          />
          <div className="flex justify-end gap-2">
            <button onClick={() => setShowCreateCategory(false)} className="px-3 py-1.5 text-sm text-white/45 hover:text-white/70">Cancel</button>
            <button onClick={handleCreateCategory} className="px-3 py-1.5 rounded bg-dl-accent text-white text-sm">Create</button>
          </div>
        </div>
      )}

      <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-3">
        <ChannelTree
          channels={channels}
          canManageChannels
          onReorder={async (layout) => reorderChannels(serverId, layout)}
          renderChannelSuffix={(channel) => (
            channel.type === "category" ? null : (
              <span className="flex items-center gap-1 ml-auto">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setEditing(channel);
                    setEditName(channel.name);
                    setEditTopic(channel.topic ?? "");
                  }}
                  className="p-1 rounded hover:bg-white/[0.08] text-white/35 hover:text-white/70"
                >
                  <Pencil size={11} />
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); setConfirmDeleteId(channel.id); }}
                  className="p-1 rounded hover:bg-red-500/10 text-white/30 hover:text-red-400"
                >
                  <Trash2 size={11} />
                </button>
              </span>
            )
          )}
        />
      </div>

      {editing && (
        <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-4 space-y-3">
          <h3 className="text-sm font-semibold text-white/80">Edit #{editing.name}</h3>
          <input
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
            className="w-full bg-white/[0.04] border border-white/[0.08] rounded-lg px-3 py-2 text-sm text-white/80"
          />
          <input
            value={editTopic}
            onChange={(e) => setEditTopic(e.target.value)}
            className="w-full bg-white/[0.04] border border-white/[0.08] rounded-lg px-3 py-2 text-sm text-white/80"
          />
          <div className="flex justify-end gap-2">
            <button onClick={() => setEditing(null)} className="inline-flex items-center gap-1 px-3 py-1.5 text-sm text-white/45 hover:text-white/70"><X size={12} /> Cancel</button>
            <button
              onClick={async () => {
                await updateChannel(serverId, editing.id, editName.trim() || editing.name, editTopic.trim());
                setEditing(null);
              }}
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded bg-dl-accent text-white text-sm"
            >
              <Check size={12} /> Save
            </button>
          </div>
        </div>
      )}

      {confirmDeleteId && (
        <div className="rounded-xl border border-red-500/25 bg-red-500/[0.06] p-4 flex items-center justify-between">
          <p className="text-sm text-red-300">Delete this channel?</p>
          <div className="flex gap-2">
            <button onClick={() => setConfirmDeleteId(null)} className="px-3 py-1.5 text-sm text-white/60 hover:text-white/80">Cancel</button>
            <button
              onClick={async () => {
                await deleteChannel(serverId, confirmDeleteId);
                setConfirmDeleteId(null);
              }}
              className="px-3 py-1.5 rounded bg-red-500 text-white text-sm"
            >
              Delete
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
