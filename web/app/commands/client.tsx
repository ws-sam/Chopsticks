'use client';
import React, { useState, useMemo, useRef } from 'react';
import { RadioIcon, MusicIcon, ShieldIcon, ZapIcon, SparkleIcon, CoinIcon, GamepadIcon, WrenchIcon, BookOpenIcon, PaletteIcon, ServerIcon } from '../icons';

const BOT_INVITE = 'https://discord.com/api/oauth2/authorize?client_id=1466382874587431036&permissions=1099514858544&scope=bot%20applications.commands';

type PrefixCmd = {
  name: string; aliases: string[]; category: string;
  usage: string; description: string; permissions: string;
};
type SlashCmd = {
  name: string; category: string; summary: string; description: string;
  subcommandsRich?: { name: string; desc: string }[];
  permissions: string; examples?: string[];
};

function hexToRgb(hex: string): string {
  return `${parseInt(hex.slice(1,3),16)},${parseInt(hex.slice(3,5),16)},${parseInt(hex.slice(5,7),16)}`;
}

const PREFIX_CATS = ['Music','Moderation','Economy','Levels','Social','Games','Fun','AI','Automation','Utility','Voice'];
const PREFIX_CAT_META: Record<string, { color: string; Icon: React.FC<{size?:number}> }> = {
  Music:      { color: '#f472b6', Icon: MusicIcon },
  Moderation: { color: '#fb923c', Icon: ShieldIcon },
  Economy:    { color: '#4ade80', Icon: CoinIcon },
  Levels:     { color: '#facc15', Icon: BookOpenIcon },
  Social:     { color: '#a78bfa', Icon: PaletteIcon },
  Games:      { color: '#f97316', Icon: GamepadIcon },
  Fun:        { color: '#22d3ee', Icon: SparkleIcon },
  AI:         { color: '#38bdf8', Icon: SparkleIcon },
  Automation: { color: '#facc15', Icon: ZapIcon },
  Utility:    { color: '#94a3b8', Icon: WrenchIcon },
  Voice:      { color: '#c084fc', Icon: RadioIcon },
};
const SLASH_CAT_META: Record<string, { color: string; Icon: React.FC<{size?:number}> }> = {
  Config:     { color: '#fb923c', Icon: ServerIcon },
  Moderation: { color: '#f87171', Icon: ShieldIcon },
  Music:      { color: '#f472b6', Icon: MusicIcon },
  Agents:     { color: '#a78bfa', Icon: RadioIcon },
  AI:         { color: '#38bdf8', Icon: SparkleIcon },
  Utility:    { color: '#94a3b8', Icon: WrenchIcon },
};
const PERM_STYLE: Record<string, { bg: string; color: string }> = {
  Everyone:  { bg: 'rgba(56,189,248,0.1)',  color: '#38bdf8' },
  Moderator: { bg: 'rgba(251,191,36,0.1)',  color: '#fbbf24' },
  Admin:     { bg: 'rgba(239,68,68,0.1)',   color: '#f87171' },
};

function PermBadge({ perm }: { perm: string }) {
  const s = PERM_STYLE[perm] ?? PERM_STYLE.Everyone;
  return (
    <span style={{ fontSize: '0.68rem', fontWeight: 700, fontFamily: 'var(--font-heading)', padding: '0.15rem 0.5rem', borderRadius: 999, background: s.bg, color: s.color, border: `1px solid ${s.color}22`, flexShrink: 0 }}>
      {perm}
    </span>
  );
}

