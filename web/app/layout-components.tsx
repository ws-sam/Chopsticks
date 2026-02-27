'use client';
import Link from 'next/link';
import { useState } from 'react';
import { DiscordIcon, GitHubIcon, MusicIcon, ShieldIcon, CoinIcon, SparkleIcon, ZapIcon, BookOpenIcon, ServerIcon, RadioIcon, GamepadIcon } from './icons';

const BOT_INVITE = 'https://discord.com/api/oauth2/authorize?client_id=1466382874587431036&permissions=1099514858544&scope=bot%20applications.commands';
const GITHUB = 'https://github.com/WokSpec/Chopsticks';

type DropItem = { label: string; href: string; Icon: React.FC<{size?:number}>; desc: string; external?: boolean };

const FEATURES_DROP: DropItem[] = [
  { label: 'Voice & Music',  href: '/features#music',      Icon: MusicIcon,    desc: '49 concurrent sessions' },
  { label: 'Agent Pool',     href: '/features#agents',     Icon: RadioIcon,    desc: 'Near-human actors' },
  { label: 'Economy',        href: '/features#economy',    Icon: CoinIcon,     desc: 'Credits, shop, quests' },
  { label: 'Moderation',     href: '/features#moderation', Icon: ShieldIcon,   desc: 'Raid, ban, antinuke' },
  { label: 'AI',             href: '/features#ai',         Icon: SparkleIcon,  desc: 'Chat, image, voice' },
  { label: 'Automation',     href: '/features#automation', Icon: ZapIcon,      desc: 'Reaction roles, scripts' },
  { label: 'Fun & Games',    href: '/features#games',      Icon: GamepadIcon,  desc: 'Trivia, battles, casino' },
];

const DOCS_DROP: DropItem[] = [
  { label: 'Quickstart',     href: '/docs#hosted',         Icon: BookOpenIcon, desc: 'Add & configure in 5 min' },
  { label: 'Self-hosting',   href: '/self-host',           Icon: ServerIcon,   desc: 'Docker stack guide' },
  { label: 'Agent Pool',     href: '/docs#agent-pool',     Icon: RadioIcon,    desc: 'Pool system explained' },
  { label: 'Contributing',   href: '/docs#contributing',   Icon: GitHubIcon,   desc: 'How to submit PRs' },
];

const COMMUNITY_DROP: DropItem[] = [
  { label: 'GitHub',         href: GITHUB,                          Icon: GitHubIcon,   desc: 'Source, issues, PRs', external: true },
  { label: 'Add to Discord', href: BOT_INVITE,                      Icon: DiscordIcon,  desc: 'Invite the hosted bot', external: true },
  { label: 'Discussions',    href: GITHUB + '/discussions',         Icon: BookOpenIcon, desc: 'Community Q&A', external: true },
];

