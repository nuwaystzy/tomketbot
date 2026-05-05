import { NextRequest, NextResponse } from 'next/server';
import { generateRecapDraft } from '@/lib/recapGenerator';
import { sendRecap, sendAdminRecapDraft } from '@/lib/telegram';

export async function GET(req: NextRequest) {
  // Security check
  const { searchParams } = new URL(req.url);
  const secret = searchParams.get('secret');
  
  if (secret !== process.env.CRON_SECRET) {
    return new Response('Unauthorized', { status: 401 });
  }

  try {
    const today = new Date().toISOString().split('T')[0];
    const recapText = await generateRecapDraft(today, today);
    
    if (recapText.startsWith('No approved items')) {
      console.log('No items to recap today.');
      return NextResponse.json({ ok: true, message: 'No items today' });
    }

    const channelId = process.env.TELEGRAM_RECAP_CHANNEL_ID;
    const imageUrl = process.env.RECAP_IMAGE_URL;

    if (!channelId) {
      throw new Error('TELEGRAM_RECAP_CHANNEL_ID is not configured');
    }

    await sendRecap(channelId, recapText, imageUrl);

    // NEW: Send reminder copy to admins
    await sendAdminRecapDraft(`🔔 <b>REMINDER REKAP HARIAN</b>\n\n${recapText}`);

    return NextResponse.json({ ok: true, sent_to: channelId });
  } catch (error: any) {
    console.error('Daily recap cron error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
