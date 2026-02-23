/**
 * RolesTab — Discord-style split-panel role management.
 *
 * Left panel: Role list with drag-to-reorder + Create button.
 * Right panel: RoleEditor with sub-tabs:
 *   - Display   (name, color, hoist, tag)
 *   - Permissions
 *   - Members   (who has this role)
 *   - Channel Overrides (per-channel allow/deny)
 */
import { useEffect, useState, useCallback } from "react";
import {
  Plus,
  GripVertical,
  Trash2,
  Shield,
  ShieldCheck,
  Tag,
  ChevronRight,
  Users,
  Hash,
  Palette,
  Lock,
  Eye,
  X,
  Search,
  AlertTriangle,
  Crown,
  ImagePlus,
} from "lucide-react";
import clsx from "clsx";
import { useServerStore } from "@/store/serverStore";
import type { PermissionKey, ServerMemberDto } from "@/types";
import {
  Permissions,
  PERMISSION_LABELS,
  PERMISSION_CATEGORIES,
  hasPermission,
  togglePermission,
} from "@/types";

// ── Color presets ────────────────────────────────────────────────
const PRESET_COLORS = [
  "#99AAB5", "#1ABC9C", "#2ECC71", "#3498DB", "#9B59B6",
  "#E91E63", "#F1C40F", "#E67E22", "#E74C3C", "#95A5A6",
  "#607D8B", "#11806A", "#1F8B4C", "#206694", "#71368A",
  "#AD1457", "#C27C0E", "#A84300", "#992D22", "#979C9F",
];
const MAX_BADGE_BYTES = 512 * 1024;

type RoleSubTab = "display" | "permissions" | "members" | "overrides";

const SUB_TABS: { id: RoleSubTab; label: string; icon: typeof Palette }[] = [
  { id: "display",     label: "Display",     icon: Palette },
  { id: "permissions", label: "Permissions",  icon: Shield },
  { id: "members",     label: "Members",      icon: Users },
  { id: "overrides",   label: "Overrides",    icon: Lock },
];

