/* ================================================
   Chopsticks Console — SPA Client
   ================================================ */

// ─── Utilities ──────────────────────────────────

const $ = (sel, ctx = document) => ctx.querySelector(sel);
const $$ = (sel, ctx = document) => [...ctx.querySelectorAll(sel)];

function el(tag, props = {}, ...children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') e.className = v;
    else if (k === 'html') e.innerHTML = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v);
  }
  children.forEach(c => c && e.append(typeof c === 'string' ? c : c));
  return e;
}

function toast(msg, type = 'info') {
  let tc = $('#toast-container');
  if (!tc) {
    tc = el('div', { id: 'toast-container' });
    document.body.append(tc);
  }
  const t = el('div', { class: `toast toast-${type}` }, msg);
  tc.append(t);
  setTimeout(() => t.remove(), 3500);
}

function fmtTime(ts) {
  if (!ts) return '—';
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
function fmtDate(ts) {
  if (!ts) return '—';
  return new Date(ts).toLocaleDateString([], { month: 'short', day: 'numeric' });
}
function fmtRelative(ts) {
  const sec = Math.floor((Date.now() - new Date(ts)) / 1000);
  if (sec < 60) return `${sec}s ago`;
  if (sec < 3600) return `${Math.floor(sec/60)}m ago`;
  if (sec < 86400) return `${Math.floor(sec/3600)}h ago`;
  return `${Math.floor(sec/86400)}d ago`;
}
function fmtDuration(ms) {
  if (!ms) return '0:00';
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  if (h) return `${h}:${String(m%60).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`;
  return `${m}:${String(s%60).padStart(2,'0')}`;
}
function progressBar(pct, label = '') {
  return `<div class="progress-bar"><div class="progress-fill" style="width:${Math.max(0,Math.min(100,pct))}%"></div></div>`;
}
function avatarUrl(userId, hash) {
  if (!hash) return `https://cdn.discordapp.com/embed/avatars/${Number(userId)%5}.png`;
  return `https://cdn.discordapp.com/avatars/${userId}/${hash}.png?size=64`;
}
function guildIconUrl(guildId, hash) {
  if (!hash) return null;
  return `https://cdn.discordapp.com/icons/${guildId}/${hash}.png?size=64`;
}

// ─── API Client ─────────────────────────────────

const guildId = location.pathname.split('/').pop();
let _csrf = null;

async function api(method, path, body) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (_csrf) opts.headers['x-csrf-token'] = _csrf;
  if (body) opts.body = JSON.stringify(body);
  const r = await fetch(path, opts);
  if (r.status === 401) { location.href = '/'; return null; }
  const data = await r.json().catch(() => ({ ok: false, error: r.statusText }));
  return data;
}

async function get(path) { return api('GET', path); }
async function post(path, body) { return api('POST', path, body); }

async function fetchCsrf() {
  const r = await get('/api/me');
  _csrf = document.cookie.match(/csrf=([^;]+)/)?.[1] || r?.csrfToken || '';
  return r;
}

// ─── State ──────────────────────────────────────

const state = {
  guildId,
  guild: null,
  me: null,
  guildData: null,
  currentPage: 'overview',
  refreshTimer: null,
};

// ─── Router / Page Engine ────────────────────────

const PAGES = {
  overview:  { title: 'Overview',      sub: 'Server health at a glance',    icon: '⚡', render: renderOverview },
  music:     { title: 'Music',         sub: 'Playback & queue management',  icon: '🎵', render: renderMusic },
  pools:     { title: 'Agent Pools',   sub: 'Manage your agent fleet',      icon: '🤖', render: renderPools },
  voice:     { title: 'Voice Rooms',   sub: 'Lobby & VC configuration',     icon: '🔊', render: renderVoice },
  audiobook: { title: 'Audiobooks',    sub: 'Reading sessions & library',   icon: '📖', render: renderAudiobook },
  logs:      { title: 'Logs',          sub: 'Audit trail & command usage',  icon: '📋', render: renderLogs },
  settings:  { title: 'Settings',      sub: 'Bot settings & permissions',   icon: '⚙️', render: renderSettings },
};

