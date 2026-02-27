import type { Metadata } from 'next';
import React from 'react';
import {
  MusicIcon, RadioIcon, ShieldIcon, ZapIcon, SparkleIcon, CoinIcon,
  UsersIcon, ServerIcon, PaletteIcon, ArrowRightIcon, GitHubIcon,
  DiscordIcon, TerminalIcon, BookOpenIcon, WrenchIcon, GamepadIcon, CheckIcon,
} from '../icons';

export const metadata: Metadata = {
  title: 'Features — Chopsticks',
  description: 'Everything Chopsticks can do: personal playlist channels, AI audiobook narration, near-human agents, gamification platform, raid protection, fully programmable automation, and open-source AI integration.',
  alternates: { canonical: 'https://chopsticks.wokspec.org/features' },
};

const BOT_INVITE = 'https://discord.com/api/oauth2/authorize?client_id=1466382874587431036&permissions=1099514858544&scope=bot%20applications.commands';
const GITHUB = 'https://github.com/WokSpec/Chopsticks';

// ── Agent role cards ────────────────────────────────────────────────────────

type RoleCategory = 'Voice' | 'Text' | 'Competitive' | 'Admin';

const AGENT_ROLES: { role: string; cat: RoleCategory; desc: string }[] = [
  { role: 'DJ',                 cat: 'Voice',       desc: 'Plays music, takes requests from chat, announces tracks, interacts with listeners in real time.' },
  { role: 'Narrator',           cat: 'Voice',       desc: 'Reads books, bedtime stories, D&D lore, research papers, or any text aloud in voice — on demand.' },
  { role: 'Lobby Host',         cat: 'Voice',       desc: 'Permanently assigned to a waiting room — plays ambient music, greets arrivals, sets the vibe.' },
  { role: 'Soundboard',         cat: 'Voice',       desc: 'Triggered by credits or commands to play sounds in VC: airhorns, crowd effects, custom clips.' },
  { role: 'Event Announcer',    cat: 'Voice',       desc: 'Counts down to events, announces match starts, hypes moments in real time.' },
  { role: 'Game Master',        cat: 'Voice',       desc: 'Narrates RPG encounters, runs combat, riddles, and escape room sessions through voice.' },
  { role: 'Support Agent',      cat: 'Text',        desc: 'Bound to #support — handles tier-1 questions with a configured knowledge base, 24/7.' },
  { role: 'Conversation Actor', cat: 'Text',        desc: 'Joins channels with a persona and butts into conversations contextually. Members may forget it\'s a bot.' },
  { role: 'Onboarding Guide',   cat: 'Text',        desc: 'Assigned to #welcome — walks new members through the server, answers FAQs, points to channels.' },
  { role: 'Hype Agent',         cat: 'Text',        desc: 'Deployed during gaming sessions to commentate wins/losses, celebrate streaks, and keep energy up.' },
  { role: 'Trivia Opponent',    cat: 'Competitive', desc: 'Challenge a pool agent to a head-to-head trivia match in any category. It plays to win.' },
  { role: 'Pool Competitor',    cat: 'Competitive', desc: 'Register your server\'s agents for cross-server competitions. Climb inter-server leaderboards.' },
  { role: 'Debate Opponent',    cat: 'Competitive', desc: 'Configured to argue a position when challenged in a channel. Good for rhetoric practice.' },
  { role: 'Moderation Sentinel',cat: 'Admin',       desc: 'Monitors channels with AI context, escalates or acts on policy violations.' },
  { role: 'Raid Responder',     cat: 'Admin',       desc: 'Deployed automatically or manually during a raid — lockdown, mod alert, activity log.' },
  { role: 'Interview Bot',      cat: 'Admin',       desc: 'Quizzes new members on server rules in #verification before granting access.' },
];

const CAT_COLORS: Record<RoleCategory, string> = {
  Voice:       '#38bdf8',
  Text:        '#a78bfa',
  Competitive: '#f472b6',
  Admin:       '#fb923c',
};

// ── Feature pillars ─────────────────────────────────────────────────────────

