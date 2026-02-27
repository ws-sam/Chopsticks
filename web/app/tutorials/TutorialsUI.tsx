'use client';

import React, { useState } from 'react';
import { ArrowRightIcon, ShieldIcon, CoinIcon, RadioIcon, ServerIcon, PaletteIcon, BookOpenIcon, UsersIcon } from '../icons';

const GITHUB = 'https://github.com/WokSpec/Chopsticks';
const BOT_INVITE = 'https://discord.com/api/oauth2/authorize?client_id=1466382874587431036&permissions=1099514858544&scope=bot%20applications.commands';

type Difficulty = 'beginner' | 'intermediate' | 'advanced';
type Step = { heading: string; body: React.ReactNode };
type Tutorial = { slug: string; icon: React.FC<{ size?: number }>; title: string; desc: string; difficulty: Difficulty; time: string; preview?: string; steps: Step[] };

const DIFF_LABEL: Record<Difficulty, string> = { beginner: 'Beginner', intermediate: 'Intermediate', advanced: 'Advanced' };

const TUTORIALS: Tutorial[] = [
  {
    slug: 'getting-started',
    icon: BookOpenIcon,
    title: 'Getting Started',
    preview: '/images/preview-setup.svg',
    desc: 'Add Chopsticks to your server, grant the right permissions, and run your first commands. Five minutes from zero to working.',
    difficulty: 'beginner',
    time: '5 min',
    steps: [
      { heading: '1. Invite the bot', body: <span>Visit the <a href={BOT_INVITE} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent)' }}>invite link</a> and add Chopsticks to your server. Select a server where you have Manage Server permission.</span> },
      { heading: '2. Grant permissions', body: 'The invite pre-selects required permissions. Chopsticks needs at minimum: Send Messages, Embed Links, Use Application Commands, and Connect + Speak for music.' },
      { heading: '3. Run /setup', body: 'In any channel visible to the bot, run /setup. This initialises the database for your server — economy tables, mod log channel, welcome settings, etc.' },
      { heading: '4. Test a command', body: 'Try /ping to confirm the bot is responding. Then !help to see all available commands grouped by category.' },
      { heading: 'Next steps', body: 'Head to the Moderation Setup or Economy Setup tutorials to configure those modules, or read Customising with /theme to brand the bot for your server.' },
    ],
  },
  {
    slug: 'moderation',
    icon: ShieldIcon,
    title: 'Moderation Setup',
    preview: '/images/preview-moderation.svg',
    desc: 'Configure mod roles, a dedicated log channel, and test every action — ban, kick, mute, warn, and purge.',
    difficulty: 'beginner',
    time: '10 min',
    steps: [
      { heading: '1. Set a mod log channel', body: 'Create a private channel (e.g. #mod-log) and run /setup modlog #mod-log. Every moderation action will be posted there with the moderator, reason, and case ID.' },
      { heading: '2. Assign mod roles', body: 'Run /setup modrole @YourModRole. Members with this role can use all moderation commands. You can add multiple roles.' },
      { heading: '3. Understand hierarchy', body: "Chopsticks is hierarchy-safe — a moderator cannot take action against someone with a role higher than or equal to their own. This mirrors Discord's own hierarchy." },
      { heading: '4. Test !warn', body: "Run !warn @member Reason. This logs the warning, DMs the member, and creates a case record. Check !cases @member to view a user's history." },
      { heading: '5. Configure auto-mod (optional)', body: 'Use /automod to set up spam filters, bad-word detection, or mention limits. Each rule can be scoped to specific channels or roles.' },
    ],
  },
  {
    slug: 'economy',
    icon: CoinIcon,
    title: 'Economy Setup',
    preview: '/images/preview-economy.svg',
    desc: 'Set up the credits system, configure daily rewards, build a shop, and keep your community engaged with leaderboards.',
    difficulty: 'beginner',
    time: '15 min',
    steps: [
      { heading: '1. Enable economy', body: 'Run /setup economy enable. This creates the database tables for your server. Economy is on by default in the hosted instance.' },
      { heading: '2. Configure daily rewards', body: 'Run /setup daily amount:500 streak-bonus:100. Members can claim once per 24h. Streak bonuses reward consecutive daily claims.' },
      { heading: '3. Add shop items', body: 'Run /shop add name:"VIP Role" price:2000 role:@VIP. When a member buys this, the bot automatically assigns the role.' },
      { heading: '4. Set starting balance', body: 'New members start with 0 credits by default. To give a starting balance, run /setup economy start-balance:250.' },
      { heading: '5. Check the leaderboard', body: 'Run !leaderboard to see the top earners. Public and real-time. Great for competitions and engagement.' },
    ],
  },
  {
    slug: 'agent-pool',
    icon: RadioIcon,
    title: 'Using the Agent System',
    preview: '/images/preview-agents.svg',
    desc: 'Learn how to deploy and configure agents in your server — voice actors, support bots, trivia hosts, and more. Feature in active development.',
    difficulty: 'intermediate',
    time: '20 min',
    steps: [
      { heading: 'What agents are', body: 'An agent is a configurable bot actor you deploy inside your server. You give it a name, a persona, and a job — then point it at a channel. Agents can narrate text aloud in voice, run trivia, host support threads, commentate gaming sessions, and more.' },
      { heading: '1. Configure via /setup agents', body: 'Run /setup agents to open the configuration wizard. Set which behaviours agents are allowed to perform, and how they should behave in your server.' },
      { heading: '2. Create your first agent', body: 'Use /agent create to set a name and persona. Keep it simple — a name, a short description of its role, and the channel you want it to live in.' },
      { heading: '3. Deploy to a channel', body: 'Run /agent deploy in the target channel to activate the agent. For voice, join a VC first. The agent will join and begin its assigned behaviour.' },
      { heading: '4. Agent actions', body: 'Depending on the agent type, it can play music, narrate audiobooks, host trivia, greet newcomers, or maintain conversation in a text channel. Use /agent leave to deactivate.' },
      { heading: '5. This feature is actively evolving', body: <span>The agent system is one of the most exciting parts of Chopsticks. Check the <a href={GITHUB + '/issues'} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent)' }}>open issues on GitHub</a> if you want to help shape where it goes next.</span> },
    ],
  },
  {
    slug: 'theme',
    icon: PaletteIcon,
    title: 'Customising with /theme',
    preview: '/images/preview-theme.svg',
    desc: "Change embed colors, rename the bot's persona, and disable modules — all from inside Discord, no code required.",
    difficulty: 'beginner',
    time: '8 min',
    steps: [
      { heading: 'What /theme controls', body: 'The /theme command applies per-server customisations. Changes only affect your server. No forking, no code changes required.' },
      { heading: '1. Change embed color', body: 'Run /theme color #ff6b6b. All bot embeds in your server will use this accent color. Any valid hex value works.' },
      { heading: "2. Rename the bot's persona", body: 'Run /theme name "Wok Helper". This changes how the bot refers to itself in embeds within your server. The Discord username stays as Chopsticks.' },
      { heading: '3. Disable a module', body: 'Run /theme feature music:off to disable music commands in your server. Toggles: music, economy, games, ai. Re-enable with /theme feature music:on.' },
      { heading: '4. Check current theme', body: 'Run /theme view to see your active theme settings at a glance.' },
      { heading: 'For deeper customisation', body: "If you want to change the bot's name globally or avatar, that requires a self-hosted instance. See the Self-hosting tutorial." },
    ],
  },
  {
    slug: 'welcome-messages',
    icon: UsersIcon,
    title: 'Welcome Messages',
    preview: '/images/preview-welcome.svg',
    desc: 'Greet new members automatically with personalised messages, DM welcomes, goodbye notices, and live member counts.',
    difficulty: 'beginner',
    time: '10 min',
    steps: [
      { heading: 'What /welcome does', body: 'The /welcome command lets you configure per-server welcome messages. You can set the channel, the message text, a DM welcome, a goodbye message, and show a live member count.' },
      { heading: '1. Set the welcome channel', body: <span>Run <code style={{ fontFamily: 'var(--font-mono)', color: 'var(--accent)', fontSize: '0.82rem' }}>/welcome set #welcome</code>. Chopsticks will post welcome messages here whenever a new member joins.</span> },
      { heading: '2. Customise the message', body: <span>Run <code style={{ fontFamily: 'var(--font-mono)', color: 'var(--accent)', fontSize: '0.82rem' }}>/welcome message</code> with your text. Placeholders: <code style={{ fontFamily: 'var(--font-mono)', color: 'var(--accent)', fontSize: '0.82rem' }}>{'{user}'}</code> (mention), <code style={{ fontFamily: 'var(--font-mono)', color: 'var(--accent)', fontSize: '0.82rem' }}>{'{server}'}</code> (server name), <code style={{ fontFamily: 'var(--font-mono)', color: 'var(--accent)', fontSize: '0.82rem' }}>{'{membercount}'}</code> (current count).</span> },
      { heading: '3. Enable a DM welcome', body: <span>Run <code style={{ fontFamily: 'var(--font-mono)', color: 'var(--accent)', fontSize: '0.82rem' }}>/welcome dm-set</code> then <code style={{ fontFamily: 'var(--font-mono)', color: 'var(--accent)', fontSize: '0.82rem' }}>/welcome dm-enable</code>. Handy for sending rules or getting-started info privately.</span> },
      { heading: '4. Add a goodbye message', body: <span>Run <code style={{ fontFamily: 'var(--font-mono)', color: 'var(--accent)', fontSize: '0.82rem' }}>/welcome goodbye-set</code> then <code style={{ fontFamily: 'var(--font-mono)', color: 'var(--accent)', fontSize: '0.82rem' }}>/welcome goodbye-enable</code>. Posts in the same welcome channel when a member leaves.</span> },
      { heading: '5. Show member count', body: <span>Run <code style={{ fontFamily: 'var(--font-mono)', color: 'var(--accent)', fontSize: '0.82rem' }}>/welcome membercount</code> to show a live count in the welcome embed.</span> },
      { heading: '6. Preview and test', body: <span>Run <code style={{ fontFamily: 'var(--font-mono)', color: 'var(--accent)', fontSize: '0.82rem' }}>/welcome preview</code> to trigger a test welcome message — no need to leave and rejoin.</span> },
    ],
  },
  {
    slug: 'self-host',
    icon: ServerIcon,
    title: 'Self-hosting',
    preview: '/images/preview-selfhost.svg',
    desc: 'Run your own Chopsticks instance with Docker. Full stack: bot, database, Redis. From clone to online in under 15 minutes.',
    difficulty: 'advanced',
    time: '30 min',
    steps: [
      { heading: 'Prerequisites', body: 'Docker Engine v24+ with Compose v2, a Discord application + bot token from the Developer Portal, and at least 1 GB of free RAM.' },
      { heading: '1. Clone and configure', body: <span><pre style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8rem', lineHeight: 1.6, color: 'var(--text-muted)', background: 'var(--surface-raised)', border: '1px solid var(--border)', borderRadius: '0.5rem', padding: '0.875rem 1rem', margin: '0.5rem 0', overflow: 'auto' }}>{`git clone https://github.com/WokSpec/Chopsticks.git\ncd Chopsticks\ncp .env.example .env`}</pre>Open <code style={{ fontFamily: 'var(--font-mono)', color: 'var(--accent)', fontSize: '0.82rem' }}>.env</code> and fill in your <code style={{ fontFamily: 'var(--font-mono)', color: 'var(--accent)', fontSize: '0.82rem' }}>DISCORD_TOKEN</code> and <code style={{ fontFamily: 'var(--font-mono)', color: 'var(--accent)', fontSize: '0.82rem' }}>CLIENT_ID</code>.</span> },
      { heading: '2. Start with Docker Compose', body: <span><pre style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8rem', lineHeight: 1.6, color: 'var(--text-muted)', background: 'var(--surface-raised)', border: '1px solid var(--border)', borderRadius: '0.5rem', padding: '0.875rem 1rem', margin: '0.5rem 0', overflow: 'auto' }}>{`docker compose -f docker-compose.free.yml up -d`}</pre></span> },
      { heading: '3. Verify it is running', body: <span><pre style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8rem', lineHeight: 1.6, color: 'var(--text-muted)', background: 'var(--surface-raised)', border: '1px solid var(--border)', borderRadius: '0.5rem', padding: '0.875rem 1rem', margin: '0.5rem 0', overflow: 'auto' }}>{`docker compose logs bot --follow`}</pre>You should see the bot come online in your Discord server.</span> },
      { heading: '4. Stay updated', body: <span><pre style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8rem', lineHeight: 1.6, color: 'var(--text-muted)', background: 'var(--surface-raised)', border: '1px solid var(--border)', borderRadius: '0.5rem', padding: '0.875rem 1rem', margin: '0.5rem 0', overflow: 'auto' }}>{`git pull && docker compose build && docker compose up -d`}</pre>Watch <a href={GITHUB + '/releases'} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent)' }}>GitHub releases</a> for breaking changes before updating.</span> },
      { heading: 'Need help?', body: <span>Open a <a href={GITHUB + '/discussions'} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent)' }}>GitHub Discussion</a> or an <a href={GITHUB + '/issues'} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent)' }}>issue</a>. Full guide on the <a href="/self-host" style={{ color: 'var(--accent)' }}>Self-host page</a>.</span> },
    ],
  },
];

