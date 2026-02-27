import type { Metadata } from 'next';
import { BookOpenIcon } from '../icons';
import TutorialsUI from './TutorialsUI';

export const metadata: Metadata = {
  title: 'Tutorials — Chopsticks',
  description: 'Step-by-step guides for setting up moderation, economy, the Agent Pool, server customization, and self-hosting Chopsticks.',
  alternates: { canonical: 'https://chopsticks.wokspec.org/tutorials' },
};

export default function TutorialsPage() {
  return (
    <>
      {/* ── Hero ── */}
      <section style={{ padding: '4rem 0 2.5rem', borderBottom: '1px solid var(--border)', background: 'linear-gradient(180deg, rgba(56,189,248,0.03) 0%, transparent 100%)' }}>
        <div className="container">
          <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1.5rem' }}>
            <div style={{ maxWidth: 560 }}>
              <div className="badge" style={{ marginBottom: '1.25rem' }}>
                <BookOpenIcon size={11} />
                Tutorials
              </div>
              <h1 style={{ fontSize: 'clamp(1.75rem, 4vw, 2.75rem)', fontWeight: 700, letterSpacing: '-0.04em', color: 'var(--text)', fontFamily: 'var(--font-heading)', lineHeight: 1.1, marginBottom: '1rem' }}>
                Step-by-step guides.
              </h1>
              <p style={{ fontSize: '1rem', color: 'var(--text-muted)', lineHeight: 1.75, marginBottom: 0 }}>
                From adding the bot to self-hosting your own instance — everything you need, in the right order.
              </p>
            </div>
            {/* Stats row */}
            <div style={{ display: 'flex', gap: '2rem', flexWrap: 'wrap' }}>
              {[
                { v: '6',    l: 'tutorials' },
                { v: '162+', l: 'commands covered' },
                { v: 'All',  l: 'skill levels' },
              ].map(({ v, l }) => (
                <div key={l} style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: '1.5rem', fontWeight: 700, fontFamily: 'var(--font-heading)', color: 'var(--text)', letterSpacing: '-0.03em', lineHeight: 1 }}>{v}</div>
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-faint)', marginTop: '0.2rem', fontFamily: 'var(--font-heading)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{l}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── Tutorials UI ── */}
      <section style={{ padding: '2rem 0 5rem' }}>
        <div className="container">
          <TutorialsUI />
        </div>
      </section>
    </>
  );
}