function navigate(page) {
  if (!PAGES[page]) return;
  state.currentPage = page;

  // Update nav
  $$('.nav-item').forEach(b => b.classList.toggle('active', b.dataset.page === page));

  // Update header
  const p = PAGES[page];
  const title = $('#page-title');
  const sub   = $('#page-sub');
  if (title) title.textContent = p.title;
  if (sub)   sub.textContent   = p.sub;

  // Render body
  const body = $('#page-body');
  if (body) {
    body.innerHTML = '<div class="empty-state"><div class="splash-loader" style="width:120px;margin:0 auto"><div class="loader-bar"></div></div></div>';
    p.render(state.guildData).then(html => {
      if (state.currentPage === page) body.innerHTML = html;
      postRender(page);
    }).catch(err => {
      body.innerHTML = `<div class="empty-state"><div class="empty-state-icon">⚠️</div><div class="empty-state-title">Failed to load</div><div class="empty-state-sub">${err.message}</div></div>`;
    });
  }

  // Mobile: close sidebar
  $('#sidebar')?.classList.remove('open');
}

function postRender(page) {
  if (page === 'settings') initSettingsHandlers();
  if (page === 'music')    initMusicHandlers();
  if (page === 'pools')    initPoolsHandlers();
  if (page === 'voice')    initVoiceHandlers();
}

// ─── Boot ────────────────────────────────────────

async function boot() {
  // Replace splash with shell
  const tpl = $('#tpl-shell');
  document.getElementById('app').innerHTML = '';
  document.getElementById('app').append(tpl.content.cloneNode(true));

  // Wire sidebar navigation
  $$('.nav-item').forEach(btn => {
    btn.addEventListener('click', () => navigate(btn.dataset.page));
  });

  // Mobile sidebar toggle
  $('#sidebar-toggle')?.addEventListener('click', () => {
    $('#sidebar')?.classList.toggle('open');
  });

  // Refresh button
  $('#refresh-btn')?.addEventListener('click', () => refreshData(true));

  // Load data
  await refreshData(false);

  // Navigate to initial page
  navigate('overview');

  // Auto-refresh every 30s
  state.refreshTimer = setInterval(() => refreshData(false), 30000);
}

async function refreshData(showToast = false) {
  const [meData, guildData] = await Promise.all([
    fetchCsrf(),
    get(`/api/guild/${guildId}`),
  ]);

  if (!guildData?.ok) {
    toast('Failed to load server data', 'error');
    return;
  }

  state.me = meData;
  state.guildData = guildData;
  state.guild = guildData.guild;

  // Update sidebar
  const guildName = $('#guild-name');
  const guildIdEl = $('#guild-id-display');
  if (guildName) guildName.textContent = guildData.guild?.name ?? 'Unknown Server';
  if (guildIdEl) guildIdEl.textContent = guildId;

  // Update user info
  const userId = meData?.user?.id;
  const avatarEl = $('#user-avatar');
  const nameEl   = $('#user-name');
  const roleEl   = $('#user-role');
  if (avatarEl) {
    avatarEl.src = avatarUrl(userId, meData?.user?.avatar);
    avatarEl.alt = meData?.user?.username ?? '';
  }
  if (nameEl) nameEl.textContent = meData?.user?.username ?? '…';
  if (roleEl) {
    if (guildData.isAdmin) {
      roleEl.textContent = 'Bot Owner';
      roleEl.className = 'user-role admin-badge';
    } else {
      roleEl.textContent = 'Server Admin';
      roleEl.className = 'user-role guild-badge';
    }
  }

  if (showToast) toast('Data refreshed', 'success');

  // Re-render current page with fresh data
  if ($('#page-body')) navigate(state.currentPage);
}

// ─── Overview ────────────────────────────────────

