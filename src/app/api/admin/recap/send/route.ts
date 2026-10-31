import { NextResponse } from 'next/server';
import { requireDashboardAuth } from '@/lib/dashboardAuth';
import { generateRecapDraft } from '@/lib/recapGenerator';
import { sendRecap } from '@/lib/telegram';

export async function POST(request: Request) {
  if (!await requireDashboardAuth()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { start, end, confirmed } = await request.json().catch(() => ({}));
  if (!confirmed || !/^\d{4}-\d{2}-\d{2}$/.test(start || '') || !/^\d{4}-\d{2}-\d{2}$/.test(end || '')) return NextResponse.json({ error: 'Konfirmasi dan rentang tanggal valid diperlukan.' }, { status: 400 });
  const channelId = process.env.TELEGRAM_RECAP_CHANNEL_ID;
  if (!channelId) return NextResponse.json({ error: 'TELEGRAM_RECAP_CHANNEL_ID belum dikonfigurasi.' }, { status: 500 });
  const text = await generateRecapDraft(start, end);
  const result = await sendRecap(channelId, text, process.env.RECAP_IMAGE_URL || 'public/recap.jpg');
  if (!result) return NextResponse.json({ error: 'Telegram menolak pengiriman recap.' }, { status: 502 });
  return NextResponse.json({ ok: true });
}
