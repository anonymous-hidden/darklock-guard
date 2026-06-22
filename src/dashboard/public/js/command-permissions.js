(function(){
  'use strict';

  async function apiFetch(url, opts = {}){
    opts.headers = opts.headers || {};
    opts.headers['Content-Type'] = 'application/json';
    try {
      const res = await fetch(url, opts);
      return await res.json();
    } catch (e) {
      console.error('API fetch error', e);
      return { success: false, error: e.message };
    }
  }

  async function init(){
    const guildId = new URLSearchParams(window.location.search).get('guildId') || null;
    const area = document.getElementById('permissions-area');
    const saveBtn = document.getElementById('saveBtn');
    const searchInput = document.getElementById('commandSearch');
    const showLegacyToggle = document.getElementById('showLegacyCommands');
    const hiddenLegacyHint = document.getElementById('hiddenLegacyHint');
    if (!guildId) {
      area.innerHTML = '<div class="error">guildId missing in URL (use ?guildId=).</div>';
      saveBtn.disabled = true;
      return;
    }

    area.innerHTML = '<div id="loading">Loading commands and roles…</div>';

    const [cmdRes, rolesRes, permRes] = await Promise.all([
      apiFetch(`/api/guilds/${encodeURIComponent(guildId)}/commands`),
      apiFetch('/api/roles?guildId=' + encodeURIComponent(guildId)),
      apiFetch(`/api/guilds/${encodeURIComponent(guildId)}/permissions`)
    ]);

    if (!cmdRes || !cmdRes.commands) {
      area.innerHTML = '<div class="error">Failed to load commands</div>';
      return;
    }

    const commands = cmdRes.commands;
    const roles = (rolesRes && rolesRes.roles) || [];
    const entries = (permRes && permRes.entries) || [];

    // Build quick lookup for existing permissions
    const permMap = {};
    entries.forEach(e => {
      permMap[`${e.scope}:${e.name}`] = e.roles || [];
    });

    const selectedRolesByCommand = new Map();
    commands.forEach(cmd => {
      const key = `command:${cmd.name}`;
      selectedRolesByCommand.set(cmd.name, new Set(permMap[key] || []));
    });

    function commandMatchesSearch(cmd, query) {
      if (!query) return true;
      const haystack = [
        cmd.name,
        cmd.description || '',
        ...(Array.isArray(cmd.aliases) ? cmd.aliases : []),
        cmd.movedTo || ''
      ].join(' ').toLowerCase();
      return haystack.includes(query);
    }

    function renderCommands() {
      const query = (searchInput?.value || '').trim().toLowerCase();
      const showLegacy = !!showLegacyToggle?.checked;

      const hiddenLegacyMatches = commands.filter(cmd => {
        return !!cmd.legacy && !showLegacy && commandMatchesSearch(cmd, query);
      }).length;

      if (hiddenLegacyHint) {
        if (hiddenLegacyMatches > 0 && query) {
          hiddenLegacyHint.textContent = `Some matching legacy commands are hidden. Enable Show legacy commands to view them. (${hiddenLegacyMatches})`;
          hiddenLegacyHint.style.display = 'block';
        } else {
          hiddenLegacyHint.style.display = 'none';
        }
      }

      const visibleCommands = commands.filter(cmd => {
        if (!commandMatchesSearch(cmd, query)) return false;
        if (!cmd.legacy) return true;
        return showLegacy;
      });

      const table = document.createElement('div');
      table.className = 'permissions-table';

      visibleCommands.forEach(cmd => {
        const row = document.createElement('div');
        row.className = 'permission-row';
        if (cmd.legacy) row.classList.add('permission-row-legacy');

        const label = document.createElement('div');
        label.className = 'permission-label';

        let legacyMeta = '';
        if (cmd.legacy && cmd.movedTo) {
          legacyMeta = `<div class="legacy-meta">Moved to ${cmd.movedTo}</div>`;
        } else if (cmd.legacy) {
          legacyMeta = '<div class="legacy-meta">Legacy command alias</div>';
        }

        label.innerHTML = `<strong>${cmd.name}${cmd.legacy ? ' <span class="legacy-badge">Legacy</span>' : ''}</strong><div class="muted">${cmd.description || ''}</div>${legacyMeta}`;

        const controls = document.createElement('div');
        controls.className = 'permission-controls';

        const selected = selectedRolesByCommand.get(cmd.name) || new Set();

        roles.forEach(r => {
          const id = `chk_${cmd.name}_${r.id}`;
          const wrapper = document.createElement('label');
          wrapper.style.marginRight = '8px';
          wrapper.style.display = 'inline-flex';
          wrapper.style.alignItems = 'center';

          const cb = document.createElement('input');
          cb.type = 'checkbox';
          cb.id = id;
          cb.dataset.roleId = r.id;
          cb.dataset.command = cmd.name;
          cb.checked = selected.has(r.id);
          cb.addEventListener('change', () => {
            const current = selectedRolesByCommand.get(cmd.name) || new Set();
            if (cb.checked) current.add(r.id);
            else current.delete(r.id);
            selectedRolesByCommand.set(cmd.name, current);
          });

          const span = document.createElement('span');
          span.textContent = r.name;
          span.style.marginLeft = '6px';

          wrapper.appendChild(cb);
          wrapper.appendChild(span);
          controls.appendChild(wrapper);
        });

        row.appendChild(label);
        row.appendChild(controls);
        table.appendChild(row);
      });

      area.innerHTML = '';
      area.appendChild(table);
    }

    renderCommands();

    if (searchInput) {
      searchInput.addEventListener('input', renderCommands);
    }
    if (showLegacyToggle) {
      showLegacyToggle.addEventListener('change', renderCommands);
    }

    saveBtn.addEventListener('click', async () => {
      saveBtn.disabled = true;
      saveBtn.textContent = 'Saving…';

      // Build payload group by command
      const payloads = commands.map(cmd => ({
        scope: 'command',
        name: cmd.name,
        roleIds: Array.from(selectedRolesByCommand.get(cmd.name) || [])
      }));

      try {
        for (const p of payloads) {
          await apiFetch(`/api/guilds/${encodeURIComponent(guildId)}/permissions`, {
            method: 'POST',
            body: JSON.stringify({ ...p, changedBy: 'dashboard' })
          });
        }
        alert('Permissions saved');
      } catch (e) {
        alert('Failed to save permissions');
      } finally {
        saveBtn.disabled = false;
        saveBtn.textContent = 'Save Permissions';
      }
    });
  }

  document.addEventListener('DOMContentLoaded', init);
})();
