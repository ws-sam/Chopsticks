import type { Metadata } from 'next';
import React from 'react';
import {
  MusicIcon, RadioIcon, ShieldIcon, ZapIcon, SparkleIcon, CoinIcon,
  ServerIcon, ArrowRightIcon, GitHubIcon, DiscordIcon, WrenchIcon,
  GamepadIcon, CheckIcon, BookOpenIcon,
} from '../icons';

import { Config, getBotInvite } from '../config';

export const metadata: Metadata = {
  title: 'Features — Chopsticks',
  description: 'Everything Chopsticks can do: personal playlist channels, AI audiobook narration, near-human agents, gamification platform, raid protection, fully programmable automation, and open-source AI integration.',
  alternates: { canonical: `${Config.baseUrl}/features` },
};

const BOT_INVITE = getBotInvite();
const GITHUB = Config.githubRepo;

function Check({ color = '#57f287' }: { color?: string }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      width: 16, height: 16, borderRadius: '50%', background: `${color}18`,
      border: `1px solid ${color}40`, color, flexShrink: 0, marginTop: 2 }}>
      <CheckIcon size={9} />
    </span>
  );
}

function CmdPreview({ cmd, output, color }: { cmd: string; output: string; color: string }) {
  return (
    <div style={{ background: '#1e1f22', borderRadius: 8, overflow: 'hidden', fontSize: '0.72rem',
      fontFamily: 'var(--font-mono)', marginTop: 'auto' }}>
      <div style={{ padding: '0.4rem 0.65rem', borderBottom: '1px solid rgba(255,255,255,0.05)',
        color: '#dcddde' }}>{cmd}</div>
      <div style={{ borderLeft: `3px solid ${color}`, margin: '0.4rem 0.65rem 0.5rem',
        paddingLeft: '0.5rem', color: '#b5bac1', lineHeight: 1.5, whiteSpace: 'pre-line' }}>{output}</div>
    </div>
  );
}

function Chip({ label, color }: { label: string; color: string }) {
  return (
    <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.68rem',
      background: `${color}10`, border: `1px solid ${color}28`,
      color, padding: '0.15rem 0.45rem', borderRadius: 4 }}>{label}</span>
  );
}

// ── Bento feature cards ────────────────────────────────────────────────────