async function renderOverview(d) {
  if (!d) return '<div class="empty-state"><div class="empty-state-icon">⚠️</div><div class="empty-state-title">No data</div></div>';

  const agents = d.agents ?? [];
  const online = agents.filter(a => a.status === 'online' || a.state === 'connected').length;
  const busy   = agents.filter(a => a.state === 'playing' || a.busy).length;
  const sessions = (d.sessions ?? []).length + (d.assistantSessions ?? []).length;
  const auditCount = (d.audit ?? []).length;

  // Guild icon
  const iconUrl = guildIconUrl(guildId, d.guild?.icon);
  const guildIcon = iconUrl
    ? `<img src="${iconUrl}" style="width:48px;height:48px;border-radius:50%;margin-right:14px;vertical-align:middle;" />`
    : `<span style="font-size:2.5rem;margin-right:14px">🏰</span>`;

  // Recent audit (top 5)
  const recentAudit = (d.audit ?? []).slice(0, 5).map(e => `
    <div class="audit-entry">
      <span class="audit-time">${fmtTime(e.timestamp ?? e.ts)}</span>
      <span class="audit-action">${e.action ?? e.event ?? '?'}</span>
      <span class="audit-user">${e.userId ? `· <@${e.userId}>` : ''}</span>
    </div>`).join('') || '<div class="empty-state-sub" style="padding:12px">No recent activity</div>';

  // Command stats top 5
  const stats = (d.analyticsGuild ?? d.analyticsGlobal ?? [])
    .slice(0, 5)
    .map(s => `<tr><td><code>${s.command ?? s.name ?? '?'}</code></td><td>${s.count ?? s.uses ?? 0}</td><td><span class="badge badge-purple">${fmtDate(s.lastUsed ?? s.updatedAt)}</span></td></tr>`)
    .join('') || '<tr><td colspan="3" style="text-align:center;color:var(--text-muted)">No data</td></tr>';

  return `
    <div class="stats-grid">
      <div class="stat-card">
        <div class="stat-icon">🤖</div>
        <div class="stat-body">
          <div class="stat-value">${agents.length}</div>
          <div class="stat-label">Total Agents</div>
        </div>
      </div>
      <div class="stat-card">
        <div class="stat-icon">🟢</div>
        <div class="stat-body">
          <div class="stat-value">${online}</div>
          <div class="stat-label">Online Agents</div>
        </div>
      </div>
      <div class="stat-card">
        <div class="stat-icon">🎵</div>
        <div class="stat-body">
          <div class="stat-value">${sessions}</div>
          <div class="stat-label">Active Sessions</div>
        </div>
      </div>
      <div class="stat-card">
        <div class="stat-icon">📋</div>
        <div class="stat-body">
          <div class="stat-value">${auditCount}</div>
          <div class="stat-label">Audit Entries</div>
        </div>
      </div>
    </div>

    <div class="grid-auto">
      <div class="card">
        <div class="card-header">
          <div>
            <div class="card-title">${guildIcon}${d.guild?.name ?? 'Server'}</div>
            <div class="card-sub">ID: ${guildId}</div>
          </div>
          <span class="badge badge-green">● Online</span>
        </div>
        <div style="display:flex;flex-wrap:wrap;gap:8px;font-size:0.78rem;color:var(--text-secondary)">
          <span>🤖 Agents: <b>${agents.length}</b></span>
          <span>🎵 Music sessions: <b>${(d.sessions ?? []).length}</b></span>
          <span>💬 AI sessions: <b>${(d.assistantSessions ?? []).length}</b></span>
        </div>
      </div>

      <div class="card">
        <div class="card-header">
          <div class="card-title">Recent Activity</div>
        </div>
        <div class="audit-list">${recentAudit}</div>
      </div>
    </div>

    <div class="section-title" style="margin-top:20px">Command Usage (This Server)</div>
    <div class="card">
      <div class="table-wrap">
        <table>
          <thead><tr><th>Command</th><th>Uses</th><th>Last Used</th></tr></thead>
          <tbody>${stats}</tbody>
        </table>
      </div>
    </div>`;
}

// ─── Music ───────────────────────────────────────

