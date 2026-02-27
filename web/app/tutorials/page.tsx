import type { Metadata } from 'next';
import Image from 'next/image';
import { ArrowRightIcon, ShieldIcon, CoinIcon, RadioIcon, ServerIcon, PaletteIcon, BookOpenIcon } from '../icons';
import React from 'react';

export const metadata: Metadata = {
  title: 'Tutorials — Chopsticks',
  description: 'Step-by-step guides for setting up moderation, economy, the Agent Pool, server customization, and self-hosting Chopsticks.',
  alternates: { canonical: 'https://chopsticks.wokspec.org/tutorials' },
};

const GITHUB = 'https://github.com/WokSpec/Chopsticks';
const BOT_INVITE = 'https://discord.com/api/oauth2/authorize?client_id=1466382874587431036&permissions=1099514858544&scope=bot%20applications.commands';

type Difficulty = 'beginner' | 'intermediate' | 'advanced';
type Step = { heading: string; body: React.ReactNode };
type Tutorial = { slug: string; icon: React.FC<{size?: number}>; title: string; desc: string; difficulty: Difficulty; time: string; preview?: string; steps: Step[] };

const TUTORIALS: Tutorial[] = [
  {
    slug: 'getting-started',
    icon: BookOpenIcon,
    title: 'Getting Started',
    preview: '/images/preview-setup.png',
    desc: 'Add Chopsticks to your server, grant the right permissions, and run your first commands. Five minutes from zero to working.',
    difficulty: 'beginner',
    time: '5 min',
    steps: [
      { heading: '1. Invite the bot', body: <span>Visit the <a href={BOT_INVITE} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent)' }}>invite link</a> and add Chopsticks to your server. Select a server where you have Manage Server permission.</span> },
      { heading: '2. Grant permissions', body: 'The invite pre-selects required permissions. Chopsticks needs at minimum: Send Messages, Embed Links, Use Application Commands, and Connect + Speak for music.' },
      { heading: '3. Run /setup', body: 'In any channel visible to the bot, run /setup. This initialises the database for your server — economy tables, mod log channel, welcome settings, etc.' },
      { heading: '4. Test a command', body: 'Try /ping to confirm the bot is responding. Then /help to see all available commands grouped by category.' },
      { heading: 'Next steps', body: 'Head to the Moderation Setup or Economy Setup tutorials to configure those modules, or read Customising with /theme to brand the bot for your server.' },
    ],
  },
  {
    slug: 'moderation',
    icon: ShieldIcon,
    title: 'Moderation Setup',
    preview: '/images/preview-moderation.png',
    desc: 'Configure mod roles, a dedicated log channel, and test every action — ban, kick, mute, warn, and purge.',
    difficulty: 'beginner',
    time: '10 min',
    steps: [
      { heading: '1. Set a mod log channel', body: 'Create a private channel (e.g. #mod-log) and run /setup modlog #mod-log. Every moderation action will be posted there with the moderator, reason, and case ID.' },
      { heading: '2. Assign mod roles', body: 'Run /setup modrole @YourModRole. Members with this role can use all moderation commands. You can add multiple roles.' },
      { heading: '3. Understand hierarchy', body: "Chopsticks is hierarchy-safe — a moderator cannot take action against someone with a role higher than or equal to their own. This mirrors Discord's own hierarchy." },
      { heading: '4. Test /warn', body: 'Run /warn @member Reason. This logs the warning, DMs the member, and creates a case record. Check /cases @member to view a user\'s history.' },
      { heading: '5. Configure auto-mod (optional)', body: 'Use /automod to set up spam filters, bad-word detection, or mention limits. Each rule can be scoped to specific channels or roles.' },
    ],
  },
  {
    slug: 'economy',
    icon: CoinIcon,
    title: 'Economy Setup',
    preview: '/images/preview-economy.png',
    desc: 'Set up the credits system, configure daily rewards, build a shop, and keep your community engaged with leaderboards.',
    difficulty: 'beginner',
    time: '15 min',
    steps: [
      { heading: '1. Enable economy', body: 'Run /setup economy enable. This creates the database tables for your server. Economy is on by default in the hosted instance.' },
      { heading: '2. Configure daily rewards', body: 'Run /setup daily amount:500 streak-bonus:100. Members can claim once per 24h. Streak bonuses reward consecutive daily claims.' },
      { heading: '3. Add shop items', body: 'Run /shop add name:"VIP Role" price:2000 role:@VIP. When a member buys this, the bot automatically assigns the role.' },
      { heading: '4. Set starting balance', body: 'New members start with 0 credits by default. To give a starting balance, run /setup economy start-balance:250.' },
      { heading: '5. Check the leaderboard', body: 'Run /leaderboard to see the top earners. Public and real-time. Great for competitions and engagement.' },
    ],
  },
  {
    slug: 'agent-pool',
    icon: RadioIcon,
    title: 'Using the Agent Pool',
    preview: '/images/preview-agents.png',
    desc: 'Understand how the community Agent Pool works, configure it for your server, and deploy an agent to a voice channel.',
    difficulty: 'intermediate',
    time: '20 min',
    steps: [
      { heading: 'How the pool works', body: 'The Agent Pool is a community-maintained set of bot tokens. When your server requests an agent, an available token from the pool is dispatched to your voice channel. You never manage tokens directly — you consume pool capacity via credits.' },
      { heading: '1. Configure via /setup agent-pool', body: 'Run /setup agent-pool to open the configuration wizard. Set which actions agents are allowed to perform, the credit cost per action, and the maximum session duration.' },
      { heading: '2. Earn or add credits', body: 'Server activity earns credits automatically. Credits are shared across the server, not per-user. Admins can also manually add credits with /credits add.' },
      { heading: '3. Request an agent', body: 'Join a voice channel, then run /agent join. An available agent from the pool will join within seconds. The bot confirms which agent was dispatched and the session credit cost.' },
      { heading: '4. Agent actions', body: 'Depending on your configuration, agents can play music, run AI conversations, host trivia games, or greet newcomers in voice. Use /agent leave to end the session and stop credit drain.' },
      { heading: '5. Contribute a token (optional)', body: <span>To contribute a bot token to the community pool, see the <a href={GITHUB + '/blob/main/docs/AGENT_POOL.md'} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent)' }}>Agent Pool contribution guide</a> on GitHub.</span> },
    ],
  },
  {
    slug: 'theme',
    icon: PaletteIcon,
    title: 'Customising with /theme',
    desc: "Change embed colors, rename the bot's persona, and disable modules — all from inside Discord, no code required.",
    difficulty: 'beginner',
    time: '8 min',
    steps: [
      { heading: 'What /theme controls', body: 'The /theme command applies per-server customisations. Changes only affect your server. No forking, no code changes required.' },
      { heading: '1. Change embed color', body: 'Run /theme color #ff6b6b. All bot embeds in your server will use this accent color. Any valid hex value works.' },
      { heading: "2. Rename the bot's persona", body: 'Run /theme name "Wok Helper". This changes how the bot refers to itself in embeds within your server. The Discord username stays as Chopsticks.' },
      { heading: '3. Disable a module', body: 'Run /theme feature music:off to disable music commands in your server. Toggles: music, economy, games, ai. Re-enable with /theme feature music:on.' },
      { heading: '4. Check current theme', body: 'Run /theme view to see your active theme settings at a glance.' },
      { heading: 'For deeper customisation', body: 'If you want to change the bot\'s name globally or avatar, that requires a self-hosted instance. See the Self-hosting tutorial.' },
    ],
  },
  {
    slug: 'self-host',
    icon: ServerIcon,
    title: 'Self-hosting with Docker',
    preview: '/images/preview-setup.png',
    desc: 'Run your own Chopsticks instance. Full stack: PostgreSQL, Redis, Lavalink. From clone to online in under 15 minutes.',
    difficulty: 'advanced',
    time: '30 min',
    steps: [
      { heading: 'Prerequisites', body: 'Docker Engine v24+ with Compose v2, a Discord application + bot token from the Developer Portal, and at least 1 GB of free RAM (2 GB recommended for the full stack).' },
      { heading: '1. Clone and configure', body: <span><pre style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8rem', lineHeight: 1.6, color: 'var(--text-muted)', background: 'var(--surface-raised)', border: '1px solid var(--border)', borderRadius: '0.5rem', padding: '0.875rem 1rem', margin: '0.5rem 0', overflow: 'auto' }}>{`git clone https://github.com/WokSpec/Chopsticks.git\ncd Chopsticks\ncp .env.example .env`}</pre>Open <code style={{ fontFamily: 'var(--font-mono)', color: 'var(--accent)', fontSize: '0.82rem' }}>.env</code> and fill in your <code style={{ fontFamily: 'var(--font-mono)', color: 'var(--accent)', fontSize: '0.82rem' }}>DISCORD_TOKEN</code> and <code style={{ fontFamily: 'var(--font-mono)', color: 'var(--accent)', fontSize: '0.82rem' }}>CLIENT_ID</code>.</span> },
      { heading: '2. Choose a profile and start', body: <span><pre style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8rem', lineHeight: 1.6, color: 'var(--text-muted)', background: 'var(--surface-raised)', border: '1px solid var(--border)', borderRadius: '0.5rem', padding: '0.875rem 1rem', margin: '0.5rem 0', overflow: 'auto' }}>{`# Minimal (bot + PostgreSQL + Redis)\ndocker compose --profile free up -d\n\n# Full stack (adds Lavalink + monitoring)\ndocker compose --profile production up -d`}</pre></span> },
      { heading: "3. Verify it's running", body: <span><pre style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8rem', lineHeight: 1.6, color: 'var(--text-muted)', background: 'var(--surface-raised)', border: '1px solid var(--border)', borderRadius: '0.5rem', padding: '0.875rem 1rem', margin: '0.5rem 0', overflow: 'auto' }}>{`docker compose ps\ndocker compose logs bot --follow`}</pre>You should see the bot come online in your Discord server.</span> },
      { heading: '4. Rebrand (optional)', body: <span>Edit <code style={{ fontFamily: 'var(--font-mono)', color: 'var(--accent)', fontSize: '0.82rem' }}>src/config/branding.js</code> to change the bot name, default colors, and enabled modules. Rebuild with <code style={{ fontFamily: 'var(--font-mono)', color: 'var(--accent)', fontSize: '0.82rem' }}>docker compose build && docker compose up -d</code>.</span> },
      { heading: '5. Stay updated', body: <span><pre style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8rem', lineHeight: 1.6, color: 'var(--text-muted)', background: 'var(--surface-raised)', border: '1px solid var(--border)', borderRadius: '0.5rem', padding: '0.875rem 1rem', margin: '0.5rem 0', overflow: 'auto' }}>{`git pull && docker compose build && docker compose up -d`}</pre>Watch <a href={GITHUB + '/releases'} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent)' }}>GitHub releases</a> for breaking changes before updating.</span> },
      { heading: 'Need help?', body: <span>Open a <a href={GITHUB + '/discussions'} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent)' }}>GitHub Discussion</a> or an <a href={GITHUB + '/issues'} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent)' }}>issue</a>. Full guide on the <a href="/self-host" style={{ color: 'var(--accent)' }}>Self-host page</a>.</span> },
    ],
  },
];

