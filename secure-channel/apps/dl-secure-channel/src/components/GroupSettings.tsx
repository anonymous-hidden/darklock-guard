/* ──────────────────────────────────────────────────────────
 *  GroupSettings — Discord-style full-screen server settings
 *  Tabs: Overview · Channels · Roles · Members · Audit Log · Security
 * ────────────────────────────────────────────────────────── */

import { useState, useMemo, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useChatStore } from '../stores/chatStore';
import { useAuthStore } from '../stores/authStore';
import { hashPin, useConvSecurityStore, type DisappearTimer, type LockTimeout } from '../stores/convSecurityStore';
import { useConvThemeStore } from '../stores/convThemeStore';
import * as ws from '../net/wsClient';
import {
  X, Settings, Hash, Volume, Users, Shield, Search,
  Plus, Trash, Crown, Lock, Eye,
} from './Icons';
import { Input, Button, Avatar } from './Shared';
import { ConvPersonalize } from './ConvPersonalize';
import type {
  GroupInfo, GroupChannel, GroupChannelType, GroupCategory,
  GroupRoleInfo, GroupPermissions, GroupModerationSettings,
} from '../types';
import { DEFAULT_PERMISSIONS } from '../types';
import { resolveGroupPermissions } from '../utils/groupPermissions';
import { normalizeModerationSettings, parseBlockedTermsInput } from '../utils/groupModeration';
import { resizeImage, validateImageFile, IMAGE_ACCEPT } from '../lib/imageUtils';
import {
  GROUP_MESSAGING_CONTAINMENT_NOTICE,
  RIDGELINE_SECURITY_CAPABILITIES,
} from '@darklock/ridgeline-security-capabilities';
import './GroupSettings.css';

type SettingsTab = 'overview' | 'channels' | 'roles' | 'members' | 'audit' | 'security' | 'personalize';

const TAB_LABELS: { key: SettingsTab; label: string }[] = [
  { key: 'overview',  label: 'Overview' },
  { key: 'channels',  label: 'Channels' },
  { key: 'roles',     label: 'Roles' },
  { key: 'members',   label: 'Members' },
  { key: 'audit',     label: 'Audit Log' },
  { key: 'security',  label: 'Security' },
  { key: 'personalize', label: 'Personalize' },
];

const CHANNEL_TYPES: { value: GroupChannelType; label: string }[] = [
  { value: 'text',          label: 'Text' },
  { value: 'voice',         label: 'Voice' },
  { value: 'announcement',  label: 'Announcement' },
  { value: 'stage',         label: 'Stage' },
  { value: 'forum',         label: 'Forum' },
];

const PERM_LABELS: { key: keyof GroupPermissions; label: string; desc: string }[] = [
  { key: 'administrator',    label: 'Administrator',      desc: 'Full access to all settings' },
  { key: 'manageChannels',   label: 'Manage Channels',    desc: 'Create, edit, delete channels and categories' },
  { key: 'manageRoles',      label: 'Manage Roles',       desc: 'Create, edit, delete roles and assign them' },
  { key: 'manageServer',     label: 'Manage Server',      desc: 'Change server name, icon, and settings' },
  { key: 'kickMembers',      label: 'Kick Members',       desc: 'Remove members from the server' },
  { key: 'banMembers',       label: 'Ban Members',        desc: 'Permanently ban members' },
  { key: 'manageMessages',   label: 'Manage Messages',    desc: "Delete other members' messages" },
  { key: 'sendMessages',     label: 'Send Messages',      desc: 'Send messages in text channels' },
  { key: 'readMessages',     label: 'Read Messages',      desc: 'View messages in channels' },
  { key: 'attachFiles',      label: 'Attach Files',       desc: 'Upload files and images' },
  { key: 'useVoice',         label: 'Use Voice',          desc: 'Connect to voice channels' },
  { key: 'mentionEveryone',  label: 'Mention @everyone',  desc: 'Notify all members at once' },
  { key: 'viewAuditLog',     label: 'View Audit Log',     desc: 'See server action history' },
  { key: 'manageInvites',    label: 'Manage Invites',     desc: 'Create and revoke invite links' },
];

const DISAPPEAR_OPTIONS: { value: DisappearTimer; label: string }[] = [
  { value: 'off', label: 'Off' },
  { value: '30s', label: '30 seconds' },
  { value: '1m',  label: '1 minute' },
  { value: '5m',  label: '5 minutes' },
  { value: '1h',  label: '1 hour' },
  { value: '24h', label: '24 hours' },
  { value: '7d',  label: '7 days' },
];

const LOCK_TIMEOUT_OPTIONS: { value: LockTimeout; label: string }[] = [
  { value: 'immediate', label: 'Immediately' },
  { value: '1m', label: 'After 1 minute' },
  { value: '5m', label: 'After 5 minutes' },
  { value: '15m', label: 'After 15 minutes' },
  { value: '1h', label: 'After 1 hour' },
  { value: 'never', label: 'Never auto-lock' },
];

const ROLE_COLORS = [
  '#99aab5', '#1abc9c', '#2ecc71', '#3498db', '#9b59b6',
  '#e91e63', '#f1c40f', '#e67e22', '#e74c3c', '#95a5a6',
  '#607d8b', '#11806a', '#1f8b4c', '#206694', '#71368a',
];

/* ────────────────────────────────────────────────────────── */

