/* ================================================
   Chopsticks Console — SPA Client
   ================================================ */

// ─── Utilities ──────────────────────────────────

const $ = (sel, ctx = document) => ctx.querySelector(sel);
const $$ = (sel, ctx = document) => [...ctx.querySelectorAll(sel)];

// HTML escape — MUST be applied to all user-controlled data in innerHTML
function esc(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

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
  overview:  { title: 'Overview',        sub: 'Server health at a glance',     icon: '⚡', render: renderOverview },
  music:     { title: 'Music',           sub: 'Playback & queue management',   icon: '🎵', render: renderMusic },
  pools:     { title: 'Agent Pools',     sub: 'Manage your agent fleet',       icon: '🤖', render: renderPools },
  voice:     { title: 'Voice Rooms',     sub: 'Lobby & VC configuration',      icon: '🔊', render: renderVoice },
  audiobook: { title: 'Audiobooks',      sub: 'Reading sessions & library',    icon: '📖', render: renderAudiobook },
  stats:     { title: 'Stats',           sub: 'Server leaderboards & activity',icon: '📊', render: renderStats },
  leveling:  { title: 'Leveling',        sub: 'XP rates & guild progression',  icon: '⚡', render: renderLeveling },
  actions:   { title: 'Agent Actions',   sub: 'Economy actions & cost config', icon: '🎭', render: renderActions },
  logs:      { title: 'Logs',            sub: 'Audit trail & command usage',   icon: '📋', render: renderLogs },
  settings:  { title: 'Settings',        sub: 'Bot settings & permissions',    icon: '⚙️', render: renderSettings },
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
      body.innerHTML = `<div class="empty-state"><div class="empty-state-icon">⚠️</div><div class="empty-state-title">Failed to load</div><div class="empty-state-sub">${esc(err.message)}</div></div>`;
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
      <span class="audit-action">${esc(e.action ?? e.event ?? '?')}</span>
      <span class="audit-user">${e.userId ? `· <@${e.userId}>` : ''}</span>
    </div>`).join('') || '<div class="empty-state-sub" style="padding:12px">No recent activity</div>';

  // Command stats top 5
  const stats = (d.analyticsGuild ?? d.analyticsGlobal ?? [])
    .slice(0, 5)
    .map(s => `<tr><td><code>${esc(s.command ?? s.name ?? '?')}</code></td><td>${s.count ?? s.uses ?? 0}</td><td><span class="badge badge-purple">${fmtDate(s.lastUsed ?? s.updatedAt)}</span></td></tr>`)
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
            <div class="card-title">${guildIcon}${esc(d.guild?.name ?? 'Server')}</div>
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
      <div class="np-title">${esc(track.title ?? 'Unknown Track')}</div>
      <div class="np-artist">${esc(track.author ?? track.artist ?? 'Unknown Artist')}</div>
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
    <div class="pool-card" data-pool-id="${esc(p.id)}">
      <div class="pool-card-header">
        <div class="pool-name">${esc(p.name ?? 'Unnamed Pool')}</div>
        <span class="badge ${p.public ? 'badge-green' : 'badge-yellow'}">${p.public ? '🌍 Public' : '🔒 Private'}</span>
      </div>
      <div style="font-size:0.78rem;color:var(--text-secondary);margin-bottom:8px">
        ${p.description ? esc(p.description) : '<span style="color:var(--text-muted)">No description set</span>'}
      </div>
      <div class="pool-tags">${(p.tags ?? []).map(t => `<span class="pool-tag">${t}</span>`).join('')}</div>
      <div class="completeness-bar">
        <div class="completeness-label">
          <span>Profile Completeness</span>
          <span>${Number(p.completeness ?? 0)}%</span>
        </div>
        ${progressBar(p.completeness ?? 0)}
      </div>
      <div style="display:flex;gap:8px;margin-top:12px">
        <button class="btn btn-ghost btn-sm" onclick="editPool('${esc(p.id)}')">✏️ Edit Profile</button>
        <button class="btn btn-ghost btn-sm" onclick="viewPoolAgents('${esc(p.id)}')">🤖 Agents (${Number(p.agentCount ?? 0)})</button>
      </div>
    </div>`).join('');

  const agentRows = agents.map(a => `
    <tr>
      <td><span class="status-dot ${getAgentStatus(a)}"></span> ${esc(a.id?.slice(0, 8) ?? '?')}</td>
      <td><code>${esc(a.guildId ?? '—')}</code></td>
      <td>${esc(a.state ?? a.status ?? 'unknown')}</td>
      <td>${esc(a.pool ?? '—')}</td>
      <td>
        <button class="btn btn-ghost btn-sm" onclick="disconnectAgent('${esc(a.id)}')">Disconnect</button>
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
      <span class="audit-action">${esc(e.action ?? e.event ?? '?')}</span>
      <span class="audit-user">${e.userId ? `· ${esc(e.username ?? e.userId)}` : ''}</span>
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
                <td><code>${esc(s.command ?? s.name ?? '?')}</code></td>
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
      <td><code>${esc(s.command)}</code></td>
      <td>${s.category ?? '—'}</td>
      <td>
        <label class="toggle">
          <input type="checkbox" class="cmd-toggle" data-cmd="${esc(s.command)}" ${s.enabled !== false ? 'checked' : ''} />
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

// ─── Stats Panel ─────────────────────────────────

const METRIC_LABELS = {
  messages_sent:     '💬 Messages',
  vc_minutes:        '🎙️ VC Time (min)',
  credits_earned:    '💰 Credits Earned',
  credits_spent:     '🛒 Credits Spent',
  work_runs:         '💼 Work Runs',
  gather_runs:       '⛏️ Gather Runs',
  fight_wins:        '⚔️ Fight Wins',
  trivia_wins:       '🧠 Trivia Wins',
  heist_runs:        '🏴‍☠️ Heist Runs',
  casino_wins:       '🎰 Casino Wins',
  commands_used:     '🤖 Commands Used',
  agent_actions_used:'🎭 Agent Actions',
};

async function renderStats(d) {
  let metric = 'messages_sent';
  async function loadBoard(m) {
    metric = m;
    const res = await get(`/api/guild/${guildId}/stats/leaderboard?metric=${m}&limit=15`);
    return res?.ok ? res.rows : [];
  }

  const rows = await loadBoard('messages_sent');

  function boardHtml(rows, m) {
    if (!rows.length) return '<div class="empty-state-sub">No data yet — activity will appear here as users engage.</div>';
    return `<div class="table-wrap"><table>
      <thead><tr><th>#</th><th>User</th><th>${METRIC_LABELS[m] || m}</th></tr></thead>
      <tbody>${rows.map((r, i) => `
        <tr>
          <td><b>${i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : i + 1}</b></td>
          <td><span class="tag">${esc(r.user_id)}</span></td>
          <td><b>${Number(r.value || 0).toLocaleString()}</b></td>
        </tr>`).join('')}
      </tbody>
    </table></div>`;
  }

  const metricSelector = `<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:16px">
    ${Object.entries(METRIC_LABELS).map(([k, v]) =>
      `<button class="btn ${k === 'messages_sent' ? 'btn-primary' : ''}" id="metric-${k}" onclick="window.__statsLoadBoard('${k}')" style="font-size:12px;padding:4px 10px">${v}</button>`
    ).join('')}
  </div>`;

  const html = `
    <div class="section-title">📊 Server Leaderboards</div>
    ${metricSelector}
    <div id="stats-board">${boardHtml(rows, 'messages_sent')}</div>
  `;

  setTimeout(() => {
    window.__statsLoadBoard = async (m) => {
      const el = document.getElementById('stats-board');
      if (el) el.innerHTML = '<div class="splash-loader" style="width:80px;margin:0 auto"><div class="loader-bar"></div></div>';
      $$('[id^="metric-"]').forEach(b => b.classList.remove('btn-primary'));
      const btn = document.getElementById(`metric-${m}`);
      if (btn) btn.classList.add('btn-primary');
      const res = await get(`/api/guild/${guildId}/stats/leaderboard?metric=${m}&limit=15`);
      if (el) el.innerHTML = boardHtml(res?.ok ? res.rows : [], m);
    };
  }, 50);

  return html;
}

// ─── Leveling Panel ───────────────────────────────

async function renderLeveling(d) {
  const cfgRes = await get(`/api/guild/${guildId}/xp/config`);
  const cfg = cfgRes?.ok ? cfgRes.config : {};

  const sources = [
    ['xp_per_message', '💬 Per Message', 'xp_per_message'],
    ['xp_per_vc_minute', '🎙️ Per VC Minute', 'xp_per_vc_minute'],
    ['xp_per_work', '💼 Work', 'xp_per_work'],
    ['xp_per_gather', '⛏️ Gather', 'xp_per_gather'],
    ['xp_per_fight_win', '⚔️ Fight Win', 'xp_per_fight_win'],
    ['xp_per_trivia_win', '🧠 Trivia Win', 'xp_per_trivia_win'],
    ['xp_per_daily', '📅 Daily Streak', 'xp_per_daily'],
    ['xp_per_command', '🤖 Per Command', 'xp_per_command'],
    ['xp_per_agent_action', '🎭 Agent Action', 'xp_per_agent_action'],
  ];

  const enabled = cfg.enabled !== false;
  const multiplier = Number(cfg.xp_multiplier || 1).toFixed(1);
  const cooldown = cfg.message_xp_cooldown_s ?? 60;
  const lvlupCh = cfg.levelup_channel_id ? `<#${cfg.levelup_channel_id}>` : '—';

  const html = `
    <div class="section-title">⚡ XP & Leveling Configuration</div>
    <div class="card" style="margin-bottom:16px;padding:16px">
      <div style="display:flex;gap:16px;align-items:center;flex-wrap:wrap">
        <label style="display:flex;align-items:center;gap:8px;cursor:pointer">
          <input type="checkbox" id="xp-enabled" ${enabled ? 'checked' : ''} onchange="window.__xpToggle(this.checked)" style="width:18px;height:18px">
          <span><b>Leveling System</b> — ${enabled ? '✅ Enabled' : '❌ Disabled'}</span>
        </label>
        <span style="color:var(--text-muted)">|</span>
        <label style="display:flex;align-items:center;gap:8px">
          <span>Multiplier:</span>
          <input type="number" id="xp-multiplier" value="${multiplier}" min="0.1" max="5" step="0.1" style="width:70px;background:var(--bg-input,#1e2124);color:var(--text-primary,#fff);border:1px solid var(--border,#444);border-radius:4px;padding:4px 8px">
          <button class="btn btn-sm" onclick="window.__xpSaveMultiplier()">Set</button>
        </label>
        <span style="color:var(--text-muted)">|</span>
        <label style="display:flex;align-items:center;gap:8px">
          <span>Msg Cooldown:</span>
          <input type="number" id="xp-cooldown" value="${cooldown}" min="10" max="3600" style="width:70px;background:var(--bg-input,#1e2124);color:var(--text-primary,#fff);border:1px solid var(--border,#444);border-radius:4px;padding:4px 8px">
          <span>sec</span>
          <button class="btn btn-sm" onclick="window.__xpSaveCooldown()">Set</button>
        </label>
      </div>
      <div style="margin-top:12px;color:var(--text-muted)">Level-up channel: <b>${lvlupCh}</b> — use <code>/xp config levelup_channel</code> to change</div>
    </div>

    <div class="section-title">XP Per Activity</div>
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:12px;margin-bottom:16px">
      ${sources.map(([id, label, field]) => `
        <div class="card" style="padding:12px">
          <div style="font-size:13px;color:var(--text-muted);margin-bottom:6px">${label}</div>
          <div style="display:flex;gap:8px;align-items:center">
            <input type="number" id="xp-${id}" value="${cfg[field] ?? ''}" min="0" max="500" placeholder="default"
              style="width:70px;background:var(--bg-input,#1e2124);color:var(--text-primary,#fff);border:1px solid var(--border,#444);border-radius:4px;padding:4px 8px">
            <span style="font-size:12px;color:var(--text-muted)">XP</span>
            <button class="btn btn-sm" onclick="window.__xpSaveField('${field}', document.getElementById('xp-${id}').value)">✔</button>
          </div>
        </div>`).join('')}
    </div>

    <div class="section-title">Quick Presets</div>
    <div style="display:flex;gap:8px;flex-wrap:wrap">
      ${[['relaxed','🌿 Relaxed'],['balanced','⚖️ Balanced'],['grind','🔥 Grind']].map(([p, l]) =>
        `<button class="btn" onclick="window.__xpPreset('${p}')">${l}</button>`).join('')}
    </div>
    <div id="xp-feedback" style="margin-top:12px;height:24px;color:var(--text-accent,#5865F2)"></div>
  `;

  setTimeout(() => {
    const feedback = (msg, ok = true) => {
      const el = document.getElementById('xp-feedback');
      if (el) { el.textContent = msg; el.style.color = ok ? 'var(--color-success,#2ecc71)' : 'var(--color-danger,#ed4245)'; }
    };
    window.__xpToggle = async (v) => {
      const r = await post(`/api/guild/${guildId}/xp/config`, { enabled: v });
      feedback(r?.ok ? `✅ Leveling ${v ? 'enabled' : 'disabled'}` : '❌ Error', r?.ok);
    };
    window.__xpSaveMultiplier = async () => {
      const v = parseFloat(document.getElementById('xp-multiplier')?.value || 1);
      const r = await post(`/api/guild/${guildId}/xp/config`, { xp_multiplier: v });
      feedback(r?.ok ? `✅ Multiplier set to ${v}x` : '❌ Error', r?.ok);
    };
    window.__xpSaveCooldown = async () => {
      const v = parseInt(document.getElementById('xp-cooldown')?.value || 60);
      const r = await post(`/api/guild/${guildId}/xp/config`, { message_xp_cooldown_s: v });
      feedback(r?.ok ? `✅ Cooldown set to ${v}s` : '❌ Error', r?.ok);
    };
    window.__xpSaveField = async (field, val) => {
      const v = parseInt(val);
      if (isNaN(v) || v < 0) { feedback('❌ Invalid value', false); return; }
      const r = await post(`/api/guild/${guildId}/xp/config`, { [field]: v });
      feedback(r?.ok ? `✅ Saved` : '❌ Error', r?.ok);
    };
    const PRESET_RATES = {
      relaxed:  { xp_per_message:3,xp_per_vc_minute:1,xp_per_work:20,xp_per_gather:15,xp_per_fight_win:25,xp_per_trivia_win:30,xp_per_daily:50,xp_multiplier:1.0,message_xp_cooldown_s:120 },
      balanced: { xp_per_message:5,xp_per_vc_minute:2,xp_per_work:40,xp_per_gather:30,xp_per_fight_win:50,xp_per_trivia_win:60,xp_per_daily:80,xp_multiplier:1.0,message_xp_cooldown_s:60 },
      grind:    { xp_per_message:10,xp_per_vc_minute:5,xp_per_work:80,xp_per_gather:60,xp_per_fight_win:100,xp_per_trivia_win:120,xp_per_daily:160,xp_multiplier:1.5,message_xp_cooldown_s:30 },
    };
    window.__xpPreset = async (preset) => {
      const r = await post(`/api/guild/${guildId}/xp/config`, PRESET_RATES[preset]);
      feedback(r?.ok ? `✅ Preset "${preset}" applied` : '❌ Error', r?.ok);
      if (r?.ok) setTimeout(() => navigate('leveling'), 800);
    };
  }, 50);

  return html;
}