const PILLARS = [
  {
    Icon: MusicIcon,
    color: '#f472b6',
    label: 'Voice & Media',
    headline: 'Your playlist. Your VC. Your agent.',
    bullets: [
      'Create a personal playlist channel — a drag-and-drop thread where you drop audio files and build your queue',
      'Deploy an agent to pull from your playlist and play it live in any voice channel, on demand',
      'Audiobook mode: drop PDFs, text files, books, or research papers into your playlist and an agent reads them aloud in a human-like voice',
      'YouTube, Spotify, and SoundCloud still supported for URL-based queue building',
      'Full queue control: skip, seek, shuffle, loop, volume, and live lyrics',
      'These features are constantly in development — we urge contribution to help mainstream them',
    ],
    cmds: ['!play', '!queue', '!skip', '!playlist', '!audiobook', '/agents join'],
  },
  {
    Icon: RadioIcon,
    color: '#a78bfa',
    label: 'The Agent System',
    headline: 'Not a feature. A workforce.',
    bullets: [
      'Deploy near-human actors from the community pool — configurable persona, tone, and behavior',
      'Agents can be permanent (bound to a channel) or session-based (deployed on demand)',
      'Roles available: DJ, Narrator, Support Bot, Conversation Actor, Trivia Opponent, Raid Responder, and more',
      'Cross-server pool competitions — register your agents to compete in trivia arenas and leaderboards against other servers',
      'Spend server credits to deploy agents: join VC and play a sound, interrupt a conversation, run a session',
      'Configurable guardrails: per-server action allowlists, session cost, and duration caps',
    ],
    cmds: ['/agents join', '/agents style', '/agents list', '/setup', '/assistant bind'],
  },
  {
    Icon: CoinIcon,
    color: '#4ade80',
    label: 'Gamification Platform',
    headline: 'Members earn. Members spend. Members stay.',
    bullets: [
      'Full economy system: wallet, bank, daily claims, work, shop, and peer-to-peer transfers',
      'XP, levels, and configurable role rewards — members level up through activity',
      'Daily quests, gathering runs, crafting recipes, and a rarity-based collection system',
      'Gamify tool usage itself — earn credits from completing automations, deploying agents, or running scripts',
      'Leaderboards for credits, XP, collection completeness, and custom server stats',
      'Giveaways, heists, and auctions — built-in community engagement events',
    ],
    cmds: ['!daily', '!work', '!quests', '!craft', '!shop', '!leaderboard'],
  },
  {
    Icon: ShieldIcon,
    color: '#fb923c',
    label: 'Server Protection',
    headline: 'Raids, nukes, spam — handled.',
    bullets: [
      'Raid detection: monitors join velocity and auto-executes configurable lockdown response',
      'Nuke protection: detects mass channel deletions, mass bans, and permission escalations — triggers alerts before damage spreads',
      'Auto-mod: spam filters, bad-word detection, mention limits, link rules — all channel-scopeable',
      'Full moderation suite: ban, kick, warn, timeout, softban, purge, slowmode, lock — all logged and case-tracked',
      'Hierarchy-safe: no moderator can act above their own rank. The bot mirrors Discord\'s native permission model',
      'Warning history, case records, and clearable files — full audit trail per member',
    ],
    cmds: ['!ban', '!warn', '!purge', '!timeout', '!lock', '!slowmode', '/automod', '/setup'],
  },
  {
    Icon: ZapIcon,
    color: '#facc15',
    label: 'Automation & Tooling',
    headline: 'Configure once. Runs forever.',
    bullets: [
      'Event-triggered automations: join, leave, level-up, boost, or any server event → custom action chain',
      'Fully programmable scripts: chain commands, use variables, trigger conditionally, call from other automations',
      'Custom commands: build your own slash commands with static or dynamic responses — no code',
      'Ticket system: member-initiated private channels with panel, roles, close, and archive',
      'Reaction roles, level-gated roles, and macro aliases — server configuration as infrastructure',
      'Scheduled messages, reminders, and timed events — set it and forget it',
    ],
    cmds: ['!poll', '!giveaway', '!remind', '!autorole', '/tickets', '/automations', '/setup'],
  },
  {
    Icon: SparkleIcon,
    color: '#22d3ee',
    label: 'AI & Intelligence',
    headline: 'Open source models. Real capability.',
    bullets: [
      'Powered by open source AI — not a thin API wrapper. Real models, running in the stack',
      'Voice agents with configurable speech style, accent, and personality respond naturally in VC',
      'Near-human persona configuration: name, avatar, tone, memory scope, response triggers',
      'AI agents can participate in text channels contextually — they read history, not just the last message',
      'Deploy AI as customer support: knowledge base, FAQ handling, escalation triggers',
      'Document reading: drop in a research paper, book chapter, or briefing — the agent reads it aloud or summarizes',
    ],
    cmds: ['!ask', '!summarize', '!translate', '!aimodel', '/ai chat', '/agents style'],
  },
];