export function GroupSettings({ groupId, onClose }: { groupId: string; onClose: () => void }) {
  const [tab, setTab] = useState<SettingsTab>('overview');

  const group = useChatStore(s => s.groups[groupId]);
  const userId = useAuthStore(s => s.userId);

  // Close on ESC
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  if (!group) return null;

  const isOwner = group.createdBy === userId;
  const myMember = group.members.find(m => m.userId === userId);
  const isAdmin = isOwner || myMember?.role === 'admin';
  const permissionSet = resolveGroupPermissions(group, userId);
  const canManageModeration = isOwner || permissionSet.administrator || permissionSet.manageServer || permissionSet.manageMessages;

  return createPortal(
    <div className="gs-overlay">
      <div className="gs-container">
        {/* ── Left nav ─────────────────────────────── */}
        <nav className="gs-nav">
          <h2 className="gs-nav__title">{group.name}</h2>
          <div className="gs-nav__subtitle">Server Settings</div>
          <div className="gs-nav__tabs">
            {TAB_LABELS.map(t => (
              <button
                key={t.key}
                className={`gs-nav__tab ${tab === t.key ? 'gs-nav__tab--active' : ''}`}
                onClick={() => setTab(t.key)}
              >
                {t.label}
              </button>
            ))}
          </div>
          <div className="gs-nav__separator" />
          <button className="gs-nav__tab gs-nav__tab--danger" onClick={onClose}>
            Close Settings
          </button>
        </nav>

        {/* ── Right content ────────────────────────── */}
        <div className="gs-content">
          <button className="gs-close" onClick={onClose} aria-label="Close">
            <X size={20} />
          </button>

          {tab === 'overview'  && <OverviewTab group={group} isAdmin={isAdmin} />}
          {tab === 'channels'  && <ChannelsTab group={group} isAdmin={isAdmin} />}
          {tab === 'roles'     && <RolesTab group={group} isAdmin={isAdmin} />}
          {tab === 'members'   && <MembersTab group={group} isAdmin={isAdmin} userId={userId ?? ''} />}
          {tab === 'audit'     && <AuditTab group={group} />}
          {tab === 'security'  && <SecurityTab group={group} isAdmin={isAdmin} canManageModeration={canManageModeration} />}
          {tab === 'personalize' && <PersonalizeTab group={group} isAdmin={isAdmin} userId={userId ?? ''} />}
        </div>
      </div>
    </div>,
    document.body,
  );
}

/* ═══════════════════════════════════════════════════════════
 *  TAB: Overview
 * ═══════════════════════════════════════════════════════════ */