const FEATURES = [
  {
    Icon: MusicIcon,
    color: '#f472b6',
    label: 'Voice & Media',
    headline: 'Your playlist. Your VC.',
    sub: 'Personal drag-and-drop playlist channels. Agents play them live. Audiobook mode reads anything aloud.',
    points: [
      'Drop audio files into a playlist thread — any member can build a queue',
      'Deploy an agent to play your playlist live in any voice channel',
      'Audiobook mode: PDFs, books, research papers read aloud by an agent',
      'YouTube, Spotify, SoundCloud URL support for quick queue building',
    ],
    cmd: '!play lo-fi hip hop radio',
    cmdOut: '🎵 Now Playing\nLo-Fi Hip Hop Radio  ·  ChilledCow  ·  3:45',
    chips: ['!play', '!queue', '!skip', '!playlist', '!audiobook'],
    span: 2,
  },
  {
    Icon: RadioIcon,
    color: '#a78bfa',
    label: 'Agent System',
    headline: 'Not a feature. A workforce.',
    sub: 'Configurable actors with names, personas, and assigned jobs. Permanent or session-based deployment.',
    points: [
      'Give each agent a persona, job, and home channel',
      'Voice roles: DJ, Narrator, Lobby Host, Game Master',
      'Text roles: Support, Onboarding Guide, Trivia Opponent',
      'Cross-server pool competitions and leaderboards',
    ],
    cmd: '/agents status',
    cmdOut: '🤖 Agent Status\nPool: default  ·  In server: 3\n🟢 Idle 2  ·  ⚡ Busy 1',
    chips: ['/agents join', '/agents style', '/agents list', '/setup'],
    span: 1,
  },
  {
    Icon: CoinIcon,
    color: '#4ade80',
    label: 'Economy & Gamification',
    headline: 'Members earn. Members stay.',
    sub: 'Full economy with XP, levels, shop, crafting, quests, and leaderboards.',
    points: [
      'Wallet, bank, daily/work earn, shop, peer-to-peer transfers',
      'XP system with level-up roles and configurable gain rates',
      'Gather runs, crafting, rarity-based item collections',
      'Giveaways, heists, auctions — built-in engagement events',
    ],
    cmd: '!balance',
    cmdOut: '💰 Balance — Mikel\nWallet: 1,250  ·  Bank: 8,900',
    chips: ['!daily', '!work', '!shop', '!gather', '!leaderboard'],
    span: 1,
  },
  {
    Icon: ShieldIcon,
    color: '#fb923c',
    label: 'Moderation & Protection',
    headline: 'Raids, nukes, spam — handled.',
    sub: 'Raid detection, nuke protection, auto-mod, and a full case-tracked moderation suite.',
    points: [
      'Raid detection: monitors join velocity, auto-executes lockdown',
      'Nuke protection: mass deletions/bans trigger alerts instantly',
      'Spam, bad-word, mention, and link filters — channel-scopeable',
      'Full case records, warning history, clearable audit trails',
    ],
    cmd: '!warn @spammer Repeated spam',
    cmdOut: 'Warned 382910471.\nTotal warnings: 3  ·  Case #049 created',
    chips: ['!ban', '!warn', '!purge', '!timeout', '/automod', '/cases'],
    span: 1,
  },
  {
    Icon: WrenchIcon,
    color: '#facc15',
    label: 'Automation & Tooling',
    headline: 'Configure once. Runs forever.',
    sub: 'Event-triggered automations, custom commands, ticket system, reaction roles, and scheduled messages.',
    points: [
      'Any event → custom action chain (join, leave, boost, level-up)',
      'Custom slash commands with static or dynamic responses — no code',
      'Ticket system: private channels with panel, close, and archive',
      'Scheduled messages, reminders, and timed events',
    ],
    cmd: '/tickets create',
    cmdOut: '🎫 Ticket #031 opened\n#ticket-mikel created  ·  Staff notified',
    chips: ['!poll', '!remind', '!autorole', '/tickets', '/automations'],
    span: 1,
  },
  {
    Icon: SparkleIcon,
    color: '#22d3ee',
    label: 'AI & Intelligence',
    headline: 'Open source models. Real capability.',
    sub: 'Voice agents with configurable speech, text agents that read chat history, document summarisation.',
    points: [
      'Open source AI — real models in the stack, not a thin API wrapper',
      'Voice agents: configurable speech style, accent, and persona',
      'Text agents read channel history, not just the last message',
      'Document reading: research papers, briefings, book chapters',
    ],
    cmd: '!ask summarize the last 50 messages',
    cmdOut: '🤖 Summary\nTopics: economy rebalance, music bot vote,\nupcoming raid event on Saturday.',
    chips: ['!ask', '!summarize', '!translate', '/ai chat', '/agents style'],
    span: 1,
  },
  {
    Icon: ServerIcon,
    color: '#38bdf8',
    label: 'Server Backup',
    headline: 'Snapshot. Restore. Breathe.',
    sub: 'Backup your entire server structure and restore it with a single button click. Never lose a role setup or channel layout again.',
    points: [
      'Snapshots all roles, categories, text and voice channels with permissions',
      'Restore creates missing structure non-destructively — existing content is untouched',
      'Up to 5 named backups per server, stored in guild data',
      'Confirmation button with 60-second safety window to prevent accidents',
    ],
    cmd: '/backup create label:before-reorg',
    cmdOut: '📦 Backup Created\nRoles: 12  ·  Channels: 24\nBackup 1/5 stored',
    chips: ['/backup create', '/backup restore', '/backup list', '/backup delete'],
    span: 1,
  },
];

// ── Agent role table ───────────────────────────────────────────────────────

type RoleCat = 'Voice' | 'Text' | 'Competitive' | 'Admin';
const CAT_COLORS: Record<RoleCat, string> = {
  Voice: '#38bdf8', Text: '#a78bfa', Competitive: '#f472b6', Admin: '#fb923c',
};
const CAT_ICONS: Record<RoleCat, React.ReactNode> = {
  Voice: '🎙️', Text: '💬', Competitive: '🏆', Admin: '🛡️',
};

