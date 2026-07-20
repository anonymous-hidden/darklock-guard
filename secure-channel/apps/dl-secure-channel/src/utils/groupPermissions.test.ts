import { describe, expect, it } from 'vitest';
import { resolveGroupPermissions } from './groupPermissions';

describe('resolveGroupPermissions', () => {
  it('blocks send permissions for non-admin members when role permissions deny it', () => {
    const group = {
      id: 'group-1',
      name: 'Permissions Test',
      createdBy: 'owner',
      createdAt: 1,
      members: [
        { userId: 'owner', role: 'admin', roleIds: ['everyone'], joinedAt: 1 },
        { userId: 'alice', role: 'member', roleIds: ['everyone'], joinedAt: 1 },
      ],
      channels: [],
      categories: [],
      auditLog: [],
      roles: [
        {
          id: 'everyone',
          name: '@everyone',
          color: '#99aab5',
          position: 0,
          isDefault: true,
          permissions: {
            administrator: false,
            manageChannels: false,
            manageRoles: false,
            manageServer: false,
            kickMembers: false,
            banMembers: false,
            manageMessages: false,
            sendMessages: false,
            readMessages: true,
            attachFiles: false,
            useVoice: false,
            mentionEveryone: false,
            viewAuditLog: false,
            manageInvites: false,
          },
        },
      ],
    } as any;

    const perms = resolveGroupPermissions(group, 'alice');
    expect(perms.readMessages).toBe(true);
    expect(perms.sendMessages).toBe(false);
    expect(perms.attachFiles).toBe(false);
  });

  it('grants full access for admins and server creators', () => {
    const group = {
      id: 'group-1',
      name: 'Permissions Test',
      createdBy: 'owner',
      createdAt: 1,
      members: [
        { userId: 'owner', role: 'member', roleIds: ['everyone'], joinedAt: 1 },
        { userId: 'admin-user', role: 'admin', roleIds: ['everyone'], joinedAt: 1 },
      ],
      channels: [],
      categories: [],
      auditLog: [],
      roles: [
        {
          id: 'everyone',
          name: '@everyone',
          color: '#99aab5',
          position: 0,
          isDefault: true,
          permissions: {
            administrator: false,
            manageChannels: false,
            manageRoles: false,
            manageServer: false,
            kickMembers: false,
            banMembers: false,
            manageMessages: false,
            sendMessages: false,
            readMessages: false,
            attachFiles: false,
            useVoice: false,
            mentionEveryone: false,
            viewAuditLog: false,
            manageInvites: false,
          },
        },
      ],
    } as any;

    const creatorPerms = resolveGroupPermissions(group, 'owner');
    const adminPerms = resolveGroupPermissions(group, 'admin-user');

    expect(creatorPerms.sendMessages).toBe(true);
    expect(creatorPerms.manageChannels).toBe(true);
    expect(adminPerms.sendMessages).toBe(true);
    expect(adminPerms.manageRoles).toBe(true);
  });
});