// ─── Agent Actions Panel ──────────────────────────

async function renderActions(d) {
  const [actRes, usageRes] = await Promise.all([
    get(`/api/guild/${guildId}/actions`),
    get(`/api/guild/${guildId}/actions/usage`),
  ]);
  const actions = actRes.ok ? actRes.actions : [];
  const usage   = usageRes.ok ? usageRes.usage : [];
  const usageMap = Object.fromEntries(usage.map(u => [u.action_type, u]));

  const ACTION_EMOJI = { play_sound:'🔊', say_message:'🗣️', summon_dj:'🎵', air_horn:'📯', rickroll:'🎵', announce:'📢' };

  function actionRow(a) {
    const u = usageMap[a.action_type] || {};
    return `
      <tr>
        <td>${ACTION_EMOJI[a.action_type] || '🤖'} <b>${esc(a.name)}</b></td>
        <td><span class="tag">${esc(a.action_type)}</span></td>
        <td>
          <input type="number" id="cost-${a.id}" value="${a.cost}" min="0" style="width:70px;background:var(--bg-input,#1e2124);color:var(--text-primary,#fff);border:1px solid var(--border,#444);border-radius:4px;padding:2px 6px">
          <button class="btn btn-sm" onclick="window.__actionSetCost('${a.action_type}', document.getElementById('cost-${a.id}').value)" style="margin-left:4px">Set</button>
        </td>
        <td>${u.uses ? Number(u.uses).toLocaleString() + ' uses' : '—'}</td>
        <td>${u.total_spent ? Number(u.total_spent).toLocaleString() + ' credits' : '—'}</td>
        <td>
          <label style="display:flex;align-items:center;gap:6px;cursor:pointer">
            <input type="checkbox" ${a.enabled ? 'checked' : ''} onchange="window.__actionToggle('${a.action_type}', this.checked)" style="width:16px;height:16px">
            <span style="font-size:12px">${a.enabled ? 'On' : 'Off'}</span>
          </label>
        </td>
      </tr>`;
  }

  const html = `
    <div class="section-title">🎭 Agent Economy Actions</div>
    <div style="color:var(--text-muted);margin-bottom:16px;font-size:13px">
      Users can spend credits to trigger agents. Use <code>/actions admin enable</code> to add actions, then configure costs here.
    </div>
    ${actions.length ? `
      <div class="table-wrap"><table>
        <thead><tr><th>Action</th><th>Type</th><th>Cost (credits)</th><th>Uses</th><th>Credits Spent</th><th>Enabled</th></tr></thead>
        <tbody>${actions.map(actionRow).join('')}</tbody>
      </table></div>` :
      `<div class="card" style="padding:20px;text-align:center;color:var(--text-muted)">
        <div style="font-size:32px;margin-bottom:8px">🎭</div>
        <b>No actions configured yet</b><br>
        <span style="font-size:13px">Use <code>/actions admin enable</code> in Discord to add economy actions for your server.</span>
      </div>`
    }

    ${usage.length ? `
      <div class="section-title" style="margin-top:24px">📈 Usage Summary</div>
      <div class="table-wrap"><table>
        <thead><tr><th>Action</th><th>Total Uses</th><th>Credits Spent</th><th>Last Used</th></tr></thead>
        <tbody>${usage.map(u => `
          <tr>
            <td>${ACTION_EMOJI[u.action_type] || '🤖'} ${esc(u.action_type)}</td>
            <td>${Number(u.uses).toLocaleString()}</td>
            <td>${Number(u.total_spent || 0).toLocaleString()}</td>
            <td>${u.last_used ? new Date(Number(u.last_used)).toLocaleString() : '—'}</td>
          </tr>`).join('')}
        </tbody>
      </table></div>` : ''}

    <div id="action-feedback" style="margin-top:12px;height:24px;color:var(--text-accent,#5865F2)"></div>
  `;

  setTimeout(() => {
    const feedback = (msg, ok = true) => {
      const el = document.getElementById('action-feedback');
      if (el) { el.textContent = msg; el.style.color = ok ? 'var(--color-success,#2ecc71)' : 'var(--color-danger,#ed4245)'; }
    };
    window.__actionSetCost = async (type, val) => {
      const cost = parseInt(val);
      if (isNaN(cost) || cost < 0) { feedback('❌ Invalid cost', false); return; }
      const r = await post(`/api/guild/${guildId}/actions/${type}/cost`, { cost });
      feedback(r?.ok ? `✅ Cost updated for ${type}` : '❌ ' + (r?.error || 'Error'), r?.ok);
    };
    window.__actionToggle = async (type, enabled) => {
      const r = await post(`/api/guild/${guildId}/actions/${type}/toggle`, { enabled });
      feedback(r?.ok ? `✅ ${type} ${enabled ? 'enabled' : 'disabled'}` : '❌ Error', r?.ok);
    };
  }, 50);

  return html;
}

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
          <div class="splash-subtitle">${esc(err.message)} · <a href="/" style="color:var(--text-accent)">Return home</a></div>
        </div>
      </div>`;
  });
}
