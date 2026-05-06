import { NextRequest, NextResponse } from 'next/server';

export async function GET(req: NextRequest) {
  // Feature disabled by user request. Recap is now fully manual via bot commands
  return NextResponse.json({ ok: true, skipped: true, message: 'Auto five-day recap disabled' });
}
