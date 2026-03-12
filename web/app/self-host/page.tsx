'use client';
import React, { useState } from 'react';
import { GitHubIcon, DockerIcon, ServerIcon, CheckIcon } from '../icons';

import { Config } from '../config';

const GITHUB = Config.githubRepo;

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <button className={`copy-btn${copied ? ' copied' : ''}`} onClick={copy}>{copied ? '✓ Copied' : 'Copy'}</button>
  );
}

function CodeBlock({ children, lang = '' }: { children: string; lang?: string }) {
  return (
    <div className="code-block-wrapper" style={{ marginTop: '0.75rem', marginBottom: '1rem' }}>
      <pre style={{ background: '#0d1117', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '0.625rem', padding: '1.125rem 1.375rem', fontFamily: 'var(--font-mono)', fontSize: '0.82rem', color: '#e2e8f0', lineHeight: 1.75, overflowX: 'auto', whiteSpace: 'pre' }}>
        {lang && <span style={{ display: 'block', fontSize: '0.65rem', color: 'rgba(148,155,164,0.6)', fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase', marginBottom: '0.625rem' }}>{lang}</span>}
        {children}
      </pre>
      <CopyButton text={children.trim()} />
    </div>
  );
}

function Ic({ children }: { children: React.ReactNode }) {
  return <code style={{ fontFamily: 'var(--font-mono)', fontSize: '0.82em', background: 'rgba(255,255,255,0.07)', padding: '0.1em 0.4em', borderRadius: '0.25rem', color: 'var(--accent)' }}>{children}</code>;
}

const STEPS = [
  { title: 'Prerequisites',        subtitle: 'Install Docker Desktop (or Engine + Compose v2) and clone the repo.' },
  { title: 'Configure environment', subtitle: 'Copy .env.example to .env and fill in credentials.' },
  { title: 'Start the Docker stack', subtitle: 'One command spins up Postgres, Redis, Lavalink, and the bot.' },
  { title: 'Register commands',     subtitle: 'Deploy slash commands to Discord so they appear in your server.' },
  { title: 'Verify & monitor',      subtitle: 'Check logs, test /ping, and confirm everything is live.' },
];

const ENV_VARS = [
  { key: 'DISCORD_TOKEN',   req: true,  desc: 'Bot token from the Discord Developer Portal' },
  { key: 'CLIENT_ID',       req: true,  desc: 'Application / client ID' },
  { key: 'GUILD_ID',        req: false, desc: 'Dev guild for instant command registration (optional)' },
  { key: 'DATABASE_URL',    req: true,  desc: 'PostgreSQL connection string (auto-set in Docker stack)' },
  { key: 'REDIS_URL',       req: true,  desc: 'Redis URL (default: redis://redis:6379 in Docker)' },
  { key: 'LAVALINK_HOST',   req: true,  desc: 'Lavalink hostname (default: lavalink in Docker)' },
  { key: 'LAVALINK_PASS',   req: true,  desc: 'Lavalink server password' },
  { key: 'OPENAI_API_KEY',  req: false, desc: 'OpenAI-compatible API key for AI features (users can BYOK)' },
  { key: 'HUGGINGFACE_KEY', req: false, desc: 'HuggingFace key for /ai image (free tier available)' },
];

export default function SelfHostPage() {
  const [activeStep, setActiveStep] = useState(0);
  const [completedSteps, setCompletedSteps] = useState<Set<number>>(new Set());
  const [showEnvTable, setShowEnvTable] = useState(false);

  const markComplete = (i: number) => {
    setCompletedSteps(prev => new Set([...prev, i]));
    if (i < STEPS.length - 1) setActiveStep(i + 1);
  };

  const progress = (completedSteps.size / STEPS.length) * 100;

  return (
    <div>
      {/* Hero */}
      <section style={{ position: 'relative', overflow: 'hidden', borderBottom: '1px solid var(--border)', padding: '5rem 0 4rem', background: 'var(--surface)' }} className="bg-grid">
        <div className="orb orb-blue"   style={{ width: 500, height: 500, top: -200, right: -100, opacity: 0.4 }} />
        <div className="orb orb-violet" style={{ width: 350, height: 350, bottom: -100, left: -80, opacity: 0.3 }} />
        <div className="container" style={{ position: 'relative', zIndex: 1 }}>
          <div className="badge" style={{ marginBottom: '1.25rem' }}><span style={{ width: 5, height: 5, borderRadius: '50%', background: '#4ade80', display: 'inline-block' }} /> Self-hosting guide</div>
          <h1 style={{ fontSize: 'clamp(2rem, 5vw, 3.75rem)', fontWeight: 700, letterSpacing: '-0.045em', color: 'var(--text)', marginBottom: '1rem', fontFamily: 'var(--font-heading)', lineHeight: 1.05 }}>
            Run your own<br /><span style={{ color: '#4ade80' }}>Chopsticks.</span>
          </h1>
          <p style={{ fontSize: '1rem', color: 'var(--text-muted)', maxWidth: '480px', lineHeight: 1.75, marginBottom: '2rem' }}>
            Full Docker stack — PostgreSQL, Redis, and Lavalink included. One command and you&apos;re running. MIT licensed. Own it completely.
          </p>
          <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
            <a href={GITHUB} target="_blank" rel="noopener noreferrer" className="btn btn-ghost">
              <GitHubIcon size={15} /> View on GitHub
            </a>
            <a href={GITHUB + '/blob/main/SELF_HOSTING.md'} target="_blank" rel="noopener noreferrer" className="btn btn-green">
              <ServerIcon size={14} /> Full Guide
            </a>
          </div>
        </div>
      </section>

      {/* Main content */}
      <div className="container self-host-grid" style={{ display: 'grid', gridTemplateColumns: '300px 1fr', gap: '3rem', padding: '4rem 1.5rem', alignItems: 'start', maxWidth: 1000 }}>

        {/* Step sidebar */}
        <div style={{ position: 'sticky', top: 72 }}>
          <div style={{ background: 'var(--surface-raised)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: '1.25rem', marginBottom: '0.75rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.875rem' }}>
              <span style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-faint)', fontFamily: 'var(--font-heading)', textTransform: 'uppercase', letterSpacing: '0.07em' }}>Progress</span>
              <span style={{ fontSize: '0.78rem', color: '#4ade80', fontWeight: 700, fontFamily: 'var(--font-heading)' }}>{completedSteps.size}/{STEPS.length}</span>
            </div>
            <div className="progress-bar-track" style={{ marginBottom: '1.25rem' }}>
              <div className="progress-bar-fill" style={{ width: `${progress}%`, background: 'linear-gradient(90deg,#4ade80,#38bdf8)' }} />
            </div>
            {STEPS.map((step, i) => (
              <button
                key={i}
                onClick={() => setActiveStep(i)}
                style={{ width: '100%', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.625rem', padding: '0.5rem 0.625rem', borderRadius: '0.4rem', marginBottom: '0.125rem', transition: 'background 0.15s', background: activeStep === i ? 'rgba(56,189,248,0.06)' : 'transparent' } as React.CSSProperties}
              >
                <div style={{ width: 20, height: 20, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontSize: '0.65rem', fontWeight: 700, fontFamily: 'var(--font-heading)', background: completedSteps.has(i) ? 'rgba(74,222,128,0.12)' : activeStep === i ? 'rgba(56,189,248,0.12)' : 'rgba(255,255,255,0.04)', border: `1px solid ${completedSteps.has(i) ? 'rgba(74,222,128,0.3)' : activeStep === i ? 'rgba(56,189,248,0.3)' : 'var(--border)'}`, color: completedSteps.has(i) ? '#4ade80' : activeStep === i ? '#38bdf8' : 'var(--text-faint)' }}>
                  {completedSteps.has(i) ? '✓' : i + 1}
                </div>
                <span style={{ fontSize: '0.8rem', color: completedSteps.has(i) ? '#4ade80' : activeStep === i ? '#38bdf8' : 'var(--text-muted)', fontFamily: 'var(--font-heading)', fontWeight: 600, textAlign: 'left', lineHeight: 1.3 }}>
                  {step.title}
                </span>
              </button>
            ))}
          </div>

          {/* Quick stack info */}
          <div style={{ background: 'var(--surface-raised)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: '1.125rem' }}>
            <div style={{ fontSize: '0.68rem', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-faint)', fontFamily: 'var(--font-heading)', marginBottom: '0.75rem' }}>Stack</div>
            {[['Node.js', '22+'], ['PostgreSQL', '16'], ['Redis', '7'], ['Lavalink', '4'], ['discord.js', 'v14']].map(([n, v]) => (
              <div key={n} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', marginBottom: '0.4rem' }}>
                <span style={{ color: 'var(--text-muted)' }}>{n}</span>
                <span style={{ color: 'var(--accent)', fontFamily: 'var(--font-mono)', fontSize: '0.75rem' }}>{v}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Step content */}
        <div>
          {/* Step 0 — Prerequisites */}
          {activeStep === 0 && (
            <div>
              <h2 style={{ fontFamily: 'var(--font-heading)', fontWeight: 700, fontSize: '1.5rem', letterSpacing: '-0.03em', color: 'var(--text)', marginBottom: '0.5rem' }}>Prerequisites</h2>
              <p style={{ color: 'var(--text-muted)', marginBottom: '1.5rem', fontSize: '0.9rem', lineHeight: 1.7 }}>Install the required tools, then clone the repository.</p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginBottom: '1.5rem' }}>
                {[
                  { req: 'Docker Desktop 4.x+', note: 'or Docker Engine + Compose v2 on Linux' },
                  { req: 'Git', note: 'to clone the repository' },
                  { req: 'A Discord application', note: 'at discord.com/developers — you need the bot token' },
                ].map(item => (
                  <div key={item.req} style={{ display: 'flex', gap: '0.625rem', alignItems: 'flex-start', padding: '0.75rem 1rem', background: 'var(--surface-raised)', borderRadius: 'var(--radius)', border: '1px solid var(--border)' }}>
                    <span style={{ color: '#4ade80', flexShrink: 0, marginTop: 2 }}>✓</span>
                    <div>
                      <span style={{ fontWeight: 600, color: 'var(--text)', fontSize: '0.875rem' }}>{item.req}</span>
                      <span style={{ color: 'var(--text-faint)', fontSize: '0.8rem', marginLeft: '0.5rem' }}>{item.note}</span>
                    </div>
                  </div>
                ))}
              </div>
              <CodeBlock lang="bash">{`git clone https://github.com/WokSpec/Chopsticks
cd Chopsticks`}</CodeBlock>
              <button className="btn btn-green" style={{ marginTop: '0.5rem' }} onClick={() => markComplete(0)}>
                <CheckIcon size={14} /> Mark complete
              </button>
            </div>
          )}

          {/* Step 1 — Environment */}
          {activeStep === 1 && (
            <div>
              <h2 style={{ fontFamily: 'var(--font-heading)', fontWeight: 700, fontSize: '1.5rem', letterSpacing: '-0.03em', color: 'var(--text)', marginBottom: '0.5rem' }}>Configure environment</h2>
              <p style={{ color: 'var(--text-muted)', marginBottom: '1.5rem', fontSize: '0.9rem', lineHeight: 1.7 }}>Copy the example file and fill in your credentials.</p>
              <CodeBlock lang="bash">{`cp .env.example .env
# Open .env in your editor and fill in values`}</CodeBlock>

              <div style={{ marginBottom: '0.5rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--text-faint)', fontFamily: 'var(--font-heading)', textTransform: 'uppercase', letterSpacing: '0.07em' }}>Environment variables</span>
                <button onClick={() => setShowEnvTable(v => !v)} style={{ background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', fontSize: '0.8rem', fontFamily: 'var(--font-heading)', fontWeight: 600 }}>
                  {showEnvTable ? 'Hide table ↑' : 'Show all vars ↓'}
                </button>
              </div>
              {showEnvTable && (
                <table style={{ width: '100%', borderCollapse: 'collapse', background: 'var(--surface-raised)', borderRadius: 'var(--radius)', overflow: 'hidden', border: '1px solid var(--border)', fontSize: '0.82rem', marginBottom: '1rem', animation: 'fadeInUp 0.2s ease' }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--border)' }}>
                      {['Variable', 'Required', 'Description'].map(h => (
                        <th key={h} style={{ padding: '0.6rem 0.875rem', textAlign: 'left', color: 'var(--text-faint)', fontFamily: 'var(--font-heading)', fontSize: '0.7rem', fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {ENV_VARS.map(v => (
                      <tr key={v.key} style={{ borderBottom: '1px solid var(--border)' }}>
                        <td style={{ padding: '0.6rem 0.875rem', fontFamily: 'var(--font-mono)', fontSize: '0.78rem', color: 'var(--accent)' }}>{v.key}</td>
                        <td style={{ padding: '0.6rem 0.875rem' }}><span style={{ fontSize: '0.7rem', fontWeight: 700, fontFamily: 'var(--font-heading)', color: v.req ? '#fb7185' : '#4ade80', background: v.req ? 'rgba(251,113,133,0.08)' : 'rgba(74,222,128,0.08)', padding: '0.15rem 0.45rem', borderRadius: 999, border: `1px solid ${v.req ? 'rgba(251,113,133,0.2)' : 'rgba(74,222,128,0.2)'}` }}>{v.req ? 'Required' : 'Optional'}</span></td>
                        <td style={{ padding: '0.6rem 0.875rem', color: 'var(--text-muted)', fontSize: '0.82rem' }}>{v.desc}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              <button className="btn btn-green" style={{ marginTop: '0.5rem' }} onClick={() => markComplete(1)}>
                <CheckIcon size={14} /> Mark complete
              </button>
            </div>
          )}

          {/* Step 2 — Docker */}
          {activeStep === 2 && (
            <div>
              <h2 style={{ fontFamily: 'var(--font-heading)', fontWeight: 700, fontSize: '1.5rem', letterSpacing: '-0.03em', color: 'var(--text)', marginBottom: '0.5rem' }}>Start the Docker stack</h2>
              <p style={{ color: 'var(--text-muted)', marginBottom: '1.5rem', fontSize: '0.9rem', lineHeight: 1.7 }}>Choose the right Compose file for your environment.</p>
              <div className="compose-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.625rem', marginBottom: '1.25rem' }}>
                {[
                  { file: 'docker-compose.laptop.yml',     label: 'Local dev', desc: 'Lightweight, hot-reload' },
                  { file: 'docker-compose.production.yml', label: 'Production', desc: 'Caddy, hardened, TLS' },
                  { file: 'docker-compose.voice.yml',      label: 'Voice only', desc: 'Lavalink standalone' },
                  { file: 'docker-compose.full.yml',       label: 'Full stack',  desc: 'Everything enabled' },
                ].map(item => (
                  <div key={item.file} style={{ background: 'var(--surface-raised)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '0.875rem' }}>
                    <div style={{ fontWeight: 700, color: 'var(--text)', fontSize: '0.85rem', fontFamily: 'var(--font-heading)', marginBottom: '0.2rem' }}>{item.label}</div>
                    <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.72rem', color: 'var(--accent)', marginBottom: '0.3rem' }}>{item.file}</div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-faint)' }}>{item.desc}</div>
                  </div>
                ))}
              </div>
              <CodeBlock lang="bash">{`# For local development
docker compose -f docker-compose.laptop.yml up -d

# Check all containers are running
docker compose ps`}</CodeBlock>
              <button className="btn btn-green" style={{ marginTop: '0.5rem' }} onClick={() => markComplete(2)}>
                <CheckIcon size={14} /> Mark complete
              </button>
            </div>
          )}

          {/* Step 3 — Register */}
          {activeStep === 3 && (
            <div>
              <h2 style={{ fontFamily: 'var(--font-heading)', fontWeight: 700, fontSize: '1.5rem', letterSpacing: '-0.03em', color: 'var(--text)', marginBottom: '0.5rem' }}>Register commands</h2>
              <p style={{ color: 'var(--text-muted)', marginBottom: '1.5rem', fontSize: '0.9rem', lineHeight: 1.7 }}>Deploy slash commands to Discord. Set <Ic>GUILD_ID</Ic> for instant registration during dev, or leave blank for global rollout (up to 1 hour).</p>
              <CodeBlock lang="bash">{`npm run deploy

# Or to a specific guild only (instant, good for testing)
GUILD_ID=your_guild_id npm run deploy`}</CodeBlock>
              <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', lineHeight: 1.7 }}>You should see a confirmation listing all registered commands. If you see permission errors, double-check that <Ic>applications.commands</Ic> scope was included in your bot invite.</p>
              <button className="btn btn-green" style={{ marginTop: '1rem' }} onClick={() => markComplete(3)}>
                <CheckIcon size={14} /> Mark complete
              </button>
            </div>
          )}

          {/* Step 4 — Verify */}
          {activeStep === 4 && (
            <div>
              <h2 style={{ fontFamily: 'var(--font-heading)', fontWeight: 700, fontSize: '1.5rem', letterSpacing: '-0.03em', color: 'var(--text)', marginBottom: '0.5rem' }}>Verify & monitor</h2>
              <p style={{ color: 'var(--text-muted)', marginBottom: '1.5rem', fontSize: '0.9rem', lineHeight: 1.7 }}>Confirm everything is running and set up basic monitoring.</p>
              <CodeBlock lang="bash">{`# Check logs for the bot container
docker compose logs -f bot

# Test the bot in Discord
/ping

# Check resource usage
docker stats`}</CodeBlock>
              <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', lineHeight: 1.7, marginTop: '0.5rem' }}>For production, use <Ic>docker-compose.monitoring.yml</Ic> to add Prometheus metrics and Grafana dashboards.</p>
              {completedSteps.size === STEPS.length - 1 ? (
                <button className="btn btn-green" style={{ marginTop: '1rem' }} onClick={() => markComplete(4)}>
                  <CheckIcon size={14} /> All done! 🎉
                </button>
              ) : (
                <button className="btn btn-green" style={{ marginTop: '1rem' }} onClick={() => markComplete(4)}>
                  <CheckIcon size={14} /> Mark complete
                </button>
              )}

              {completedSteps.size === STEPS.length && (
                <div style={{ marginTop: '1.5rem', padding: '1.25rem', background: 'rgba(74,222,128,0.06)', border: '1px solid rgba(74,222,128,0.2)', borderRadius: 'var(--radius-lg)', animation: 'fadeInUp 0.3s ease' }}>
                  <div style={{ fontFamily: 'var(--font-heading)', fontWeight: 700, color: '#4ade80', marginBottom: '0.35rem' }}>🎉 You're self-hosted!</div>
                  <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', lineHeight: 1.65 }}>Your Chopsticks instance is up and running. Check the docs for reskinning, feature flags, and contributing back to the community.</div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