async function renderMusic(d) {
  if (!d) return renderEmpty('🎵', 'No music data available');

  const sessions = d.sessions ?? [];
  const musicCfg = d.music ?? {};

  const nowPlayingCards = sessions.length
    ? sessions.map(s => renderNowPlayingCard(s)).join('')
    : `<div class="empty-state"><div class="empty-state-icon">🎵</div>
       <div class="empty-state-title">Nothing playing right now</div>
       <div class="empty-state-sub">Use <code>/music play</code> in Discord to start</div></div>`;

  return `
    <div class="section-title">Active Sessions (${sessions.length})</div>
    <div id="music-sessions">${nowPlayingCards}</div>

    <div class="section-title">Music Settings</div>
    <div class="card">
      <div class="grid-2">
        <div class="form-row">
          <label class="form-label">Default Volume</label>
          <input class="form-input" id="music-vol" type="number" min="1" max="200" value="${musicCfg.defaultVolume ?? 80}" />
        </div>
        <div class="form-row">
          <label class="form-label">Default Mode</label>
          <select class="form-select" id="music-mode">
            ${['normal','radio','party','chill'].map(m =>
              `<option value="${m}" ${musicCfg.defaultMode === m ? 'selected' : ''}>${m}</option>`
            ).join('')}
          </select>
        </div>
      </div>
      <button class="btn btn-primary" id="save-music-settings">Save Settings</button>
    </div>

    <div class="section-title">DJ Mode</div>
    <div class="card">
      <div class="grid-2">
        <div class="form-row">
          <label class="form-label">DJ Mode</label>
          <label class="toggle">
            <input type="checkbox" id="dj-enabled" ${musicCfg.dj_enabled ? 'checked' : ''} />
            <span class="toggle-slider"></span>
          </label>
          <div class="form-hint">AI announcements between songs</div>
        </div>
        <div class="form-row">
          <label class="form-label">DJ Persona</label>
          <select class="form-select" id="dj-persona">
            ${['smooth','hype','chaotic','chill'].map(p =>
              `<option value="${p}" ${musicCfg.dj_persona === p ? 'selected' : ''}>${p}</option>`
            ).join('')}
          </select>
        </div>
      </div>
    </div>`;
}

function renderNowPlayingCard(s) {
  const track = s.currentTrack ?? s.track ?? {};
  const pos  = s.position ?? 0;
  const dur  = track.duration ?? track.length ?? 0;
  const pct  = dur ? Math.round((pos / dur) * 100) : 0;

  return `<div class="np-card" style="margin-bottom:12px">
    <div class="np-thumb">🎵</div>
    <div class="np-info">
      <div class="np-title">${track.title ?? 'Unknown Track'}</div>
      <div class="np-artist">${track.author ?? track.artist ?? 'Unknown Artist'}</div>
      <div class="np-progress">
        <span>${fmtDuration(pos)}</span>
        <div style="flex:1">${progressBar(pct)}</div>
        <span>${fmtDuration(dur)}</span>
      </div>
      <div style="display:flex;gap:6px;margin-top:10px;align-items:center">
        <span class="badge badge-green">● Playing</span>
        ${s.channelId ? `<span class="badge badge-blue">VC Active</span>` : ''}
        <span style="margin-left:auto;font-size:0.72rem;color:var(--text-muted)">${s.guildId ?? ''}</span>
      </div>
    </div>
  </div>`;
}

function initMusicHandlers() {
  $('#save-music-settings')?.addEventListener('click', async () => {
    const vol  = parseInt($('#music-vol')?.value ?? '80');
    const mode = $('#music-mode')?.value ?? 'normal';
    const r = await post(`/api/guild/${guildId}/music/default`, { defaultVolume: vol, defaultMode: mode });
    if (r?.ok) toast('Music settings saved', 'success');
    else toast(r?.error ?? 'Failed to save', 'error');
  });
}

// ─── Pools ───────────────────────────────────────

