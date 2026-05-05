import { NextRequest, NextResponse } from 'next/server';
import { parseTelegramPost } from '@/lib/filterParser';
import { handleAdminCommand } from '@/lib/adminCommands';
import { answerCallbackQuery, isAdmin } from '@/lib/telegram';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET;

export async function POST(req: NextRequest) {
  // Validate Webhook Secret if set
  if (WEBHOOK_SECRET) {
    const secret = req.headers.get('x-telegram-bot-api-secret-token');
    if (secret !== WEBHOOK_SECRET) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  try {
    const update = await req.json();

    // 1. Handle Channel Posts
    if (update.channel_post || update.edited_channel_post) {
      await parseTelegramPost(update);
      return NextResponse.json({ ok: true });
    }

    // 2. Handle Admin DM Commands
    if (update.message && update.message.text) {
      const chatId = update.message.chat.id;
      const userId = update.message.from?.id;
      
      // Multi-admin support
      if (userId && isAdmin(userId)) {
        await handleAdminCommand(chatId, update.message.text);
      }
      return NextResponse.json({ ok: true });
    }

    // 3. Handle Inline Keyboard Callbacks
    if (update.callback_query) {
      const callbackQuery = update.callback_query;
      const callbackQueryId = callbackQuery.id;
      const data = callbackQuery.data;
      const userId = callbackQuery.from?.id;

      if (userId && isAdmin(userId) && data) {
        if (data.startsWith('approve_')) {
          const itemId = data.replace('approve_', '');
          await supabaseAdmin.from('parsed_items').update({ status: 'approved' }).eq('id', itemId);
          await answerCallbackQuery(callbackQueryId, '✅ Approved');
        } else if (data.startsWith('skip_')) {
          const itemId = data.replace('skip_', '');
          await supabaseAdmin.from('parsed_items').update({ status: 'skipped' }).eq('id', itemId);
          await answerCallbackQuery(callbackQueryId, '❌ Skipped');
        }
      } else {
         await answerCallbackQuery(callbackQueryId, 'Unauthorized');
      }
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('Webhook error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({ status: 'Webhook endpoint is active.' });
}
