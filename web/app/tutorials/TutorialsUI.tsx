'use client';

import React, { useState } from 'react';
import {
  ArrowRightIcon, ShieldIcon, CoinIcon, RadioIcon,
  ServerIcon, PaletteIcon, BookOpenIcon, UsersIcon,
} from '../icons';

const GITHUB     = 'https://github.com/WokSpec/Chopsticks';
const BOT_INVITE = 'https://discord.com/api/oauth2/authorize?client_id=1466382874587431036&permissions=1099514858544&scope=bot%20applications.commands';

type Difficulty = 'beginner' | 'intermediate' | 'advanced';
type Step       = { heading: string; body: React.ReactNode };
type Tutorial   = {
  slug: string;
  icon: React.FC<{ size?: number }>;
  title: string;
  desc: string;
  difficulty: Difficulty;
  time: string;
  preview?: string;
  steps: Step[];
};

const DIFF_LABEL: Record<Difficulty, string> = {
  beginner:     'Beginner',
  intermediate: 'Intermediate',
  advanced:     'Advanced',
};

const cs: React.CSSProperties = {
  fontFamily: 'var(--font-mono)',
  color: 'var(--accent)',
  fontSize: '0.82em',
  background: 'rgba(56,189,248,0.06)',
  padding: '0.1em 0.35em',
  borderRadius: 4,
  border: '1px solid rgba(56,189,248,0.12)',
};