const AGENT_ROLES: { role: string; cat: RoleCat; desc: string }[] = [
  { role: 'DJ',                  cat: 'Voice',       desc: 'Plays music, takes requests, announces tracks, and interacts with listeners in real time.' },
  { role: 'Narrator',            cat: 'Voice',       desc: 'Reads books, lore, research papers, or any text aloud in voice — on demand.' },
  { role: 'Lobby Host',          cat: 'Voice',       desc: 'Permanently assigned to a waiting room — plays ambient music, greets arrivals.' },
  { role: 'Game Master',         cat: 'Voice',       desc: 'Narrates RPG encounters, runs combat, riddles, and escape room sessions through voice.' },
  { role: 'Support Agent',       cat: 'Text',        desc: 'Bound to #support — handles tier-1 questions with a configured knowledge base.' },
  { role: 'Conversation Actor',  cat: 'Text',        desc: 'Joins channels with a persona and butts into conversations contextually.' },
  { role: 'Onboarding Guide',    cat: 'Text',        desc: 'Assigned to #welcome — walks new members through the server, answers FAQs.' },
  { role: 'Hype Agent',          cat: 'Text',        desc: 'Commentates wins/losses, celebrates streaks, and keeps energy up during sessions.' },
  { role: 'Trivia Opponent',     cat: 'Competitive', desc: 'Challenge a pool agent to a head-to-head trivia match. It plays to win.' },
  { role: 'Pool Competitor',     cat: 'Competitive', desc: "Register your server's agents for cross-server leaderboard competitions." },
  { role: 'Debate Opponent',     cat: 'Competitive', desc: 'Argues a configured position when challenged. Good for rhetoric practice.' },
  { role: 'Mod Sentinel',        cat: 'Admin',       desc: 'Monitors channels with AI context, escalates or acts on policy violations.' },
  { role: 'Raid Responder',      cat: 'Admin',       desc: 'Deployed during a raid — lockdown, mod alert, activity log.' },
  { role: 'Interview Bot',       cat: 'Admin',       desc: 'Quizzes new members on rules in #verification before granting access.' },
];

// ── Use cases ──────────────────────────────────────────────────────────────

const USE_CASES = [
  { icon: '🎮', label: 'Gaming Server',   color: '#a78bfa', desc: 'Music in every lobby. Economy and XP to keep members grinding. Trivia agents during downtime. Hype agents on milestone moments.' },
  { icon: '🌐', label: 'Community Hub',   color: '#38bdf8', desc: 'Raid protection that responds before you can. AI-guided onboarding. Giveaways, polls, and quests. Credits economy that rewards participation.' },
  { icon: '🎧', label: 'Support Server',  color: '#4ade80', desc: 'Bind an AI agent to #support. Configure a knowledge base. Tier-1 questions answered automatically. Ticket threads for everything else.' },
  { icon: '📚', label: 'Study Group',     color: '#facc15', desc: 'Agents that read research papers aloud. Trivia on your subject. Reminders, polls, scheduled sessions. Economy rewards consistent participation.' },
  { icon: '🐉', label: 'Roleplay Server', color: '#f472b6', desc: 'Named AI personas that stay in character. Game Master agents for encounters. Lore narration in voice. Crafting that maps to your world.' },
  { icon: '🏢', label: 'Brand / Business',color: '#fb923c', desc: 'Self-hosted and rebranded under your name. Support agents, onboarding flows, lobby music. Runs on your infrastructure, configured via /setup.' },
];

