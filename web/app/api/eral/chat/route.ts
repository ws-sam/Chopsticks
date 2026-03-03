import { NextRequest, NextResponse } from 'next/server';

/**
 * POST /api/eral/chat
 * Thin proxy to the Eral Worker using a service API key.
 * Chopsticks is a public docs site — no user auth required.
 */

const ERAL_API = process.env.ERAL_API_URL ?? 'https://eral.wokspec.org/api';
const ERAL_API_KEY = process.env.ERAL_API_KEY ?? '';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  if (!ERAL_API_KEY) {
    return NextResponse.json({ error: 'Eral not configured' }, { status: 503 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json() as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const message = (body.message ?? body.prompt ?? '') as string;
  if (!message.trim()) {
    return NextResponse.json({ error: 'message is required' }, { status: 400 });
  }

  const eralRes = await fetch(`${ERAL_API}/v1/chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${ERAL_API_KEY}`,
      'X-Eral-Source': 'chopsticks',
    },
    body: JSON.stringify({
      message,
      sessionId: body.sessionId ?? 'chopsticks-docs',
      product: 'chopsticks',
      pageContext: body.pageContext,
    }),
  });

  const data = await eralRes.json() as { data?: { response?: string; sessionId?: string }; error?: unknown };
  if (!eralRes.ok) return NextResponse.json(data.error ?? data, { status: eralRes.status });

  return NextResponse.json({
    reply: data.data?.response ?? '',
    sessionId: data.data?.sessionId ?? body.sessionId,
  });
}