function PrefixCard({ cmd }: { cmd: PrefixCmd }) {
  const [open, setOpen] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);
  const cat = PREFIX_CAT_META[cmd.category] ?? PREFIX_CAT_META.Utility;

  return (
    <div className="cmd-card" style={{ borderColor: open ? `rgba(${hexToRgb(cat.color)},0.3)` : undefined }}>
      <button className="cmd-accordion-trigger" onClick={() => setOpen(v => !v)} aria-expanded={open}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', minWidth: 0 }}>
          <div style={{ width: 32, height: 32, borderRadius: '0.5rem', background: `rgba(${hexToRgb(cat.color)},0.1)`, border: `1px solid rgba(${hexToRgb(cat.color)},0.2)`, display: 'flex', alignItems: 'center', justifyContent: 'center', color: cat.color, flexShrink: 0 }}>
            <cat.Icon size={14} />
          </div>
          <div style={{ minWidth: 0 }}>
            <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: '0.9rem', color: cat.color }}>!{cmd.name}</span>
            {cmd.aliases.length > 0 && (
              <span style={{ marginLeft: '0.5rem', fontSize: '0.7rem', color: 'var(--text-faint)', fontFamily: 'var(--font-mono)' }}>
                {cmd.aliases.slice(0,3).map(a => `!${a}`).join('  ')}
              </span>
            )}
            <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '0.1rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 380 }}>
              {cmd.description}
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexShrink: 0 }}>
          <PermBadge perm={cmd.permissions} />
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" style={{ color: 'var(--text-faint)', transition: 'transform 0.25s', transform: open ? 'rotate(180deg)' : 'none' }}>
            <path d="M3 5l4 4 4-4"/>
          </svg>
        </div>
      </button>
      <div className={`cmd-accordion-body${open ? ' open' : ''}`} ref={bodyRef}
        style={{ maxHeight: open ? (bodyRef.current?.scrollHeight ?? 800) + 'px' : '0px' }}>
        <div className="cmd-accordion-inner">
          <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', lineHeight: 1.7, marginBottom: cmd.aliases.length ? '0.75rem' : 0 }}>
            {cmd.description}
          </p>
          {cmd.aliases.length > 0 && (
            <div>
              <div style={{ fontSize: '0.68rem', fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase', color: 'var(--text-faint)', fontFamily: 'var(--font-heading)', marginBottom: '0.375rem' }}>Aliases</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.3rem' }}>
                {cmd.aliases.map(a => (
                  <span key={a} style={{ fontFamily: 'var(--font-mono)', fontSize: '0.78rem', color: cat.color, background: `rgba(${hexToRgb(cat.color)},0.07)`, border: `1px solid rgba(${hexToRgb(cat.color)},0.15)`, borderRadius: '0.3rem', padding: '0.2rem 0.5rem' }}>!{a}</span>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function SlashCard({ cmd }: { cmd: SlashCmd }) {
  const [open, setOpen] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);
  const cat = SLASH_CAT_META[cmd.category] ?? SLASH_CAT_META.Utility;

  return (
    <div className="cmd-card" style={{ borderColor: open ? `rgba(${hexToRgb(cat.color)},0.3)` : undefined }}>
      <button className="cmd-accordion-trigger" onClick={() => setOpen(v => !v)} aria-expanded={open}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', minWidth: 0 }}>
          <div style={{ width: 32, height: 32, borderRadius: '0.5rem', background: `rgba(${hexToRgb(cat.color)},0.1)`, border: `1px solid rgba(${hexToRgb(cat.color)},0.2)`, display: 'flex', alignItems: 'center', justifyContent: 'center', color: cat.color, flexShrink: 0 }}>
            <cat.Icon size={14} />
          </div>
          <div style={{ minWidth: 0 }}>
            <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: '0.9rem', color: '#a5b4fc' }}>/{cmd.name}</span>
            {cmd.subcommandsRich && (
              <span style={{ marginLeft: '0.4rem', fontSize: '0.7rem', color: 'var(--text-faint)', fontFamily: 'var(--font-heading)' }}>+{cmd.subcommandsRich.length}</span>
            )}
            <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '0.1rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 380 }}>
              {cmd.summary}
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexShrink: 0 }}>
          <PermBadge perm={cmd.permissions} />
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" style={{ color: 'var(--text-faint)', transition: 'transform 0.25s', transform: open ? 'rotate(180deg)' : 'none' }}>
            <path d="M3 5l4 4 4-4"/>
          </svg>
        </div>
      </button>
      <div className={`cmd-accordion-body${open ? ' open' : ''}`} ref={bodyRef}
        style={{ maxHeight: open ? (bodyRef.current?.scrollHeight ?? 800) + 'px' : '0px' }}>
        <div className="cmd-accordion-inner">
          <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', lineHeight: 1.7, marginBottom: cmd.subcommandsRich?.length ? '1rem' : 0 }}>
            {cmd.description}
          </p>
          {cmd.subcommandsRich && cmd.subcommandsRich.length > 0 && (
            <div style={{ marginBottom: cmd.examples?.length ? '1rem' : 0 }}>
              <div style={{ fontSize: '0.68rem', fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase', color: 'var(--text-faint)', fontFamily: 'var(--font-heading)', marginBottom: '0.5rem' }}>Subcommands</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
                {cmd.subcommandsRich.map(sub => (
                  <div key={sub.name} style={{ display: 'flex', alignItems: 'baseline', gap: '0.5rem', background: 'rgba(165,180,252,0.04)', border: '1px solid rgba(165,180,252,0.1)', borderRadius: '0.375rem', padding: '0.35rem 0.625rem' }}>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.78rem', color: '#a5b4fc', fontWeight: 600, flexShrink: 0 }}>/{cmd.name} {sub.name}</span>
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-faint)' }}>{sub.desc}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          {cmd.examples && cmd.examples.length > 0 && (
            <div>
              <div style={{ fontSize: '0.68rem', fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase', color: 'var(--text-faint)', fontFamily: 'var(--font-heading)', marginBottom: '0.375rem' }}>Examples</div>
              {cmd.examples.map((ex, i) => (
                <div key={i} style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8rem', color: '#a5b4fc', background: 'rgba(165,180,252,0.05)', padding: '0.35rem 0.625rem', borderRadius: '0.3rem', marginBottom: '0.25rem' }}>{ex}</div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function CommandsClient() {
  const [prefixCmds, setPrefixCmds] = useState<PrefixCmd[]>([]);
  const [slashCmds, setSlashCmds]   = useState<SlashCmd[]>([]);
  const [loading, setLoading]        = useState(true);
  const [tab, setTab]                = useState<'prefix' | 'slash'>('prefix');
  const [search, setSearch]          = useState('');
  const [activeCategory, setActiveCategory] = useState('All');

  React.useEffect(() => {
    Promise.all([
      fetch('/data/prefix-commands.json').then(r => r.json()),
      fetch('/data/slash-commands.json').then(r => r.json()),
    ]).then(([p, s]) => { setPrefixCmds(p); setSlashCmds(s); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  // reset category when tab switches
  React.useEffect(() => { setActiveCategory('All'); setSearch(''); }, [tab]);

  const prefixFiltered = useMemo(() => {
    let cmds = prefixCmds;
    if (activeCategory !== 'All') cmds = cmds.filter(c => c.category === activeCategory);
    if (search.trim()) {
      const q = search.toLowerCase();
      cmds = cmds.filter(c => c.name.toLowerCase().includes(q) || c.aliases.some(a => a.includes(q)) || c.description.toLowerCase().includes(q));
    }
    return cmds;
  }, [prefixCmds, search, activeCategory]);

  const slashFiltered = useMemo(() => {
    let cmds = slashCmds;
    if (activeCategory !== 'All') cmds = cmds.filter(c => c.category === activeCategory);
    if (search.trim()) {
      const q = search.toLowerCase();
      cmds = cmds.filter(c => c.name.toLowerCase().includes(q) || c.summary.toLowerCase().includes(q) || c.description.toLowerCase().includes(q));
    }
    return cmds;
  }, [slashCmds, search, activeCategory]);

  const prefixGrouped = useMemo(() => {
    if (activeCategory !== 'All') return { [activeCategory]: prefixFiltered };
    const g: Record<string, PrefixCmd[]> = {};
    PREFIX_CATS.forEach(cat => { const cs = prefixFiltered.filter(c => c.category === cat); if (cs.length) g[cat] = cs; });
    return g;
  }, [prefixFiltered, activeCategory]);

  const prefixCatCounts = useMemo(() => {
    const c: Record<string, number> = {};
    prefixCmds.forEach(cmd => { c[cmd.category] = (c[cmd.category] ?? 0) + 1; });
    return c;
  }, [prefixCmds]);

  const slashCatCounts = useMemo(() => {
    const c: Record<string, number> = {};
    slashCmds.forEach(cmd => { c[cmd.category] = (c[cmd.category] ?? 0) + 1; });
    return c;
  }, [slashCmds]);

  const slashCats = useMemo(() => ['Config','Moderation','Music','Agents','AI','Utility'], []);

  return (
    <div>
      {/* Hero */}
      <section style={{ position: 'relative', overflow: 'hidden', borderBottom: '1px solid var(--border)', padding: '5rem 0 3rem', background: 'var(--surface)' }} className="bg-grid">
        <div className="orb orb-blue"   style={{ width: 500, height: 500, top: -200, left: -100, opacity: 0.4 }} />
        <div className="orb orb-violet" style={{ width: 350, height: 350, bottom: -120, right: -60, opacity: 0.35 }} />
        <div className="container" style={{ position: 'relative', zIndex: 1 }}>
          <div className="badge" style={{ marginBottom: '1.25rem' }}>
            <span className="dot-live" />
            {loading ? '…' : `${prefixCmds.length} prefix commands · ${slashCmds.length} core slash`}
          </div>
          <h1 style={{ fontSize: 'clamp(2.5rem, 6vw, 4rem)', fontWeight: 700, letterSpacing: '-0.05em', color: 'var(--text)', marginBottom: '1rem', fontFamily: 'var(--font-heading)', lineHeight: 1.0 }}>
            Command Reference
          </h1>
          <p style={{ fontSize: '1rem', color: 'var(--text-muted)', maxWidth: '520px', lineHeight: 1.75, marginBottom: '1.5rem' }}>
            Chopsticks is primarily a <strong style={{ color: 'var(--text)' }}>prefix-command bot</strong> — use <code style={{ fontFamily: 'var(--font-mono)', color: 'var(--accent)', fontSize: '0.9rem' }}>!command</code> for everything. A small set of slash commands handle server configuration and setup.
          </p>
          <a href={BOT_INVITE} target="_blank" rel="noopener noreferrer" className="btn btn-primary" style={{ padding: '0.65rem 1.5rem' }}>Add to Discord</a>
        </div>
      </section>

      {/* Tab + search bar */}
      <div style={{ borderBottom: '1px solid var(--border)', background: 'var(--surface)', position: 'sticky', top: 58, zIndex: 80, backdropFilter: 'blur(12px)' }}>
        <div className="container" style={{ padding: '0.75rem 1.5rem', display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
          {/* Tab toggle */}
          <div style={{ display: 'flex', background: 'var(--surface-raised)', border: '1px solid var(--border)', borderRadius: '0.625rem', padding: '0.25rem', gap: '0.25rem', flexShrink: 0 }}>
            {(['prefix','slash'] as const).map(t => (
              <button key={t} onClick={() => setTab(t)} style={{ padding: '0.375rem 0.875rem', borderRadius: '0.45rem', border: 'none', cursor: 'pointer', fontFamily: 'var(--font-heading)', fontWeight: 700, fontSize: '0.8rem', transition: 'all 0.15s', background: tab === t ? 'var(--accent-dim)' : 'transparent', color: tab === t ? 'var(--accent)' : 'var(--text-muted)', borderColor: tab === t ? 'var(--accent-border)' : 'transparent', borderWidth: 1, borderStyle: 'solid' }}>
                {t === 'prefix' ? '! Prefix' : '/ Slash (Core)'}
              </button>
            ))}
          </div>

          {/* Search */}
          <div style={{ position: 'relative', flex: '1 1 220px', minWidth: 180 }}>
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ position: 'absolute', left: '0.625rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-faint)', pointerEvents: 'none' }}><circle cx="6" cy="6" r="4"/><path d="M10 10l2.5 2.5"/></svg>
            <input
              type="text" placeholder={`Search ${tab} commands…`} value={search}
              onChange={e => setSearch(e.target.value)}
              style={{ width: '100%', paddingLeft: '2rem', paddingRight: '0.75rem', paddingTop: '0.45rem', paddingBottom: '0.45rem', background: 'var(--surface-raised)', border: '1px solid var(--border)', borderRadius: '0.5rem', color: 'var(--text)', fontSize: '0.85rem', outline: 'none', fontFamily: 'var(--font-body)', boxSizing: 'border-box' }}
            />
          </div>

          {/* Category filters */}
          <div style={{ display: 'flex', gap: '0.375rem', flexWrap: 'wrap' }}>
            {['All', ...(tab === 'prefix' ? PREFIX_CATS : slashCats)].map(cat => {
              const count = tab === 'prefix' ? (cat === 'All' ? prefixCmds.length : prefixCatCounts[cat] ?? 0) : (cat === 'All' ? slashCmds.length : slashCatCounts[cat] ?? 0);
              if (cat !== 'All' && !count) return null;
              return (
                <button key={cat} onClick={() => setActiveCategory(cat)} style={{ padding: '0.3rem 0.7rem', borderRadius: '0.4rem', border: '1px solid', cursor: 'pointer', fontSize: '0.75rem', fontFamily: 'var(--font-heading)', fontWeight: 600, transition: 'all 0.14s', background: activeCategory === cat ? 'var(--accent-dim)' : 'transparent', color: activeCategory === cat ? 'var(--accent)' : 'var(--text-muted)', borderColor: activeCategory === cat ? 'var(--accent-border)' : 'var(--border)' }}>
                  {cat}{cat !== 'All' && count > 0 ? ` ${count}` : ''}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Results */}
      <div className="container" style={{ padding: '2.5rem 1.5rem' }}>
        {loading ? (
          <div style={{ textAlign: 'center', padding: '4rem', color: 'var(--text-faint)' }}>Loading commands…</div>
        ) : tab === 'prefix' ? (
          <>
            {/* prefix note */}
            <div style={{ background: 'rgba(56,189,248,0.05)', border: '1px solid rgba(56,189,248,0.15)', borderRadius: '0.625rem', padding: '0.75rem 1rem', marginBottom: '2rem', display: 'flex', gap: '0.75rem', alignItems: 'flex-start' }}>
              <span style={{ fontSize: '1rem', flexShrink: 0 }}>💡</span>
              <p style={{ fontSize: '0.83rem', color: 'var(--text-muted)', lineHeight: 1.6, margin: 0 }}>
                Default prefix is <code style={{ fontFamily: 'var(--font-mono)', color: 'var(--accent)' }}>!</code>. Change it with <code style={{ fontFamily: 'var(--font-mono)', color: 'var(--accent)' }}>/prefix</code> or <code style={{ fontFamily: 'var(--font-mono)', color: 'var(--accent)' }}>!prefix &lt;new&gt;</code>. Aliases shown in grey — any alias works exactly like the main command.
              </p>
            </div>
            {Object.keys(prefixGrouped).length === 0 ? (
              <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-faint)' }}>No commands match your search.</div>
            ) : (
              Object.entries(prefixGrouped).map(([cat, cmds]) => {
                const meta = PREFIX_CAT_META[cat] ?? PREFIX_CAT_META.Utility;
                return (
                  <div key={cat} style={{ marginBottom: '2.5rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.625rem', marginBottom: '1rem', paddingBottom: '0.625rem', borderBottom: '1px solid var(--border)' }}>
                      <div style={{ width: 28, height: 28, borderRadius: '0.4rem', background: `rgba(${hexToRgb(meta.color)},0.12)`, border: `1px solid rgba(${hexToRgb(meta.color)},0.2)`, display: 'flex', alignItems: 'center', justifyContent: 'center', color: meta.color }}>
                        <meta.Icon size={13} />
                      </div>
                      <h2 style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--text)', fontFamily: 'var(--font-heading)', letterSpacing: '-0.02em' }}>{cat}</h2>
                      <span style={{ fontSize: '0.75rem', color: 'var(--text-faint)', fontFamily: 'var(--font-heading)' }}>{cmds.length} command{cmds.length !== 1 ? 's' : ''}</span>
                    </div>
                    <div className="cmd-grid">
                      {cmds.map(cmd => <PrefixCard key={cmd.name} cmd={cmd} />)}
                    </div>
                  </div>
                );
              })
            )}
          </>
        ) : (
          <>
            {/* slash note */}
            <div style={{ background: 'rgba(165,180,252,0.05)', border: '1px solid rgba(165,180,252,0.15)', borderRadius: '0.625rem', padding: '0.75rem 1rem', marginBottom: '2rem', display: 'flex', gap: '0.75rem', alignItems: 'flex-start' }}>
              <span style={{ fontSize: '1rem', flexShrink: 0 }}>⚡</span>
              <p style={{ fontSize: '0.83rem', color: 'var(--text-muted)', lineHeight: 1.6, margin: 0 }}>
                Slash commands are reserved for <strong style={{ color: 'var(--text)' }}>server configuration and admin tooling</strong>. For music, economy, moderation, and everything else — use the prefix commands on the other tab.
              </p>
            </div>
            <div className="cmd-grid">
              {slashFiltered.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-faint)', gridColumn: '1/-1' }}>No commands match your search.</div>
              ) : slashFiltered.map(cmd => <SlashCard key={cmd.name} cmd={cmd} />)}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