// ── Use case highlights ──────────────────────────────────────────────────────

const USE_CASES = [
  {
    headline: 'The gaming server',
    desc: 'Music in every lobby simultaneously. Economy and XP to keep members grinding. Trivia agents to challenge during downtime. Hype agents that go off when someone hits a milestone.',
  },
  {
    headline: 'The community hub',
    desc: 'Raid protection that responds before you can. Custom onboarding with an AI guide. Giveaways, polls, and quests to drive engagement. A credits economy that rewards participation.',
  },
  {
    headline: 'The support server',
    desc: 'Bind an AI agent to #support permanently. Configure a knowledge base. Tier-1 questions answered automatically. Escalation to mods when confidence is low. Ticket threads for everything else.',
  },
  {
    headline: 'The study group',
    desc: 'Agents that read research papers and book chapters aloud in voice. Trivia on your subject matter. Reminders, polls, and scheduled study sessions. Economy to reward consistent participation.',
  },
  {
    headline: 'The roleplay server',
    desc: 'Named AI personas that stay in character. Game Master agents for encounters. Lore narration in voice. Economy and crafting that maps to your world. Every interaction logged and tracked.',
  },
  {
    headline: 'The business/brand',
    desc: 'A self-hosted Chopsticks instance, rebranded under your name. Support agents, onboarding flows, lobby music. All running on your infrastructure, configured entirely via /setup.',
  },
];

