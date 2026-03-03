'use client';

import { useState, useRef, useEffect } from 'react';
import { usePathname } from 'next/navigation';

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

function genSessionId() {
  return `ch-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

const SUGGESTIONS = [
  'What music commands does Chopsticks have?',
  'How do I set up auto-moderation?',
  'How does the economy system work?',
  'Can I self-host Chopsticks?',
  'What AI agent commands are available?',
];

export function EralCompanion() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const sessionIdRef = useRef<string>(genSessionId());
  const pathname = usePathname();

  useEffect(() => () => { abortRef.current?.abort(); }, []);
  useEffect(() => {
    if (open) messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, open]);

  async function sendMessage(text: string) {
    if (!text.trim() || loading) return;
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    const userMsg: Message = { role: 'user', content: text.trim() };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setLoading(true);

    try {
      const res = await fetch('/api/eral/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: text.trim(),
          sessionId: sessionIdRef.current,
          pageContext: `Page: ${pathname}. Chopsticks is a Discord bot with 60+ commands — music, moderation, economy, games, AI agents.`,
        }),
        signal: ctrl.signal,
      });
      const data = await res.json() as { reply?: string; error?: string };
      const reply = data.reply ?? (data.error ? `Error: ${data.error}` : 'No response.');
      setMessages(prev => [...prev, { role: 'assistant', content: reply }]);
    } catch (err) {
      if ((err as Error)?.name !== 'AbortError') {
        setMessages(prev => [...prev, { role: 'assistant', content: 'Failed to reach Eral. Try again shortly.' }]);
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      {/* Trigger button */}
      <button
        onClick={() => setOpen(o => !o)}
        aria-label="Ask Eral about Chopsticks"
        style={{
          position: 'fixed',
          bottom: 24,
          right: 24,
          width: 50,
          height: 50,
          borderRadius: '50%',
          background: open ? '#5b21b6' : '#7c3aed',
          border: 'none',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          boxShadow: '0 4px 20px rgba(124,58,237,0.45)',
          zIndex: 9999,
          transition: 'background 0.15s, transform 0.15s',
        }}
        onMouseEnter={e => { e.currentTarget.style.transform = 'scale(1.08)'; }}
        onMouseLeave={e => { e.currentTarget.style.transform = 'scale(1)'; }}
      >
        {open ? (
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round">
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        ) : (
          <svg width="20" height="20" viewBox="0 0 24 24" fill="white" aria-hidden="true">
            <path d="M12 3l1.5 3.5L17 8l-3.5 1.5L12 13l-1.5-3.5L7 8l3.5-1.5L12 3z"/>
            <path d="M19 15l.8 1.8 1.8.8-1.8.8-.8 1.8-.8-1.8-1.8-.8 1.8-.8L19 15z"/>
          </svg>
        )}
      </button>

      {/* Panel */}
      {open && (
        <div style={{
          position: 'fixed',
          bottom: 86,
          right: 24,
          width: 340,
          height: 500,
          background: '#0d0d0d',
          border: '1px solid #1e1e1e',
          borderRadius: 14,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          boxShadow: '0 8px 40px rgba(0,0,0,0.8)',
          zIndex: 9998,
          animation: 'eralSlide 0.18s ease-out',
        }}>
          <style>{`
            @keyframes eralSlide {
              from { opacity:0; transform:translateY(12px); }
              to   { opacity:1; transform:translateY(0); }
            }
          `}</style>

          {/* Header */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '12px 14px',
            borderBottom: '1px solid #1a1a1a',
            flexShrink: 0,
          }}>
            <div style={{
              width: 30,
              height: 30,
              borderRadius: '50%',
              background: 'linear-gradient(135deg,#7c3aed,#a855f7)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="white">
                <path d="M12 3l1.5 3.5L17 8l-3.5 1.5L12 13l-1.5-3.5L7 8l3.5-1.5L12 3z"/>
                <path d="M19 15l.8 1.8 1.8.8-1.8.8-.8 1.8-.8-1.8-1.8-.8 1.8-.8L19 15z"/>
              </svg>
            </div>
            <div>
              <div style={{ color: '#fff', fontWeight: 600, fontSize: 13, lineHeight: 1.2 }}>Eral</div>
              <div style={{ color: '#7c3aed', fontSize: 11, lineHeight: 1.2 }}>Chopsticks assistant</div>
            </div>
          </div>

          {/* Messages */}
          <div style={{
            flex: 1,
            overflowY: 'auto',
            padding: '10px 12px',
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
          }}>
            {messages.length === 0 ? (
              <div style={{ padding: '8px 0' }}>
                <div style={{ color: '#555', fontSize: 12, marginBottom: 10 }}>
                  Ask anything about Chopsticks:
                </div>
                {SUGGESTIONS.map(s => (
                  <button
                    key={s}
                    onClick={() => sendMessage(s)}
                    style={{
                      display: 'block',
                      width: '100%',
                      textAlign: 'left',
                      background: '#141414',
                      border: '1px solid #1e1e1e',
                      borderRadius: 8,
                      color: '#ccc',
                      fontSize: 12,
                      padding: '7px 10px',
                      marginBottom: 5,
                      cursor: 'pointer',
                      transition: 'border-color 0.1s',
                    }}
                    onMouseEnter={e => { e.currentTarget.style.borderColor = '#7c3aed'; }}
                    onMouseLeave={e => { e.currentTarget.style.borderColor = '#1e1e1e'; }}
                  >
                    {s}
                  </button>
                ))}
              </div>
            ) : (
              messages.map((m, i) => (
                <div key={i} style={{
                  alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start',
                  maxWidth: '85%',
                  background: m.role === 'user' ? '#7c3aed' : '#161616',
                  color: '#fff',
                  borderRadius: m.role === 'user' ? '12px 12px 3px 12px' : '12px 12px 12px 3px',
                  padding: '8px 11px',
                  fontSize: 13,
                  lineHeight: 1.5,
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                  border: m.role === 'assistant' ? '1px solid #202020' : 'none',
                }}>
                  {m.content}
                </div>
              ))
            )}
            {loading && (
              <div style={{
                alignSelf: 'flex-start',
                background: '#161616',
                border: '1px solid #202020',
                borderRadius: '12px 12px 12px 3px',
                padding: '9px 12px',
                display: 'flex',
                gap: 4,
                alignItems: 'center',
              }}>
                {[0,1,2].map(n => (
                  <div key={n} style={{
                    width: 5,
                    height: 5,
                    borderRadius: '50%',
                    background: '#7c3aed',
                    animation: `eralDot 1.2s ease-in-out ${n*0.2}s infinite`,
                  }}/>
                ))}
                <style>{`
                  @keyframes eralDot {
                    0%,80%,100%{opacity:.3;transform:scale(.8);}
                    40%{opacity:1;transform:scale(1);}
                  }
                `}</style>
              </div>
            )}
            <div ref={messagesEndRef}/>
          </div>

          {/* Input */}
          <div style={{
            padding: '8px 10px 10px',
            borderTop: '1px solid #1a1a1a',
            display: 'flex',
            gap: 7,
            alignItems: 'flex-end',
            flexShrink: 0,
          }}>
            <textarea
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  sendMessage(input);
                }
              }}
              placeholder="Ask about Chopsticks…"
              disabled={loading}
              rows={1}
              style={{
                flex: 1,
                background: '#141414',
                border: '1px solid #1e1e1e',
                borderRadius: 9,
                color: '#fff',
                fontSize: 13,
                padding: '8px 11px',
                resize: 'none',
                outline: 'none',
                fontFamily: 'inherit',
                lineHeight: 1.4,
                maxHeight: 88,
                overflowY: 'auto',
              }}
              onFocus={e => { e.currentTarget.style.borderColor = '#7c3aed'; }}
              onBlur={e => { e.currentTarget.style.borderColor = '#1e1e1e'; }}
              onInput={e => {
                const el = e.currentTarget;
                el.style.height = 'auto';
                el.style.height = `${Math.min(el.scrollHeight, 88)}px`;
              }}
            />
            <button
              onClick={() => sendMessage(input)}
              disabled={loading || !input.trim()}
              style={{
                width: 34,
                height: 34,
                borderRadius: 9,
                background: input.trim() ? '#7c3aed' : '#141414',
                border: '1px solid #1e1e1e',
                cursor: input.trim() ? 'pointer' : 'default',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
                transition: 'background 0.15s',
              }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M22 2L11 13M22 2L15 22l-4-9-9-4 20-7z"/>
              </svg>
            </button>
          </div>
        </div>
      )}
    </>
  );
}