async function renderPools(d) {
  const pools = d?.myPools ?? [];
  const allPools = await get('/api/me');
  const myPools = allPools?.myPools ?? pools;
  const agents = d?.agents ?? [];

  if (!myPools.length) {
    return renderEmpty('🤖', 'No Agent Pools', 'Create a pool with <code>/pools create</code> in Discord');
  }

  const poolCards = myPools.map(p => `
    <div class="pool-card" data-pool-id="${p.id}">
      <div class="pool-card-header">
        <div class="pool-name">${p.name ?? 'Unnamed Pool'}</div>
        <span class="badge ${p.public ? 'badge-green' : 'badge-yellow'}">${p.public ? '🌍 Public' : '🔒 Private'}</span>
      </div>
      <div style="font-size:0.78rem;color:var(--text-secondary);margin-bottom:8px">
        ${p.description ?? '<span style="color:var(--text-muted)">No description set</span>'}
      </div>
      <div class="pool-tags">${(p.tags ?? []).map(t => `<span class="pool-tag">${t}</span>`).join('')}</div>
      <div class="completeness-bar">
        <div class="completeness-label">
          <span>Profile Completeness</span>
          <span>${p.completeness ?? 0}%</span>
        </div>
        ${progressBar(p.completeness ?? 0)}
      </div>
      <div style="display:flex;gap:8px;margin-top:12px">
        <button class="btn btn-ghost btn-sm" onclick="editPool('${p.id}')">✏️ Edit Profile</button>
        <button class="btn btn-ghost btn-sm" onclick="viewPoolAgents('${p.id}')">🤖 Agents (${p.agentCount ?? 0})</button>
      </div>
    </div>`).join('');

  const agentRows = agents.map(a => `
    <tr>
      <td><span class="status-dot ${getAgentStatus(a)}"></span> ${a.id?.slice(0, 8) ?? '?'}</td>
      <td><code>${a.guildId ?? '—'}</code></td>
      <td>${a.state ?? a.status ?? 'unknown'}</td>
      <td>${a.pool ?? '—'}</td>
      <td>
        <button class="btn btn-ghost btn-sm" onclick="disconnectAgent('${a.id}')">Disconnect</button>
      </td>
    </tr>`).join('') || '<tr><td colspan="5" style="text-align:center;color:var(--text-muted)">No agents connected</td></tr>';

  return `
    <div class="section-title">Your Pools (${myPools.length})</div>
    <div class="grid-auto" id="pools-grid">${poolCards}</div>

    <div class="section-title">Connected Agents</div>
    <div class="card">
      <div class="table-wrap">
        <table>
          <thead><tr><th>Agent</th><th>Guild</th><th>State</th><th>Pool</th><th>Actions</th></tr></thead>
          <tbody>${agentRows}</tbody>
        </table>
      </div>
    </div>`;
}

function getAgentStatus(a) {
  if (a.state === 'playing' || a.busy) return 'status-busy';
  if (a.status === 'online' || a.state === 'connected' || a.state === 'idle') return 'status-online';
  if (a.state === 'error') return 'status-error';
  return 'status-offline';
}

function initPoolsHandlers() {
  window.editPool = async (poolId) => {
    toast('Use /pools profile in Discord to edit pool details', 'info');
  };
  window.viewPoolAgents = async (poolId) => {
    toast('Agent details shown above', 'info');
  };
  window.disconnectAgent = async (agentId) => {
    const r = await post(`/api/agents/${agentId}/disconnect`, {});
    if (r?.ok) { toast('Agent disconnected', 'success'); navigate('pools'); }
    else toast(r?.error ?? 'Failed', 'error');
  };
}

// ─── Voice Rooms ─────────────────────────────────