export default function FeaturesPage() {
  return (
    <>
      {/* ── Header ────────────────────────────────────── */}
      <section style={{ padding: '4rem 0 3.5rem', borderBottom: '1px solid var(--border)', position: 'relative', overflow: 'hidden' }}>
        <div className="orb orb-blue"   style={{ width: 500, height: 500, top: -200, left: -150, opacity: 0.4, position: 'absolute' }} />
        <div className="orb orb-violet" style={{ width: 350, height: 350, top: -100, right: -100, opacity: 0.3, position: 'absolute' }} />
        <div className="container" style={{ position: 'relative', zIndex: 1 }}>
          <div style={{ maxWidth: 680 }}>
            <div className="badge" style={{ marginBottom: '1.25rem' }}>
              <CheckIcon size={11} />
              Everything included
            </div>
            <h1 style={{ fontSize: 'clamp(2rem, 5vw, 3.5rem)', fontWeight: 700, letterSpacing: '-0.05em', color: 'var(--text)', fontFamily: 'var(--font-heading)', lineHeight: 1.0, marginBottom: '1.25rem' }}>
              What Chopsticks<br />actually does.
            </h1>
            <p style={{ fontSize: '1.05rem', color: 'var(--text-muted)', lineHeight: 1.75, maxWidth: 520, marginBottom: '2rem' }}>
              One bot. Six capability pillars. Personal playlist channels. AI audiobook narration. Near-human agents. A full gamification platform. Raid protection. Fully programmable automation. All open source.
            </p>
            <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
              <a href={BOT_INVITE} target="_blank" rel="noopener noreferrer" className="btn btn-primary" style={{ padding: '0.75rem 1.5rem', fontSize: '0.88rem' }}>
                <DiscordIcon size={15} />
                Add to Discord
              </a>
              <a href="/commands" className="btn btn-ghost" style={{ padding: '0.75rem 1.5rem', fontSize: '0.88rem' }}>
                Browse commands <ArrowRightIcon size={13} />
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* ── Feature pillars ───────────────────────────── */}
      <section style={{ padding: '4rem 0', borderBottom: '1px solid var(--border)' }}>
        <div className="container">
          <div style={{ marginBottom: '2.5rem' }}>
            <p style={{ fontSize: '0.68rem', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-faint)', fontFamily: 'var(--font-heading)', marginBottom: '0.625rem' }}>Six pillars</p>
            <h2 style={{ fontSize: 'clamp(1.5rem, 3.5vw, 2.25rem)', fontWeight: 700, letterSpacing: '-0.04em', color: 'var(--text)', fontFamily: 'var(--font-heading)' }}>
              From music to AI agents to raid defense.
            </h2>
          </div>
          <div className="features-grid">
            {PILLARS.map(p => (
              <div key={p.label} className="feature-pillar" style={{ '--pillar-color': p.color } as React.CSSProperties}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: '1rem' }}>
                  <div className="feature-pillar-icon" style={{ '--pillar-color': p.color } as React.CSSProperties}>
                    <p.Icon size={20} />
                  </div>
                  <div>
                    <p style={{ fontSize: '0.65rem', fontWeight: 700, letterSpacing: '0.09em', textTransform: 'uppercase', color: p.color, fontFamily: 'var(--font-heading)', marginBottom: '0.2rem' }}>{p.label}</p>
                    <h3 className="feature-pillar-title">{p.headline}</h3>
                  </div>
                </div>
                <ul className="feature-pillar-bullets">
                  {p.bullets.map(b => <li key={b}>{b}</li>)}
                </ul>
                <div className="feature-pillar-cmds">
                  {p.cmds.map(c => (
                    <span key={c} className="feature-cmd-chip" style={{ '--pillar-color': p.color } as React.CSSProperties}>{c}</span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Agent roles deep-dive ──────────────────────── */}
      <section style={{ padding: '4rem 0', borderBottom: '1px solid var(--border)', background: 'var(--surface)' }}>
        <div className="container">
          <div style={{ marginBottom: '2.5rem', maxWidth: 600 }}>
            <div className="badge" style={{ marginBottom: '1rem', borderColor: 'rgba(167,139,250,0.3)', background: 'rgba(167,139,250,0.08)', color: '#a78bfa' }}>
              <RadioIcon size={11} />
              The Agent System
            </div>
            <h2 style={{ fontSize: 'clamp(1.5rem, 3.5vw, 2.25rem)', fontWeight: 700, letterSpacing: '-0.04em', color: 'var(--text)', fontFamily: 'var(--font-heading)', lineHeight: 1.1, marginBottom: '1rem' }}>
              Not bots. Workers.
            </h2>
            <p style={{ fontSize: '0.95rem', color: 'var(--text-muted)', lineHeight: 1.75 }}>
              An agent is a configurable actor deployed from the community pool. Give it a name, a persona, and a job. Bind it to a channel permanently or deploy it session-by-session. Funded by server credits — the more your members participate, the more agents you can run.
            </p>
          </div>

          {/* Role categories */}
          {(['Voice', 'Text', 'Competitive', 'Admin'] as RoleCategory[]).map(cat => (
            <div key={cat} style={{ marginBottom: '2.5rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.625rem', marginBottom: '1rem' }}>
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: CAT_COLORS[cat], flexShrink: 0 }} />
                <p style={{ fontSize: '0.7rem', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: CAT_COLORS[cat], fontFamily: 'var(--font-heading)' }}>{cat} roles</p>
              </div>
              <div className="agent-roles-grid">
                {AGENT_ROLES.filter(r => r.cat === cat).map(r => (
                  <div key={r.role} className="agent-role-card">
                    <p className="agent-role-tag" style={{ color: CAT_COLORS[cat] }}>{r.cat}</p>
                    <p style={{ fontSize: '0.88rem', fontWeight: 700, color: 'var(--text)', fontFamily: 'var(--font-heading)', marginBottom: '0.35rem' }}>{r.role}</p>
                    <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', lineHeight: 1.6 }}>{r.desc}</p>
                  </div>
                ))}
              </div>
            </div>
          ))}

          <div style={{ background: 'rgba(167,139,250,0.05)', border: '1px solid rgba(167,139,250,0.15)', borderRadius: '0.875rem', padding: '1.5rem', maxWidth: 620, marginTop: '1rem' }}>
            <p style={{ fontSize: '0.88rem', fontWeight: 700, color: 'var(--text)', fontFamily: 'var(--font-heading)', marginBottom: '0.4rem' }}>Think of it as serverless functions for Discord.</p>
            <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', lineHeight: 1.7 }}>You don't manage infrastructure. You hire from the pool, fund with credits, and configure behavior. The community pool scales capacity. Your server scales activity.</p>
            <a href="/docs#agent-pool" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.8rem', color: '#a78bfa', marginTop: '0.75rem' }}>
              How the pool works <ArrowRightIcon size={12} />
            </a>
          </div>
        </div>
      </section>

      {/* ── Use cases ─────────────────────────────────── */}
      <section style={{ padding: '4rem 0', borderBottom: '1px solid var(--border)' }}>
        <div className="container">
          <div style={{ marginBottom: '2.5rem' }}>
            <p style={{ fontSize: '0.68rem', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-faint)', fontFamily: 'var(--font-heading)', marginBottom: '0.625rem' }}>By server type</p>
            <h2 style={{ fontSize: 'clamp(1.5rem, 3.5vw, 2.25rem)', fontWeight: 700, letterSpacing: '-0.04em', color: 'var(--text)', fontFamily: 'var(--font-heading)' }}>
              What does your server need?
            </h2>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '1rem' }}>
            {USE_CASES.map((uc, i) => {
              const colors = ['var(--accent)', '#a78bfa', '#4ade80', '#f472b6', '#facc15', '#fb923c'];
              const c = colors[i % colors.length];
              return (
                <div key={uc.headline} className="feature-pillar" style={{ '--pillar-color': c, borderLeft: `3px solid ${c}` } as React.CSSProperties}>
                  <p style={{ fontSize: '0.9rem', fontWeight: 700, color: 'var(--text)', fontFamily: 'var(--font-heading)', marginBottom: '0.5rem' }}>{uc.headline}</p>
                  <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', lineHeight: 1.7 }}>{uc.desc}</p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ── CTA ───────────────────────────────────────── */}
      <section style={{ padding: '5rem 0', background: 'var(--surface)' }}>
        <div className="container" style={{ textAlign: 'center', maxWidth: 520, margin: '0 auto' }}>
          <h2 style={{ fontSize: 'clamp(1.75rem, 4vw, 2.75rem)', fontWeight: 700, letterSpacing: '-0.045em', color: 'var(--text)', fontFamily: 'var(--font-heading)', lineHeight: 1.05, marginBottom: '1rem' }}>
            All of this. Free.
          </h2>
          <p style={{ fontSize: '0.95rem', color: 'var(--text-muted)', lineHeight: 1.75, marginBottom: '2rem' }}>
            Add the hosted instance, run it yourself, or contribute. Everything here works out of the box.
          </p>
          <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'center', flexWrap: 'wrap' }}>
            <a href={BOT_INVITE} target="_blank" rel="noopener noreferrer" className="btn btn-primary" style={{ padding: '0.875rem 2rem', fontSize: '0.9rem' }}>
              <DiscordIcon size={15} />
              Add to Discord
            </a>
            <a href="/self-host" className="btn btn-ghost" style={{ padding: '0.875rem 1.5rem', fontSize: '0.9rem' }}>
              <ServerIcon size={14} />
              Self-host
            </a>
            <a href={GITHUB} target="_blank" rel="noopener noreferrer" className="btn btn-ghost" style={{ padding: '0.875rem 1.5rem', fontSize: '0.9rem' }}>
              <GitHubIcon size={14} />
              View source
            </a>
          </div>
        </div>
      </section>
    </>
  );
}