export default function RolesTab({ serverId }: { serverId: string }) {
  const roles = useServerStore((s) => s.roles[serverId] ?? []);
  const fetchRoles = useServerStore((s) => s.fetchRoles);
  const createRole = useServerStore((s) => s.createRole);
  const updateRole = useServerStore((s) => s.updateRole);
  const deleteRole = useServerStore((s) => s.deleteRole);
  const reorderRoles = useServerStore((s) => s.reorderRoles);

  const [selectedRoleId, setSelectedRoleId] = useState<string | null>(null);
  const [activeSubTab, setActiveSubTab] = useState<RoleSubTab>("display");
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [dirty, setDirty] = useState(false);

  // Create modal state
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createName, setCreateName] = useState("New Role");
  const [createColor, setCreateColor] = useState("#99AAB5");
  const [createShowTag, setCreateShowTag] = useState(true);
  const [creating, setCreating] = useState(false);

  // Editor state
  const [editName, setEditName] = useState("");
  const [editColor, setEditColor] = useState("#99AAB5");
  const [editPerms, setEditPerms] = useState("0");
  const [editAdmin, setEditAdmin] = useState(false);
  const [editShowTag, setEditShowTag] = useState(true);
  const [editHoist, setEditHoist] = useState(false);
  const [editTagStyle, setEditTagStyle] = useState("dot");
  const [editSeparateMembers, setEditSeparateMembers] = useState(false);
  const [editBadgeImageUrl, setEditBadgeImageUrl] = useState<string | null>(null);

  useEffect(() => {
    fetchRoles(serverId);
  }, [serverId, fetchRoles]);

  const selectedRole = roles.find((r) => r.id === selectedRoleId);

  // Sync editor state when role selection changes
  useEffect(() => {
    if (selectedRole) {
      setEditName(selectedRole.name);
      setEditColor(selectedRole.color_hex);
      setEditPerms(selectedRole.permissions);
      setEditAdmin(selectedRole.is_admin);
      setEditShowTag(selectedRole.show_tag);
      setEditHoist(selectedRole.hoist ?? false);
      setEditTagStyle(selectedRole.tag_style ?? "dot");
      setEditSeparateMembers(selectedRole.separate_members ?? false);
      setEditBadgeImageUrl(selectedRole.badge_image_url ?? null);
      setConfirmDelete(false);
      setDirty(false);
      setActiveSubTab("display");
    }
  }, [selectedRoleId, selectedRole?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Track dirty
  const markDirty = useCallback(() => setDirty(true), []);

  const handleCreate = async () => {
    if (!createName.trim()) return;
    setCreating(true);
    try {
      const role = await createRole(
        serverId,
        createName.trim(),
        createColor,
        undefined,
        false,
        createShowTag,
      );
      setSelectedRoleId(role.id);
      setShowCreateModal(false);
      setCreateName("New Role");
      setCreateColor("#99AAB5");
      setCreateShowTag(true);
    } finally {
      setCreating(false);
    }
  };

  const handleSave = async () => {
    if (!selectedRoleId) return;
    setSaving(true);
    try {
      await updateRole(serverId, selectedRoleId, {
        name: editName,
        colorHex: editColor,
        permissions: editPerms,
        isAdmin: editAdmin,
        showTag: editShowTag,
        hoist: editHoist,
        tagStyle: editTagStyle,
        separateMembers: editSeparateMembers,
        badgeImageUrl: editBadgeImageUrl,
      });
      setDirty(false);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!selectedRoleId) return;
    await deleteRole(serverId, selectedRoleId);
    setSelectedRoleId(null);
    setConfirmDelete(false);
  };

  const handleTogglePerm = useCallback(
    (permKey: PermissionKey) => {
      const perm = Permissions[permKey];
      const current = hasPermission(editPerms, perm);
      setEditPerms(togglePermission(editPerms, perm, !current));
      setDirty(true);
    },
    [editPerms]
  );

  // ── Drag & drop reorder ────────────────────────────────────────
  const [dragFromIdx, setDragFromIdx] = useState<number | null>(null);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);

  const handleDragStart = (idx: number) => {
    setDragFromIdx(idx);
    setDragOverIdx(idx);
  };

  const handleDragOver = (e: React.DragEvent, idx: number) => {
    e.preventDefault();
    if (dragFromIdx === null || dragFromIdx === idx) return;
    setDragOverIdx(idx);
  };

  const handleDrop = async () => {
    if (dragFromIdx === null || dragOverIdx === null || dragFromIdx === dragOverIdx) {
      setDragFromIdx(null);
      setDragOverIdx(null);
      return;
    }
    // Build reordered array: move the dragged role to the target position
    const reordered = [...roles];
    const [moved] = reordered.splice(dragFromIdx, 1);
    reordered.splice(dragOverIdx, 0, moved);
    const orderedIds = reordered.map((r) => r.id);
    setDragFromIdx(null);
    setDragOverIdx(null);
    await reorderRoles(serverId, orderedIds);
  };

  // Keyboard reorder (Alt+Up/Down)
  const handleKeyReorder = useCallback(
    async (e: React.KeyboardEvent, idx: number) => {
      if (!e.altKey) return;
      const roleArr = [...roles];
      if (e.key === "ArrowUp" && idx > 0) {
        e.preventDefault();
        [roleArr[idx - 1], roleArr[idx]] = [roleArr[idx], roleArr[idx - 1]];
        await reorderRoles(serverId, roleArr.map((r) => r.id));
      } else if (e.key === "ArrowDown" && idx < roleArr.length - 1) {
        e.preventDefault();
        [roleArr[idx], roleArr[idx + 1]] = [roleArr[idx + 1], roleArr[idx]];
        await reorderRoles(serverId, roleArr.map((r) => r.id));
      }
    },
    [roles, serverId, reorderRoles]
  );

  const isEveryone = selectedRole?.position === 0;

  return (
    <div className="flex gap-0 h-full min-h-[500px] -mx-10 -mt-2">
      {/* ══════ Create Role Modal ══════ */}
      {showCreateModal && (
        <>
          <div className="fixed inset-0 z-40 bg-black/60" onClick={() => setShowCreateModal(false)} />
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="w-full max-w-sm bg-[#1a1d27] border border-white/[0.08] rounded-2xl shadow-2xl p-6 space-y-5">
              <div className="flex items-center justify-between">
                <h3 className="text-base font-semibold text-white/80">Create Role</h3>
                <button onClick={() => setShowCreateModal(false)} className="text-white/30 hover:text-white/60 transition-colors">
                  <X size={16} />
                </button>
              </div>

              {/* Role Name */}
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-white/40 uppercase tracking-wider">Role Name</label>
                <input
                  type="text"
                  value={createName}
                  onChange={(e) => setCreateName(e.target.value)}
                  placeholder="e.g. Moderator"
                  className="w-full bg-white/[0.04] border border-white/[0.06] rounded-lg px-3 py-2.5 text-sm text-white/70 placeholder:text-white/20 focus:outline-none focus:ring-1 focus:ring-dl-accent/50"
                  autoFocus
                />
              </div>

              {/* Color */}
              <div className="space-y-2">
                <label className="text-xs font-medium text-white/40 uppercase tracking-wider">Color</label>
                <div className="flex flex-wrap gap-1.5">
                  {PRESET_COLORS.map((c) => (
                    <button
                      key={c}
                      onClick={() => setCreateColor(c)}
                      className={`w-6 h-6 rounded-full border-2 transition-all ${
                        createColor === c ? "border-white/60 scale-110" : "border-transparent hover:border-white/20"
                      }`}
                      style={{ backgroundColor: c }}
                    />
                  ))}
                </div>
              </div>

              {/* Show Tag Toggle */}
              <label className="flex items-center gap-3 cursor-pointer">
                <div
                  className={`w-9 h-5 rounded-full transition-all relative ${createShowTag ? "bg-dl-accent" : "bg-white/10"}`}
                  onClick={() => setCreateShowTag(!createShowTag)}
                >
                  <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all ${createShowTag ? "left-[18px]" : "left-0.5"}`} />
                </div>
                <span className="text-xs text-white/50">Show role tag next to name</span>
              </label>

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
                  disabled={!createName.trim() || creating}
                  className="px-5 py-2 rounded-lg bg-dl-accent text-white text-sm font-medium hover:bg-dl-accent/80 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {creating ? "Creating…" : "Create Role"}
                </button>
              </div>
            </div>
          </div>
        </>
      )}

      {/* ══════════ Left: Role List ══════════ */}
      <div className="w-[250px] shrink-0 flex flex-col border-r border-white/[0.06] px-4 py-2">
        <div className="flex items-center justify-between mb-3">
          <span className="text-xs font-semibold text-white/40 uppercase tracking-wider">
            Roles — {roles.length}
          </span>
          <button
            onClick={() => setShowCreateModal(true)}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-md text-xs font-medium text-dl-accent hover:bg-dl-accent/10 transition-all"
            aria-label="Create new role"
          >
            <Plus size={12} />
            Create
          </button>
        </div>

        <div className="flex-1 overflow-y-auto space-y-0.5 overscroll-contain" role="listbox" aria-label="Server roles">
          {roles.map((role, idx) => (
            <div
              key={role.id}
              role="option"
              aria-selected={selectedRoleId === role.id}
              tabIndex={0}
              draggable={role.position !== 0}
              onDragStart={() => handleDragStart(idx)}
              onDragOver={(e) => handleDragOver(e, idx)}
              onDrop={handleDrop}
              onDragEnd={() => { setDragFromIdx(null); setDragOverIdx(null); }}
              onClick={() => setSelectedRoleId(role.id)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  setSelectedRoleId(role.id);
                }
                handleKeyReorder(e, idx);
              }}
              className={clsx(
                "flex items-center gap-2 px-3 py-2.5 rounded-lg cursor-pointer transition-all text-sm select-none",
                selectedRoleId === role.id
                  ? "bg-white/[0.08] text-white shadow-[inset_0_0_0_1px_rgba(99,102,241,0.15)]"
                  : "text-white/50 hover:bg-white/[0.04] hover:text-white/70",
                dragFromIdx === idx && "opacity-50",
                dragOverIdx === idx && dragFromIdx !== null && dragFromIdx !== idx && "ring-1 ring-dl-accent/40"
              )}
            >
              {role.position !== 0 && (
                <GripVertical size={12} className="text-white/20 shrink-0 cursor-grab" aria-hidden />
              )}
              <div
                className="w-3 h-3 rounded-full shrink-0 ring-1 ring-white/10"
                style={{ backgroundColor: role.color_hex }}
              />
              <span className="flex-1 truncate">{role.name}</span>
              {role.is_admin && <ShieldCheck size={12} className="text-amber-400/60 shrink-0" aria-label="Administrator" />}
              {role.member_count != null && (
                <span className="text-[10px] text-white/25 tabular-nums">{role.member_count}</span>
              )}
              <ChevronRight size={12} className={clsx(
                "shrink-0 transition-transform",
                selectedRoleId === role.id ? "text-white/30 rotate-0" : "text-white/10"
              )} />
            </div>
          ))}
        </div>
      </div>

      {/* ══════════ Right: Role Editor ══════════ */}
      {selectedRole ? (
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Sub-tab bar */}
          <div className="flex items-center gap-1 px-6 pt-3 pb-2 border-b border-white/[0.06] shrink-0" role="tablist">
            {SUB_TABS.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                role="tab"
                aria-selected={activeSubTab === id}
                onClick={() => setActiveSubTab(id)}
                className={clsx(
                  "flex items-center gap-2 px-4 py-2 rounded-md text-xs font-medium transition-all",
                  activeSubTab === id
                    ? "bg-white/[0.08] text-white"
                    : "text-white/35 hover:text-white/60 hover:bg-white/[0.03]"
                )}
              >
                <Icon size={13} />
                {label}
              </button>
            ))}

            {/* Save button pinned right */}
            <div className="flex-1" />
            {dirty && (
              <button
                onClick={handleSave}
                disabled={saving}
                className="px-5 py-1.5 rounded-md bg-dl-accent text-white text-xs font-medium hover:bg-dl-accent/80 disabled:opacity-50 transition-all animate-in fade-in"
              >
                {saving ? "Saving…" : "Save Changes"}
              </button>
            )}
          </div>

          {/* Sub-tab content */}
          <div className="flex-1 overflow-y-auto px-6 py-5 overscroll-contain" role="tabpanel">
            {activeSubTab === "display" && (
              <DisplaySubTab
                editName={editName}
                setEditName={(v) => { setEditName(v); markDirty(); }}
                editColor={editColor}
                setEditColor={(v) => { setEditColor(v); markDirty(); }}
                editShowTag={editShowTag}
                setEditShowTag={(v) => { setEditShowTag(v); markDirty(); }}
                editHoist={editHoist}
                setEditHoist={(v) => { setEditHoist(v); markDirty(); }}
                editAdmin={editAdmin}
                setEditAdmin={(v) => { setEditAdmin(v); markDirty(); }}
                editTagStyle={editTagStyle}
                setEditTagStyle={(v) => { setEditTagStyle(v); markDirty(); }}
                editSeparateMembers={editSeparateMembers}
                setEditSeparateMembers={(v) => { setEditSeparateMembers(v); markDirty(); }}
                editBadgeImageUrl={editBadgeImageUrl}
                setEditBadgeImageUrl={(v) => { setEditBadgeImageUrl(v); markDirty(); }}
                isEveryone={isEveryone}
                onDelete={confirmDelete ? handleDelete : undefined}
                confirmDelete={confirmDelete}
                setConfirmDelete={setConfirmDelete}
              />
            )}

            {activeSubTab === "permissions" && (
              <PermissionsSubTab
                editPerms={editPerms}
                editAdmin={editAdmin}
                onToggle={handleTogglePerm}
                isEveryone={isEveryone}
              />
            )}

            {activeSubTab === "members" && (
              <MembersSubTab serverId={serverId} roleId={selectedRole.id} roleName={selectedRole.name} />
            )}

            {activeSubTab === "overrides" && (
              <OverridesSubTab serverId={serverId} roleId={selectedRole.id} roleName={selectedRole.name} />
            )}
          </div>
        </div>
      ) : (
        <div className="flex-1 flex flex-col items-center justify-center text-white/15 gap-3">
          <Shield size={40} strokeWidth={1} />
          <p className="text-sm">Select a role to edit</p>
          <p className="text-xs text-white/10">Use Alt+↑↓ to reorder roles</p>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
//  Display Sub-Tab
// ═══════════════════════════════════════════════════════════════════════════════

function DisplaySubTab({
  editName, setEditName,
  editColor, setEditColor,
  editShowTag, setEditShowTag,
  editHoist, setEditHoist,
  editAdmin, setEditAdmin,
  editTagStyle, setEditTagStyle,
  editSeparateMembers, setEditSeparateMembers,
  editBadgeImageUrl, setEditBadgeImageUrl,
  isEveryone,
  onDelete,
  confirmDelete,
  setConfirmDelete,
}: {
  editName: string; setEditName: (v: string) => void;
  editColor: string; setEditColor: (v: string) => void;
  editShowTag: boolean; setEditShowTag: (v: boolean) => void;
  editHoist: boolean; setEditHoist: (v: boolean) => void;
  editAdmin: boolean; setEditAdmin: (v: boolean) => void;
  editTagStyle: string; setEditTagStyle: (v: string) => void;
  editSeparateMembers: boolean; setEditSeparateMembers: (v: boolean) => void;
  editBadgeImageUrl: string | null; setEditBadgeImageUrl: (v: string | null) => void;
  isEveryone: boolean;
  onDelete?: () => void;
  confirmDelete: boolean;
  setConfirmDelete: (v: boolean) => void;
}) {
  const badgeInputId = "role-badge-upload-input";

  const onSelectBadge = (file?: File | null) => {
    if (!file) return;
    const isAllowed = ["image/png", "image/jpeg", "image/webp", "image/gif", "image/svg+xml"].includes(file.type);
    if (!isAllowed || file.size > MAX_BADGE_BYTES) return;
    const fr = new FileReader();
    fr.onload = () => {
      if (typeof fr.result === "string") {
        setEditBadgeImageUrl(fr.result);
      }
    };
    fr.readAsDataURL(file);
  };

  return (
    <div className="space-y-7 max-w-xl">
      {/* Role name */}
      <div>
        <label className="block text-xs font-semibold text-white/40 uppercase tracking-wider mb-2">
          Role Name
        </label>
        <input
          type="text"
          value={editName}
          onChange={(e) => setEditName(e.target.value)}
          disabled={isEveryone}
          className="w-full max-w-md bg-white/[0.04] border border-white/[0.06] rounded-lg px-4 py-2.5 text-sm text-white/90 focus:outline-none focus:ring-1 focus:ring-dl-accent/50 disabled:opacity-50 transition-all"
          maxLength={100}
          aria-label="Role name"
        />
        {isEveryone && (
          <p className="mt-1.5 text-xs text-white/25 flex items-center gap-1.5">
            <Eye size={11} />
            The @everyone role applies to all members and cannot be renamed or deleted.
          </p>
        )}
      </div>

      {/* Color picker */}
      <div>
        <label className="block text-xs font-semibold text-white/40 uppercase tracking-wider mb-2">
          Role Color
        </label>
        <div className="flex flex-wrap gap-2 mb-3">
          {PRESET_COLORS.map((c) => (
            <button
              key={c}
              onClick={() => setEditColor(c)}
              className={clsx(
                "w-7 h-7 rounded-full border-2 transition-all focus:outline-none focus:ring-2 focus:ring-dl-accent/50",
                editColor === c ? "border-white scale-110" : "border-transparent hover:border-white/30"
              )}
              style={{ backgroundColor: c }}
              aria-label={`Color ${c}`}
            />
          ))}
        </div>
        <div className="flex items-center gap-3">
          <input
            type="color"
            value={editColor}
            onChange={(e) => setEditColor(e.target.value)}
            className="w-9 h-9 rounded-lg border border-white/[0.06] cursor-pointer bg-transparent"
          />
          <input
            type="text"
            value={editColor}
            onChange={(e) => setEditColor(e.target.value)}
            className="w-24 bg-white/[0.04] border border-white/[0.06] rounded-lg px-3 py-1.5 text-xs text-white/70 font-mono focus:outline-none"
            maxLength={7}
          />
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white/[0.04]">
            <div className="w-3 h-3 rounded-full" style={{ backgroundColor: editColor }} />
            <span className="text-sm" style={{ color: editColor }}>{editName || "Role"}</span>
          </div>
        </div>
      </div>

      {/* Toggles grid */}
      <div className="grid grid-cols-2 gap-4">
        <ToggleRow
          icon={<Tag size={13} />}
          label="Show role tag"
          description="Display a tag next to members"
          checked={editShowTag}
          onChange={setEditShowTag}
        />
        <ToggleRow
          icon={<Users size={13} />}
          label="Hoist members"
          description="Show members separately in the sidebar"
          checked={editHoist}
          onChange={setEditHoist}
        />
        <ToggleRow
          icon={<Users size={13} />}
          label="Separate members"
          description="Role creates its own member list section"
          checked={editSeparateMembers}
          onChange={setEditSeparateMembers}
        />
        <ToggleRow
          icon={<Shield size={13} />}
          label="Administrator"
          description="Full access to all permissions"
          checked={editAdmin}
          onChange={setEditAdmin}
          variant="danger"
        />
        <div>
          <label className="block text-xs font-semibold text-white/30 uppercase tracking-wider mb-1.5">
            Tag Style
          </label>
          <select
            value={editTagStyle}
            onChange={(e) => setEditTagStyle(e.target.value)}
            className="w-full bg-white/[0.04] border border-white/[0.06] rounded-lg px-3 py-2 text-sm text-white/70 focus:outline-none focus:ring-1 focus:ring-dl-accent/50"
          >
            <option value="dot">Dot</option>
            <option value="badge">Badge</option>
            <option value="pill">Pill</option>
          </select>
        </div>
      </div>

      <div>
        <label className="block text-xs font-semibold text-white/30 uppercase tracking-wider mb-1.5">
          Custom Badge Image
        </label>
        <p className="text-[11px] text-white/25 mb-2">Shown next to usernames for members with this role (highest role badge wins).</p>
        <div className="flex items-center gap-2">
          <input
            id={badgeInputId}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml"
            className="hidden"
            onChange={(e) => onSelectBadge(e.target.files?.[0])}
          />
          <button
            onClick={() => document.getElementById(badgeInputId)?.click()}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white/[0.04] border border-white/[0.08] text-xs text-white/70 hover:bg-white/[0.07]"
          >
            <ImagePlus size={12} />
            Upload Badge
          </button>
          {editBadgeImageUrl && (
            <button
              onClick={() => setEditBadgeImageUrl(null)}
              className="px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/25 text-xs text-red-300 hover:bg-red-500/20"
            >
              Clear
            </button>
          )}
          {editBadgeImageUrl && (
            <img src={editBadgeImageUrl} alt="Role badge preview" className="w-5 h-5 rounded-sm object-cover border border-white/15" />
          )}
        </div>
        <p className="text-[10px] text-white/20 mt-1">PNG/JPG/WebP/GIF/SVG up to 512KB.</p>
      </div>

      {editAdmin && (
        <div className="px-4 py-3 rounded-lg bg-amber-500/10 border border-amber-500/20 flex items-start gap-3">
          <AlertTriangle size={16} className="text-amber-400 shrink-0 mt-0.5" />
          <div>
            <p className="text-xs text-amber-400/80 font-medium">Dangerous Permission</p>
            <p className="text-xs text-amber-400/60 mt-0.5">
              Administrators bypass all permission checks and channel overrides. Only grant to trusted users.
            </p>
          </div>
        </div>
      )}

      {/* Delete */}
      {!isEveryone && (
        <div className="pt-4 border-t border-white/[0.04]">
          {!confirmDelete ? (
            <button
              onClick={() => setConfirmDelete(true)}
              className="flex items-center gap-2 px-4 py-2 rounded-lg text-red-400/60 text-sm hover:text-red-400 hover:bg-red-500/10 transition-all"
            >
              <Trash2 size={13} />
              Delete Role
            </button>
          ) : (
            <div className="flex items-center gap-2">
              <span className="text-xs text-red-400">Delete this role permanently?</span>
              <button
                onClick={onDelete}
                className="px-3 py-1.5 rounded-md bg-red-500 text-white text-xs font-medium hover:bg-red-600 transition-all"
              >
                Delete
              </button>
              <button
                onClick={() => setConfirmDelete(false)}
                className="px-3 py-1.5 rounded-md bg-white/[0.06] text-white/60 text-xs hover:bg-white/[0.1] transition-all"
              >
                Cancel
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
//  Permissions Sub-Tab
// ═══════════════════════════════════════════════════════════════════════════════

function PermissionsSubTab({
  editPerms,
  editAdmin,
  onToggle,
  isEveryone,
}: {
  editPerms: string;
  editAdmin: boolean;
  onToggle: (key: PermissionKey) => void;
  isEveryone: boolean;
}) {
  return (
    <div className="space-y-6 max-w-2xl">
      {editAdmin && (
        <div className="px-4 py-3 rounded-lg bg-amber-500/10 border border-amber-500/20">
          <p className="text-xs text-amber-400/80">
            This role has Administrator enabled — all permissions are granted regardless of individual toggles.
          </p>
        </div>
      )}

      {PERMISSION_CATEGORIES.map((cat) => (
        <div key={cat.label}>
          <h3 className="text-xs font-semibold text-white/30 uppercase tracking-wider mb-2">
            {cat.label}
          </h3>
          <div className="space-y-1">
            {cat.keys.map((key) => {
              // Don't show ADMINISTRATOR in the permissions grid (it's a toggle in Display)
              if (key === "ADMINISTRATOR") return null;

              const perm = Permissions[key];
              const isOn = editAdmin || hasPermission(editPerms, perm);
              const isDangerous = key === "BAN_MEMBERS" || key === "KICK_MEMBERS" || key === "MANAGE_SERVER";

              // Hide dangerous perms from @everyone
              if (isEveryone && isDangerous) return null;

              return (
                <label
                  key={key}
                  className={clsx(
                    "flex items-center justify-between px-4 py-3 rounded-lg border transition-all cursor-pointer",
                    editAdmin
                      ? "border-amber-500/15 bg-amber-500/[0.04] cursor-not-allowed"
                      : isOn
                      ? "border-dl-accent/20 bg-dl-accent/[0.04]"
                      : "border-white/[0.04] bg-white/[0.02] hover:bg-white/[0.04]"
                  )}
                >
                  <div className="flex items-center gap-3">
                    <span className={clsx(
                      "text-sm",
                      isOn ? "text-white/80" : "text-white/40"
                    )}>
                      {PERMISSION_LABELS[key]}
                    </span>
                    {isDangerous && (
                      <AlertTriangle size={11} className="text-amber-400/40" />
                    )}
                  </div>
                  <div className="relative">
                    <input
                      type="checkbox"
                      checked={isOn}
                      disabled={editAdmin}
                      onChange={() => onToggle(key)}
                      className="sr-only peer"
                    />
                    <div className={clsx(
                      "w-9 h-5 rounded-full transition-all",
                      editAdmin ? "bg-amber-500/40" : "bg-white/[0.08] peer-checked:bg-dl-accent/60"
                    )} />
                    <div className="absolute left-0.5 top-0.5 w-4 h-4 bg-white rounded-full shadow peer-checked:translate-x-4 transition-transform" />
                  </div>
                </label>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
//  Members Sub-Tab — who has this role
// ═══════════════════════════════════════════════════════════════════════════════

function MembersSubTab({
  serverId,
  roleId,
  roleName,
}: {
  serverId: string;
  roleId: string;
  roleName: string;
}) {
  const members = useServerStore((s) => s.members[serverId] ?? []);
  const fetchMembers = useServerStore((s) => s.fetchMembers);
  const assignRole = useServerStore((s) => s.assignRole);
  const removeRoleFn = useServerStore((s) => s.removeRole);
  const [search, setSearch] = useState("");
  const [showAddPopup, setShowAddPopup] = useState(false);

  useEffect(() => {
    fetchMembers(serverId);
  }, [serverId, fetchMembers]);

  const roleMembers = members.filter((m) =>
    m.roles.some((r) => r.id === roleId)
  );

  const searchFiltered = roleMembers.filter((m) => {
    const name = (m.nickname ?? m.username).toLowerCase();
    return name.includes(search.toLowerCase());
  });

  const nonRoleMembers = members.filter(
    (m) => !m.roles.some((r) => r.id === roleId)
  );

  const handleAdd = async (userId: string) => {
    await assignRole(serverId, userId, roleId);
    setShowAddPopup(false);
  };

  const handleRemove = async (userId: string) => {
    await removeRoleFn(serverId, userId, roleId);
  };

  return (
    <div className="space-y-4 max-w-xl">
      <div className="flex items-center gap-3">
        <div className="relative flex-1">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/25" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={`Search members with ${roleName}…`}
            className="w-full bg-white/[0.04] border border-white/[0.06] rounded-lg pl-9 pr-4 py-2 text-sm text-white/90 placeholder:text-white/20 focus:outline-none focus:ring-1 focus:ring-dl-accent/50 transition-all"
          />
        </div>
        <div className="relative">
          <button
            onClick={() => setShowAddPopup(!showAddPopup)}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-dl-accent/10 text-dl-accent text-xs font-medium hover:bg-dl-accent/20 transition-all"
          >
            <Plus size={12} />
            Add
          </button>
          {showAddPopup && (
            <AddMemberPopup
              members={nonRoleMembers}
              onAdd={handleAdd}
              onClose={() => setShowAddPopup(false)}
            />
          )}
        </div>
      </div>

      <p className="text-xs text-white/25">
        {roleMembers.length} member{roleMembers.length !== 1 ? "s" : ""} with this role
      </p>

      <div className="space-y-1">
        {searchFiltered.map((member) => (
          <div
            key={member.user_id}
            className="flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-white/[0.03] transition-all group"
          >
            <div
              className="w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-semibold text-white shrink-0"
              style={{
                background: member.avatar
                  ? `url(${member.avatar}) center/cover`
                  : `linear-gradient(135deg, ${member.profile_color ?? "#6366f1"}88, ${member.profile_color ?? "#6366f1"}44)`,
              }}
            >
              {!member.avatar && (member.nickname ?? member.username).charAt(0).toUpperCase()}
            </div>
            <span className="flex-1 text-sm text-white/70 truncate">
              {member.nickname ?? member.username}
            </span>
            {member.is_owner && <Crown size={12} className="text-amber-400 shrink-0" />}
            <button
              onClick={() => handleRemove(member.user_id)}
              className="opacity-0 group-hover:opacity-100 p-1 text-white/20 hover:text-red-400 transition-all"
              title="Remove role from member"
            >
              <X size={12} />
            </button>
          </div>
        ))}
        {searchFiltered.length === 0 && (
          <p className="text-xs text-white/20 py-4 text-center">
            {roleMembers.length === 0 ? "No members have this role" : "No matching members"}
          </p>
        )}
      </div>
    </div>
  );
}

// Small popup for adding members to a role
function AddMemberPopup({
  members,
  onAdd,
  onClose,
}: {
  members: ServerMemberDto[];
  onAdd: (userId: string) => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState("");
  const filtered = members.filter((m) =>
    (m.nickname ?? m.username).toLowerCase().includes(q.toLowerCase())
  );

  return (
    <>
      <div className="fixed inset-0 z-10" onClick={onClose} />
      <div className="absolute right-0 top-full mt-1 z-20 w-56 bg-[#1a1d27] border border-white/[0.06] rounded-lg shadow-xl overflow-hidden">
        <div className="p-2">
          <input
            type="text"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search…"
            className="w-full bg-white/[0.04] border border-white/[0.06] rounded-md px-2.5 py-1.5 text-xs text-white/80 placeholder:text-white/20 focus:outline-none"
            autoFocus
          />
        </div>
        <div className="max-h-48 overflow-y-auto py-1">
          {filtered.length === 0 ? (
            <p className="px-3 py-2 text-xs text-white/25">No members available</p>
          ) : (
            filtered.slice(0, 20).map((m) => (
              <button
                key={m.user_id}
                onClick={() => onAdd(m.user_id)}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm text-white/60 hover:bg-white/[0.06] hover:text-white/90 transition-all"
              >
                <div
                  className="w-5 h-5 rounded-full shrink-0 flex items-center justify-center text-[8px] text-white font-bold"
                  style={{
                    background: `linear-gradient(135deg, ${m.profile_color ?? "#6366f1"}88, ${m.profile_color ?? "#6366f1"}44)`,
                  }}
                >
                  {(m.nickname ?? m.username).charAt(0).toUpperCase()}
                </div>
                <span className="truncate">{m.nickname ?? m.username}</span>
              </button>
            ))
          )}
        </div>
      </div>
    </>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
//  Channel Overrides Sub-Tab
// ═══════════════════════════════════════════════════════════════════════════════

function OverridesSubTab({
  serverId,
  roleId,
  roleName,
}: {
  serverId: string;
  roleId: string;
  roleName: string;
}) {
  const channels = useServerStore((s) => s.channels[serverId] ?? []);
  const fetchChannels = useServerStore((s) => s.fetchChannels);
  const fetchOverrides = useServerStore((s) => s.fetchOverrides);
  const setOverride = useServerStore((s) => s.setOverride);
  const deleteOverrideFn = useServerStore((s) => s.deleteOverride);
  const allOverrides = useServerStore((s) => s.overrides);

  const [selectedChannelId, setSelectedChannelId] = useState<string | null>(null);

  useEffect(() => {
    fetchChannels(serverId);
  }, [serverId, fetchChannels]);

  useEffect(() => {
    if (selectedChannelId) {
      fetchOverrides(serverId, selectedChannelId);
    }
  }, [selectedChannelId, serverId, fetchOverrides]);

  const channelOverrides = selectedChannelId ? (allOverrides[selectedChannelId] ?? []) : [];
  const currentOverride = channelOverrides.find((o) => o.role_id === roleId);

  const currentAllow = Number(currentOverride?.allow_permissions ?? "0");
  const currentDeny = Number(currentOverride?.deny_permissions ?? "0");

  const handleToggle = async (perm: number, state: "allow" | "deny" | "inherit") => {
    if (!selectedChannelId) return;

    let newAllow = currentAllow;
    let newDeny = currentDeny;

    // Clear both first
    newAllow &= ~perm;
    newDeny &= ~perm;

    if (state === "allow") newAllow |= perm;
    else if (state === "deny") newDeny |= perm;

    if (newAllow === 0 && newDeny === 0) {
      await deleteOverrideFn(serverId, selectedChannelId, roleId);
    } else {
      await setOverride(serverId, selectedChannelId, roleId, newAllow.toString(), newDeny.toString());
    }
  };

  const getPermState = (perm: number): "allow" | "deny" | "inherit" => {
    if ((currentAllow & perm) === perm) return "allow";
    if ((currentDeny & perm) === perm) return "deny";
    return "inherit";
  };

  const textChannels = channels.sort((a, b) => a.position - b.position);

  return (
    <div className="space-y-4 max-w-2xl">
      <p className="text-xs text-white/30">
        Configure per-channel permission overrides for <strong className="text-white/50">{roleName}</strong>.
      </p>

      {/* Channel selector */}
      <div>
        <label className="block text-xs font-semibold text-white/30 uppercase tracking-wider mb-1.5">
          Select Channel
        </label>
        <div className="flex flex-wrap gap-1.5">
          {textChannels.map((ch) => (
            <button
              key={ch.id}
              onClick={() => setSelectedChannelId(ch.id)}
              className={clsx(
                "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs transition-all",
                selectedChannelId === ch.id
                  ? "bg-white/[0.08] text-white border border-white/[0.1]"
                  : "bg-white/[0.02] text-white/40 border border-white/[0.04] hover:bg-white/[0.05]"
              )}
            >
              <Hash size={11} />
              {ch.name}
            </button>
          ))}
        </div>
      </div>

      {/* Override editor */}
      {selectedChannelId ? (
        <div className="space-y-1.5 mt-4">
          <div className="grid grid-cols-[1fr,auto,auto,auto] gap-x-2 px-4 pb-2 text-[10px] font-semibold text-white/25 uppercase tracking-wider">
            <span>Permission</span>
            <span className="w-16 text-center">Allow</span>
            <span className="w-16 text-center">Inherit</span>
            <span className="w-16 text-center">Deny</span>
          </div>
          {(Object.keys(Permissions) as PermissionKey[])
            .filter((k) => k !== "ADMINISTRATOR")
            .map((key) => {
              const perm = Permissions[key];
              const state = getPermState(perm);
              return (
                <div
                  key={key}
                  className="grid grid-cols-[1fr,auto,auto,auto] gap-x-2 items-center px-4 py-2.5 rounded-lg bg-white/[0.02] border border-white/[0.03] hover:border-white/[0.06] transition-all"
                >
                  <span className="text-sm text-white/60">{PERMISSION_LABELS[key]}</span>
                  <TriToggle value="allow" current={state} onChange={() => handleToggle(perm, state === "allow" ? "inherit" : "allow")} />
                  <TriToggle value="inherit" current={state} onChange={() => handleToggle(perm, "inherit")} />
                  <TriToggle value="deny" current={state} onChange={() => handleToggle(perm, state === "deny" ? "inherit" : "deny")} />
                </div>
              );
            })}
        </div>
      ) : (
        <p className="text-xs text-white/15 py-6 text-center">Select a channel to configure overrides</p>
      )}
    </div>
  );
}

// Tri-state radio button for allow/inherit/deny
function TriToggle({
  value,
  current,
  onChange,
}: {
  value: "allow" | "inherit" | "deny";
  current: "allow" | "inherit" | "deny";
  onChange: () => void;
}) {
  const isActive = value === current;
  const colorMap = {
    allow: "bg-green-500",
    inherit: "bg-white/20",
    deny: "bg-red-500",
  };

  return (
    <button
      onClick={onChange}
      className={clsx(
        "w-16 h-7 rounded-md flex items-center justify-center text-[10px] font-medium transition-all",
        isActive
          ? `${colorMap[value]} text-white`
          : "bg-white/[0.04] text-white/20 hover:bg-white/[0.08]"
      )}
    >
      {value === "allow" ? "✓" : value === "deny" ? "✕" : "—"}
    </button>
  );
}

// ── Shared toggle row component ─────────────────────────────────────────────

function ToggleRow({
  icon,
  label,
  description,
  checked,
  onChange,
  variant = "default",
}: {
  icon: React.ReactNode;
  label: string;
  description: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  variant?: "default" | "danger";
}) {
  const accentClass = variant === "danger"
    ? "peer-checked:bg-amber-500/60"
    : "peer-checked:bg-dl-accent/60";

  return (
    <label className="flex items-start gap-3 cursor-pointer group p-3 rounded-lg hover:bg-white/[0.02] transition-all">
      <div className="relative mt-0.5">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          className="sr-only peer"
        />
        <div className={clsx("w-10 h-5 bg-white/[0.08] rounded-full transition-all", accentClass)} />
        <div className="absolute left-0.5 top-0.5 w-4 h-4 bg-white rounded-full shadow peer-checked:translate-x-5 transition-transform" />
      </div>
      <div>
        <div className="flex items-center gap-1.5 text-sm text-white/60 group-hover:text-white/80">
          {icon}
          {label}
        </div>
        <p className="text-[11px] text-white/25 mt-0.5">{description}</p>
      </div>
    </label>
  );
}
