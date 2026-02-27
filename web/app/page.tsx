'use client';
import React, { useState, useEffect, useRef } from 'react';
import { MusicIcon, ShieldIcon, CoinIcon, SparkleIcon, GamepadIcon, ZapIcon, WrenchIcon, RadioIcon } from './icons';

const BOT_INVITE = 'https://discord.com/api/oauth2/authorize?client_id=1466382874587431036&permissions=1099514858544&scope=bot%20applications.commands';
const DISCORD_SERVER = 'https://discord.gg/QbS47HDdpf';
const GITHUB_REPO = 'https://github.com/wokspec/chopsticks';

// ─── Stat counter hook ────────────────────────────────────────────────────
function useCounter(target: number, duration = 1600): number {
  const [val, setVal] = useState(0);
  const started = useRef(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = (ref as any).el;
    const io = new IntersectionObserver(([e]) => {
      if (e.isIntersecting && !started.current) {
        started.current = true;
        const start = performance.now();
        const tick = (now: number) => {
          const p = Math.min((now - start) / duration, 1);
          setVal(Math.round(p * p * target));
          if (p < 1) requestAnimationFrame(tick);
          else setVal(target);
        };
        requestAnimationFrame(tick);
        io.disconnect();
      }
    }, { threshold: 0.4 });
    if (el) io.observe(el);
    return () => io.disconnect();
  }, [target, duration]);
  return val;
}

// ─── Animated Discord mockup ──────────────────────────────────────────────
const MESSAGES = [
  { user: 'Wokspec', avatar: '🎧', content: '!play never gonna give you up', type: 'command' },
  { user: 'Chopsticks', avatar: '🤖', content: '🎵 Now playing: **Never Gonna Give You Up** · Rick Astley\n02:47 ─────────────── 03:32', type: 'bot' },
  { user: 'Kira', avatar: '⚡', content: '!balance', type: 'command' },
  { user: 'Chopsticks', avatar: '🤖', content: '💰 Balance: **4,280 coins**\n🏦 Bank: **12,500 coins** · Rank #3', type: 'bot' },
  { user: 'Nova', avatar: '🔮', content: '!ask What is the meaning of life?', type: 'command' },
  { user: 'Chopsticks', avatar: '🤖', content: '🧠 **AI Response** · GPT-4o\n> 42. But also: connection, purpose, and good music.', type: 'bot' },
];

