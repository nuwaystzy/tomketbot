import { NextResponse } from 'next/server';
import { dashboardCookieName } from '@/lib/dashboardAuth';

export async function POST() {
  const response = NextResponse.json({ ok: true });
  response.cookies.set({ name: dashboardCookieName, value: '', path: '/', maxAge: 0 });
  return response;
}