function OverviewTab({ group, isAdmin }: { group: GroupInfo; isAdmin: boolean }) {
  const [name, setName] = useState(group.name);
  const [desc, setDesc] = useState(group.description ?? '');
  const [avatar, setAvatar] = useState<string | null>(group.avatar ?? null);
  const [iconError, setIconError] = useState<string | null>(null);
  const iconInputRef = useRef<HTMLInputElement>(null);
  const updateGroupOverview = useChatStore(s => s.updateGroupOverview);
  const appendAuditLog = useChatStore(s => s.appendAuditLog);
  const userId = useAuthStore(s => s.userId) ?? '';

  const dirty = name !== group.name || desc !== (group.description ?? '') || avatar !== (group.avatar ?? null);

  const handleIconFile = async (file: File | undefined) => {
    if (!file || !isAdmin) return;
    const validationError = validateImageFile(file, 8);
    if (validationError) { setIconError(validationError); return; }
    setIconError(null);
    try {
      const dataUrl = await resizeImage(file, 256);
      setAvatar(dataUrl);
    } catch {
      setIconError('Could not process that image. Try a different file.');
    }
  };

  const save = () => {
    if (!name.trim()) return;
    updateGroupOverview(group.id, {
      name: name.trim(),
      description: desc.trim() || undefined,
      ...(avatar !== (group.avatar ?? null) ? { avatar } : {}),
    });
    appendAuditLog(group.id, { action: 'server_update', userId, detail: 'Server info updated' });
  };

  return (
    <div className="gs-tab">
      <h3 className="gs-tab__heading">Server Overview</h3>

      <div className="gs-form-group">
        <label className="gs-label">Server Name</label>
        <Input value={name} onChange={e => setName(e.target.value)} maxLength={64} disabled={!isAdmin} />
      </div>

      <div className="gs-form-group">
        <label className="gs-label">Description</label>
        <textarea
          className="gs-textarea"
          value={desc}
          onChange={e => setDesc(e.target.value)}
          maxLength={512}
          rows={4}
          disabled={!isAdmin}
          placeholder="Tell members what this server is about…"
        />
      </div>

      <div className="gs-form-group">
        <label className="gs-label">Server Icon</label>
        <div className="gs-overview__icon-row">
          <div className="gs-overview__icon">
            {avatar
              ? <img src={avatar} alt="" />
              : <span>{group.name.charAt(0).toUpperCase()}</span>
            }
          </div>
          {isAdmin && (
            <div className="gs-overview__icon-actions">
              <input
                ref={iconInputRef}
                type="file"
                accept={IMAGE_ACCEPT}
                style={{ display: 'none' }}
                onChange={e => { void handleIconFile(e.target.files?.[0]); e.target.value = ''; }}
              />
              <Button variant="ghost" onClick={() => iconInputRef.current?.click()}>
                {avatar ? 'Change Icon' : 'Upload Icon'}
              </Button>
              {avatar && (
                <Button variant="ghost" onClick={() => { setAvatar(null); setIconError(null); }}>
                  Remove
                </Button>
              )}
            </div>
          )}
        </div>
        {iconError && <span className="gs-overview__icon-error">{iconError}</span>}
      </div>

      <div className="gs-form-group">
        <label className="gs-label">Info</label>
        <div className="gs-overview__meta">
          <div>Created: {new Date(group.createdAt).toLocaleDateString()}</div>
          <div>Members: {group.members.length}</div>
          <div>Channels: {group.channels?.length ?? 0}</div>
          <div>Roles: {group.roles?.length ?? 0}</div>
        </div>
      </div>

      {isAdmin && dirty && (
        <div className="gs-save-bar">
          <Button variant="ghost" onClick={() => { setName(group.name); setDesc(group.description ?? ''); setAvatar(group.avatar ?? null); setIconError(null); }}>Reset</Button>
          <Button variant="primary" onClick={save}>Save Changes</Button>
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
 *  TAB: Channels
 * ═══════════════════════════════════════════════════════════ */

function ChannelsTab({ group, isAdmin }: { group: GroupInfo; isAdmin: boolean }) {
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [newType, setNewType] = useState<GroupChannelType>('text');
  const [newCatId, setNewCatId] = useState<string | null>(group.categories?.[0]?.id ?? null);
  const [showCreateCat, setShowCreateCat] = useState(false);
  const [newCatName, setNewCatName] = useState('');

  const addChannel = useChatStore(s => s.addChannel);
  const updateChannel = useChatStore(s => s.updateChannel);
  const deleteChannel = useChatStore(s => s.deleteChannel);
  const addCategory = useChatStore(s => s.addCategory);
  const deleteCategory = useChatStore(s => s.deleteCategory);
  const appendAuditLog = useChatStore(s => s.appendAuditLog);
  const userId = useAuthStore(s => s.userId) ?? '';

  const categories = [...(group.categories ?? [])].sort((a, b) => a.position - b.position);
  const channels = group.channels ?? [];

  const handleCreateChannel = () => {
    if (!newName.trim()) return;
    const ch: GroupChannel = {
      id: crypto.randomUUID(),
      name: newName.trim().toLowerCase().replace(/\s+/g, '-'),
      type: newType,
      categoryId: newCatId,
      position: channels.filter(c => c.categoryId === newCatId).length,
    };
    addChannel(group.id, ch);
    appendAuditLog(group.id, { action: 'channel_create', userId, targetId: ch.id, targetName: ch.name, detail: `Created ${ch.type} channel #${ch.name}` });
    setNewName('');
    setShowCreate(false);
  };

  const handleCreateCategory = () => {
    if (!newCatName.trim()) return;
    const cat: GroupCategory = {
      id: crypto.randomUUID(),
      name: newCatName.trim(),
      position: categories.length,
    };
    addCategory(group.id, cat);
    appendAuditLog(group.id, { action: 'category_create', userId, targetId: cat.id, targetName: cat.name, detail: `Created category "${cat.name}"` });
    setNewCatName('');
    setShowCreateCat(false);
  };

  const handleDeleteChannel = (ch: GroupChannel) => {
    deleteChannel(group.id, ch.id);
    appendAuditLog(group.id, { action: 'channel_delete', userId, targetId: ch.id, targetName: ch.name, detail: `Deleted channel #${ch.name}` });
  };

  const handlePatchChannel = (ch: GroupChannel, patch: Partial<GroupChannel>) => {
    updateChannel(group.id, ch.id, patch);

    const patchDetails: string[] = [];
    if (typeof patch.name === 'string') patchDetails.push(`name: #${patch.name}`);
    if (typeof patch.isNsfw === 'boolean') patchDetails.push(`NSFW: ${patch.isNsfw ? 'on' : 'off'}`);
    if (typeof patch.userLimit === 'number') patchDetails.push(`user limit: ${patch.userLimit === 0 ? 'none' : patch.userLimit}`);

    appendAuditLog(group.id, {
      action: 'channel_update',
      userId,
      targetId: ch.id,
      targetName: ch.name,
      detail: `Updated #${ch.name}${patchDetails.length > 0 ? ` (${patchDetails.join(', ')})` : ''}`,
    });
  };

  const handleDeleteCategory = (cat: GroupCategory) => {
    deleteCategory(group.id, cat.id);
    appendAuditLog(group.id, { action: 'category_delete', userId, targetId: cat.id, targetName: cat.name, detail: `Deleted category "${cat.name}"` });
  };

  return (
    <div className="gs-tab">
      <div className="gs-tab__header-row">
        <h3 className="gs-tab__heading">Channels</h3>
        {isAdmin && (
          <div className="gs-tab__header-actions">
            <Button variant="ghost" onClick={() => setShowCreateCat(true)}><Plus size={14} /> Category</Button>
            <Button variant="primary" onClick={() => setShowCreate(true)}><Plus size={14} /> Channel</Button>
          </div>
        )}
      </div>

      {/* Create channel form */}
      {showCreate && (
        <div className="gs-create-form">
          <div className="gs-create-form__row">
            <Input placeholder="Channel name" value={newName} onChange={e => setNewName(e.target.value)} maxLength={64} />
            <select className="gs-select" value={newType} onChange={e => setNewType(e.target.value as GroupChannelType)}>
              {CHANNEL_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
            <select className="gs-select" value={newCatId ?? ''} onChange={e => setNewCatId(e.target.value || null)}>
              <option value="">No category</option>
              {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div className="gs-create-form__actions">
            <Button variant="ghost" onClick={() => setShowCreate(false)}>Cancel</Button>
            <Button variant="primary" disabled={!newName.trim()} onClick={handleCreateChannel}>Create</Button>
          </div>
        </div>
      )}

      {/* Create category form */}
      {showCreateCat && (
        <div className="gs-create-form">
          <div className="gs-create-form__row">
            <Input placeholder="Category name" value={newCatName} onChange={e => setNewCatName(e.target.value)} maxLength={64} />
          </div>
          <div className="gs-create-form__actions">
            <Button variant="ghost" onClick={() => setShowCreateCat(false)}>Cancel</Button>
            <Button variant="primary" disabled={!newCatName.trim()} onClick={handleCreateCategory}>Create</Button>
          </div>
        </div>
      )}

      {/* Uncategorized channels */}
      {channels.filter(ch => !ch.categoryId).map(ch => (
        <ChannelSettingsRow
          key={ch.id}
          channel={ch}
          isAdmin={isAdmin}
          onDelete={() => handleDeleteChannel(ch)}
          onPatch={(patch) => handlePatchChannel(ch, patch)}
        />
      ))}

      {/* Categories with their channels */}
      {categories.map(cat => (
        <div key={cat.id} className="gs-channel-category">
          <div className="gs-channel-category__header">
            <span className="gs-channel-category__name">{cat.name}</span>
            {isAdmin && (
              <button className="gs-icon-btn gs-icon-btn--danger" onClick={() => handleDeleteCategory(cat)} title="Delete category">
                <Trash size={14} />
              </button>
            )}
          </div>
          {channels.filter(ch => ch.categoryId === cat.id).sort((a, b) => a.position - b.position).map(ch => (
            <ChannelSettingsRow
              key={ch.id}
              channel={ch}
              isAdmin={isAdmin}
              onDelete={() => handleDeleteChannel(ch)}
              onPatch={(patch) => handlePatchChannel(ch, patch)}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

function ChannelSettingsRow({ channel, isAdmin, onDelete, onPatch }: {
  channel: GroupChannel;
  isAdmin: boolean;
  onDelete: () => void;
  onPatch: (patch: Partial<GroupChannel>) => void;
}) {
  const [draftName, setDraftName] = useState(channel.name);
  const isVoiceChannel = channel.type === 'voice' || channel.type === 'stage';

  useEffect(() => {
    setDraftName(channel.name);
  }, [channel.name]);

  const commitName = () => {
    const normalized = draftName.trim().toLowerCase().replace(/\s+/g, '-').slice(0, 64);
    if (!normalized || normalized === channel.name) {
      setDraftName(channel.name);
      return;
    }
    onPatch({ name: normalized });
  };

  return (
    <div className="gs-channel-row">
      <span className="gs-channel-row__icon">
        {channel.type === 'voice' || channel.type === 'stage' ? <Volume size={16} /> : <Hash size={16} />}
      </span>
      {isAdmin ? (
        <input
          className="gs-channel-row__name-input"
          value={draftName}
          onChange={(e) => setDraftName(e.target.value)}
          onBlur={commitName}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              (e.currentTarget as HTMLInputElement).blur();
            }
            if (e.key === 'Escape') {
              setDraftName(channel.name);
              (e.currentTarget as HTMLInputElement).blur();
            }
          }}
          maxLength={64}
          aria-label="Channel name"
        />
      ) : (
        <span className="gs-channel-row__name">{channel.name}</span>
      )}
      <span className="gs-channel-row__type">{channel.type}</span>
      {channel.isNsfw && <span className="gs-badge gs-badge--nsfw">NSFW</span>}
      {isAdmin && !isVoiceChannel && (
        <button
          className={`gs-toggle gs-toggle--tiny ${channel.isNsfw ? 'gs-toggle--on' : ''}`}
          onClick={() => onPatch({ isNsfw: !channel.isNsfw })}
          title={channel.isNsfw ? 'Disable NSFW' : 'Enable NSFW'}
        >
          <span className="gs-toggle__knob" />
        </button>
      )}
      {isAdmin && isVoiceChannel && (
        <label className="gs-channel-row__limit">
          <span>Limit</span>
          <input
            type="number"
            min={0}
            max={99}
            value={channel.userLimit ?? 0}
            onChange={(e) => {
              const raw = Number.parseInt(e.target.value, 10);
              const clamped = Number.isFinite(raw) ? Math.max(0, Math.min(99, raw)) : 0;
              onPatch({ userLimit: clamped });
            }}
            aria-label="Voice user limit"
          />
        </label>
      )}
      {isAdmin && (
        <button className="gs-icon-btn gs-icon-btn--danger" onClick={onDelete} title="Delete channel">
          <Trash size={14} />
        </button>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
 *  TAB: Roles
 * ═══════════════════════════════════════════════════════════ */

function RolesTab({ group, isAdmin }: { group: GroupInfo; isAdmin: boolean }) {
  const [selectedRole, setSelectedRole] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [newRoleName, setNewRoleName] = useState('');
  const [newRoleColor, setNewRoleColor] = useState('#3498db');

  const addRole = useChatStore(s => s.addRole);
  const updateRole = useChatStore(s => s.updateRole);
  const deleteRole = useChatStore(s => s.deleteRole);
  const appendAuditLog = useChatStore(s => s.appendAuditLog);
  const userId = useAuthStore(s => s.userId) ?? '';

  const roles = [...(group.roles ?? [])].sort((a, b) => b.position - a.position);
  const activeRole = roles.find(r => r.id === selectedRole);

  const handleCreateRole = () => {
    if (!newRoleName.trim()) return;
    const role: GroupRoleInfo = {
      id: crypto.randomUUID(),
      name: newRoleName.trim(),
      color: newRoleColor,
      position: roles.length,
      permissions: { ...DEFAULT_PERMISSIONS },
    };
    addRole(group.id, role);
    appendAuditLog(group.id, { action: 'role_create', userId, targetId: role.id, targetName: role.name, detail: `Created role "${role.name}"` });
    setNewRoleName('');
    setShowCreate(false);
    setSelectedRole(role.id);
  };

  const handleDeleteRole = (roleId: string) => {
    const role = roles.find(r => r.id === roleId);
    if (!role || role.isDefault) return;
    deleteRole(group.id, roleId);
    appendAuditLog(group.id, { action: 'role_delete', userId, targetId: roleId, targetName: role.name, detail: `Deleted role "${role.name}"` });
    setSelectedRole(null);
  };

  const togglePerm = (roleId: string, key: keyof GroupPermissions) => {
    const role = roles.find(r => r.id === roleId);
    if (!role) return;
    const newPerms = { ...role.permissions, [key]: !role.permissions[key] };
    updateRole(group.id, roleId, { permissions: newPerms });
    appendAuditLog(group.id, { action: 'role_update', userId, targetId: roleId, targetName: role.name, detail: `${newPerms[key] ? 'Enabled' : 'Disabled'} ${key} for "${role.name}"` });
  };

  return (
    <div className="gs-tab gs-tab--split">
      {/* Role list */}
      <div className="gs-roles-list">
        <div className="gs-tab__header-row">
          <h3 className="gs-tab__heading">Roles</h3>
          {isAdmin && <Button variant="primary" onClick={() => setShowCreate(true)}><Plus size={14} /> Role</Button>}
        </div>

        {showCreate && (
          <div className="gs-create-form">
            <div className="gs-create-form__row">
              <Input placeholder="Role name" value={newRoleName} onChange={e => setNewRoleName(e.target.value)} maxLength={32} />
              <div className="gs-color-picker">
                {ROLE_COLORS.map(c => (
                  <button key={c} className={`gs-color-swatch ${newRoleColor === c ? 'gs-color-swatch--active' : ''}`} style={{ background: c }} onClick={() => setNewRoleColor(c)} />
                ))}
              </div>
            </div>
            <div className="gs-create-form__actions">
              <Button variant="ghost" onClick={() => setShowCreate(false)}>Cancel</Button>
              <Button variant="primary" disabled={!newRoleName.trim()} onClick={handleCreateRole}>Create</Button>
            </div>
          </div>
        )}

        {roles.map(role => (
          <button
            key={role.id}
            className={`gs-role-item ${selectedRole === role.id ? 'gs-role-item--active' : ''}`}
            onClick={() => setSelectedRole(role.id)}
          >
            <span className="gs-role-item__dot" style={{ background: role.color }} />
            <span className="gs-role-item__name">{role.name}</span>
            {role.isDefault && <span className="gs-badge">Default</span>}
            <span className="gs-role-item__count">
              {group.members.filter(m => (m.roleIds ?? []).includes(role.id)).length}
            </span>
          </button>
        ))}
      </div>

      {/* Permission editor */}
      <div className="gs-roles-perms">
        {activeRole ? (
          <>
            <div className="gs-roles-perms__header">
              <span className="gs-role-item__dot" style={{ background: activeRole.color }} />
              <h4>{activeRole.name}</h4>
              {isAdmin && !activeRole.isDefault && (
                <button className="gs-icon-btn gs-icon-btn--danger" onClick={() => handleDeleteRole(activeRole.id)}>
                  <Trash size={14} />
                </button>
              )}
            </div>
            <div className="gs-perm-list">
              {PERM_LABELS.map(p => (
                <div key={p.key} className="gs-perm-row">
                  <div className="gs-perm-row__info">
                    <span className="gs-perm-row__label">{p.label}</span>
                    <span className="gs-perm-row__desc">{p.desc}</span>
                  </div>
                  <button
                    className={`gs-toggle ${activeRole.permissions[p.key] ? 'gs-toggle--on' : ''}`}
                    onClick={() => isAdmin && togglePerm(activeRole.id, p.key)}
                    disabled={!isAdmin}
                  >
                    <span className="gs-toggle__knob" />
                  </button>
                </div>
              ))}
            </div>
          </>
        ) : (
          <div className="gs-roles-perms__empty">Select a role to edit permissions</div>
        )}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
 *  TAB: Members
 * ═══════════════════════════════════════════════════════════ */

function MembersTab({ group, isAdmin, userId }: { group: GroupInfo; isAdmin: boolean; userId: string }) {
  const [search, setSearch] = useState('');
  const contacts = useChatStore(s => s.contacts);
  const remoteProfiles = useChatStore(s => s.remoteProfiles);
  const kickMember = useChatStore(s => s.kickMember);
  const updateMember = useChatStore(s => s.updateMember);
  const appendAuditLog = useChatStore(s => s.appendAuditLog);

  const roles = group.roles ?? [];

  const filteredMembers = useMemo(() => {
    const q = search.toLowerCase().trim();
    return group.members.filter(m => {
      if (m.banned) return false;
      const name = remoteProfiles[m.userId]?.displayName || contacts[m.userId]?.displayName || m.userId;
      return !q || name.toLowerCase().includes(q);
    });
  }, [group.members, contacts, remoteProfiles, search]);

  const handleKick = (memberId: string) => {
    const name = contacts[memberId]?.displayName || memberId;
    kickMember(group.id, memberId);
    appendAuditLog(group.id, { action: 'member_kick', userId, targetId: memberId, targetName: name, detail: `Kicked ${name}` });
  };

  const handleRoleToggle = (memberId: string, roleId: string) => {
    const member = group.members.find(m => m.userId === memberId);
    if (!member) return;
    const current = member.roleIds ?? [];
    const newRoleIds = current.includes(roleId)
      ? current.filter(id => id !== roleId)
      : [...current, roleId];
    updateMember(group.id, memberId, { roleIds: newRoleIds });
    const role = roles.find(r => r.id === roleId);
    appendAuditLog(group.id, {
      action: 'member_role_update', userId, targetId: memberId,
      targetName: contacts[memberId]?.displayName || memberId,
      detail: `${current.includes(roleId) ? 'Removed' : 'Added'} role "${role?.name}" ${current.includes(roleId) ? 'from' : 'to'} member`,
    });
  };

  return (
    <div className="gs-tab">
      <div className="gs-tab__header-row">
        <h3 className="gs-tab__heading">Members — {group.members.filter(m => !m.banned).length}</h3>
      </div>
      <Input placeholder="Search members…" value={search} onChange={e => setSearch(e.target.value)} icon={<Search size={14} />} />

      <div className="gs-member-list">
        {filteredMembers.map(member => {
          const rp = remoteProfiles[member.userId];
          const name = rp?.displayName || contacts[member.userId]?.displayName || member.userId.slice(0, 12);
          const isOwner = group.createdBy === member.userId;
          const memberRoleIds = member.roleIds ?? [];
          const memberBannerStyle = rp?.banner
            ? { backgroundImage: `url(${rp.banner})` }
            : rp?.accentColor
              ? {
                  background: `linear-gradient(${rp.gradientAngle ?? 135}deg, ${rp.accentColor}, ${rp.accentColor2 || `${rp.accentColor}66`})`,
                }
              : null;

          return (
            <div key={member.userId} className="gs-member-row">
              {memberBannerStyle && <span className="gs-member-row__banner" style={memberBannerStyle} aria-hidden="true" />}
              <div className="gs-member-row__avatar-wrap">
                <Avatar name={name} src={rp?.avatar ?? undefined} size={36} />
              </div>
              <div className="gs-member-row__info">
                <div className="gs-member-row__name">
                  {name}
                  {isOwner && <Crown size={12} className="gs-member-row__crown" />}
                </div>
                <div className="gs-member-row__roles">
                  {roles.filter(r => memberRoleIds.includes(r.id)).map(r => (
                    <span key={r.id} className="gs-role-badge" style={{ borderColor: r.color, color: r.color }}>
                      <span className="gs-role-badge__dot" style={{ background: r.color }} />
                      {r.name}
                      {isAdmin && !r.isDefault && (
                        <button className="gs-role-badge__remove" onClick={() => handleRoleToggle(member.userId, r.id)}>×</button>
                      )}
                    </span>
                  ))}
                  {isAdmin && (
                    <RoleAssignDropdown
                      roles={roles.filter(r => !memberRoleIds.includes(r.id) && !r.isDefault)}
                      onSelect={(roleId) => handleRoleToggle(member.userId, roleId)}
                    />
                  )}
                </div>
              </div>
              {isAdmin && !isOwner && member.userId !== userId && (
                <button className="gs-icon-btn gs-icon-btn--danger" onClick={() => handleKick(member.userId)} title="Kick member">
                  <Trash size={14} />
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function RoleAssignDropdown({ roles, onSelect }: { roles: GroupRoleInfo[]; onSelect: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  if (roles.length === 0) return null;
  return (
    <div className="gs-role-assign">
      <button className="gs-role-assign__btn" onClick={() => setOpen(!open)}>
        <Plus size={12} />
      </button>
      {open && (
        <div className="gs-role-assign__dropdown">
          {roles.map(r => (
            <button key={r.id} className="gs-role-assign__item" onClick={() => { onSelect(r.id); setOpen(false); }}>
              <span className="gs-role-item__dot" style={{ background: r.color }} />
              {r.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
 *  TAB: Audit Log
 * ═══════════════════════════════════════════════════════════ */

function AuditTab({ group }: { group: GroupInfo }) {
  const contacts = useChatStore(s => s.contacts);
  const remoteProfiles = useChatStore(s => s.remoteProfiles);
  const logs = [...(group.auditLog ?? [])].sort((a, b) => b.timestamp - a.timestamp);

  const getName = (uid: string) => remoteProfiles[uid]?.displayName || contacts[uid]?.displayName || uid.slice(0, 12);

  const formatTime = (ts: number) => {
    const d = new Date(ts);
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' ' +
           d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const actionIcon = (action: string) => {
    if (action.includes('channel')) return <Hash size={14} />;
    if (action.includes('role')) return <Shield size={14} />;
    if (action.includes('member')) return <Users size={14} />;
    if (action.includes('server')) return <Settings size={14} />;
    return <Eye size={14} />;
  };

  return (
    <div className="gs-tab">
      <h3 className="gs-tab__heading">Audit Log</h3>
      {logs.length === 0 && <div className="gs-empty">No actions recorded yet</div>}
      <div className="gs-audit-list">
        {logs.map(entry => (
          <div key={entry.id} className="gs-audit-row">
            <span className="gs-audit-row__icon">{actionIcon(entry.action)}</span>
            <div className="gs-audit-row__body">
              <span className="gs-audit-row__actor">{getName(entry.userId)}</span>
              <span className="gs-audit-row__detail">{entry.detail ?? entry.action.replace(/_/g, ' ')}</span>
            </div>
            <span className="gs-audit-row__time">{formatTime(entry.timestamp)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
 *  TAB: Security
 * ═══════════════════════════════════════════════════════════ */

function SecurityTab({
  group,
  isAdmin,
  canManageModeration,
}: {
  group: GroupInfo;
  isAdmin: boolean;
  canManageModeration: boolean;
}) {
  const convSec = useConvSecurityStore(s => s.get(group.id));
  const setConvSec = useConvSecurityStore(s => s.set);
  const setGroupInfo = useChatStore(s => s.setGroupInfo);
  const userId = useAuthStore(s => s.userId) ?? '';
  const [pinInput, setPinInput] = useState('');
  const [pinStatus, setPinStatus] = useState('');
  const moderation = useMemo(() => normalizeModerationSettings(group.moderation), [group.moderation]);
  const [blockedTermsInput, setBlockedTermsInput] = useState(() => moderation.blockedTerms.join(', '));
  const previousSerialized = useRef<string | null>(null);
  const previousModerationSerialized = useRef<string | null>(null);
  const serializedSecurity = useMemo(() => JSON.stringify(convSec), [convSec]);
  const serializedModeration = useMemo(() => JSON.stringify(moderation), [moderation]);

  useEffect(() => {
    setBlockedTermsInput(moderation.blockedTerms.join(', '));
  }, [group.id, moderation.blockedTerms]);

  useEffect(() => {
    if (!isAdmin) return;

    if (previousSerialized.current === null) {
      previousSerialized.current = serializedSecurity;
      return;
    }

    if (previousSerialized.current === serializedSecurity) return;
    previousSerialized.current = serializedSecurity;

    const recipients = group.members
      .map((member) => String(member.userId ?? '').trim())
      .filter((memberId) => memberId && memberId !== userId);

    if (recipients.length === 0) return;

    const timer = setTimeout(() => {
      let securityPatch: Record<string, unknown> = {};
      try {
        securityPatch = JSON.parse(serializedSecurity);
      } catch {
        securityPatch = {};
      }

      void ws.sendGroupSettingsUpdate(group.id, recipients, {
        security: securityPatch,
      });
    }, 450);

    return () => clearTimeout(timer);
  }, [group.id, group.members, isAdmin, serializedSecurity, userId]);

  useEffect(() => {
    if (!canManageModeration) return;

    if (previousModerationSerialized.current === null) {
      previousModerationSerialized.current = serializedModeration;
      return;
    }

    if (previousModerationSerialized.current === serializedModeration) return;
    previousModerationSerialized.current = serializedModeration;

    const recipients = group.members
      .map((member) => String(member.userId ?? '').trim())
      .filter((memberId) => memberId && memberId !== userId);

    if (recipients.length === 0) return;

    const timer = setTimeout(() => {
      let moderationPatch: Record<string, unknown> = {};
      try {
        moderationPatch = JSON.parse(serializedModeration);
      } catch {
        moderationPatch = {};
      }

      void ws.sendGroupSettingsUpdate(group.id, recipients, {
        moderation: moderationPatch,
      });
    }, 450);

    return () => clearTimeout(timer);
  }, [canManageModeration, group.id, group.members, serializedModeration, userId]);

  const updateModeration = (patch: Partial<GroupModerationSettings>) => {
    const next = normalizeModerationSettings({
      ...moderation,
      ...patch,
      updatedAt: Date.now(),
      updatedBy: userId,
    });
    setGroupInfo(group.id, {
      ...group,
      moderation: next,
    });
  };

  const toggleExemptRole = (roleId: string) => {
    const current = moderation.exemptRoleIds ?? [];
    const next = current.includes(roleId)
      ? current.filter((id) => id !== roleId)
      : [...current, roleId];
    updateModeration({ exemptRoleIds: next });
  };

  const savePin = async () => {
    const normalizedPin = pinInput.trim();
    if (!normalizedPin) {
      setPinStatus('Enter a PIN first');
      return;
    }
    if (normalizedPin.length < 4 || normalizedPin.length > 32) {
      setPinStatus('PIN must be 4-32 characters');
      return;
    }

    const pinHash = await hashPin(normalizedPin);
    setConvSec(group.id, {
      requirePin: true,
      pinHash,
    });
    setPinInput('');
    setPinStatus('Group PIN updated');
  };

  return (
    <div className="gs-tab">
      <h3 className="gs-tab__heading">Security</h3>

      {/* Capability status comes from the shared backend-enforced definition. */}
      <div className="gs-security-card gs-security-card--highlight">
        <div className="gs-security-card__icon"><Lock size={20} /></div>
        <div className="gs-security-card__body">
          <div className="gs-security-card__title">
            {RIDGELINE_SECURITY_CAPABILITIES.groupE2eeSupported ? 'Group Encryption' : 'Group Messaging Paused'}
          </div>
          <div className="gs-security-card__desc">{GROUP_MESSAGING_CONTAINMENT_NOTICE}</div>
        </div>
        <span className="gs-badge">Unavailable</span>
      </div>

      {/* Disappearing messages */}
      <div className="gs-security-card">
        <div className="gs-security-card__icon"><Settings size={18} /></div>
        <div className="gs-security-card__body">
          <div className="gs-security-card__title">Disappearing Messages</div>
          <div className="gs-security-card__desc">Auto-delete messages after a set time for all channels in this server.</div>
        </div>
        <select
          className="gs-select"
          value={convSec.disappearTimer}
          onChange={e => setConvSec(group.id, { disappearTimer: e.target.value as DisappearTimer })}
          disabled={!isAdmin}
        >
          {DISAPPEAR_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </div>

      <div className="gs-security-card gs-security-card--stacked">
        <div className="gs-security-card__icon"><Shield size={18} /></div>
        <div className="gs-security-card__body">
          <div className="gs-security-card__title">Group Moderation Filter</div>
          <div className="gs-security-card__desc">Client-side moderation for blocked words and phrases in this group.</div>
          {!canManageModeration && (
            <div className="gs-overview__icon-hint" style={{ marginTop: 6 }}>
              Only owner/admin roles with moderation permissions can edit this.
            </div>
          )}
        </div>
        <button
          className={`gs-toggle ${moderation.enabled ? 'gs-toggle--on' : ''}`}
          onClick={() => canManageModeration && updateModeration({ enabled: !moderation.enabled })}
          disabled={!canManageModeration}
        >
          <span className="gs-toggle__knob" />
        </button>

        <div className="gs-moderation-panel">
          <div className="gs-moderation-row">
            <label className="gs-label" htmlFor="gs-moderation-mode">Filter Mode</label>
            <select
              id="gs-moderation-mode"
              className="gs-select"
              value={moderation.mode}
              onChange={(e) => canManageModeration && updateModeration({ mode: e.target.value as GroupModerationSettings['mode'] })}
              disabled={!canManageModeration}
            >
              <option value="block">Block message</option>
              <option value="mask">Mask blocked words</option>
              <option value="warn">Warn only</option>
            </select>
          </div>

          <div className="gs-moderation-row gs-moderation-row--toggle">
            <span className="gs-label">Notify members when a message is filtered</span>
            <button
              className={`gs-toggle ${moderation.notifyMembers ? 'gs-toggle--on' : ''}`}
              onClick={() => canManageModeration && updateModeration({ notifyMembers: !moderation.notifyMembers })}
              disabled={!canManageModeration}
            >
              <span className="gs-toggle__knob" />
            </button>
          </div>

          <div className="gs-moderation-row">
            <label className="gs-label" htmlFor="gs-blocked-terms">Blocked Terms (comma or new line)</label>
            <textarea
              id="gs-blocked-terms"
              className="gs-textarea gs-textarea--compact"
              rows={3}
              value={blockedTermsInput}
              onChange={(e) => setBlockedTermsInput(e.target.value)}
              disabled={!canManageModeration}
              placeholder="example1, example2"
            />
            {canManageModeration && (
              <div className="gs-moderation-actions">
                <Button
                  variant="ghost"
                  onClick={() => updateModeration({ blockedTerms: parseBlockedTermsInput(blockedTermsInput) })}
                >
                  Apply Terms
                </Button>
              </div>
            )}
          </div>

          <div className="gs-moderation-row">
            <label className="gs-label">Exempt Roles</label>
            <div className="gs-moderation-roles">
              {group.roles.filter((role) => !role.isDefault).map((role) => {
                const active = moderation.exemptRoleIds.includes(role.id);
                return (
                  <button
                    key={role.id}
                    className={`gs-moderation-role ${active ? 'gs-moderation-role--active' : ''}`}
                    onClick={() => canManageModeration && toggleExemptRole(role.id)}
                    disabled={!canManageModeration}
                  >
                    <span className="gs-role-item__dot" style={{ background: role.color }} />
                    {role.name}
                  </button>
                );
              })}
              {group.roles.filter((role) => !role.isDefault).length === 0 && (
                <span className="gs-overview__icon-hint">Create roles to configure moderation exemptions.</span>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="gs-security-card">
        <div className="gs-security-card__icon"><Lock size={18} /></div>
        <div className="gs-security-card__body">
          <div className="gs-security-card__title">Require PIN to open chats</div>
          <div className="gs-security-card__desc">Members must unlock this group with a PIN before reading messages.</div>
        </div>
        <button
          className={`gs-toggle ${convSec.requirePin ? 'gs-toggle--on' : ''}`}
          onClick={() => isAdmin && setConvSec(group.id, { requirePin: !convSec.requirePin })}
          disabled={!isAdmin}
        >
          <span className="gs-toggle__knob" />
        </button>
      </div>

      {convSec.requirePin && (
        <div className="gs-security-card">
          <div className="gs-security-card__icon"><Lock size={18} /></div>
          <div className="gs-security-card__body">
            <div className="gs-security-card__title">Group PIN</div>
            <div className="gs-security-card__desc">Set or rotate the PIN used to unlock this group.</div>
            <div className="gs-create-form__row" style={{ marginTop: 8 }}>
              <Input
                placeholder="Enter new PIN"
                value={pinInput}
                onChange={(e) => setPinInput(e.target.value)}
                maxLength={32}
                type="password"
                disabled={!isAdmin}
              />
              <Button variant="primary" disabled={!isAdmin || !pinInput.trim()} onClick={() => void savePin()}>
                Save PIN
              </Button>
            </div>
            {pinStatus && <div className="gs-overview__icon-hint">{pinStatus}</div>}
          </div>
        </div>
      )}

      <div className="gs-security-card">
        <div className="gs-security-card__icon"><Settings size={18} /></div>
        <div className="gs-security-card__body">
          <div className="gs-security-card__title">Auto-lock timeout</div>
          <div className="gs-security-card__desc">Choose how quickly chats lock again when PIN lock is enabled.</div>
        </div>
        <select
          className="gs-select"
          value={convSec.lockTimeout}
          onChange={(e) => setConvSec(group.id, { lockTimeout: e.target.value as LockTimeout })}
          disabled={!isAdmin || !convSec.requirePin}
        >
          {LOCK_TIMEOUT_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
      </div>

      {/* Block screenshots */}
      <div className="gs-security-card">
        <div className="gs-security-card__icon"><Eye size={18} /></div>
        <div className="gs-security-card__body">
          <div className="gs-security-card__title">Block Screenshots</div>
          <div className="gs-security-card__desc">Prevent screen capture for this server (where platform supports it).</div>
        </div>
        <button
          className={`gs-toggle ${convSec.blockScreenshots ? 'gs-toggle--on' : ''}`}
          onClick={() => isAdmin && setConvSec(group.id, { blockScreenshots: !convSec.blockScreenshots })}
          disabled={!isAdmin}
        >
          <span className="gs-toggle__knob" />
        </button>
      </div>

      {/* Hide notification previews */}
      <div className="gs-security-card">
        <div className="gs-security-card__icon"><Shield size={18} /></div>
        <div className="gs-security-card__body">
          <div className="gs-security-card__title">Hide Notification Previews</div>
          <div className="gs-security-card__desc">Don't show message text in push notifications for this server.</div>
        </div>
        <button
          className={`gs-toggle ${convSec.hideNotifPreview ? 'gs-toggle--on' : ''}`}
          onClick={() => isAdmin && setConvSec(group.id, { hideNotifPreview: !convSec.hideNotifPreview })}
          disabled={!isAdmin}
        >
          <span className="gs-toggle__knob" />
        </button>
      </div>

      {/* Blur messages */}
      <div className="gs-security-card">
        <div className="gs-security-card__icon"><Eye size={18} /></div>
        <div className="gs-security-card__body">
          <div className="gs-security-card__title">Privacy Screen</div>
          <div className="gs-security-card__desc">Blur messages until hovered/tapped — protects from shoulder surfing.</div>
        </div>
        <button
          className={`gs-toggle ${convSec.blurMessages ? 'gs-toggle--on' : ''}`}
          onClick={() => setConvSec(group.id, { blurMessages: !convSec.blurMessages })}
        >
          <span className="gs-toggle__knob" />
        </button>
      </div>

      {/* Invite controls */}
      <div className="gs-security-card">
        <div className="gs-security-card__icon"><Users size={18} /></div>
        <div className="gs-security-card__body">
          <div className="gs-security-card__title">Invite Restrictions</div>
          <div className="gs-security-card__desc">Only admins can invite new members to this server.</div>
        </div>
        <span className="gs-badge">Admin Only</span>
      </div>

      <div className="gs-security-card">
        <div className="gs-security-card__icon"><Shield size={18} /></div>
        <div className="gs-security-card__body">
          <div className="gs-security-card__title">Member verification policy</div>
          <div className="gs-security-card__desc">Encourage safety-number verification before granting elevated roles.</div>
        </div>
        <span className="gs-badge">Recommended</span>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
 *  TAB: Personalize (group-wide theme)
 * ═══════════════════════════════════════════════════════════ */

function PersonalizeTab({ group, isAdmin, userId }: { group: GroupInfo; isAdmin: boolean; userId: string }) {
  const [openEditor, setOpenEditor] = useState(true);
  const [syncMessage, setSyncMessage] = useState('');
  const groupTheme = useConvThemeStore((s) => s.themes[group.id] ?? {});
  const previousSerialized = useRef<string | null>(null);

  useEffect(() => {
    const serialized = JSON.stringify(groupTheme ?? {});
    if (previousSerialized.current === null) {
      previousSerialized.current = serialized;
      return;
    }

    if (previousSerialized.current === serialized) return;
    previousSerialized.current = serialized;

    if (!isAdmin) return;

    const recipients = group.members
      .map((member) => String(member.userId ?? '').trim())
      .filter((memberId) => memberId && memberId !== userId);

    if (recipients.length === 0) return;

    const timer = setTimeout(() => {
      void ws.sendGroupSettingsUpdate(group.id, recipients, {
        theme: groupTheme,
      });
      setSyncMessage('Group personalization synced');
      window.setTimeout(() => setSyncMessage(''), 1800);
    }, 450);

    return () => clearTimeout(timer);
  }, [group.id, group.members, groupTheme, isAdmin, userId]);

  return (
    <div className="gs-tab">
      <h3 className="gs-tab__heading">Group Personalization</h3>

      <div className="gs-security-card gs-security-card--highlight">
        <div className="gs-security-card__icon"><Settings size={18} /></div>
        <div className="gs-security-card__body">
          <div className="gs-security-card__title">Shared chat appearance</div>
          <div className="gs-security-card__desc">
            Configure the group's shared personalize settings. Members can still choose their own personalize mode in chat.
          </div>
        </div>
        {syncMessage && <span className="gs-badge gs-badge--secure">{syncMessage}</span>}
      </div>

      {!isAdmin && (
        <div className="gs-empty">
          Only admins can edit the group personalize settings.
        </div>
      )}

      {isAdmin && !openEditor && (
        <div className="gs-save-bar">
          <Button variant="primary" onClick={() => setOpenEditor(true)}>Open Group Personalize</Button>
        </div>
      )}

      {isAdmin && openEditor && (
        <ConvPersonalize
          convId={group.id}
          onClose={() => setOpenEditor(false)}
        />
      )}
    </div>
  );
}
