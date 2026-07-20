/**
 * ChannelsTab — Manage server channels (create, rename, reorder, delete).
 * Uses inline confirmation instead of browser confirm(), and supports
 * editing channel topic. Create channel modal with type selection.
 */
import { useEffect, useState } from "react";
import { Plus, Hash, Volume2, Trash2, Pencil, Check, X, MessageSquare, Megaphone, BookOpen, Lock, Radio, MessageCircle, Eye, GripVertical, FolderPlus, FolderOpen, ChevronDown, ChevronRight } from "lucide-react";
import clsx from "clsx";
import { useServerStore } from "@/store/serverStore";

type ChannelType = "text" | "voice" | "announcement" | "rules" | "stage" | "forum" | "private_encrypted" | "read_only_news";

const CHANNEL_TYPES: { value: ChannelType; label: string; desc: string; icon: React.ReactNode }[] = [
  { value: "text", label: "Text", desc: "Send messages, images, and files", icon: <Hash size={18} className="text-white/40" /> },
  { value: "voice", label: "Voice", desc: "Voice and video conversations", icon: <Volume2 size={18} className="text-white/40" /> },
  { value: "announcement", label: "Announcement", desc: "Important updates for members", icon: <Megaphone size={18} className="text-white/40" /> },
  { value: "rules", label: "Rules", desc: "Server rules and guidelines", icon: <BookOpen size={18} className="text-white/40" /> },
  { value: "stage", label: "Stage", desc: "Host talks, Q&As, and events", icon: <Radio size={18} className="text-purple-400/60" /> },
  { value: "forum", label: "Forum", desc: "Threaded discussions by topic", icon: <MessageCircle size={18} className="text-green-400/60" /> },
  { value: "private_encrypted", label: "Private", desc: "Invite only; group messaging is paused", icon: <Lock size={18} className="text-red-400/60" /> },
  { value: "read_only_news", label: "News Feed", desc: "Read-only announcements & news", icon: <Eye size={18} className="text-blue-400/60" /> },
];

function channelIcon(type: string | null) {
  switch (type) {
    case "voice": return <Volume2 size={14} className="text-white/30" />;
    case "announcement": return <Megaphone size={14} className="text-white/30" />;
    case "rules": return <BookOpen size={14} className="text-white/30" />;
    case "stage": return <Radio size={14} className="text-purple-400/40" />;
    case "forum": return <MessageCircle size={14} className="text-green-400/40" />;
    case "private_encrypted": return <Lock size={14} className="text-red-400/40" />;
    case "read_only_news": return <Eye size={14} className="text-blue-400/40" />;
    default: return <Hash size={14} className="text-white/30" />;
  }
}

