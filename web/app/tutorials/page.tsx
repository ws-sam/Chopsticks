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
      <TutorialsUI />
    </>
  );
}
