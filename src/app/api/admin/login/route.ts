import { NextResponse } from 'next/server';
import { createDashboardSession, dashboardConfigured, dashboardSessionCookie, verifyPassword } from '@/lib/dashboardAuth';

export async function POST(request: Request) {
  const { password } = await request.json().catch(() => ({ password: '' }));
  if (!dashboardConfigured() || typeof password !== 'string' || !verifyPassword(password)) {
    return NextResponse.json({ error: 'Login gagal.' }, { status: 401 });
  }
  const response = NextResponse.json({ ok: true });
  response.cookies.set(dashboardSessionCookie(createDashboardSession()));
  return response;
}