export default function ChannelsTab({ serverId }: { serverId: string }) {
  const channels = useServerStore((s) => s.channels[serverId] ?? []);
  const fetchChannels = useServerStore((s) => s.fetchChannels);
  const createChannel = useServerStore((s) => s.createChannel);
  const updateChannel = useServerStore((s) => s.updateChannel);
  const deleteChannel = useServerStore((s) => s.deleteChannel);
  const reorderChannels = useServerStore((s) => s.reorderChannels);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editTopic, setEditTopic] = useState("");
  const [topicEditId, setTopicEditId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  // Drag state
  const [dragFromIdx, setDragFromIdx] = useState<number | null>(null);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);
  const [dragGroup, setDragGroup] = useState<string | null>(null);

  // Create modal state
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newType, setNewType] = useState<ChannelType>("text");
  const [newName, setNewName] = useState("");
  const [newTopic, setNewTopic] = useState("");
  const [creating, setCreating] = useState(false);

  // Category state
  const [showCreateCategoryModal, setShowCreateCategoryModal] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState("");
  const [creatingCategory, setCreatingCategory] = useState(false);
  const [newChannelCategoryId, setNewChannelCategoryId] = useState<string | null>(null);
  const [collapsedCategories, setCollapsedCategories] = useState<Set<string>>(new Set());

  useEffect(() => {
    fetchChannels(serverId);
  }, [serverId, fetchChannels]);

  const handleCreate = async () => {
    if (!newName.trim()) return;
    setCreating(true);
    try {
      await createChannel(serverId, newName.trim(), newType, newTopic.trim() || undefined, newChannelCategoryId);
      setNewName("");
      setNewTopic("");
      setNewType("text");
      setNewChannelCategoryId(null);
      setShowCreateModal(false);
    } finally {
      setCreating(false);
    }
  };

  const handleCreateCategory = async () => {
    if (!newCategoryName.trim()) return;
    setCreatingCategory(true);
    try {
      await createChannel(serverId, newCategoryName.trim(), "category");
      setNewCategoryName("");
      setShowCreateCategoryModal(false);
    } finally {
      setCreatingCategory(false);
    }
  };

  const handleSaveEdit = async (channelId: string) => {
    if (editName.trim()) {
      await updateChannel(serverId, channelId, editName.trim());
    }
    setEditingId(null);
  };

  const handleSaveTopic = async (channelId: string) => {
    await updateChannel(serverId, channelId, undefined, editTopic.trim());
    setTopicEditId(null);
  };

  const handleDelete = async (channelId: string) => {
    await deleteChannel(serverId, channelId);
    setConfirmDeleteId(null);
  };

  const handleDragStart = (e: React.DragEvent, groupLabel: string, idx: number, channelId: string) => {
    // dataTransfer.setData is required — without it WebKit aborts the drag silently
    e.dataTransfer.setData('text/plain', channelId);
    e.dataTransfer.effectAllowed = 'move';
    setDragGroup(groupLabel);
    setDragFromIdx(idx);
    setDragOverIdx(idx);
  };

  const handleDragOver = (e: React.DragEvent, groupLabel: string, idx: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (dragGroup !== groupLabel || dragFromIdx === null) return;
    setDragOverIdx(idx);
  };

  // targetIdx is the drop-target's idx passed directly — avoids stale-state bugs
  const handleDrop = async (e: React.DragEvent, items: typeof channels, targetIdx: number) => {
    e.preventDefault();
    const channelId = e.dataTransfer.getData('text/plain');
    const fromIdx = items.findIndex((c) => c.id === channelId);
    if (fromIdx === -1 || fromIdx === targetIdx) {
      setDragFromIdx(null);
      setDragOverIdx(null);
      setDragGroup(null);
      return;
    }
    const reordered = [...items];
    const [moved] = reordered.splice(fromIdx, 1);
    reordered.splice(targetIdx, 0, moved);
    setDragFromIdx(null);
    setDragOverIdx(null);
    setDragGroup(null);
    await reorderChannels(serverId, reordered.map((c) => c.id));
  };

  // Category-aware channel grouping
  const categoryChannels = channels.filter((c) => c.type === "category").sort((a, b) => a.position - b.position);
  const nonCategoryChannels = channels.filter((c) => c.type !== "category");
  const usedChannelIds = new Set<string>();
  const categorySections = categoryChannels.map((cat) => {
    const items = nonCategoryChannels.filter((c) => c.category_id === cat.id).sort((a, b) => a.position - b.position);
    items.forEach((c) => usedChannelIds.add(c.id));
    return { catId: cat.id, catName: cat.name, items };
  });
  const uncategorized = nonCategoryChannels.filter((c) => !usedChannelIds.has(c.id)).sort((a, b) => a.position - b.position);

  return (
    <div className="space-y-6 max-w-lg">
      {/* Header buttons */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => setShowCreateModal(true)}
          className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-dl-accent text-white text-sm font-medium hover:bg-dl-accent/80 transition-all"
        >
          <Plus size={14} />
          Create Channel
        </button>
        <button
          onClick={() => setShowCreateCategoryModal(true)}
          className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-white/[0.06] text-white/60 text-sm font-medium hover:bg-white/[0.1] transition-all border border-white/[0.06]"
        >
          <FolderPlus size={14} />
          Create Category
        </button>
      </div>

      {/* Create Channel Modal */}
      {showCreateModal && (
        <>
          <div className="fixed inset-0 z-40 bg-black/60" onClick={() => setShowCreateModal(false)} />
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="w-full max-w-md bg-[#1a1d27] border border-white/[0.08] rounded-2xl shadow-2xl p-6 space-y-5">
              <div className="flex items-center justify-between">
                <h3 className="text-base font-semibold text-white/80">Create Channel</h3>
                <button onClick={() => setShowCreateModal(false)} className="text-white/30 hover:text-white/60 transition-colors">
                  <X size={16} />
                </button>
              </div>

              {/* Channel Type Selection */}
              <div className="space-y-2">
                <label className="text-xs font-medium text-white/40 uppercase tracking-wider">Channel Type</label>
                <div className="grid grid-cols-2 gap-2">
                  {CHANNEL_TYPES.map((ct) => (
                    <button
                      key={ct.value}
                      onClick={() => setNewType(ct.value)}
                      className={`flex items-center gap-3 p-3 rounded-lg border transition-all text-left ${
                        newType === ct.value
                          ? "bg-dl-accent/10 border-dl-accent/40"
                          : "bg-white/[0.02] border-white/[0.06] hover:border-white/[0.12]"
                      }`}
                    >
                      {ct.icon}
                      <div className="min-w-0">
                        <p className="text-xs font-medium text-white/70">{ct.label}</p>
                        <p className="text-[10px] text-white/25 truncate">{ct.desc}</p>
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Channel Name */}
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-white/40 uppercase tracking-wider">Channel Name</label>
                <input
                  type="text"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="e.g. general"
                  onKeyDown={(e) => { if (e.key === "Enter" && newName.trim()) handleCreate(); }}
                  className="w-full bg-white/[0.04] border border-white/[0.06] rounded-lg px-3 py-2.5 text-sm text-white/70 placeholder:text-white/20 focus:outline-none focus:ring-1 focus:ring-dl-accent/50"
                  autoFocus
                />
              </div>

              {/* Topic (optional) */}
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-white/40 uppercase tracking-wider">Topic <span className="normal-case text-white/20">(optional)</span></label>
                <input
                  type="text"
                  value={newTopic}
                  onChange={(e) => setNewTopic(e.target.value)}
                  placeholder="What is this channel about?"
                  className="w-full bg-white/[0.04] border border-white/[0.06] rounded-lg px-3 py-2.5 text-sm text-white/70 placeholder:text-white/20 focus:outline-none focus:ring-1 focus:ring-dl-accent/50"
                />
              </div>

              {/* Category assignment (optional, only shown when categories exist) */}
              {categoryChannels.length > 0 && (
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-white/40 uppercase tracking-wider">Category <span className="normal-case text-white/20">(optional)</span></label>
                  <select
                    value={newChannelCategoryId ?? ""}
                    onChange={(e) => setNewChannelCategoryId(e.target.value || null)}
                    className="w-full bg-white/[0.04] border border-white/[0.06] rounded-lg px-3 py-2.5 text-sm text-white/70 focus:outline-none focus:ring-1 focus:ring-dl-accent/50"
                  >
                    <option value="">No category</option>
                    {categoryChannels.map((cat) => (
                      <option key={cat.id} value={cat.id}>{cat.name}</option>
                    ))}
                  </select>
                </div>
              )}

              {/* Actions */}
              <div className="flex justify-end gap-3 pt-2">
                <button
                  onClick={() => setShowCreateModal(false)}
                  className="px-4 py-2 rounded-lg text-sm text-white/40 hover:text-white/60 hover:bg-white/[0.04] transition-all"
                >
                  Cancel
                </button>
                <button
                  onClick={handleCreate}
                  disabled={!newName.trim() || creating}
                  className="px-5 py-2 rounded-lg bg-dl-accent text-white text-sm font-medium hover:bg-dl-accent/80 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {creating ? "Creating…" : "Create Channel"}
                </button>
              </div>
            </div>
          </div>
        </>
      )}

      {/* Create Category Modal */}
      {showCreateCategoryModal && (
        <>
          <div className="fixed inset-0 z-40 bg-black/60" onClick={() => setShowCreateCategoryModal(false)} />
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="w-full max-w-sm bg-[#1a1d27] border border-white/[0.08] rounded-2xl shadow-2xl p-6 space-y-5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <FolderOpen size={16} className="text-dl-accent/60" />
                  <h3 className="text-base font-semibold text-white/80">Create Category</h3>
                </div>
                <button onClick={() => setShowCreateCategoryModal(false)} className="text-white/30 hover:text-white/60 transition-colors"><X size={16} /></button>
              </div>
              <p className="text-xs text-white/30">Categories group channels into collapsible sections.</p>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-white/40 uppercase tracking-wider">Category Name</label>
                <input
                  type="text"
                  value={newCategoryName}
                  onChange={(e) => setNewCategoryName(e.target.value)}
                  placeholder="e.g. Information"
                  onKeyDown={(e) => { if (e.key === "Enter" && newCategoryName.trim()) handleCreateCategory(); }}
                  className="w-full bg-white/[0.04] border border-white/[0.06] rounded-lg px-3 py-2.5 text-sm text-white/70 placeholder:text-white/20 focus:outline-none focus:ring-1 focus:ring-dl-accent/50"
                  autoFocus
                />
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <button onClick={() => setShowCreateCategoryModal(false)} className="px-4 py-2 rounded-lg text-sm text-white/40 hover:text-white/60 hover:bg-white/[0.04] transition-all">Cancel</button>
                <button
                  onClick={handleCreateCategory}
                  disabled={!newCategoryName.trim() || creatingCategory}
                  className="px-5 py-2 rounded-lg bg-dl-accent text-white text-sm font-medium hover:bg-dl-accent/80 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {creatingCategory ? "Creating…" : "Create Category"}
                </button>
              </div>
            </div>
          </div>
        </>
      )}

      {/* Uncategorized channels */}
      {uncategorized.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-white/30 uppercase tracking-wider mb-2">Uncategorized</p>
          <div className="space-y-1">
            {uncategorized.map((ch, idx) => (
              <div
                key={ch.id}
                draggable
                onDragStart={(e) => handleDragStart(e, "uncategorized", idx, ch.id)}
                onDragOver={(e) => handleDragOver(e, "uncategorized", idx)}
                onDrop={(e) => handleDrop(e, uncategorized, idx)}
                onDragEnd={() => { setDragFromIdx(null); setDragOverIdx(null); setDragGroup(null); }}
                className={clsx(
                  "transition-all",
                  dragGroup === "uncategorized" && dragFromIdx === idx && "opacity-50",
                  dragGroup === "uncategorized" && dragOverIdx === idx && dragFromIdx !== null && dragFromIdx !== idx && "ring-1 ring-dl-accent/40 rounded-lg"
                )}
              >
                <ChannelRow
                  name={ch.name}
                  topic={ch.topic ?? ""}
                  icon={channelIcon(ch.type)}
                  isEditing={editingId === ch.id}
                  isEditingTopic={topicEditId === ch.id}
                  isConfirmingDelete={confirmDeleteId === ch.id}
                  editName={editName}
                  editTopic={editTopic}
                  onEditNameChange={setEditName}
                  onEditTopicChange={setEditTopic}
                  onStartEdit={() => { setEditingId(ch.id); setEditName(ch.name); }}
                  onStartTopicEdit={() => { setTopicEditId(ch.id); setEditTopic(ch.topic ?? ""); }}
                  onSaveEdit={() => handleSaveEdit(ch.id)}
                  onSaveTopic={() => handleSaveTopic(ch.id)}
                  onCancelEdit={() => setEditingId(null)}
                  onCancelTopicEdit={() => setTopicEditId(null)}
                  onRequestDelete={() => setConfirmDeleteId(ch.id)}
                  onConfirmDelete={() => handleDelete(ch.id)}
                  onCancelDelete={() => setConfirmDeleteId(null)}
                />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Category sections */}
      {categorySections.map(({ catId, catName, items }) => (
        <div key={catId} className="border border-white/[0.05] rounded-xl overflow-hidden">
          <div className="flex items-center gap-2 px-3 py-2.5 bg-white/[0.025] group/cat">
            <button
              onClick={() => setCollapsedCategories((prev) => { const s = new Set(prev); s.has(catId) ? s.delete(catId) : s.add(catId); return s; })}
              className="flex items-center gap-2 flex-1 text-left min-w-0"
            >
              {collapsedCategories.has(catId)
                ? <ChevronRight size={11} className="text-white/30 shrink-0" />
                : <ChevronDown size={11} className="text-white/30 shrink-0" />}
              <FolderOpen size={13} className="text-dl-accent/50 shrink-0" />
              <span className="text-xs font-semibold text-white/50 uppercase tracking-wider truncate">{catName}</span>
              <span className="text-[10px] text-white/20 ml-1">({items.length})</span>
            </button>
            <button
              onClick={() => { if (editingId !== catId) { setEditingId(catId); setEditName(catName); } else setEditingId(null); }}
              className="opacity-0 group-hover/cat:opacity-100 p-1 text-white/20 hover:text-white/60 transition-all shrink-0"
              title="Rename category"
            >
              <Pencil size={11} />
            </button>
            <button
              onClick={() => setConfirmDeleteId(catId)}
              className="opacity-0 group-hover/cat:opacity-100 p-1 text-white/20 hover:text-red-400 transition-all shrink-0"
              title="Delete category"
            >
              <Trash2 size={11} />
            </button>
          </div>
          {editingId === catId && (
            <div className="flex items-center gap-2 px-3 py-2 bg-white/[0.02] border-t border-white/[0.05]">
              <input
                type="text"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") handleSaveEdit(catId); if (e.key === "Escape") setEditingId(null); }}
                className="flex-1 bg-white/[0.06] border border-white/[0.1] rounded-md px-2 py-1 text-sm text-white/90 focus:outline-none"
                autoFocus
              />
              <button onClick={() => handleSaveEdit(catId)} className="text-green-400 hover:text-green-300"><Check size={13} /></button>
              <button onClick={() => setEditingId(null)} className="text-white/30 hover:text-white/60"><X size={13} /></button>
            </div>
          )}
          {confirmDeleteId === catId && (
            <div className="flex items-center gap-2 px-3 py-2 bg-red-500/[0.06] border-t border-red-500/20">
              <span className="flex-1 text-sm text-red-400">Delete <strong>{catName}</strong>? Channels will become uncategorized.</span>
              <button onClick={() => handleDelete(catId)} className="px-3 py-1 rounded-md bg-red-500 text-white text-xs font-medium hover:bg-red-600">Delete</button>
              <button onClick={() => setConfirmDeleteId(null)} className="px-3 py-1 rounded-md bg-white/[0.06] text-white/50 text-xs hover:bg-white/[0.1]">Cancel</button>
            </div>
          )}
          {!collapsedCategories.has(catId) && (
            <div className="p-2 space-y-1">
              {items.length === 0 && (
                <p className="text-xs text-white/15 italic px-2 py-1">No channels yet — create a channel and assign it to this category.</p>
              )}
              {items.map((ch, idx) => (
                <div
                  key={ch.id}
                  draggable
                  onDragStart={(e) => handleDragStart(e, catId, idx, ch.id)}
                  onDragOver={(e) => handleDragOver(e, catId, idx)}
                  onDrop={(e) => handleDrop(e, items, idx)}
                  onDragEnd={() => { setDragFromIdx(null); setDragOverIdx(null); setDragGroup(null); }}
                  className={clsx(
                    "transition-all",
                    dragGroup === catId && dragFromIdx === idx && "opacity-50",
                    dragGroup === catId && dragOverIdx === idx && dragFromIdx !== null && dragFromIdx !== idx && "ring-1 ring-dl-accent/40 rounded-lg"
                  )}
                >
                  <ChannelRow
                    name={ch.name}
                    topic={ch.topic ?? ""}
                    icon={channelIcon(ch.type)}
                    isEditing={editingId === ch.id}
                    isEditingTopic={topicEditId === ch.id}
                    isConfirmingDelete={confirmDeleteId === ch.id}
                    editName={editName}
                    editTopic={editTopic}
                    onEditNameChange={setEditName}
                    onEditTopicChange={setEditTopic}
                    onStartEdit={() => { setEditingId(ch.id); setEditName(ch.name); }}
                    onStartTopicEdit={() => { setTopicEditId(ch.id); setEditTopic(ch.topic ?? ""); }}
                    onSaveEdit={() => handleSaveEdit(ch.id)}
                    onSaveTopic={() => handleSaveTopic(ch.id)}
                    onCancelEdit={() => setEditingId(null)}
                    onCancelTopicEdit={() => setTopicEditId(null)}
                    onRequestDelete={() => setConfirmDeleteId(ch.id)}
                    onConfirmDelete={() => handleDelete(ch.id)}
                    onCancelDelete={() => setConfirmDeleteId(null)}
                  />
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function ChannelRow({
  name,
  topic,
  icon,
  isEditing,
  isEditingTopic,
  isConfirmingDelete,
  editName,
  editTopic,
  onEditNameChange,
  onEditTopicChange,
  onStartEdit,
  onStartTopicEdit,
  onSaveEdit,
  onSaveTopic,
  onCancelEdit,
  onCancelTopicEdit,
  onRequestDelete,
  onConfirmDelete,
  onCancelDelete,
}: {
  name: string;
  topic: string;
  icon: React.ReactNode;
  isEditing: boolean;
  isEditingTopic: boolean;
  isConfirmingDelete: boolean;
  editName: string;
  editTopic: string;
  onEditNameChange: (v: string) => void;
  onEditTopicChange: (v: string) => void;
  onStartEdit: () => void;
  onStartTopicEdit: () => void;
  onSaveEdit: () => void;
  onSaveTopic: () => void;
  onCancelEdit: () => void;
  onCancelTopicEdit: () => void;
  onRequestDelete: () => void;
  onConfirmDelete: () => void;
  onCancelDelete: () => void;
}) {
  if (isConfirmingDelete) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-red-500/[0.06] border border-red-500/20">
        {icon}
        <span className="flex-1 text-sm text-red-400">Delete <strong>{name}</strong>?</span>
        <button
          onClick={onConfirmDelete}
          className="px-3 py-1 rounded-md bg-red-500 text-white text-xs font-medium hover:bg-red-600 transition-all"
        >
          Delete
        </button>
        <button
          onClick={onCancelDelete}
          className="px-3 py-1 rounded-md bg-white/[0.06] text-white/50 text-xs hover:bg-white/[0.1] transition-all"
        >
          Cancel
        </button>
      </div>
    );
  }

  return (
    <div className="px-3 py-2 rounded-lg hover:bg-white/[0.03] group transition-all">
      <div className="flex items-center gap-2">
        <GripVertical size={12} className="text-white/15 shrink-0 cursor-grab" />
        {icon}
        {isEditing ? (
          <div className="flex items-center gap-2 flex-1">
            <input
              type="text"
              value={editName}
              onChange={(e) => onEditNameChange(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") onSaveEdit(); if (e.key === "Escape") onCancelEdit(); }}
              className="flex-1 bg-white/[0.06] border border-white/[0.1] rounded-md px-2 py-1 text-sm text-white/90 focus:outline-none"
              autoFocus
            />
            <button onClick={onSaveEdit} className="text-green-400 hover:text-green-300">
              <Check size={14} />
            </button>
            <button onClick={onCancelEdit} className="text-white/30 hover:text-white/60">
              <X size={14} />
            </button>
          </div>
        ) : (
          <>
            <span className="flex-1 text-sm text-white/60">{name}</span>
            <button
              onClick={onStartTopicEdit}
              className="opacity-0 group-hover:opacity-100 p-1 text-white/20 hover:text-dl-accent/70 transition-all"
              title="Edit topic"
            >
              <MessageSquare size={12} />
            </button>
            <button
              onClick={onStartEdit}
              className="opacity-0 group-hover:opacity-100 p-1 text-white/20 hover:text-white/60 transition-all"
              title="Rename"
            >
              <Pencil size={12} />
            </button>
            <button
              onClick={onRequestDelete}
              className="opacity-0 group-hover:opacity-100 p-1 text-white/20 hover:text-red-400 transition-all"
              title="Delete"
            >
              <Trash2 size={12} />
            </button>
          </>
        )}
      </div>
      {/* Topic editing row */}
      {isEditingTopic && (
        <div className="mt-2 ml-6 flex items-center gap-2">
          <input
            type="text"
            value={editTopic}
            onChange={(e) => onEditTopicChange(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") onSaveTopic(); if (e.key === "Escape") onCancelTopicEdit(); }}
            placeholder="Channel topic…"
            className="flex-1 bg-white/[0.04] border border-white/[0.06] rounded-md px-2 py-1 text-xs text-white/60 placeholder:text-white/15 focus:outline-none"
            autoFocus
          />
          <button onClick={onSaveTopic} className="text-green-400 hover:text-green-300">
            <Check size={12} />
          </button>
          <button onClick={onCancelTopicEdit} className="text-white/30 hover:text-white/60">
            <X size={12} />
          </button>
        </div>
      )}
      {/* Show existing topic if not editing */}
      {!isEditingTopic && topic && (
        <p className="ml-6 mt-0.5 text-[10px] text-white/20 truncate">{topic}</p>
      )}
    </div>
  );
}
