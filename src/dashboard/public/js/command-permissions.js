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

    // Render table-like UI
    const table = document.createElement('div');
    table.className = 'permissions-table';

    commands.forEach(cmd => {
      const key = `command:${cmd.name}`;
      const row = document.createElement('div');
      row.className = 'permission-row';

      const label = document.createElement('div');
      label.className = 'permission-label';
      label.innerHTML = `<strong>${cmd.name}</strong><div class="muted">${cmd.description || ''}</div>`;

      const controls = document.createElement('div');
      controls.className = 'permission-controls';

      // role checkboxes
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
        cb.checked = (permMap[key] || []).includes(r.id);

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

    saveBtn.addEventListener('click', async () => {
      saveBtn.disabled = true;
      saveBtn.textContent = 'Saving…';

      // Build payload group by command
      const payloads = [];
      commands.forEach(cmd => {
        const checkboxes = Array.from(document.querySelectorAll(`input[data-command="${cmd.name}"]`));
        const selected = checkboxes.filter(c => c.checked).map(c => c.dataset.roleId);
        payloads.push({ scope: 'command', name: cmd.name, roleIds: selected });
      });

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
