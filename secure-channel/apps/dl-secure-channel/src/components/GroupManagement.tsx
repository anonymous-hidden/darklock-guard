import { useState, useMemo } from 'react';
import { useChatStore } from '../stores/chatStore';
import { useAuthStore } from '../stores/authStore';
import { useConvThemeStore } from '../stores/convThemeStore';
import * as ws from '../net/wsClient';
import {
  Users, Plus, X, Search, Shield, Lock, Trash, ArrowLeft, Check, Crown,
} from './Icons';
import { Button, Input, Avatar, Badge, Modal } from './Shared';
import {
  GROUP_MESSAGING_CONTAINMENT_NOTICE,
  RIDGELINE_SECURITY_CAPABILITIES,
} from '@darklock/ridgeline-security-capabilities';
import './GroupManagement.css';

/* ── Create Group Modal ─────────────────────────────────── */

export function CreateGroupModal({ onClose }: { onClose: () => void }) {
  const [step, setStep] = useState<'info' | 'members'>('info');
  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  const contacts = useChatStore(s => s.contacts);
  const createGroup = useChatStore(s => s.createGroup);
  const userId = useAuthStore(s => s.userId);

  const contactList = useMemo(() => {
    const all = Object.values(contacts).filter(c => c.id !== userId);
    const q = searchQuery.toLowerCase().trim();
    if (!q) return all;
    return all.filter(c => c.displayName?.toLowerCase().includes(q));
  }, [contacts, userId, searchQuery]);

  const toggleSelect = (id: string) => {
    setSelectedIds(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id],
    );
  };

  const handleCreate = () => {
    if (!RIDGELINE_SECURITY_CAPABILITIES.groupMessagingSupported) return;
    if (!name.trim()) return;
    const groupId = createGroup(name.trim(), selectedIds);
    const createdGroup = useChatStore.getState().groups[groupId];
    // Send invite to all selected members via the relay
    const now = Date.now();
    const currentUserId = useAuthStore.getState().userId ?? '';
    const allMembers = [currentUserId, ...selectedIds.filter(id => id !== currentUserId)];
    const memberInfo = allMembers.map((uid, i) => ({
      userId: uid,
      role: i === 0 ? 'admin' : 'member',
      joinedAt: now,
    }));
    ws.sendGroupInvite(
      groupId,
      name.trim(),
      memberInfo,
      selectedIds,
      createdGroup?.channels,
      createdGroup?.categories,
      createdGroup?.roles,
      useConvThemeStore.getState().themes[groupId] ?? undefined,
      createdGroup?.moderation,
    );
    onClose();
  };

  return (
    <Modal title="Create Group" onClose={onClose}>
      <div className="group-create">
        {step === 'info' && (
          <div className="group-create__step">
            <div className="group-create__icon-row">
              <div className="group-create__avatar">
                <Users size={28} />
              </div>
            </div>

            <Input
              placeholder="Group name"
              value={name}
              onChange={e => setName(e.target.value)}
              maxLength={64}
            />

            <div className="group-create__info">
              <Shield size={14} />
              <span>{GROUP_MESSAGING_CONTAINMENT_NOTICE}</span>
            </div>

            <div className="group-create__actions">
              <Button variant="ghost" onClick={onClose}>Cancel</Button>
              <Button
                variant="primary"
                disabled={!name.trim() || !RIDGELINE_SECURITY_CAPABILITIES.groupMessagingSupported}
                onClick={() => setStep('members')}
              >
                Next
              </Button>
            </div>
          </div>
        )}

        {step === 'members' && (
          <div className="group-create__step">
            <button className="group-create__back" onClick={() => setStep('info')}>
              <ArrowLeft size={16} /> Back
            </button>

            <h3>Add Members</h3>

            {selectedIds.length > 0 && (
              <div className="group-create__selected">
                {selectedIds.map(id => {
                  const c = contacts[id];
                  return (
                    <div key={id} className="group-create__chip">
                      <span>{c?.displayName ?? id.slice(0, 8)}</span>
                      <button onClick={() => toggleSelect(id)}><X size={10} /></button>
                    </div>
                  );
                })}
              </div>
            )}

            <Input
              placeholder="Search contacts…"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              icon={<Search size={14} />}
            />

            <div className="group-create__contact-list">
              {contactList.length === 0 && (
                <div className="group-create__empty">No contacts found</div>
              )}
              {contactList.map(contact => {
                const selected = selectedIds.includes(contact.id);
                return (
                  <button
                    key={contact.id}
                    className={`group-create__contact ${selected ? 'group-create__contact--selected' : ''}`}
                    onClick={() => toggleSelect(contact.id)}
                  >
                    <Avatar name={contact.displayName ?? contact.id} size={32} online={contact.online} />
                    <span className="group-create__contact-name">{contact.displayName ?? contact.id.slice(0, 12)}</span>
                    {selected && (
                      <span className="group-create__check"><Check size={14} /></span>
                    )}
                  </button>
                );
              })}
            </div>

            <div className="group-create__actions">
              <Button variant="ghost" onClick={() => setStep('info')}>Back</Button>
              <Button
                variant="primary"
                onClick={handleCreate}
                disabled={!RIDGELINE_SECURITY_CAPABILITIES.groupMessagingSupported}
              >
                <Lock size={14} /> Group Messaging Unavailable
              </Button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}

/* ── Group Info Panel ───────────────────────────────────── */

export function GroupInfoPanel({ groupId, onClose }: { groupId: string; onClose: () => void }) {
  const groups = useChatStore(s => s.groups);
  const contacts = useChatStore(s => s.contacts);
  const userId = useAuthStore(s => s.userId);

  const group = groups[groupId];
  if (!group) return null;

  const isAdmin = group.members.some(m => m.userId === userId && m.role === 'admin');

  return (
    <div className="group-info">
      <div className="group-info__header">
        <button className="group-info__close" onClick={onClose}>
          <X size={18} />
        </button>
        <h3>Group Info</h3>
      </div>

      <div className="group-info__profile">
        <div className="group-info__avatar"><Users size={32} /></div>
        <h2>{group.name}</h2>
        <span className="group-info__meta">
          <Lock size={12} /> Messaging paused · {group.members.length} {group.members.length === 1 ? 'member' : 'members'}
        </span>
      </div>

      <div className="group-info__section">
        <h4>Security status</h4>
        <div className="group-info__enc-badge">
          <Shield size={14} />
          <span>{GROUP_MESSAGING_CONTAINMENT_NOTICE}</span>
        </div>
      </div>

      <div className="group-info__section">
        <div className="group-info__section-header">
          <h4>Members ({group.members.length})</h4>
          {isAdmin && (
            <button className="group-info__add-btn">
              <Plus size={14} /> Add
            </button>
          )}
        </div>

        <div className="group-info__members">
          {group.members.map(member => {
            const contact = contacts[member.userId];
            const name = member.userId === userId
              ? 'You'
              : (contact?.displayName ?? member.userId.slice(0, 12));

            return (
              <div key={member.userId} className="group-info__member">
                <Avatar name={name} size={32} online={contact?.online} />
                <div className="group-info__member-info">
                  <span className="group-info__member-name">{name}</span>
                  {member.role === 'admin' && (
                    <Badge variant="primary"><Crown size={8} /> Admin</Badge>
                  )}
                </div>
                {isAdmin && member.userId !== userId && (
                  <button className="group-info__remove-btn" aria-label={`Remove ${name} from group`}>
                    <Trash size={14} />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div className="group-info__section">
        <Button variant="danger" size="sm" className="group-info__leave">
          Leave Group
        </Button>
      </div>
    </div>
  );
}
