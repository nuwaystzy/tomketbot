import { NextRequest, NextResponse } from 'next/server';
import { generateRecapDraft } from '@/lib/recapGenerator';
import { sendMessage, sendPhoto, sendAdminRecapDraft } from '@/lib/telegram';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const secret = searchParams.get('secret');
  
  if (secret !== process.env.CRON_SECRET) {
    return new Response('Unauthorized', { status: 401 });
  }

  try {
    const today = new Date();
    const endDate = today.toISOString().split('T')[0];
    
    // Get date 5 days ago
    const fiveDaysAgo = new Date();
    fiveDaysAgo.setDate(today.getDate() - 4); // Including today makes it a 5-day window
    const startDate = fiveDaysAgo.toISOString().split('T')[0];

    const recapText = await generateRecapDraft(startDate, endDate);
    
    if (recapText.startsWith('No approved items')) {
      return NextResponse.json({ ok: true, message: 'No items in 5-day window' });
    }

    const channelId = process.env.TELEGRAM_RECAP_CHANNEL_ID;
    const imageUrl = process.env.RECAP_IMAGE_URL;

    if (!channelId) throw new Error('TELEGRAM_RECAP_CHANNEL_ID not configured');

    // Change title to reflect it's a 5-day / weekly recap
    const finalRecap = recapText.replace('📢 LIST AIRDROP', '🏛️ WEEKLY LIST AIRDROP');

    if (imageUrl) {
      if (finalRecap.length > 1000) {
        await sendPhoto(channelId, imageUrl);
        await sendMessage(channelId, finalRecap);
      } else {
        await sendPhoto(channelId, imageUrl, finalRecap);
      }
    } else {
      await sendMessage(channelId, finalRecap);
    }

    // NEW: Send reminder copy to admins
    await sendAdminRecapDraft(`🏛️ <b>REMINDER REKAP 5-HARIAN</b>\n\n${finalRecap}`);

    return NextResponse.json({ ok: true, sent_to: channelId, window: `${startDate} to ${endDate}` });
  } catch (error: any) {
    console.error('5-day recap cron error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
