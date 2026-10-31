import { NextResponse } from 'next/server';
import { requireDashboardAuth } from '@/lib/dashboardAuth';
import { generateRecapDraft } from '@/lib/recapGenerator';

export async function GET(request: Request) {
  if (!await requireDashboardAuth()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { searchParams } = new URL(request.url);
  const start = searchParams.get('start');
  const end = searchParams.get('end');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start || '') || !/^\d{4}-\d{2}-\d{2}$/.test(end || '')) return NextResponse.json({ error: 'Pilih rentang tanggal valid.' }, { status: 400 });
  const text = await generateRecapDraft(start!, end!);
  return NextResponse.json({ text });
}