export default function TutorialsUI() {
  const [active, setActive] = useState(0);
  const t = TUTORIALS[active];

  return (
    <>
      {/* ── Demo Viewer ── */}
      <section style={{ padding: '2.5rem 0 0', borderBottom: '1px solid var(--border)' }}>
        <div className="container">

          {/* Navigation pills */}
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '1.5rem' }}>
            {TUTORIALS.map((tut, i) => (
              <button
                key={tut.slug}
                onClick={() => setActive(i)}
                style={{
                  display: 'flex', alignItems: 'center', gap: '0.45rem',
                  padding: '0.45rem 0.9rem',
                  borderRadius: 999,
                  border: i === active ? '1px solid var(--accent)' : '1px solid var(--border)',
                  background: i === active ? 'var(--accent)' : 'var(--surface)',
                  color: i === active ? '#fff' : 'var(--text-muted)',
                  fontSize: '0.78rem', fontWeight: i === active ? 700 : 500,
                  fontFamily: 'var(--font-heading)',
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                  whiteSpace: 'nowrap',
                }}
              >
                <tut.icon size={13} />
                {tut.title}
              </button>
            ))}
          </div>

          {/* Full-width SVG demo — shown at natural aspect ratio */}
          {t.preview && (
            <div style={{
              borderRadius: '0.75rem 0.75rem 0 0',
              overflow: 'hidden',
              border: '1px solid var(--border)',
              borderBottom: 'none',
              background: '#1e1f22',
              boxShadow: '0 8px 40px rgba(0,0,0,0.4)',
            }}>
              {/* Fake browser/Discord chrome */}
              <div style={{
                background: '#1e1f22',
                padding: '0.6rem 0.875rem',
                display: 'flex', alignItems: 'center', gap: '0.5rem',
                borderBottom: '1px solid #232428',
              }}>
                <span style={{ width: 11, height: 11, borderRadius: '50%', background: '#ed4245', display: 'block', flexShrink: 0 }} />
                <span style={{ width: 11, height: 11, borderRadius: '50%', background: '#faa61a', display: 'block', flexShrink: 0 }} />
                <span style={{ width: 11, height: 11, borderRadius: '50%', background: '#23a55a', display: 'block', flexShrink: 0 }} />
                <div style={{ flex: 1, marginLeft: '0.5rem', background: '#2b2d31', borderRadius: 5, padding: '0.22rem 0.75rem', fontSize: '0.7rem', color: '#949ba4', fontFamily: 'var(--font-mono)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  Discord — {t.title}
                </div>
              </div>
              {/* SVG rendered at full natural width — no cropping */}
              <img
                src={t.preview}
                alt={`${t.title} demo`}
                style={{ width: '100%', height: 'auto', display: 'block' }}
              />
            </div>
          )}

          {/* Info bar below the demo */}
          <div style={{
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            borderTop: 'none',
            borderRadius: '0 0 0.75rem 0.75rem',
            padding: '1rem 1.25rem',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.75rem',
            marginBottom: '3rem',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
              <div className="tutorial-card-icon" style={{ marginBottom: 0 }}>
                <t.icon size={18} />
              </div>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
                  <span style={{ fontWeight: 700, fontSize: '1rem', color: 'var(--text)', fontFamily: 'var(--font-heading)' }}>{t.title}</span>
                  <span className={`tutorial-tag tag-${t.difficulty}`}>{DIFF_LABEL[t.difficulty]}</span>
                  <span style={{ fontSize: '0.72rem', color: 'var(--text-faint)', fontFamily: 'var(--font-heading)' }}>{t.time}</span>
                </div>
                <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', marginTop: '0.2rem', lineHeight: 1.6 }}>{t.desc}</p>
              </div>
            </div>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button
                onClick={() => setActive(Math.max(0, active - 1))}
                disabled={active === 0}
                style={{ padding: '0.45rem 0.85rem', borderRadius: 6, border: '1px solid var(--border)', background: 'transparent', color: active === 0 ? 'var(--text-faint)' : 'var(--text-muted)', cursor: active === 0 ? 'not-allowed' : 'pointer', fontSize: '0.8rem', fontFamily: 'var(--font-heading)' }}
              >&#8592; Prev</button>
              <button
                onClick={() => setActive(Math.min(TUTORIALS.length - 1, active + 1))}
                disabled={active === TUTORIALS.length - 1}
                style={{ padding: '0.45rem 0.85rem', borderRadius: 6, border: '1px solid var(--border)', background: 'transparent', color: active === TUTORIALS.length - 1 ? 'var(--text-faint)' : 'var(--text-muted)', cursor: active === TUTORIALS.length - 1 ? 'not-allowed' : 'pointer', fontSize: '0.8rem', fontFamily: 'var(--font-heading)' }}
              >Next &#8594;</button>
            </div>
          </div>
        </div>
      </section>

      {/* ── Steps for active tutorial ── */}
      <section style={{ padding: '3rem 0 4rem' }}>
        <div className="container" style={{ maxWidth: 760 }}>
          <h2 style={{ fontSize: '1.25rem', fontWeight: 700, letterSpacing: '-0.03em', color: 'var(--text)', fontFamily: 'var(--font-heading)', marginBottom: '2rem', paddingBottom: '1rem', borderBottom: '1px solid var(--border)' }}>
            {t.title} — Steps
          </h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.75rem' }}>
            {t.steps.map((step, si) => (
              <div key={si} style={{ display: 'flex', gap: '1.25rem', alignItems: 'flex-start' }}>
                <div style={{ width: 28, height: 28, borderRadius: '50%', background: 'var(--surface-raised)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.68rem', fontWeight: 700, fontFamily: 'var(--font-heading)', color: 'var(--text-faint)', flexShrink: 0, marginTop: '0.1rem' }}>{si + 1}</div>
                <div style={{ flex: 1 }}>
                  <p style={{ fontWeight: 700, fontSize: '0.9rem', color: 'var(--text)', fontFamily: 'var(--font-heading)', marginBottom: '0.4rem' }}>{step.heading}</p>
                  <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', lineHeight: 1.8 }}>{step.body}</div>
                </div>
              </div>
            ))}
          </div>

          {/* Other tutorials quick-nav */}
          <div style={{ marginTop: '3rem', paddingTop: '2rem', borderTop: '1px solid var(--border)' }}>
            <p style={{ fontSize: '0.8rem', color: 'var(--text-faint)', fontFamily: 'var(--font-heading)', marginBottom: '0.875rem', letterSpacing: '0.06em', textTransform: 'uppercase' }}>More tutorials</p>
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
              {TUTORIALS.filter((_, i) => i !== active).map((tut) => {
                const origIdx = TUTORIALS.indexOf(tut);
                return (
                  <button
                    key={tut.slug}
                    onClick={() => { setActive(origIdx); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
                    style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0.4rem 0.8rem', borderRadius: 999, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text-muted)', fontSize: '0.76rem', fontFamily: 'var(--font-heading)', cursor: 'pointer' }}
                  >
                    <tut.icon size={12} />
                    {tut.title}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </section>

      {/* ── CTA ── */}
      <section style={{ padding: '4rem 0', borderTop: '1px solid var(--border)', background: 'var(--surface)' }}>
        <div className="container" style={{ textAlign: 'center', maxWidth: 520, margin: '0 auto' }}>
          <h2 style={{ fontSize: '1.5rem', fontWeight: 700, letterSpacing: '-0.03em', color: 'var(--text)', fontFamily: 'var(--font-heading)', marginBottom: '0.75rem' }}>Still stuck?</h2>
          <p style={{ fontSize: '0.88rem', color: 'var(--text-muted)', lineHeight: 1.7, marginBottom: '1.5rem' }}>
            Open a <a href={GITHUB + '/discussions'} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent)' }}>GitHub Discussion</a> or file an <a href={GITHUB + '/issues'} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent)' }}>issue</a>. The community and maintainers actively respond.
          </p>
          <div style={{ display: 'flex', gap: '0.625rem', justifyContent: 'center', flexWrap: 'wrap' }}>
            <a href={GITHUB + '/discussions'} target="_blank" rel="noopener noreferrer" className="btn btn-ghost" style={{ fontSize: '0.82rem', padding: '0.65rem 1.25rem' }}>
              GitHub Discussions <ArrowRightIcon size={13} />
            </a>
            <a href="/self-host" className="btn btn-ghost" style={{ fontSize: '0.82rem', padding: '0.65rem 1.25rem' }}>
              Self-host guide <ArrowRightIcon size={13} />
            </a>
          </div>
        </div>
      </section>
    </>
  );
}