const DIFF_LABEL: Record<Difficulty, string> = { beginner: 'Beginner', intermediate: 'Intermediate', advanced: 'Advanced' };

export default function TutorialsPage() {
  return (
    <>
      <section style={{ padding: '4rem 0 3rem', borderBottom: '1px solid var(--border)' }}>
        <div className="container">
          <div style={{ maxWidth: 600 }}>
            <div className="badge" style={{ marginBottom: '1.25rem' }}>
              <BookOpenIcon size={11} />
              Tutorials
            </div>
            <h1 style={{ fontSize: 'clamp(1.75rem, 4vw, 2.75rem)', fontWeight: 700, letterSpacing: '-0.04em', color: 'var(--text)', fontFamily: 'var(--font-heading)', lineHeight: 1.1, marginBottom: '1rem' }}>
              Step-by-step guides.
            </h1>
            <p style={{ fontSize: '1rem', color: 'var(--text-muted)', lineHeight: 1.75 }}>
              From adding the bot to self-hosting your own instance — everything you need, in the right order.
            </p>
          </div>
        </div>
      </section>

      <section style={{ padding: '3rem 0 2rem' }}>
        <div className="container">
          <div className="tutorial-grid" style={{ marginBottom: '4rem' }}>
            {TUTORIALS.map(t => (
              <a key={t.slug} href={`#${t.slug}`} className="tutorial-card" style={{ textDecoration: 'none', color: 'inherit' }}>
                {t.preview && (
                  <div style={{ margin: '-1.25rem -1.25rem 1rem', borderRadius: '0.5rem 0.5rem 0 0', overflow: 'hidden', height: 120, position: 'relative' }}>
                    <Image src={t.preview} alt={t.title} fill style={{ objectFit: 'cover', objectPosition: 'top left' }} sizes="400px" />
                    {/* Logo badge */}
                    <div style={{ position: 'absolute', bottom: 8, right: 8, width: 26, height: 26, borderRadius: '50%', background: 'rgba(2,4,5,0.75)', border: '1px solid rgba(56,189,248,0.25)', backdropFilter: 'blur(6px)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <img src="/images/chopsticks.png" alt="Chopsticks" width={16} height={16} style={{ objectFit: 'contain', display: 'block' }} />
                    </div>
                  </div>
                )}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.25rem' }}>
                  <div className="tutorial-card-icon">
                    <t.icon size={18} />
                  </div>
                  <span className={`tutorial-tag tag-${t.difficulty}`}>{DIFF_LABEL[t.difficulty]}</span>
                </div>
                <p style={{ fontWeight: 700, fontSize: '0.95rem', color: 'var(--text)', fontFamily: 'var(--font-heading)' }}>{t.title}</p>
                <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', lineHeight: 1.65, flex: 1 }}>{t.desc}</p>
                <div style={{ marginTop: 'auto', paddingTop: '0.75rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: '0.72rem', color: 'var(--text-faint)', fontFamily: 'var(--font-heading)' }}>{t.time}</span>
                  <span style={{ fontSize: '0.78rem', color: 'var(--accent)', display: 'flex', alignItems: 'center', gap: '0.25rem' }}>Read <ArrowRightIcon size={12} /></span>
                </div>
              </a>
            ))}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '4rem' }}>
            {TUTORIALS.map((t, ti) => (
              <article key={t.slug} id={t.slug} style={{ scrollMarginTop: '5rem' }}>
                {t.preview && (
                  <div style={{ marginBottom: '2rem', borderRadius: '0.75rem', overflow: 'hidden', position: 'relative', height: 220, border: '1px solid var(--border)' }}>
                    <Image src={t.preview} alt={`${t.title} preview`} fill style={{ objectFit: 'cover', objectPosition: 'top left' }} sizes="(max-width:900px) 100vw, 900px" />
                    {/* Logo badge */}
                    <div style={{ position: 'absolute', bottom: 12, right: 12, display: 'flex', alignItems: 'center', gap: '0.4rem', background: 'rgba(2,4,5,0.72)', border: '1px solid rgba(56,189,248,0.2)', borderRadius: 999, padding: '0.25rem 0.6rem 0.25rem 0.3rem', backdropFilter: 'blur(8px)' }}>
                      <img src="/images/chopsticks.png" alt="Chopsticks" width={16} height={16} style={{ objectFit: 'contain', display: 'block' }} />
                      <span style={{ fontSize: '0.68rem', fontWeight: 700, color: 'rgba(255,255,255,0.7)', fontFamily: 'var(--font-heading)', letterSpacing: '0.02em' }}>Chopsticks</span>
                    </div>
                  </div>
                )}
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: '1.25rem', marginBottom: '2rem', paddingBottom: '1.5rem', borderBottom: '1px solid var(--border)' }}>
                  <div className="tutorial-card-icon" style={{ marginBottom: 0, flexShrink: 0 }}>
                    <t.icon size={20} />
                  </div>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.35rem', flexWrap: 'wrap' }}>
                      <h2 style={{ fontSize: '1.35rem', fontWeight: 700, letterSpacing: '-0.03em', color: 'var(--text)', fontFamily: 'var(--font-heading)' }}>{t.title}</h2>
                      <span className={`tutorial-tag tag-${t.difficulty}`}>{DIFF_LABEL[t.difficulty]}</span>
                      <span style={{ fontSize: '0.72rem', color: 'var(--text-faint)', fontFamily: 'var(--font-heading)' }}>{t.time}</span>
                    </div>
                    <p style={{ fontSize: '0.88rem', color: 'var(--text-muted)', lineHeight: 1.7 }}>{t.desc}</p>
                  </div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                  {t.steps.map((step, si) => (
                    <div key={si} style={{ display: 'flex', gap: '1.25rem', alignItems: 'flex-start' }}>
                      <div style={{ width: 28, height: 28, borderRadius: '50%', background: 'var(--surface-raised)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.68rem', fontWeight: 700, fontFamily: 'var(--font-heading)', color: 'var(--text-faint)', flexShrink: 0, marginTop: '0.1rem' }}>{si + 1}</div>
                      <div style={{ flex: 1 }}>
                        <p style={{ fontWeight: 700, fontSize: '0.9rem', color: 'var(--text)', fontFamily: 'var(--font-heading)', marginBottom: '0.35rem' }}>{step.heading}</p>
                        <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', lineHeight: 1.75 }}>{step.body}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

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