const TUTORIALS: Tutorial[] = [
  {
    slug: 'getting-started',
    icon: BookOpenIcon,
    title: 'Getting Started',
    preview: '/images/preview-setup.svg?v=9',
    desc: 'Add Chopsticks to your server, grant the right permissions, and run your first commands. Five minutes from zero to working.',
    difficulty: 'beginner',
    time: '5 min',
    steps: [
      { heading: '1. Invite the bot', body: <span>Visit the <a href={BOT_INVITE} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent)' }}>invite link</a> and add Chopsticks to your server. You need Manage Server permission on the target server.</span> },
      { heading: '2. Grant permissions', body: 'The invite pre-selects all required permissions. Chopsticks needs at minimum: Send Messages, Embed Links, Use Application Commands, and Connect + Speak for music.' },
      { heading: '3. Run /setup', body: 'In any channel visible to the bot, run /setup. This initialises the database for your server — economy tables, mod log channel, welcome settings, and more.' },
      { heading: '4. Test a command', body: 'Try /ping to confirm the bot is responding. Then !help to see all available commands grouped by category.' },
      { heading: '5. Next steps', body: 'Head to the Moderation Setup or Economy Setup tutorials to configure those modules, or read Customising with /theme to brand the bot for your server.' },
    ],
  },
  {
    slug: 'moderation',
    icon: ShieldIcon,
    title: 'Moderation Setup',
    preview: '/images/preview-moderation.svg?v=9',
    desc: 'Configure mod roles, a dedicated log channel, and test every action — ban, kick, mute, warn, and purge.',
    difficulty: 'beginner',
    time: '10 min',
    steps: [
      { heading: '1. Set a mod log channel', body: <span>Create a private channel (e.g. <code style={cs}>#mod-log</code>) and run <code style={cs}>/setup modlog #mod-log</code>. Every moderation action will be posted there with the moderator, reason, and case ID.</span> },
      { heading: '2. Assign mod roles', body: <span>Run <code style={cs}>/setup modrole @YourModRole</code>. Members with this role can use all moderation commands. You can add multiple roles.</span> },
      { heading: '3. Understand hierarchy', body: "Chopsticks is hierarchy-safe — a moderator cannot take action against someone with a role higher than or equal to their own. This mirrors Discord's own permission hierarchy." },
      { heading: '4. Test !warn', body: <span>Run <code style={cs}>!warn @member Reason</code>. This logs the warning, DMs the member, and creates a case record. Use <code style={cs}>!cases @member</code> to view their history.</span> },
      { heading: '5. Configure auto-mod', body: <span>Use <code style={cs}>/automod</code> to set up spam filters, bad-word detection, or mention limits. Each rule can be scoped to specific channels or roles.</span> },
    ],
  },
  {
    slug: 'economy',
    icon: CoinIcon,
    title: 'Economy Setup',
    preview: '/images/preview-economy.svg?v=9',
    desc: 'Set up the credits system, configure daily rewards, build a shop, and keep your community engaged with leaderboards.',
    difficulty: 'beginner',
    time: '15 min',
    steps: [
      { heading: '1. Enable economy', body: <span>Run <code style={cs}>/setup economy enable</code>. This creates the database tables for your server. Economy is on by default in the hosted instance.</span> },
      { heading: '2. Configure daily rewards', body: <span>Run <code style={cs}>/setup daily amount:500 streak-bonus:100</code>. Members can claim once per 24h. Streak bonuses reward consecutive daily claims.</span> },
      { heading: '3. Add shop items', body: <span>Run <code style={cs}>/shop add name:"VIP Role" price:2000 role:@VIP</code>. When a member buys this, the bot automatically assigns the role.</span> },
      { heading: '4. Set starting balance', body: <span>New members start with 0 credits by default. To give a starting balance, run <code style={cs}>/setup economy start-balance:250</code>.</span> },
      { heading: '5. Check the leaderboard', body: <span>Run <code style={cs}>!leaderboard</code> to see the top earners. Public, real-time, and great for competitions and engagement.</span> },
    ],
  },
  {
    slug: 'agent-pool',
    icon: RadioIcon,
    title: 'Agent System',
    preview: '/images/preview-agents.svg?v=9',
    desc: 'Deploy and configure agents — voice actors, support bots, trivia hosts, and more. Feature in active development.',
    difficulty: 'intermediate',
    time: '20 min',
    steps: [
      { heading: 'What agents are', body: 'An agent is a configurable bot actor you deploy inside your server. You give it a name, a persona, and a job — then point it at a channel. Agents can narrate text in voice, run trivia, host support threads, and more.' },
      { heading: '1. Configure via /setup agents', body: <span>Run <code style={cs}>/setup agents</code> to open the configuration wizard. Set which behaviours agents are allowed to perform, and how they should behave in your server.</span> },
      { heading: '2. Create your first agent', body: <span>Use <code style={cs}>/agent create</code> to set a name and persona. Keep it simple — a name, a short description of its role, and the channel you want it to live in.</span> },
      { heading: '3. Deploy to a channel', body: <span>Run <code style={cs}>/agent deploy</code> in the target channel to activate the agent. For voice, join a VC first. The agent will join and begin its assigned behaviour.</span> },
      { heading: '4. Deactivate with /agent leave', body: <span>Use <code style={cs}>/agent leave</code> to deactivate. The agent stops all behaviour and leaves the channel or VC.</span> },
      { heading: '5. This feature is evolving', body: <span>The agent system is one of the most exciting parts of Chopsticks. Check the <a href={GITHUB + '/issues'} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent)' }}>open issues on GitHub</a> if you want to help shape where it goes next.</span> },
    ],
  },
  {
    slug: 'theme',
    icon: PaletteIcon,
    title: 'Customising /theme',
    preview: '/images/preview-theme.svg?v=9',
    desc: "Change embed colors, rename the bot's persona, and disable modules — all from inside Discord, no code required.",
    difficulty: 'beginner',
    time: '8 min',
    steps: [
      { heading: 'What /theme controls', body: 'The /theme command applies per-server customisations. Changes only affect your server. No forking or code changes required.' },
      { heading: '1. Change embed color', body: <span>Run <code style={cs}>/theme color #ff6b6b</code>. All bot embeds in your server will use this accent color. Any valid hex value works.</span> },
      { heading: "2. Rename the bot's persona", body: <span>Run <code style={cs}>/theme name "Wok Helper"</code>. This changes how the bot refers to itself in embeds within your server. The Discord username stays as Chopsticks.</span> },
      { heading: '3. Disable a module', body: <span>Run <code style={cs}>/theme feature music:off</code> to disable music commands in your server. Toggles: music, economy, games, ai. Re-enable with <code style={cs}>/theme feature music:on</code>.</span> },
      { heading: '4. Check current theme', body: <span>Run <code style={cs}>/theme view</code> to see your active theme settings at a glance.</span> },
      { heading: '5. Deeper customisation', body: <span>Changing the bot's name globally or avatar requires a self-hosted instance. See the <a href="/tutorials#self-host" style={{ color: 'var(--accent)' }}>Self-hosting tutorial</a>.</span> },
    ],
  },
  {
    slug: 'welcome-messages',
    icon: UsersIcon,
    title: 'Welcome Messages',
    preview: '/images/preview-welcome.svg?v=9',
    desc: 'Greet new members automatically with personalised messages, DM welcomes, goodbye notices, and live member counts.',
    difficulty: 'beginner',
    time: '10 min',
    steps: [
      { heading: 'What /welcome does', body: 'The /welcome command configures per-server welcome messages. Set the channel, message text, DM welcome, goodbye message, and member count display.' },
      { heading: '1. Set the welcome channel', body: <span>Run <code style={cs}>/welcome set #welcome</code>. Chopsticks will post welcome messages here whenever a new member joins.</span> },
      { heading: '2. Customise the message', body: <span>Run <code style={cs}>/welcome message</code> with your text. Placeholders: <code style={cs}>{'{user}'}</code> (mention), <code style={cs}>{'{server}'}</code> (server name), <code style={cs}>{'{membercount}'}</code> (current count).</span> },
      { heading: '3. Enable a DM welcome', body: <span>Run <code style={cs}>/welcome dm-set</code> then <code style={cs}>/welcome dm-enable</code>. Handy for sending rules or getting-started info privately to new members.</span> },
      { heading: '4. Add a goodbye message', body: <span>Run <code style={cs}>/welcome goodbye-set</code> then <code style={cs}>/welcome goodbye-enable</code>. Posts in the welcome channel when a member leaves.</span> },
      { heading: '5. Show member count', body: <span>Run <code style={cs}>/welcome membercount</code> to show a live member count in the welcome embed.</span> },
      { heading: '6. Preview and test', body: <span>Run <code style={cs}>/welcome preview</code> to trigger a test welcome message without leaving and rejoining.</span> },
    ],
  },
];

export default function TutorialsUI() {
  const [active, setActive]     = useState(0);
  const [openStep, setOpenStep] = useState<number>(0);
  const [fade, setFade]         = useState(true);

  const t = TUTORIALS[active];

  function selectTutorial(i: number) {
    if (i === active) return;
    setFade(false);
    setTimeout(() => {
      setActive(i);
      setOpenStep(0);
      setFade(true);
    }, 150);
  }

  function toggleStep(i: number) {
    setOpenStep(prev => prev === i ? -1 : i);
  }

  return (
    <>
      {/* ─── Mobile tabs ─────────────────────────────── */}
      <div className="tut-mobile-tabs">
        <div className="tut-mobile-tabs-inner">
          {TUTORIALS.map((tut, i) => (
            <button
              key={tut.slug}
              onClick={() => selectTutorial(i)}
              className={'tut-mobile-tab' + (i === active ? ' active' : '')}
            >
              <tut.icon size={12} />
              {tut.title}
            </button>
          ))}
          <a href="/self-host" className="tut-mobile-tab">
            <ServerIcon size={12} />
            Self-hosting
          </a>
        </div>
      </div>

      {/* ─── Main 2-col layout ───────────────────────── */}
      <div className="tut-layout">

        {/* LEFT sidebar */}
        <aside className="tut-sidebar">
          <p className="tut-sidebar-label">Tutorials</p>
          {TUTORIALS.map((tut, i) => (
            <button
              key={tut.slug}
              onClick={() => selectTutorial(i)}
              className={'tut-navcard' + (i === active ? ' active' : '')}
            >
              <div className={'tut-navcard-icon-wrap' + (i === active ? ' active' : '')}>
                <tut.icon size={15} />
              </div>
              <div className="tut-navcard-text">
                <span className="tut-navcard-title">{tut.title}</span>
                <div className="tut-navcard-chips">
                  <span className={'tutorial-tag tag-' + tut.difficulty}>{DIFF_LABEL[tut.difficulty]}</span>
                  <span className="tut-navcard-time">{tut.time}</span>
                </div>
              </div>
              {i === active && <div className="tut-navcard-bar" />}
            </button>
          ))}

          {/* Self-host link card — routes to dedicated page */}
          <a href="/self-host" className="tut-navcard tut-navcard-link">
            <div className="tut-navcard-icon-wrap">
              <ServerIcon size={15} />
            </div>
            <div className="tut-navcard-text">
              <span className="tut-navcard-title">Self-hosting</span>
              <div className="tut-navcard-chips">
                <span className="tutorial-tag tag-advanced">Advanced</span>
                <span className="tut-navcard-time">Full guide →</span>
              </div>
            </div>
          </a>

          {/* Sidebar CTAs */}
          <a href={BOT_INVITE} target="_blank" rel="noopener noreferrer" className="tut-sidebar-cta">
            Add to Discord <ArrowRightIcon size={12} />
          </a>
          <a href={GITHUB} target="_blank" rel="noopener noreferrer" className="tut-sidebar-cta tut-sidebar-star">
            ⭐ Star on GitHub
          </a>
        </aside>

        {/* RIGHT main content */}
        <main className="tut-main">

          {/* Discord window mockup */}
          {t.preview && (
            <div className="tut-window">
              <div className="tut-window-chrome">
                <div className="tut-chrome-dots">
                  <span className="chrome-dot dot-red" />
                  <span className="chrome-dot dot-yellow" />
                  <span className="chrome-dot dot-green" />
                </div>
                <div className="tut-chrome-url">
                  discord.com / <span style={{ color: '#f2f3f5' }}>Egg Fried Rice</span> / {t.title}
                </div>
                <div style={{ width: 60 }} />
              </div>
              <div className={'tut-preview-wrap' + (fade ? ' visible' : '')}>
                <img
                  src={t.preview}
                  alt={t.title + ' demo'}
                  className="tut-preview-img"
                />
              </div>
            </div>
          )}

          {/* Meta strip */}
          <div className="tut-meta-strip">
            <div className="tut-meta-left">
              <div className={'tut-meta-icon tut-meta-icon--' + t.difficulty}>
                <t.icon size={16} />
              </div>
              <div>
                <div className="tut-meta-row">
                  <span className="tut-meta-name">{t.title}</span>
                  <span className={'tutorial-tag tag-' + t.difficulty}>{DIFF_LABEL[t.difficulty]}</span>
                  <span className="tut-meta-time">{t.time}</span>
                </div>
                <p className="tut-meta-desc">{t.desc}</p>
              </div>
            </div>
            <div className="tut-prev-next">
              <button
                onClick={() => selectTutorial(Math.max(0, active - 1))}
                disabled={active === 0}
                className="tut-pn-btn"
              >← Prev</button>
              <span className="tut-pn-count">{active + 1} / {TUTORIALS.length}</span>
              <button
                onClick={() => selectTutorial(Math.min(TUTORIALS.length - 1, active + 1))}
                disabled={active === TUTORIALS.length - 1}
                className="tut-pn-btn"
              >Next →</button>
            </div>
          </div>

          {/* Steps */}
          <div className="tut-steps-wrap">
            <div className="tut-steps-header">
              <span className="tut-steps-label">Steps</span>
              <div className="tut-steps-progress">
                {t.steps.map((_, i) => (
                  <button
                    key={i}
                    className={'tut-pip' + (i === openStep ? ' active' : i < (openStep === -1 ? 0 : openStep) ? ' done' : '')}
                    onClick={() => toggleStep(i)}
                    title={t.steps[i].heading}
                  />
                ))}
              </div>
            </div>

            <div className="tut-steps-list">
              {t.steps.map((step, si) => {
                const isOpen = openStep === si;
                const isDone = openStep > si;
                return (
                  <div key={si} className={'tut-step' + (isOpen ? ' open' : isDone ? ' done' : '')}>
                    {/* Track */}
                    <div className="tut-step-track">
                      <div className={'tut-step-num' + (isOpen ? ' active' : isDone ? ' done' : '')}>
                        {isDone ? '✓' : si + 1}
                      </div>
                      {si < t.steps.length - 1 && (
                        <div className={'tut-step-line' + (isDone ? ' done' : '')} />
                      )}
                    </div>
                    {/* Content */}
                    <div className="tut-step-content">
                      <button
                        className="tut-step-hdr"
                        onClick={() => toggleStep(si)}
                        aria-expanded={isOpen}
                      >
                        <span className="tut-step-heading">{step.heading}</span>
                        <span className={'tut-step-chevron' + (isOpen ? ' open' : '')}>›</span>
                      </button>
                      <div className={'tut-step-body' + (isOpen ? ' open' : '')}>
                        <div className="tut-step-body-inner">
                          {step.body}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Bottom CTA */}
          <div className="tut-cta-bar">
            <div>
              <p className="tut-cta-heading">Still stuck?</p>
              <p className="tut-cta-sub">The community and maintainers actively respond on GitHub.</p>
            </div>
            <div className="tut-cta-btns">
              <a href={GITHUB + '/discussions'} target="_blank" rel="noopener noreferrer" className="btn btn-ghost" style={{ fontSize: '0.8rem', padding: '0.5rem 1rem' }}>
                Discussions <ArrowRightIcon size={12} />
              </a>
              <a href={GITHUB + '/issues'} target="_blank" rel="noopener noreferrer" className="btn btn-ghost" style={{ fontSize: '0.8rem', padding: '0.5rem 1rem' }}>
                Report issue <ArrowRightIcon size={12} />
              </a>
            </div>
          </div>

        </main>
      </div>
    </>
  );
}