async function renderVoice(d) {
  const voice = d?.voice ?? {};
  const channels = d?.channels ?? [];
  const vcChannels = channels.filter(c => c.type === 2 || c.type === 13);

  const lobbies = voice.lobbies ?? [];
  const lobbyRows = lobbies.map(l => `
    <tr>
      <td>${l.channelId}</td>
      <td><span class="badge ${l.enabled ? 'badge-green' : 'badge-yellow'}">${l.enabled ? 'Active' : 'Disabled'}</span></td>
      <td>Max: ${l.maxUsers ?? '∞'} · ${l.private ? '🔒 Private' : '🌍 Public'}</td>
      <td>
        <button class="btn btn-ghost btn-sm" onclick="toggleLobby('${l.channelId}', ${!l.enabled})">
          ${l.enabled ? 'Disable' : 'Enable'}
        </button>
      </td>
    </tr>`).join('') || '<tr><td colspan="4" style="text-align:center;color:var(--text-muted)">No lobbies configured</td></tr>';

  const vcOptions = vcChannels.map(c => `<option value="${c.id}">${c.name}</option>`).join('');

  return `
    <div class="section-title">Voice Lobbies</div>
    <div class="card">
      <div class="table-wrap">
        <table>
          <thead><tr><th>Channel</th><th>Status</th><th>Config</th><th>Actions</th></tr></thead>
          <tbody>${lobbyRows}</tbody>
        </table>
      </div>
    </div>

    <div class="section-title">Add Lobby</div>
    <div class="card">
      <div class="form-row">
        <label class="form-label">Voice Channel</label>
        <select class="form-select" id="add-lobby-channel">${vcOptions}</select>
      </div>
      <button class="btn btn-primary" id="add-lobby-btn">Add Lobby</button>
    </div>`;
}

function initVoiceHandlers() {
  $('#add-lobby-btn')?.addEventListener('click', async () => {
    const channelId = $('#add-lobby-channel')?.value;
    if (!channelId) return;
    const r = await post(`/api/guild/${guildId}/voice/lobby/add`, { channelId });
    if (r?.ok) { toast('Lobby added', 'success'); navigate('voice'); }
    else toast(r?.error ?? 'Failed', 'error');
  });
  window.toggleLobby = async (channelId, enabled) => {
    const r = await post(`/api/guild/${guildId}/voice/lobby/toggle`, { channelId, enabled });
    if (r?.ok) { toast(`Lobby ${enabled ? 'enabled' : 'disabled'}`, 'success'); navigate('voice'); }
    else toast(r?.error ?? 'Failed', 'error');
  };
}

// ─── Audiobook ───────────────────────────────────

async function renderAudiobook(d) {
  return renderEmpty('📖', 'Audiobook Sessions', 'Use <code>/audiobook start</code> in Discord to begin a reading session. Sessions appear here when active.');
}

// ─── Logs ────────────────────────────────────────

async function renderLogs(d) {
  const audit = d?.audit ?? [];

  const rows = audit.map(e => `
    <div class="audit-entry">
      <span class="audit-time">${fmtRelative(e.timestamp ?? e.ts ?? Date.now())}</span>
      <span class="audit-action">${e.action ?? e.event ?? '?'}</span>
      <span class="audit-user">${e.userId ? `· ${e.username ?? e.userId}` : ''}</span>
      ${e.detail ? `<span class="audit-detail">· ${e.detail}</span>` : ''}
    </div>`).join('') || '<div class="empty-state-sub" style="padding:20px">No audit entries found</div>';

  return `
    <div class="section-title">Audit Log (${audit.length} entries)</div>
    <div class="card">
      <div class="audit-list">${rows}</div>
    </div>

    <div class="section-title">Command Usage</div>
    <div class="card">
      <div class="table-wrap">
        <table>
          <thead><tr><th>Command</th><th>Uses</th><th>Last Used</th></tr></thead>
          <tbody>
            ${(d?.analyticsGuild ?? d?.analyticsGlobal ?? []).map(s =>
              `<tr>
                <td><code>${s.command ?? s.name ?? '?'}</code></td>
                <td>${s.count ?? s.uses ?? 0}</td>
                <td>${fmtDate(s.lastUsed ?? s.updatedAt)}</td>
              </tr>`
            ).join('') || '<tr><td colspan="3" style="text-align:center;color:var(--text-muted)">No data</td></tr>'}
          </tbody>
        </table>
      </div>
    </div>`;
}

// ─── Settings ────────────────────────────────────