function NavDropdown({ label, items }: { label: string; items: DropItem[] }) {
  return (
    <div className="nav-dropdown-wrapper">
      <button className="nav-link" style={{ background: 'none', border: 'none' }}>
        {label}
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true" style={{ marginLeft: 1 }}>
          <path d="M2 3.5l3 3 3-3" />
        </svg>
      </button>
      <div className="nav-dropdown">
        {items.map((item, i) => (
          <Link
            key={i}
            href={item.href}
            className="nav-dropdown-item"
            {...(item.external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
          >
            <div className="nav-dropdown-item-icon">
              <item.Icon size={13} />
            </div>
            <div>
              <div style={{ fontWeight: 600, fontSize: '0.82rem', color: 'var(--text)', lineHeight: 1.2 }}>{item.label}</div>
              <div style={{ fontSize: '0.72rem', color: 'var(--text-faint)', marginTop: '0.1rem' }}>{item.desc}</div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}

export function Header() {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <header>
      <div className="header-inner">
        <Link href="/" className="header-logo">
          <div className="header-logo-mark"><img src="/images/chopsticks.png" alt="Chopsticks" width={22} height={22} style={{ objectFit: 'contain', display: 'block' }} /></div>
          Chopsticks
        </Link>

        {/* Desktop nav */}
        <nav className="desktop-nav">
          <NavDropdown label="Features"  items={FEATURES_DROP} />
          <Link href="/commands"  className="nav-link">Commands</Link>
          <Link href="/tutorials" className="nav-link">Tutorials</Link>
          <NavDropdown label="Docs"      items={DOCS_DROP} />
          <NavDropdown label="Community" items={COMMUNITY_DROP} />
        </nav>

        <div className="header-actions">
          <a href={GITHUB} target="_blank" rel="noopener noreferrer" className="btn btn-ghost" style={{ padding: '0.45rem 0.875rem', fontSize: '0.8rem' }}>
            <GitHubIcon size={14} />
            GitHub
          </a>
          <a href={BOT_INVITE} target="_blank" rel="noopener noreferrer" className="btn btn-primary" style={{ padding: '0.5rem 1.1rem', fontSize: '0.82rem' }}>
            <DiscordIcon size={14} />
            Add to Discord
          </a>
          <button
            className="mobile-nav-toggle"
            aria-label={mobileOpen ? 'Close menu' : 'Open menu'}
            onClick={() => setMobileOpen(v => !v)}
          >
            {mobileOpen ? (
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M2 2l12 12M14 2L2 14"/></svg>
            ) : (
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M2 4h12M2 8h12M2 12h12"/></svg>
            )}
          </button>
        </div>
      </div>

      {/* Mobile nav */}
      <div className={`mobile-nav${mobileOpen ? '' : ' hidden'}`}>
        {[
          { href: '/features',  label: 'Features',  Icon: SparkleIcon },
          { href: '/commands',  label: 'Commands',  Icon: ZapIcon },
          { href: '/tutorials', label: 'Tutorials', Icon: BookOpenIcon },
          { href: '/docs',      label: 'Docs',      Icon: BookOpenIcon },
          { href: '/self-host', label: 'Self-host', Icon: ServerIcon },
        ].map(item => (
          <Link key={item.href} href={item.href} className="mobile-nav-link" onClick={() => setMobileOpen(false)}>
            <div style={{ width: 30, height: 30, borderRadius: '0.4rem', background: 'var(--accent-dim)', border: '1px solid var(--accent-border)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--accent)', flexShrink: 0 }}>
              <item.Icon size={14} />
            </div>
            {item.label}
          </Link>
        ))}
        <div style={{ height: '1px', background: 'var(--border)', margin: '0.75rem 0' }} />
        <a href={BOT_INVITE} target="_blank" rel="noopener noreferrer" className="btn btn-primary" style={{ width: '100%', justifyContent: 'center', marginTop: '0.25rem' }}>
          <DiscordIcon size={15} /> Add to Discord
        </a>
      </div>
    </header>
  );
}

export function Footer() {
  return (
    <footer>
      <div className="footer-inner">
        <div className="footer-grid">
          <div className="footer-brand">
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '0.125rem' }}>
              <div style={{ width: 26, height: 26, borderRadius: 7, background: 'rgba(56,189,248,0.08)', border: '1px solid rgba(56,189,248,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><img src="/images/chopsticks.png" alt="Chopsticks" width={18} height={18} style={{ objectFit: 'contain', display: 'block' }} /></div>
              <span style={{ fontWeight: 700, fontSize: '0.9rem', fontFamily: 'var(--font-heading)', letterSpacing: '-0.02em' }}>Chopsticks</span>
            </div>
            <p>An open source Discord bot built by goot27 and the WokSpec community. MIT licensed.</p>
          </div>

          <div className="footer-col">
            <h4>Bot</h4>
            <Link href="/features">Features</Link>
            <Link href="/commands">Commands</Link>
            <Link href="/tutorials">Tutorials</Link>
            <Link href="/docs">Docs</Link>
            <Link href="/self-host">Self-host</Link>
          </div>

          <div className="footer-col">
            <h4>Project</h4>
            <a href={GITHUB} target="_blank" rel="noopener noreferrer">GitHub</a>
            <a href={GITHUB + '/issues'} target="_blank" rel="noopener noreferrer">Issues</a>
            <a href={GITHUB + '/pulls'} target="_blank" rel="noopener noreferrer">Pull Requests</a>
            <a href={GITHUB + '/discussions'} target="_blank" rel="noopener noreferrer">Discussions</a>
          </div>

          <div className="footer-col">
            <h4>Community</h4>
            <a href={BOT_INVITE} target="_blank" rel="noopener noreferrer">Add to Discord</a>
            <a href={GITHUB + '/stargazers'} target="_blank" rel="noopener noreferrer">Star on GitHub</a>
            <a href={GITHUB + '/blob/main/CONTRIBUTING.md'} target="_blank" rel="noopener noreferrer">Contribute</a>
          </div>
        </div>

        <div className="footer-bottom">
          <p>Built by <a href="https://github.com/goot27" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--text-muted)', textDecoration: 'underline', textUnderlineOffset: '3px' }}>goot27</a> &amp; Wok Specialists · {new Date().getFullYear()}</p>
          <div className="footer-social">
            <a href={GITHUB} target="_blank" rel="noopener noreferrer" title="GitHub"><GitHubIcon size={15} /></a>
            <a href={BOT_INVITE} target="_blank" rel="noopener noreferrer" title="Add to Discord"><DiscordIcon size={15} /></a>
          </div>
        </div>
      </div>
    </footer>
  );
}

