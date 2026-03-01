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
      if (e?.isIntersecting && !started.current) {
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
const CHANNELS = ['general', 'music', 'commands', 'bot-log'];
type Msg = {
  user: string; avatar: string; color: string; type: 'user' | 'bot';
  content?: string; embed?: { color: string; title: string; fields: { k: string; v: string }[] };
};
const CHANNEL_MSGS: Record<number, Msg[]> = {
  // general
  0: [
    { user: 'Euxine',     avatar: '/images/avatar-hellokitty.png',  color: '#f472b6', type: 'user', content: 'anyone know the bot prefix?' },
    { user: 'Chopsticks', avatar: '/images/chopsticks.png',         color: '#5865f2', type: 'bot',  embed: { color: '#5865f2', title: '📖 Quick Start', fields: [{ k: 'Prefix', v: '! or /' }, { k: 'Commands', v: '148 prefix · 101 slash across 11 categories' }, { k: 'Invite', v: 'discord.com/invite' }] } },
    { user: 'Mikel',      avatar: '/images/avatar-mousememe.jpg',   color: '#22d3ee', type: 'user', content: 'just ran /gather for the first time 🔥' },
    { user: 'Chopsticks', avatar: '/images/chopsticks.png',         color: '#5865f2', type: 'bot',  embed: { color: '#a78bfa', title: '⚡ Gather Complete', fields: [{ k: 'Items Found', v: '3' }, { k: 'Drops', v: '💎 Quantum Crystal [EPIC] · ⚪ Iron Ore ×2 [COMMON]' }, { k: 'XP', v: '+67 XP' }] } },
  ],
  // music
  1: [
    { user: 'Nakari',     avatar: '/images/avatar-patrickstar.jpg', color: '#a78bfa', type: 'user', content: '!play lo-fi chill beats' },
    { user: 'Chopsticks', avatar: '/images/chopsticks.png',         color: '#5865f2', type: 'bot',  embed: { color: '#5865f2', title: '🎵 Now Playing', fields: [{ k: 'Track', v: 'Lo-Fi Chill Beats Mix · 1:02:34' }, { k: 'Added by', v: 'Nakari' }, { k: 'Queue', v: '3 tracks waiting' }] } },
    { user: 'Euxine',     avatar: '/images/avatar-hellokitty.png',  color: '#f472b6', type: 'user', content: '!skip' },
    { user: 'Chopsticks', avatar: '/images/chopsticks.png',         color: '#5865f2', type: 'bot',  embed: { color: '#22d3ee', title: '⏭ Skipped', fields: [{ k: 'Now Playing', v: 'Synthwave Drive · 47:22' }, { k: 'Requested by', v: 'Euxine' }, { k: 'Up Next', v: 'Study Beats Playlist' }] } },
  ],
  // commands
  2: [
    { user: 'Mikel',      avatar: '/images/avatar-mousememe.jpg',   color: '#22d3ee', type: 'user', content: '/work' },
    { user: 'Chopsticks', avatar: '/images/chopsticks.png',         color: '#5865f2', type: 'bot',  embed: { color: '#f0b232', title: '💼 Work Complete', fields: [{ k: 'Job', v: 'Chef 👨‍🍳' }, { k: 'Earned', v: '248 credits' }, { k: 'Balance', v: '4,528 credits · Bank: 12,500' }] } },
    { user: 'Nakari',     avatar: '/images/avatar-patrickstar.jpg', color: '#a78bfa', type: 'user', content: '/daily' },
    { user: 'Chopsticks', avatar: '/images/chopsticks.png',         color: '#5865f2', type: 'bot',  embed: { color: '#23a55a', title: '🎁 Daily Reward', fields: [{ k: 'Reward', v: '+500 credits' }, { k: 'Streak', v: '7 days 🔥' }, { k: 'Bonus', v: '×1.5 streak multiplier applied' }] } },
  ],
  // bot-log
  3: [
    { user: 'Chopsticks', avatar: '/images/chopsticks.png',         color: '#5865f2', type: 'bot',  content: '📥 New member joined', embed: { color: '#f0b232', title: 'Member Joined', fields: [{ k: 'User', v: 'spammer123#4421' }, { k: 'Account Age', v: '3 days ⚠️ New' }, { k: 'Action', v: 'Flagged for review' }] } },
    { user: 'Chopsticks', avatar: '/images/chopsticks.png',         color: '#5865f2', type: 'bot',  embed: { color: '#ed4245', title: '🔨 Member Banned', fields: [{ k: 'User', v: 'spammer123#4421' }, { k: 'Moderator', v: 'Admin' }, { k: 'Reason', v: 'Spam + raid invite links · Case #048' }] } },
  ],
};

function Avatar({ src, size = 36, bot = false }: { src: string; size?: number; bot?: boolean }) {
  return (
    <div style={{ position: 'relative', flexShrink: 0, width: size, height: size }}>
      <img src={src} alt="" width={size} height={size}
        style={{ width: size, height: size, borderRadius: '50%', objectFit: 'cover', display: 'block',
          border: bot ? '1px solid rgba(88,101,242,0.5)' : '1px solid rgba(255,255,255,0.08)' }} />
      {bot && (
        <div style={{ position: 'absolute', bottom: -2, right: -2, background: '#5865f2', borderRadius: 4,
          fontSize: '0.48rem', fontWeight: 800, color: '#fff', padding: '1px 3px', lineHeight: 1.2, letterSpacing: '0.03em',
          border: '1.5px solid #1e1f22', fontFamily: 'var(--font-heading)' }}>APP</div>
      )}
    </div>
  );
}

function EmbedCard({ embed }: { embed: { color: string; title: string; fields: { k: string; v: string }[] } }) {
  return (
    <div style={{ borderLeft: `3px solid ${embed.color}`, background: 'rgba(255,255,255,0.04)',
      borderRadius: '0 6px 6px 0', padding: '0.55rem 0.75rem', marginTop: '0.3rem', maxWidth: 300 }}>
      <div style={{ fontSize: '0.78rem', fontWeight: 700, color: '#fff', marginBottom: '0.35rem',
        fontFamily: 'var(--font-heading)' }}>{embed.title}</div>
      {embed.fields.map(f => (
        <div key={f.k} style={{ marginBottom: '0.2rem' }}>
          <div style={{ fontSize: '0.67rem', fontWeight: 700, color: 'rgba(255,255,255,0.5)', textTransform: 'uppercase', letterSpacing: '0.04em', fontFamily: 'var(--font-heading)' }}>{f.k}</div>
          <div style={{ fontSize: '0.77rem', color: 'rgba(255,255,255,0.87)', lineHeight: 1.45 }}>{f.v}</div>
        </div>
      ))}
    </div>
  );
}

function DiscordMockup() {
  const [visible, setVisible] = useState<number[]>([]);
  const [activeChannel, setActiveChannel] = useState(0);
  const messagesRef = useRef<HTMLDivElement>(null);
  const msgs = CHANNEL_MSGS[activeChannel] ?? [];

  useEffect(() => {
    setVisible([]);
    const timers: ReturnType<typeof setTimeout>[] = [];
    msgs.forEach((_, i) => {
      timers.push(setTimeout(() => setVisible(v => [...v, i]), i * 1100 + 300));
    });
    return () => timers.forEach(clearTimeout);
  }, [activeChannel]);

  useEffect(() => {
    if (messagesRef.current) messagesRef.current.scrollTop = messagesRef.current.scrollHeight;
  }, [visible]);

  return (
    <div style={{ background: '#313338', borderRadius: '0.875rem', overflow: 'hidden',
      boxShadow: '0 40px 100px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.06)',
      width: '100%', maxWidth: 600, fontFamily: "'gg sans', 'Noto Sans', sans-serif",
      display: 'flex', flexDirection: 'column' }}>

      {/* macOS chrome bar */}
      <div style={{ background: '#1e1f22', padding: '0.55rem 0.875rem', display: 'flex',
        alignItems: 'center', gap: '0.5rem', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
        <span style={{ width: 11, height: 11, borderRadius: '50%', background: '#ff5f57', display: 'inline-block' }}/>
        <span style={{ width: 11, height: 11, borderRadius: '50%', background: '#febc2e', display: 'inline-block' }}/>
        <span style={{ width: 11, height: 11, borderRadius: '50%', background: '#28c840', display: 'inline-block' }}/>
        <span style={{ flex: 1, textAlign: 'center', fontSize: '0.7rem', color: 'rgba(255,255,255,0.28)',
          fontFamily: 'var(--font-heading)', letterSpacing: '0.02em' }}>discord.com / Egg Fried Rice</span>
        <span style={{ width: 40 }} />
      </div>

      {/* App body */}
      <div className="discord-mock-body" style={{ display: 'flex', height: 460 }}>

        {/* Server rail */}
        <div className="discord-mock-rail" style={{ width: 72, background: '#1e1f22', display: 'flex', flexDirection: 'column',
          alignItems: 'center', padding: '0.75rem 0', gap: '0.5rem', borderRight: '1px solid rgba(255,255,255,0.04)' }}>
          {/* Server icon */}
          <div style={{ position: 'relative' }}>
            <div style={{ width: 44, height: 44, borderRadius: '30%', overflow: 'hidden', cursor: 'pointer',
              border: '2px solid rgba(88,101,242,0.6)', boxSizing: 'border-box' }}>
              <img src="/images/fried_egg_fried_rice.gif" alt="Egg Fried Rice" width={44} height={44}
                style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
            </div>
            {/* active indicator */}
            <div style={{ position: 'absolute', left: -10, top: '50%', transform: 'translateY(-50%)',
              width: 4, height: 28, background: '#fff', borderRadius: '0 4px 4px 0' }} />
          </div>
          <div style={{ width: 32, height: 1, background: 'rgba(255,255,255,0.08)', margin: '0.25rem 0' }} />
          {/* DM icon */}
          <div style={{ width: 44, height: 44, borderRadius: '50%', background: 'rgba(255,255,255,0.06)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="rgba(255,255,255,0.35)">
              <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 14H9V8h2v8zm4 0h-2V8h2v8z"/>
            </svg>
          </div>
          {/* Add server */}
          <div style={{ width: 44, height: 44, borderRadius: '50%', background: 'rgba(67,181,129,0.1)',
            border: '2px dashed rgba(67,181,129,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', marginTop: 'auto' }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="rgba(67,181,129,0.7)"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg>
          </div>
        </div>

        {/* Channel sidebar */}
        <div className="discord-mock-sidebar" style={{ width: 220, background: '#2b2d31', display: 'flex', flexDirection: 'column',
          borderRight: '1px solid rgba(255,255,255,0.04)' }}>
          {/* Server header */}
          <div style={{ padding: '0 0.875rem', height: 48, display: 'flex', alignItems: 'center',
            borderBottom: '1px solid rgba(255,255,255,0.06)', cursor: 'pointer', flexShrink: 0 }}>
            <span style={{ fontWeight: 700, fontSize: '0.875rem', color: '#f2f3f5',
              fontFamily: 'var(--font-heading)', flex: 1 }}>Egg Fried Rice</span>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="rgba(255,255,255,0.4)"><path d="M7 10l5 5 5-5z"/></svg>
          </div>
          {/* Channel list */}
          <div style={{ padding: '0.625rem 0.5rem', flex: 1, overflowY: 'hidden' }}>
            <div style={{ fontSize: '0.65rem', fontWeight: 700, color: 'rgba(255,255,255,0.35)',
              textTransform: 'uppercase', letterSpacing: '0.04em', padding: '0 0.375rem 0.35rem',
              display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
              <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><path d="M7 10l5 5 5-5z"/></svg>
              Text Channels
            </div>
            {CHANNELS.map((ch, i) => (
              <div key={ch} onClick={() => setActiveChannel(i)}
                style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0.28rem 0.5rem',
                  borderRadius: 4, cursor: 'pointer', marginBottom: 1,
                  background: activeChannel === i ? 'rgba(255,255,255,0.1)' : 'transparent',
                  color: activeChannel === i ? '#f2f3f5' : 'rgba(255,255,255,0.4)',
                  fontSize: '0.82rem', fontWeight: activeChannel === i ? 500 : 400,
                  transition: 'background 0.15s, color 0.15s' }}
                onMouseEnter={e => { if (activeChannel !== i) (e.currentTarget as HTMLDivElement).style.background = 'rgba(255,255,255,0.06)'; (e.currentTarget as HTMLDivElement).style.color = 'rgba(255,255,255,0.7)'; }}
                onMouseLeave={e => { if (activeChannel !== i) { (e.currentTarget as HTMLDivElement).style.background = 'transparent'; (e.currentTarget as HTMLDivElement).style.color = 'rgba(255,255,255,0.4)'; } }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" style={{ opacity: 0.6 }}>
                  <path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z"/>
                </svg>
                {ch}
              </div>
            ))}
            <div style={{ marginTop: '0.75rem' }}>
              <div style={{ fontSize: '0.65rem', fontWeight: 700, color: 'rgba(255,255,255,0.35)',
                textTransform: 'uppercase', letterSpacing: '0.04em', padding: '0 0.375rem 0.35rem',
                display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><path d="M7 10l5 5 5-5z"/></svg>
                Voice Channels
              </div>
              {['Lounge', 'Gaming'].map(vc => (
                <div key={vc} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0.28rem 0.5rem',
                  borderRadius: 4, color: 'rgba(255,255,255,0.35)', fontSize: '0.82rem', cursor: 'pointer' }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" style={{ opacity: 0.6 }}>
                    <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02z"/>
                  </svg>
                  {vc}
                </div>
              ))}
            </div>
          </div>
          {/* User panel */}
          <div style={{ padding: '0.5rem 0.625rem', background: '#232428', display: 'flex',
            alignItems: 'center', gap: '0.5rem', borderTop: '1px solid rgba(255,255,255,0.05)' }}>
            <div style={{ position: 'relative' }}>
              <img src="/images/avatar-pixelart.png" alt="Admin" width={28} height={28}
                style={{ width: 28, height: 28, borderRadius: '50%', objectFit: 'cover', display: 'block' }} />
              <div style={{ position: 'absolute', bottom: -1, right: -1, width: 9, height: 9,
                background: '#23a559', borderRadius: '50%', border: '2px solid #232428' }} />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: '0.75rem', fontWeight: 700, color: '#f2f3f5', lineHeight: 1.1,
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>Admin</div>
              <div style={{ fontSize: '0.63rem', color: 'rgba(255,255,255,0.35)', lineHeight: 1.1 }}>#0001</div>
            </div>
            <div style={{ display: 'flex', gap: '0.25rem' }}>
              {['M','H','⚙'].map(icon => (
                <div key={icon} style={{ width: 26, height: 26, borderRadius: 4, background: 'transparent',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color: 'rgba(255,255,255,0.4)', fontSize: '0.7rem', cursor: 'pointer' }}>{icon}</div>
              ))}
            </div>
          </div>
        </div>

        {/* Main chat */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          {/* Channel header */}
          <div style={{ height: 48, padding: '0 1rem', display: 'flex', alignItems: 'center', gap: '0.5rem',
            borderBottom: '1px solid rgba(255,255,255,0.06)', flexShrink: 0 }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="rgba(255,255,255,0.35)">
              <path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z"/>
            </svg>
            <span style={{ fontWeight: 700, fontSize: '0.875rem', color: '#f2f3f5',
              fontFamily: 'var(--font-heading)' }}>{CHANNELS[activeChannel]}</span>
            <div style={{ width: 1, height: 18, background: 'rgba(255,255,255,0.12)', margin: '0 0.25rem' }} />
            <span style={{ fontSize: '0.72rem', color: 'rgba(255,255,255,0.35)' }}>Chopsticks Demo</span>
            <div style={{ marginLeft: 'auto', display: 'flex', gap: '0.5rem' }}>
              {[
                <svg key="s" width="16" height="16" viewBox="0 0 24 24" fill="rgba(255,255,255,0.35)"><path d="M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/></svg>,
                <svg key="b" width="16" height="16" viewBox="0 0 24 24" fill="rgba(255,255,255,0.35)"><path d="M12 22c1.1 0 2-.9 2-2h-4c0 1.1.9 2 2 2zm6-6v-5c0-3.07-1.64-5.64-4.5-6.32V4c0-.83-.67-1.5-1.5-1.5s-1.5.67-1.5 1.5v.68C7.63 5.36 6 7.92 6 11v5l-2 2v1h16v-1l-2-2z"/></svg>,
              ]}
            </div>
          </div>

          {/* Messages */}
          <div ref={messagesRef} style={{ flex: 1, overflowY: 'auto', padding: '0.75rem 0.875rem',
            display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', gap: '0.5rem',
            scrollbarWidth: 'none' }}>
            {msgs.map((m, i) => visible.includes(i) ? (
              <div key={i} style={{ display: 'flex', gap: '0.625rem', alignItems: 'flex-start',
                animation: 'msgFadeIn 0.35s ease both' }}>
                <Avatar src={m.avatar} size={34} bot={m.type === 'bot'} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.4rem', marginBottom: '0.1rem' }}>
                    <span style={{ fontSize: '0.825rem', fontWeight: 700, color: m.color,
                      fontFamily: 'var(--font-heading)', lineHeight: 1 }}>{m.user}</span>
                    {m.type === 'bot' && (
                      <span style={{ fontSize: '0.58rem', background: '#5865f2', color: '#fff',
                        borderRadius: 3, padding: '1px 4px', fontWeight: 700, lineHeight: 1.3,
                        fontFamily: 'var(--font-heading)', letterSpacing: '0.02em' }}>BOT</span>
                    )}
                    <span style={{ fontSize: '0.65rem', color: 'rgba(255,255,255,0.28)' }}>Today at 4:20 PM</span>
                  </div>
                  {m.content && (
                    <div style={{ fontSize: '0.82rem', color: 'rgba(255,255,255,0.85)', lineHeight: 1.5 }}>{m.content}</div>
                  )}
                  {m.embed && <EmbedCard embed={m.embed} />}
                </div>
              </div>
            ) : null)}
          </div>

          {/* Input bar */}
          <div style={{ padding: '0 0.875rem 0.875rem' }}>
            <div style={{ background: '#383a40', borderRadius: 8, display: 'flex', alignItems: 'center',
              padding: '0.55rem 0.75rem', gap: '0.5rem' }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="rgba(255,255,255,0.3)" style={{ flexShrink: 0 }}>
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm5 11h-4v4h-2v-4H7v-2h4V7h2v4h4v2z"/>
              </svg>
              <span style={{ flex: 1, fontSize: '0.82rem', color: 'rgba(255,255,255,0.28)',
                fontFamily: 'var(--font-body)' }}>Message #{CHANNELS[activeChannel]}</span>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                {[
                  <svg key="g" width="18" height="18" viewBox="0 0 24 24" fill="rgba(255,255,255,0.3)"><path d="M11.5 2C6.81 2 3 5.81 3 10.5S6.81 19 11.5 19h.5v3c4.86-2.34 8-7 8-11.5C20 5.81 16.19 2 11.5 2zm1 14.5h-2v-2h2v2zm0-4h-2c0-3.25 3-3 3-5 0-1.1-.9-2-2-2s-2 .9-2 2h-2c0-2.21 1.79-4 4-4s4 1.79 4 4c0 2.5-3 2.75-3 5z"/></svg>,
                  <svg key="e" width="18" height="18" viewBox="0 0 36 36" fill="rgba(255,255,255,0.3)"><path d="M18 2a16 16 0 1 0 16 16A16 16 0 0 0 18 2zm8 22H10v-2h16zm-2-6a2 2 0 1 1 2-2 2 2 0 0 1-2 2zm-12 0a2 2 0 1 1 2-2 2 2 0 0 1-2 2z"/></svg>,
                ]}
              </div>
            </div>
          </div>
        </div>
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
      <section style={{ position: 'relative', overflow: 'hidden', minHeight: '88vh', display: 'flex', alignItems: 'center', borderBottom: '1px solid var(--border)', background: 'var(--surface)' }} className="bg-grid hero-section">
        <div className="orb orb-blue"   style={{ width: 700, height: 700, top: -250, left: -200, opacity: 0.45 }} />
        <div className="orb orb-violet" style={{ width: 500, height: 500, bottom: -200, right: -150, opacity: 0.35 }} />
        <div className="orb"            style={{ width: 300, height: 300, top: '30%', left: '55%', background: 'radial-gradient(circle, rgba(244,114,182,0.25), transparent 70%)', opacity: 0.5 }} />

        <div className="container hero-grid" style={{ position: 'relative', zIndex: 1, display: 'grid', gridTemplateColumns: '1.1fr 0.9fr', gap: '3rem', alignItems: 'center', padding: '5rem 1.5rem' }}>
          {/* Left */}
          <div>
            <a href="https://wokspec.org" target="_blank" rel="noopener noreferrer" className="badge" style={{ marginBottom: '1.5rem', background: 'rgba(30,30,30,0.7)', border: '1px solid rgba(180,100,30,0.35)', color: '#c8c8c8', gap: '0.5rem', textDecoration: 'none', cursor: 'pointer' }}>
              <span style={{ fontWeight: 700, color: '#e8742a', letterSpacing: '0.02em' }}>WokSpec</span>
            </a>
            <h1 style={{ fontFamily: 'var(--font-heading)', fontWeight: 800, fontSize: 'clamp(2.75rem, 6vw, 4.5rem)', lineHeight: 1.0, letterSpacing: '-0.05em', color: 'var(--text)', marginBottom: '1.5rem' }}>
              One bot.<br />
              <span className="gradient-text">Infinite possibilities.</span>
            </h1>
            <p style={{ fontSize: '1.05rem', color: 'var(--text-muted)', lineHeight: 1.8, maxWidth: 480, marginBottom: '2rem' }}>
              Chopsticks is a fully-loaded Discord bot with 148 prefix commands and 101 slash commands across 11 categories — music, moderation, economy, AI, leveling, and automation. It's open source, actively developed, and we'd love your help making it something special.
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
              {[['148', 'Prefix commands'], ['101', 'Slash commands'], ['49', 'Voice sessions'], ['6', 'Agent roles']].map(([n, l]) => (
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
          <div className="oss-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4rem', alignItems: 'start' }}>
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