async function renderSettings(d) {
  const cmdSettings = d?.commandSettings ?? [];
  const perms = d?.dashboardPerms ?? {};

  const cmdRows = cmdSettings.map(s => `
    <tr>
      <td><code>${s.command}</code></td>
      <td>${s.category ?? '—'}</td>
      <td>
        <label class="toggle">
          <input type="checkbox" class="cmd-toggle" data-cmd="${s.command}" ${s.enabled !== false ? 'checked' : ''} />
          <span class="toggle-slider"></span>
        </label>
      </td>
    </tr>`).join('') || '<tr><td colspan="3" style="text-align:center;color:var(--text-muted)">No command settings</td></tr>';

  return `
    <div class="section-title">Command Toggles</div>
    <div class="card">
      <div class="table-wrap">
        <table>
          <thead><tr><th>Command</th><th>Category</th><th>Enabled</th></tr></thead>
          <tbody>${cmdRows}</tbody>
        </table>
      </div>
    </div>

    <div class="section-title">Dashboard Access</div>
    <div class="card">
      <div class="form-row">
        <label class="form-label">Allowed User IDs (comma-separated)</label>
        <input class="form-input" id="perms-users" value="${(perms.allowUserIds ?? []).join(', ')}" placeholder="Discord user IDs" />
        <div class="form-hint">These users can access this guild's dashboard</div>
      </div>
      <div class="form-row">
        <label class="form-label">Allowed Role IDs (comma-separated)</label>
        <input class="form-input" id="perms-roles" value="${(perms.allowRoleIds ?? []).join(', ')}" placeholder="Discord role IDs" />
      </div>
      <button class="btn btn-primary" id="save-perms">Save Access Settings</button>
    </div>`;
}

function initSettingsHandlers() {
  // Command toggles
  $$('.cmd-toggle').forEach(cb => {
    cb.addEventListener('change', async function() {
      const cmd = this.dataset.cmd;
      const enabled = this.checked;
      const r = await post(`/api/guild/${guildId}/commands/toggle`, { command: cmd, enabled });
      if (r?.ok) toast(`${cmd} ${enabled ? 'enabled' : 'disabled'}`, 'success');
      else { toast(r?.error ?? 'Failed', 'error'); this.checked = !this.checked; }
    });
  });

  // Dashboard permissions
  $('#save-perms')?.addEventListener('click', async () => {
    const userIds = ($('#perms-users')?.value ?? '').split(',').map(s => s.trim()).filter(Boolean);
    const roleIds = ($('#perms-roles')?.value ?? '').split(',').map(s => s.trim()).filter(Boolean);
    const r = await post(`/api/guild/${guildId}/dashboard/permissions`, { allowUserIds: userIds, allowRoleIds: roleIds });
    if (r?.ok) toast('Access settings saved', 'success');
    else toast(r?.error ?? 'Failed', 'error');
  });
}

// ─── Helpers ─────────────────────────────────────

function renderEmpty(icon, title, sub = '') {
  return `<div class="empty-state">
    <div class="empty-state-icon">${icon}</div>
    <div class="empty-state-title">${title}</div>
    ${sub ? `<div class="empty-state-sub">${sub}</div>` : ''}
  </div>`;
}

// ─── Init ────────────────────────────────────────

if (!guildId || !/^\d+$/.test(guildId)) {
  document.getElementById('app').innerHTML = `
    <div class="splash">
      <div class="splash-inner">
        <div class="splash-logo">⚠️</div>
        <div class="splash-title">Invalid Session</div>
        <div class="splash-subtitle">No guild ID found. <a href="/" style="color:var(--text-accent)">Return home</a></div>
      </div>
    </div>`;
} else {
  boot().catch(err => {
    console.error('Boot failed:', err);
    document.getElementById('app').innerHTML = `
      <div class="splash">
        <div class="splash-inner">
          <div class="splash-logo">⚠️</div>
          <div class="splash-title">Failed to Load</div>
          <div class="splash-subtitle">${err.message} · <a href="/" style="color:var(--text-accent)">Return home</a></div>
        </div>
      </div>`;
  });
}
