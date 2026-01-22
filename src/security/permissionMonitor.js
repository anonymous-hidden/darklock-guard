/**
 * Permission prevention layer. Listens to member/role changes and removes roles
 * that grant dangerous permissions to non-whitelisted users/bots.
 */
const DANGEROUS_PERMS = ['ADMINISTRATOR','MANAGE_GUILD','MANAGE_CHANNELS','MANAGE_ROLES'];

function hasDangerousPerms(permBitfield) {
  if (!permBitfield) return false;
  const perms = permBitfield.toString ? permBitfield.toString() : permBitfield;
  for (const d of DANGEROUS_PERMS) {
    if (perms.includes(d)) return true;
  }
  return false;
}

class PermissionMonitor {
  constructor(client, { whitelist = new Set(), onDangerDetected = ()=>{} } = {}) {
    this.client = client;
    this.whitelist = whitelist;
    this.onDangerDetected = onDangerDetected;
    this._bind();
  }

  _bind() {
    this.client.on('guildMemberUpdate', async (oldMember, newMember) => {
      try {
        // check newly added roles
        const oldRoles = new Set(oldMember.roles.cache.keys());
        for (const r of newMember.roles.cache.values()) {
          if (!oldRoles.has(r.id)) {
            // role added
            if (hasDangerousPerms(r.permissions)) {
              await this._handleElevatedRole(newMember, r);
            } else {
              // check member's effective perms
              const effective = newMember.permissions;
              if (hasDangerousPerms(effective)) {
                await this._handleElevatedMember(newMember);
              }
            }
          }
        }
      } catch (e) {}
    });

    this.client.on('roleUpdate', async (oldRole, newRole) => {
      try {
        // permission increase
        if (!hasDangerousPerms(oldRole.permissions) && hasDangerousPerms(newRole.permissions)) {
          // remove this role from non-whitelisted members
          const guild = newRole.guild;
          for (const member of guild.members.cache.values()) {
            if (member.user && this.whitelist.has(member.id)) continue;
            if (member.roles.cache.has(newRole.id)) {
              try { await member.roles.remove(newRole.id, 'Role permissions escalated'); } catch(e){}
              this.onDangerDetected(guild, member, { reason: 'rolePermissionEscalation', role: newRole });
            }
          }
        }
      } catch(e) {}
    });
  }

  async _handleElevatedRole(member, role) {
    if (this.whitelist.has(member.id)) return;
    try {
      await member.roles.remove(role.id, 'Prevented dangerous permission grant');
    } catch (e) {}
    this.onDangerDetected(member.guild, member, { reason: 'roleAddedWithDangerousPerms', role });
  }

  async _handleElevatedMember(member) {
    if (this.whitelist.has(member.id)) return;
    // try to remove newly added roles that cause perms; best-effort: remove roles added in last 10s
    const now = Date.now();
    for (const role of member.roles.cache.values()) {
      try {
        if (hasDangerousPerms(role.permissions)) {
          await member.roles.remove(role.id, 'Prevented dangerous effective permissions');
        }
      } catch (e) {}
    }
    this.onDangerDetected(member.guild, member, { reason: 'memberGainedDangerousPerms' });
  }
}

module.exports = PermissionMonitor;