export default function FeaturesPage() {
  return (
    <>
      {/* ── Hero ──────────────────────────────────────── */}
      <section style={{ padding: '5rem 0 4rem', borderBottom: '1px solid var(--border)', position: 'relative', overflow: 'hidden' }}>
        <div className="orb orb-blue"   style={{ width: 600, height: 600, top: -250, left: -200, opacity: 0.35, position: 'absolute' }} />
        <div className="orb orb-violet" style={{ width: 400, height: 400, top: -150, right: -100, opacity: 0.28, position: 'absolute' }} />
        <div className="container" style={{ position: 'relative', zIndex: 1 }}>

          <div className="badge" style={{ marginBottom: '1.5rem' }}>
            <CheckIcon size={11} /> Open source · actively developed
          </div>

          <h1 style={{ fontSize: 'clamp(2.5rem, 6vw, 4.25rem)', fontWeight: 800, letterSpacing: '-0.055em',
            color: 'var(--text)', fontFamily: 'var(--font-heading)', lineHeight: 1.0, marginBottom: '1.5rem', maxWidth: 700 }}>
            Seven systems.<br />
            <span className="gradient-text">One bot.</span>
          </h1>

          <p style={{ fontSize: '1.05rem', color: 'var(--text-muted)', lineHeight: 1.8, maxWidth: 540, marginBottom: '2.5rem' }}>
            Voice &amp; media, AI agents, gamification, moderation, automation, intelligence, and server backup — fully integrated,
            open source. Deploy the hosted instance in 30 seconds or self-host on your own infrastructure.
          </p>

          {/* Stat pills */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.625rem', marginBottom: '2.5rem' }}>
            {[
              { n: String(Config.stats.prefixCommands), l: 'prefix commands' },
              { n: String(Config.stats.slashCommands),  l: 'slash commands' },
              { n: '11',  l: 'categories' },
              { n: String(Config.stats.systems),   l: 'core systems' },
              { n: String(Config.stats.agentRoles),  l: 'agent roles' },
              { n: '5',   l: 'backups/server' },
            ].map(s => (
              <div key={s.n} style={{ display: 'flex', alignItems: 'baseline', gap: '0.35rem',
                background: 'rgba(255,255,255,0.04)', border: '1px solid var(--border)',
                borderRadius: 8, padding: '0.4rem 0.75rem' }}>
                <span style={{ fontFamily: 'var(--font-heading)', fontWeight: 800, fontSize: '1.1rem',
                  color: 'var(--text)', letterSpacing: '-0.03em' }}>{s.n}</span>
                <span style={{ fontSize: '0.72rem', color: 'var(--text-faint)', fontFamily: 'var(--font-heading)' }}>{s.l}</span>
              </div>
            ))}
          </div>

          <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
            <a href={BOT_INVITE} target="_blank" rel="noopener noreferrer" className="btn btn-primary"
              style={{ padding: '0.75rem 1.5rem', fontSize: '0.88rem' }}>
              <DiscordIcon size={15} /> Add to Discord
            </a>
            <a href="/commands" className="btn btn-ghost"
              style={{ padding: '0.75rem 1.5rem', fontSize: '0.88rem' }}>
              Browse commands <ArrowRightIcon size={13} />
            </a>
          </div>
        </div>
      </section>

      {/* ── Bento feature grid ────────────────────────── */}
      <section style={{ padding: '4rem 0', borderBottom: '1px solid var(--border)' }}>
        <div className="container">
          <div style={{ marginBottom: '2.5rem' }}>
            <p style={{ fontSize: '0.67rem', fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase',
              color: 'var(--text-faint)', fontFamily: 'var(--font-heading)', marginBottom: '0.5rem' }}>What's inside</p>
            <h2 style={{ fontSize: 'clamp(1.5rem, 3vw, 2.25rem)', fontWeight: 700, letterSpacing: '-0.04em',
              color: 'var(--text)', fontFamily: 'var(--font-heading)' }}>
              Every capability, out of the box.
            </h2>
          </div>

          {/* Row 1 — Voice (2/3) + Agents (1/3) */}
          <div className="feat-bento-r1">
            {FEATURES.slice(0, 2).map(f => (
              <FeatureCard key={f.label} f={f} />
            ))}
          </div>

          {/* Row 2 — Economy + Moderation */}
          <div className="feat-bento-r2">
            {FEATURES.slice(2, 4).map(f => (
              <FeatureCard key={f.label} f={f} />
            ))}
          </div>

          {/* Row 3 — Automation + AI */}
          <div className="feat-bento-r3">
            {FEATURES.slice(4, 6).map(f => (
              <FeatureCard key={f.label} f={f} />
            ))}
          </div>

          {/* Row 4 — Backup */}
          <div className="feat-bento-r4" style={{ marginTop: '1rem' }}>
            <FeatureCard key="Server Backup" f={FEATURES[6]} />
          </div>
        </div>
      </section>

      {/* ── Agent Roles ───────────────────────────────── */}
      <section style={{ padding: '4rem 0', borderBottom: '1px solid var(--border)', background: 'var(--surface)' }}>
        <div className="container">
          <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between',
            flexWrap: 'wrap', gap: '1rem', marginBottom: '2.5rem' }}>
            <div>
              <div className="badge" style={{ marginBottom: '1rem', borderColor: 'rgba(167,139,250,0.3)',
                background: 'rgba(167,139,250,0.08)', color: '#a78bfa' }}>
                <RadioIcon size={11} /> The Agent System
              </div>
              <h2 style={{ fontSize: 'clamp(1.5rem, 3vw, 2.25rem)', fontWeight: 700, letterSpacing: '-0.04em',
                color: 'var(--text)', fontFamily: 'var(--font-heading)', lineHeight: 1.1 }}>
                14 agent roles.
              </h2>
              <p style={{ fontSize: '0.9rem', color: 'var(--text-muted)', marginTop: '0.5rem', maxWidth: 480, lineHeight: 1.7 }}>
                Each agent gets a persona, a job, and a channel. Permanent or session-based.
                The agent system is actively in development.
              </p>
            </div>
            <a href="https://discord.gg/QbS47HDdpf" target="_blank" rel="noopener noreferrer"
              className="btn btn-ghost" style={{ fontSize: '0.82rem', padding: '0.5rem 1rem', alignSelf: 'flex-start' }}>
              Follow development <ArrowRightIcon size={12} />
            </a>
          </div>

          <div className="feat-agent-grid">
            {(['Voice', 'Text', 'Competitive', 'Admin'] as RoleCat[]).map(cat => (
              <div key={cat} style={{ background: 'var(--bg)', border: '1px solid var(--border)',
                borderRadius: '0.875rem', overflow: 'hidden' }}>
                {/* Category header */}
                <div style={{ padding: '0.75rem 1rem', borderBottom: '1px solid var(--border)',
                  display: 'flex', alignItems: 'center', gap: '0.5rem',
                  background: `${CAT_COLORS[cat]}08` }}>
                  <span style={{ fontSize: '1rem' }}>{CAT_ICONS[cat]}</span>
                  <span style={{ fontSize: '0.72rem', fontWeight: 700, letterSpacing: '0.08em',
                    textTransform: 'uppercase', color: CAT_COLORS[cat], fontFamily: 'var(--font-heading)' }}>{cat} roles</span>
                </div>
                {/* Roles list */}
                <div style={{ padding: '0.25rem 0' }}>
                  {AGENT_ROLES.filter(r => r.cat === cat).map((r, i, arr) => (
                    <div key={r.role} className="feat-role-row"
                      style={{ borderBottom: i < arr.length - 1 ? '1px solid var(--border)' : 'none' }}>
                      <span style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--text)',
                        fontFamily: 'var(--font-heading)' }}>{r.role}</span>
                      <span style={{ fontSize: '0.77rem', color: 'var(--text-muted)', lineHeight: 1.55 }}>{r.desc}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Use cases ─────────────────────────────────── */}
      <section style={{ padding: '4rem 0', borderBottom: '1px solid var(--border)' }}>
        <div className="container">
          <div style={{ marginBottom: '2.5rem' }}>
            <p style={{ fontSize: '0.67rem', fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase',
              color: 'var(--text-faint)', fontFamily: 'var(--font-heading)', marginBottom: '0.5rem' }}>By server type</p>
            <h2 style={{ fontSize: 'clamp(1.5rem, 3vw, 2.25rem)', fontWeight: 700, letterSpacing: '-0.04em',
              color: 'var(--text)', fontFamily: 'var(--font-heading)' }}>What does your server need?</h2>
          </div>
          <div className="feat-use-grid">
            {USE_CASES.map(uc => (
              <div key={uc.label} className="glass-card" style={{ padding: '1.5rem',
                borderTop: `3px solid ${uc.color}` }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.625rem', marginBottom: '0.75rem' }}>
                  <span style={{ fontSize: '1.4rem', lineHeight: 1 }}>{uc.icon}</span>
                  <span style={{ fontSize: '0.88rem', fontWeight: 700, color: 'var(--text)',
                    fontFamily: 'var(--font-heading)' }}>{uc.label}</span>
                </div>
                <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', lineHeight: 1.7 }}>{uc.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── CTA ───────────────────────────────────────── */}
      <section style={{ padding: '5.5rem 0', background: 'var(--surface)', position: 'relative', overflow: 'hidden' }}>
        <div className="orb orb-blue" style={{ width: 500, height: 500, bottom: -200, right: -100, opacity: 0.2, position: 'absolute' }} />
        <div className="container" style={{ textAlign: 'center', maxWidth: 560, margin: '0 auto', position: 'relative', zIndex: 1 }}>
          <h2 style={{ fontSize: 'clamp(2rem, 4vw, 3rem)', fontWeight: 800, letterSpacing: '-0.05em',
            color: 'var(--text)', fontFamily: 'var(--font-heading)', lineHeight: 1.05, marginBottom: '1rem' }}>
            All of this.<br /><span className="gradient-text">One bot.</span>
          </h2>
          <p style={{ fontSize: '0.95rem', color: 'var(--text-muted)', lineHeight: 1.8, marginBottom: '2.25rem' }}>
            Add the hosted instance or self-host on your own infrastructure. Every feature works out of the box.
          </p>
          <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'center', flexWrap: 'wrap' }}>
            <a href={BOT_INVITE} target="_blank" rel="noopener noreferrer" className="btn btn-primary"
              style={{ padding: '0.875rem 2rem', fontSize: '0.9rem' }}>
              <DiscordIcon size={15} /> Add to Discord
            </a>
            <a href="/self-host" className="btn btn-ghost" style={{ padding: '0.875rem 1.5rem', fontSize: '0.9rem' }}>
              <ServerIcon size={14} /> Self-host
            </a>
            <a href={GITHUB} target="_blank" rel="noopener noreferrer" className="btn btn-ghost"
              style={{ padding: '0.875rem 1.5rem', fontSize: '0.9rem' }}>
              <GitHubIcon size={14} /> View source
            </a>
          </div>
        </div>
      </section>
    </>
  );
}

// ── Feature bento card ─────────────────────────────────────────────────────

function FeatureCard({ f }: { f: typeof FEATURES[0] }) {
  return (
    <div className="feat-feature-card" style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '1rem',
      padding: '1.75rem', display: 'flex', flexDirection: 'column', gap: '1rem',
      minHeight: 280,
      borderTop: `3px solid ${f.color}` }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.875rem' }}>
        <div style={{ width: 38, height: 38, borderRadius: '0.625rem', flexShrink: 0,
          background: `${f.color}15`, border: `1px solid ${f.color}30`,
          display: 'flex', alignItems: 'center', justifyContent: 'center', color: f.color }}>
          <f.Icon size={18} />
        </div>
        <div>
          <p style={{ fontSize: '0.62rem', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase',
            color: f.color, fontFamily: 'var(--font-heading)', marginBottom: '0.15rem' }}>{f.label}</p>
          <h3 style={{ fontSize: '1.1rem', fontWeight: 700, letterSpacing: '-0.03em', color: 'var(--text)',
            fontFamily: 'var(--font-heading)', lineHeight: 1.2 }}>{f.headline}</h3>
        </div>
      </div>

      {/* Sub */}
      <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', lineHeight: 1.65, marginTop: -4 }}>{f.sub}</p>

      {/* Points */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
        {f.points.map(pt => (
          <div key={pt} style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-start' }}>
            <Check color={f.color} />
            <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', lineHeight: 1.55 }}>{pt}</span>
          </div>
        ))}
      </div>

      {/* Command preview */}
      <CmdPreview cmd={f.cmd} output={f.cmdOut} color={f.color} />

      {/* Chips */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.3rem' }}>
        {f.chips.map(c => <Chip key={c} label={c} color={f.color} />)}
      </div>
    </div>
  );
}