function DiscordMockup() {
  const [visible, setVisible] = useState<number[]>([]);
  useEffect(() => {
    MESSAGES.forEach((_, i) => {
      setTimeout(() => setVisible(v => [...v, i]), i * 900 + 400);
    });
  }, []);
  return (
    <div style={{ background: '#23272a', border: '1px solid rgba(255,255,255,0.07)', borderRadius: '1rem', overflow: 'hidden', boxShadow: '0 32px 80px rgba(0,0,0,0.5)', width: '100%', maxWidth: 460, fontFamily: 'var(--font-body)' }}>
      {/* Title bar */}
      <div style={{ background: '#1e2124', padding: '0.6rem 1rem', display: 'flex', alignItems: 'center', gap: '0.5rem', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
        <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#ff5f57', display: 'inline-block' }}/>
        <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#febc2e', display: 'inline-block' }}/>
        <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#28c840', display: 'inline-block' }}/>
        <span style={{ flex: 1, textAlign: 'center', fontSize: '0.72rem', color: 'rgba(255,255,255,0.35)', fontFamily: 'var(--font-heading)' }}>#general · Chopsticks Demo</span>
      </div>
      {/* Messages */}
      <div style={{ padding: '1rem', display: 'flex', flexDirection: 'column', gap: '0.75rem', minHeight: 280 }}>
        {MESSAGES.map((m, i) => (
          <div key={i} style={{ display: 'flex', gap: '0.625rem', alignItems: 'flex-start', opacity: visible.includes(i) ? 1 : 0, transform: visible.includes(i) ? 'translateY(0)' : 'translateY(8px)', transition: 'opacity 0.4s ease, transform 0.4s ease' }}>
            <div style={{ width: 32, height: 32, borderRadius: '50%', background: m.type === 'bot' ? 'rgba(88,101,242,0.15)' : 'rgba(255,255,255,0.08)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1rem', flexShrink: 0, border: m.type === 'bot' ? '1px solid rgba(88,101,242,0.4)' : '1px solid rgba(255,255,255,0.06)', overflow: 'hidden' }}>
              {m.type === 'bot'
                ? <img src="/images/chopsticks.png" alt="Chopsticks" width={22} height={22} style={{ objectFit: 'contain', display: 'block' }} />
                : m.avatar}
            </div>
            <div>
              <span style={{ fontSize: '0.78rem', fontWeight: 700, color: m.type === 'bot' ? '#7289da' : '#ffffff', fontFamily: 'var(--font-heading)' }}>{m.user}</span>
              {m.type === 'command' && <span style={{ fontSize: '0.65rem', background: 'rgba(88,101,242,0.2)', color: '#a5b4fc', border: '1px solid rgba(88,101,242,0.3)', borderRadius: 3, padding: '0 0.3rem', marginLeft: '0.4rem', fontFamily: 'var(--font-mono)', fontWeight: 700 }}>prefix</span>}
              <div style={{ fontSize: '0.825rem', color: m.type === 'command' ? 'rgba(255,255,255,0.55)' : 'rgba(255,255,255,0.88)', marginTop: '0.15rem', whiteSpace: 'pre-line', lineHeight: 1.55 }}>{m.content}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Category grid ────────────────────────────────────────────────────────
const FEATURES = [
  {
    cat: 'Music',
    color: '#f472b6',
    Icon: MusicIcon,
    headline: 'Voice & Music',
    body: 'Drop audio files into your own playlist channel — a drag-and-drop thread any member can build — then deploy an agent to play it in any VC. Or have an agent read you audiobooks, PDFs, and text files aloud in a human-like voice. These features are actively evolving. We urge contribution.',
    chips: ['!playlist', '!queue', '!audiobook', '!agent read', '!play', '!np'],
  },
  {
    cat: 'Moderation',
    color: '#fb923c',
    Icon: ShieldIcon,
    headline: 'Moderation',
    body: 'Comprehensive mod toolkit: warn, ban, timeout, log channels, audit trails, auto-role, lockdown, and anti-raid protection built-in.',
    chips: ['!ban', '!warn', '!timeout', '!lock', '!purge', '!case'],
  },
  {
    cat: 'Economy',
    color: '#4ade80',
    Icon: CoinIcon,
    headline: 'Economy',
    body: 'Full virtual economy with coins, banking, shop listings, transfers, leaderboard, and daily/work earn commands. Server-scoped balances.',
    chips: ['!balance', '!shop', '!pay', '!daily', '!work', '!top'],
  },
  {
    cat: 'AI',
    color: '#22d3ee',
    Icon: SparkleIcon,
    headline: 'AI Integration',
    body: 'GPT-4o powered natural language in your server. Ask questions, summarise threads, translate, or let AI moderate your rules channel.',
    chips: ['!ask', '!summarize', '!translate', '!aimodel', '/agents', '/ai'],
  },
  {
    cat: 'Fun & Games',
    color: '#a78bfa',
    Icon: GamepadIcon,
    headline: 'Fun & Games',
    body: 'Minigames, trivia, battle system, fishing, casino games, blackjack, hangman, and user profile cards. Keep your community engaged.',
    chips: ['!trivia', '!battle', '!blackjack', '!hangman', '!fish', '!8ball'],
  },
  {
    cat: 'Leveling',
    color: '#facc15',
    Icon: ZapIcon,
    headline: 'Levels & XP',
    body: 'Server-scoped XP system with level-up roles, configurable gain rates, and a rich rank card with progress bars.',
    chips: ['!rank', '!top', '!setxp', '!levelroles'],
  },
  {
    cat: 'Automation',
    color: '#f472b6',
    Icon: WrenchIcon,
    headline: 'Automation',
    body: 'Scheduled announcements, reaction roles, welcome messages, ticket system, and a full server setup dashboard — all in one place.',
    chips: ['!poll', '!giveaway', '!remind', '!autorole', '/tickets', '/setup'],
  },
];

function hexToRgb(hex: string) {
  return `${parseInt(hex.slice(1,3),16)},${parseInt(hex.slice(3,5),16)},${parseInt(hex.slice(5,7),16)}`;
}

function FeatureCard({ f }: { f: typeof FEATURES[0] }) {
  const [hover, setHover] = useState(false);
  return (
    <div
      className="glass-card"
      style={{ cursor: 'default', borderColor: hover ? `rgba(${hexToRgb(f.color)},0.3)` : undefined, boxShadow: hover ? `0 0 32px rgba(${hexToRgb(f.color)},0.08)` : undefined, transition: 'border-color 0.25s, box-shadow 0.25s', padding: '1.5rem' }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <div style={{ width: 40, height: 40, borderRadius: '0.625rem', background: `rgba(${hexToRgb(f.color)},0.1)`, border: `1px solid rgba(${hexToRgb(f.color)},0.2)`, display: 'flex', alignItems: 'center', justifyContent: 'center', color: f.color, marginBottom: '1rem' }}>
        <f.Icon size={18} />
      </div>
      <h3 style={{ fontFamily: 'var(--font-heading)', fontWeight: 700, fontSize: '1.05rem', color: 'var(--text)', marginBottom: '0.5rem' }}>{f.headline}</h3>
      <p style={{ fontSize: '0.83rem', color: 'var(--text-muted)', lineHeight: 1.7, marginBottom: '0.875rem' }}>{f.body}</p>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.3rem' }}>
        {f.chips.map(c => (
          <span key={c} style={{ fontFamily: 'var(--font-mono)', fontSize: '0.72rem', background: `rgba(${hexToRgb(f.color)},0.07)`, border: `1px solid rgba(${hexToRgb(f.color)},0.15)`, color: f.color, padding: '0.2rem 0.5rem', borderRadius: 4 }}>{c}</span>
        ))}
      </div>
    </div>
  );
}

// ─── Agent role cards ─────────────────────────────────────────────────────
const AGENT_ROLES = [
  { id: 'radio',   label: 'Radio Agent',   color: '#f472b6', icon: '📻', desc: 'Plays your personal playlist channel live in any VC — drag-and-drop audio, always yours.' },
  { id: 'dj',      label: 'DJ Agent',      color: '#a78bfa', icon: '🎧', desc: 'Manages per-guild music queues, EQ presets, and DJ locks.' },
  { id: 'guard',   label: 'Guard Agent',   color: '#fb923c', icon: '🛡️', desc: 'Monitors activity, enforces moderation rules in real time.' },
  { id: 'banker',  label: 'Banker Agent',  color: '#4ade80', icon: '🏦', desc: 'Processes economy transactions and bank interest cycles.' },
  { id: 'oracle',  label: 'Oracle Agent',  color: '#22d3ee', icon: '🔮', desc: 'Routes AI queries to GPT-4o with per-server persona config.' },
  { id: 'herald',  label: 'Herald Agent',  color: '#facc15', icon: '📢', desc: 'Handles scheduled announcements, welcome flows, and crons.' },
];

// ─── 3-step How It Works ──────────────────────────────────────────────────
const HOW_STEPS = [
  { n: '01', title: 'Invite the bot', body: 'Click "Add to Discord" and grant the requested permissions. Chopsticks will auto-create its config channels.' },
  { n: '02', title: 'Configure channels', body: 'Use /dashboard for a one-stop setup panel — log channels, welcome rooms, DJ roles, leveling, tickets, and economy rewards, all per-server.' },
  { n: '03', title: 'Activate features', body: 'Each feature module is opt-in. Enable only what your community needs. Everything else stays off.' },
];

// ─── Page ─────────────────────────────────────────────────────────────────
export default function HomePage() {
  return (
    <main>
      {/* ── Hero ─────────────────────────────────────── */}
      <section style={{ position: 'relative', overflow: 'hidden', minHeight: '88vh', display: 'flex', alignItems: 'center', borderBottom: '1px solid var(--border)', background: 'var(--surface)' }} className="bg-grid">
        <div className="orb orb-blue"   style={{ width: 700, height: 700, top: -250, left: -200, opacity: 0.45 }} />
        <div className="orb orb-violet" style={{ width: 500, height: 500, bottom: -200, right: -150, opacity: 0.35 }} />
        <div className="orb"            style={{ width: 300, height: 300, top: '30%', left: '55%', background: 'radial-gradient(circle, rgba(244,114,182,0.25), transparent 70%)', opacity: 0.5 }} />

        <div className="container" style={{ position: 'relative', zIndex: 1, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4rem', alignItems: 'center', padding: '5rem 1.5rem' }}>
          {/* Left */}
          <div>
            <div className="badge" style={{ marginBottom: '1.5rem', background: 'rgba(30,30,30,0.7)', border: '1px solid rgba(180,100,30,0.35)', color: '#c8c8c8', gap: '0.5rem' }}>
              <span style={{ fontWeight: 700, color: '#e8742a', letterSpacing: '0.02em' }}>WokSpec</span>
              <span style={{ color: 'rgba(180,100,30,0.5)', fontSize: '0.7rem' }}>▸</span>
              Developed by WokSpec
            </div>
            <h1 style={{ fontFamily: 'var(--font-heading)', fontWeight: 800, fontSize: 'clamp(2.75rem, 6vw, 4.5rem)', lineHeight: 1.0, letterSpacing: '-0.05em', color: 'var(--text)', marginBottom: '1.5rem' }}>
              One bot.<br />
              <span className="gradient-text">Infinite possibilities.</span>
            </h1>
            <p style={{ fontSize: '1.05rem', color: 'var(--text-muted)', lineHeight: 1.8, maxWidth: 480, marginBottom: '2rem' }}>
              Chopsticks is a fully-loaded Discord bot with 162 prefix commands across 17 categories — music, moderation, economy, AI, leveling, and automation. It's open source, actively developed, and we'd love your help making it something special.
            </p>
            <div style={{ display: 'flex', gap: '0.875rem', flexWrap: 'wrap', marginBottom: '2.5rem' }}>
              <a href={BOT_INVITE} target="_blank" rel="noopener noreferrer" className="btn btn-primary" style={{ padding: '0.8rem 2rem', fontSize: '0.9rem' }}>
                Add to Discord
              </a>
              <a href="/commands" className="btn btn-secondary" style={{ padding: '0.8rem 2rem', fontSize: '0.9rem' }}>
                View Commands
              </a>
            </div>
            {/* Stat pills */}
            <div style={{ display: 'flex', gap: '1.25rem', flexWrap: 'wrap' }}>
              {[['162', 'Prefix commands'], ['49', 'Voice sessions'], ['6', 'Agent roles'], ['17', 'Categories']].map(([n, l]) => (
                <div key={l} style={{ textAlign: 'center' }}>
                  <div style={{ fontFamily: 'var(--font-heading)', fontWeight: 800, fontSize: '1.6rem', color: 'var(--text)', letterSpacing: '-0.05em' }}>{n}</div>
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.07em', fontFamily: 'var(--font-heading)', fontWeight: 600 }}>{l}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Right: Discord mockup */}
          <div style={{ display: 'flex', justifyContent: 'center' }}>
            <DiscordMockup />
          </div>
        </div>
      </section>

      {/* ── How It Works ─────────────────────────────── */}
      <section style={{ padding: '5rem 0', borderBottom: '1px solid var(--border)' }}>
        <div className="container">
          <div style={{ textAlign: 'center', marginBottom: '3.5rem' }}>
            <div className="badge" style={{ marginBottom: '1rem' }}>Getting started</div>
            <h2 style={{ fontFamily: 'var(--font-heading)', fontWeight: 700, fontSize: 'clamp(1.75rem, 4vw, 2.5rem)', color: 'var(--text)', letterSpacing: '-0.04em', marginBottom: '0.75rem' }}>Up in three steps</h2>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.95rem', maxWidth: 450, margin: '0 auto' }}>No complicated setup. No config files. Just invite, tweak settings, and go.</p>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1.5rem', position: 'relative' }}>
            {/* connector line */}
            <div style={{ position: 'absolute', top: 28, left: '16.67%', right: '16.67%', height: 1, background: 'linear-gradient(90deg, transparent, var(--accent-border), var(--accent-border), transparent)', pointerEvents: 'none' }} />
            {HOW_STEPS.map(s => (
              <div key={s.n} className="glass-card" style={{ padding: '2rem', textAlign: 'center', position: 'relative' }}>
                <div style={{ width: 52, height: 52, borderRadius: '50%', border: '2px solid var(--accent-border)', background: 'var(--surface)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 1.25rem', position: 'relative', zIndex: 1 }}>
                  <span style={{ fontFamily: 'var(--font-heading)', fontWeight: 800, fontSize: '0.85rem', color: 'var(--accent)' }}>{s.n}</span>
                </div>
                <h3 style={{ fontFamily: 'var(--font-heading)', fontWeight: 700, fontSize: '1.05rem', color: 'var(--text)', marginBottom: '0.5rem' }}>{s.title}</h3>
                <p style={{ fontSize: '0.83rem', color: 'var(--text-muted)', lineHeight: 1.7 }}>{s.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Feature Grid ─────────────────────────────── */}
      <section style={{ padding: '5rem 0', background: 'var(--surface)', borderBottom: '1px solid var(--border)' }}>
        <div className="container">
          <div style={{ textAlign: 'center', marginBottom: '3.5rem' }}>
            <div className="badge" style={{ marginBottom: '1rem' }}>Modules</div>
            <h2 style={{ fontFamily: 'var(--font-heading)', fontWeight: 700, fontSize: 'clamp(1.75rem, 4vw, 2.5rem)', color: 'var(--text)', letterSpacing: '-0.04em', marginBottom: '0.75rem' }}>Everything your server needs</h2>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.95rem', maxWidth: 500, margin: '0 auto' }}>Seventeen fully-featured categories. Enable them independently — pay no performance cost for unused features.</p>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '1rem' }}>
            {FEATURES.map(f => <FeatureCard key={f.cat} f={f} />)}
          </div>
        </div>
      </section>

      {/* ── Open Source / Contribute spotlight ──────────── */}
      <section style={{ padding: '5rem 0', borderBottom: '1px solid var(--border)', position: 'relative', overflow: 'hidden' }}>
        <div className="orb orb-violet" style={{ width: 600, height: 600, top: '50%', right: -200, transform: 'translateY(-50%)', opacity: 0.18, pointerEvents: 'none' }} />
        <div className="container" style={{ position: 'relative', zIndex: 1 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4rem', alignItems: 'start' }}>
            <div>
              <div className="badge" style={{ marginBottom: '1.25rem' }}>Open Source</div>
              <h2 style={{ fontFamily: 'var(--font-heading)', fontWeight: 700, fontSize: 'clamp(1.75rem, 4vw, 2.5rem)', color: 'var(--text)', letterSpacing: '-0.04em', lineHeight: 1.1, marginBottom: '1.25rem' }}>
                Built in the open.<br/>
                <span className="gradient-text">Grown by the community.</span>
              </h2>
              <p style={{ fontSize: '0.9rem', color: 'var(--text-muted)', lineHeight: 1.8, marginBottom: '1.5rem' }}>
                Chopsticks is a passion project — open source and actively developed. You can fork it, self-host your own instance, or grab the code and explore. But what we&apos;d really love is for you to <strong style={{ color: 'var(--text)' }}>build with us</strong>. There&apos;s plenty of uncharted territory and we want to make this something genuinely fun and community-driven.
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                {([
                  ['🍴', 'Fork &amp; self-host', 'Clone the repo, spin up your own instance with Docker. Full stack in under 15 minutes.'],
                  ['🐛', 'Find &amp; fix bugs', 'Browse open issues on GitHub. No contribution is too small — docs, tests, fixes all count.'],
                  ['✨', 'Ship new features', 'Got an idea? We actively review PRs. Agents, economy, games — there&apos;s always room to add something cool.'],
                  ['💬', 'Join the Discord', 'Hang out, share ideas, coordinate with other contributors, and see features being built in real time.'],
                ] as [string,string,string][]).map(([icon, title, desc]) => (
                  <div key={title} style={{ display: 'flex', gap: '0.75rem', alignItems: 'flex-start' }}>
                    <span style={{ fontSize: '1.1rem', flexShrink: 0, marginTop: '0.05rem' }}>{icon}</span>
                    <div>
                      <span style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--text)', fontFamily: 'var(--font-heading)' }} dangerouslySetInnerHTML={{ __html: title }} />
                      <span style={{ fontSize: '0.82rem', color: 'var(--text-muted)', marginLeft: '0.375rem' }} dangerouslySetInnerHTML={{ __html: desc }} />
                    </div>
                  </div>
                ))}
              </div>
              <div style={{ display: 'flex', gap: '0.75rem', marginTop: '2rem', flexWrap: 'wrap' }}>
                <a href={GITHUB_REPO} target="_blank" rel="noopener noreferrer" className="btn btn-primary" style={{ padding: '0.7rem 1.75rem' }}>Contribute on GitHub</a>
                <a href={DISCORD_SERVER} target="_blank" rel="noopener noreferrer" className="btn btn-secondary" style={{ padding: '0.7rem 1.75rem' }}>Join Discord</a>
              </div>
            </div>
            {/* Contribution cards */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.875rem' }}>
              {([
                { label: 'Agent System', color: '#a78bfa', icon: '🤖', blurb: 'The agent dispatch and pool system is constantly evolving. Help shape how agents are assigned, configured, and extended.' },
                { label: 'Playlist & Audiobook', color: '#f472b6', icon: '🎵', blurb: 'Drag-and-drop thread playlists and human-like audiobook narration. Feature in active development — contributors welcome.' },
                { label: 'Economy & Games', color: '#faa61a', icon: '🪙', blurb: 'Crafting, quests, cross-server leaderboards. There are a dozen half-built ideas waiting for the right person to pick them up.' },
                { label: 'Docs & Tutorials', color: '#38bdf8', icon: '📖', blurb: 'Good documentation is a superpower. Help us write guides, examples, and self-hosting walkthroughs.' },
              ] as {label:string;color:string;icon:string;blurb:string}[]).map(c => (
                <div key={c.label} className="glass-card" style={{ padding: '1.1rem 1.25rem', display: 'flex', gap: '1rem', alignItems: 'flex-start' }}>
                  <div style={{ width: 36, height: 36, borderRadius: '0.5rem', background: `rgba(${hexToRgb(c.color)},0.12)`, border: `1px solid rgba(${hexToRgb(c.color)},0.2)`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.1rem', flexShrink: 0 }}>{c.icon}</div>
                  <div>
                    <p style={{ fontSize: '0.88rem', fontWeight: 700, color: c.color, fontFamily: 'var(--font-heading)', marginBottom: '0.25rem' }}>{c.label}</p>
                    <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', lineHeight: 1.65 }}>{c.blurb}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── Community strip ───────────────────────────── */}
      <section style={{ padding: '5rem 0', background: 'var(--surface)', borderBottom: '1px solid var(--border)' }}>
        <div className="container">
          <div style={{ textAlign: 'center', marginBottom: '3rem' }}>
            <div className="badge" style={{ marginBottom: '1rem' }}>Community</div>
            <h2 style={{ fontFamily: 'var(--font-heading)', fontWeight: 700, fontSize: 'clamp(1.75rem, 4vw, 2.5rem)', color: 'var(--text)', letterSpacing: '-0.04em', marginBottom: '0.75rem' }}>Join the community</h2>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.95rem' }}>Open-source, community-driven, and actively developed.</p>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '1.25rem' }}>
            {/* GitHub */}
            <div className="glass-card" style={{ padding: '2rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              <div style={{ fontSize: '2rem' }}>⭐</div>
              <div style={{ fontFamily: 'var(--font-heading)', fontWeight: 700, fontSize: '1.05rem', color: 'var(--text)' }}>Star on GitHub</div>
              <div style={{ fontSize: '0.83rem', color: 'var(--text-muted)', lineHeight: 1.7, flex: 1 }}>Help us grow by starring the repo. See the source code, open issues, and contribute.</div>
              <a href={GITHUB_REPO} target="_blank" rel="noopener noreferrer" style={{ fontSize: '0.82rem', fontWeight: 700, color: '#facc15', fontFamily: 'var(--font-heading)', display: 'flex', alignItems: 'center', gap: '0.25rem', textDecoration: 'none' }}>View on GitHub →</a>
            </div>

            {/* Discord — GIF card */}
            <a
              href={DISCORD_SERVER}
              target="_blank"
              rel="noopener noreferrer"
              className="glass-card"
              style={{ display: 'flex', flexDirection: 'column', gap: 0, overflow: 'hidden', textDecoration: 'none', borderColor: 'rgba(114,137,218,0.25)', transition: 'border-color 0.2s, box-shadow 0.2s' }}
              onMouseEnter={e => { (e.currentTarget as HTMLAnchorElement).style.borderColor = 'rgba(114,137,218,0.5)'; (e.currentTarget as HTMLAnchorElement).style.boxShadow = '0 0 32px rgba(114,137,218,0.12)'; }}
              onMouseLeave={e => { (e.currentTarget as HTMLAnchorElement).style.borderColor = 'rgba(114,137,218,0.25)'; (e.currentTarget as HTMLAnchorElement).style.boxShadow = ''; }}
            >
              {/* GIF hero */}
              <div style={{ position: 'relative', width: '100%', aspectRatio: '1/1', overflow: 'hidden', background: '#0d1117' }}>
                <img
                  src="/images/fried_egg_fried_rice.gif"
                  alt="Chopsticks community"
                  style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                />
                <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to bottom, transparent 50%, var(--surface) 100%)', pointerEvents: 'none' }} />
              </div>
              {/* Text below */}
              <div style={{ padding: '1.25rem 1.5rem 1.5rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="#7289da"><path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03z"/></svg>
                  <span style={{ fontFamily: 'var(--font-heading)', fontWeight: 700, fontSize: '1.05rem', color: 'var(--text)' }}>Join the Discord</span>
                </div>
                <div style={{ fontSize: '0.83rem', color: 'var(--text-muted)', lineHeight: 1.7 }}>Get support, report bugs, suggest features, and hang out with the Chopsticks community.</div>
                <span style={{ fontSize: '0.82rem', fontWeight: 700, color: '#7289da', fontFamily: 'var(--font-heading)', display: 'flex', alignItems: 'center', gap: '0.25rem', marginTop: '0.25rem' }}>Join Server →</span>
              </div>
            </a>

            {/* Self-host */}
            <div className="glass-card" style={{ padding: '2rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              <div style={{ fontSize: '2rem' }}>🛠️</div>
              <div style={{ fontFamily: 'var(--font-heading)', fontWeight: 700, fontSize: '1.05rem', color: 'var(--text)' }}>Self-host it</div>
              <div style={{ fontSize: '0.83rem', color: 'var(--text-muted)', lineHeight: 1.7, flex: 1 }}>Run your own instance. Full Docker support, Lavalink included, and a step-by-step guide.</div>
              <a href="/self-host" style={{ fontSize: '0.82rem', fontWeight: 700, color: '#4ade80', fontFamily: 'var(--font-heading)', display: 'flex', alignItems: 'center', gap: '0.25rem', textDecoration: 'none' }}>Self-host guide →</a>
            </div>
          </div>
        </div>
      </section>

      {/* ── Footer CTA ───────────────────────────────── */}
      <section style={{ padding: '6rem 0', position: 'relative', overflow: 'hidden' }} className="bg-grid">
        <div className="orb orb-blue"   style={{ width: 600, height: 600, top: '50%', left: '50%', transform: 'translate(-50%,-50%)', opacity: 0.2 }} />
        <div className="container" style={{ position: 'relative', zIndex: 1, textAlign: 'center' }}>
          <h2 style={{ fontFamily: 'var(--font-heading)', fontWeight: 800, fontSize: 'clamp(2rem, 5vw, 3.5rem)', color: 'var(--text)', letterSpacing: '-0.05em', marginBottom: '1rem', lineHeight: 1.0 }}>
            Ready to power up<br /><span className="gradient-text">your server?</span>
          </h2>
          <p style={{ color: 'var(--text-muted)', marginBottom: '2.5rem', fontSize: '1rem', maxWidth: 450, margin: '0 auto 2.5rem' }}>
            Add Chopsticks in 30 seconds. No credit card. No setup fee. Full-featured from day one.
          </p>
          <div style={{ display: 'flex', gap: '1rem', justifyContent: 'center', flexWrap: 'wrap' }}>
            <a href={BOT_INVITE} target="_blank" rel="noopener noreferrer" className="btn btn-primary" style={{ padding: '0.9rem 2.5rem', fontSize: '1rem' }}>
              Add to Discord — It's Free
            </a>
            <a href="/docs" className="btn btn-secondary" style={{ padding: '0.9rem 2.5rem', fontSize: '1rem' }}>
              Read the Docs
            </a>
          </div>
        </div>
      </section>
    </main>
  );
}
