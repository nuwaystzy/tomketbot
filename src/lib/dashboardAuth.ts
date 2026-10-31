import crypto from 'crypto';
import { cookies } from 'next/headers';

const COOKIE = 'tomket_admin';
const MAX_AGE = 60 * 60 * 12;

const secret = () => process.env.DASHBOARD_SESSION_SECRET || '';

const sign = (value: string) => crypto.createHmac('sha256', secret()).update(value).digest('base64url');

export const dashboardConfigured = () => Boolean(process.env.DASHBOARD_PASSWORD && secret());

export const verifyPassword = (password: string) => {
  const expected = process.env.DASHBOARD_PASSWORD || '';
  if (!expected || password.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(password), Buffer.from(expected));
};

export const createDashboardSession = () => {
  const expires = Math.floor(Date.now() / 1000) + MAX_AGE;
  const payload = `admin.${expires}`;
  return `${payload}.${sign(payload)}`;
};

export const isValidDashboardSession = (value?: string) => {
  if (!value || !secret()) return false;
  const [role, expires, signature] = value.split('.');
  const payload = `${role}.${expires}`;
  if (role !== 'admin' || !expires || !signature || Number(expires) < Date.now() / 1000) return false;
  const expected = sign(payload);
  return signature.length === expected.length && crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
};

export const dashboardSessionCookie = (value: string) => ({
  name: COOKIE,
  value,
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: process.env.NODE_ENV === 'production',
  path: '/',
  maxAge: MAX_AGE,
});

export const requireDashboardAuth = async () => isValidDashboardSession((await cookies()).get(COOKIE)?.value);
export const dashboardCookieName = COOKIE;
