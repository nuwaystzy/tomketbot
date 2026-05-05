import { NextRequest, NextResponse } from 'next/server';
import { parseTelegramPost } from '@/lib/filterParser';
import { handleAdminCommand, logAction, showNextReviewItem } from '@/lib/adminCommands';
import { answerCallbackQuery, isAdmin, getCategoryKeyboard, sendMessage, sendAdminRecapDraft, sendPhoto, sendRecap } from '@/lib/telegram';
import { generateRecapDraft } from '@/lib/recapGenerator';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET;

export async function POST(req: NextRequest) {
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

    // 2. Handle Admin DM Commands & Session Text
    if (update.message && update.message.text) {
      const chatId = update.message.chat.id;
      const userId = update.message.from?.id;
      
      if (userId && isAdmin(userId)) {
        await handleAdminCommand(chatId, userId, update.message.text);
      }
      return NextResponse.json({ ok: true });
    }

    // 3. Handle Inline Keyboard Callbacks
    if (update.callback_query) {
      const callbackQuery = update.callback_query;
      const callbackQueryId = callbackQuery.id;
      const data = callbackQuery.data;
      const userId = callbackQuery.from?.id;
      const chatId = callbackQuery.message?.chat.id;
      const messageId = callbackQuery.message?.message_id;

      if (userId && isAdmin(userId) && data && chatId && messageId) {
        // INSTANT RESPONSE: Removes loading spinner immediately
        await answerCallbackQuery(callbackQueryId);
        
        const getPrevState = async (id: string) => {
           const { data } = await supabaseAdmin.from('parsed_items').select('id, category').eq('id', id).single();
           return data;
        };

        if (data.startsWith('app_next_')) {
          const itemId = data.replace('app_next_', '');
          const { data: prev } = await supabaseAdmin.from('parsed_items').select('*').eq('id', itemId).single();
          
          const updates: any = { status: 'approved' };
          
          if (prev) {
            const text = prev.original_text || '';
            const textUpper = text.toUpperCase();

            // 1. Smart Name Extraction (if missing)
            if (prev.project_name?.includes('Perlu Review')) {
              const words = text.split(/\s+/).filter((w: string) => !['LINK:', 'HTTPS://', 'JOIN', 'NEW', 'AIRDROP', 'CHECK'].includes(w.toUpperCase()));
              const extractedName = words.slice(0, 3).join(' ').replace(/[^a-zA-Z0-9\s]/g, '').trim();
              updates.project_name = extractedName || 'Project';
              updates.title_for_list = extractedName || 'Project';
            }

            // 2. Smart Category Detection (Hierarchy)
            if (prev.category === 'PENDING_REVIEW' || !prev.category) {
              const projName = updates.project_name || prev.project_name;
              
              if (textUpper.includes('WAITLIST') || textUpper.includes('WL ') || textUpper.includes('EARLY')) {
                updates.category = 'WL_EARLY_ACCESS';
              } else if (textUpper.includes('TESTNET')) {
                updates.category = 'TESTNET';
              } else if (textUpper.includes('NODE')) {
                updates.category = 'NODE';
              } else if (textUpper.includes('CLAIM') || textUpper.includes('ELIGIBLE') || textUpper.includes('CHECK')) {
                updates.category = 'CLAIM_CHECK_ELIGIBLE';
              } else if (textUpper.includes('MAINNET')) {
                updates.category = 'MAINNET';
              } else {
                // If no specific keyword, check DB history
                const { data: existing } = await supabaseAdmin
                  .from('parsed_items')
                  .select('id')
                  .ilike('project_name', projName)
                  .eq('status', 'approved')
                  .limit(1);
                
                updates.category = (existing && existing.length > 0) ? 'UPDATE' : 'AIRDROP';
              }
            }
          }

          await logAction(userId, 'approve', itemId, { status: 'pending' }, updates);
          await supabaseAdmin.from('parsed_items').update(updates).eq('id', itemId);
          await showNextReviewItem(chatId, messageId);
        } 
        else if (data.startsWith('skip_next_')) {
          const itemId = data.replace('skip_next_', '');
          await logAction(userId, 'skip', itemId, { status: 'pending' }, { status: 'skipped' });
          await supabaseAdmin.from('parsed_items').update({ status: 'skipped' }).eq('id', itemId);
          await showNextReviewItem(chatId, messageId);
        }
        else if (data.startsWith('move_cat_')) {
          const itemId = data.replace('move_cat_', '');
          const { editMessageText } = require('@/lib/telegram');
          await editMessageText(chatId, messageId, `Select new category:`, getCategoryKeyboard(itemId));
        }
        else if (data.startsWith('edit_name_')) {
          const itemId = data.replace('edit_name_', '');
          await supabaseAdmin.from('admin_sessions').upsert({
             admin_id: userId, flow: 'edit', step: 'name', payload: { item_id: itemId, message_id: messageId, return_to_review: true }
          });
          await sendMessage(chatId, `Please type the new project name for this item:`);
        }
        else if (data.startsWith('move_to_')) {
          const parts = data.split('_');
          const itemId = parts.pop()!;
          const cat = parts.slice(2).join('_');
          
          if (itemId === 'wizard') {
             await supabaseAdmin.from('admin_sessions').update({ step: 'name', payload: { category: cat } }).eq('admin_id', userId);
             const { editMessageText } = require('@/lib/telegram');
             await editMessageText(chatId, messageId, `Category selected: <b>${cat}</b>\n\nPlease type the Project Name:`, { parse_mode: 'HTML' });
          } else {
            const prev = await getPrevState(itemId);
            if (prev) {
               await logAction(userId, 'move_cat', itemId, { category: prev.category }, { category: cat });
               await supabaseAdmin.from('parsed_items').update({ category: cat }).eq('id', itemId);
            }
            await showNextReviewItem(chatId, messageId);
          }
        }
        else if (data.startsWith('manage_item_')) {
          const itemId = data.replace('manage_item_', '');
          const { data: item } = await supabaseAdmin.from('parsed_items').select('*').eq('id', itemId).single();
          if (item) {
            const kb = {
              inline_keyboard: [
                [
                  { text: '✏️ Nama', callback_data: `edit_name_${itemId}` },
                  { text: '📂 Kategori', callback_data: `move_cat_${itemId}` }
                ],
                [
                  { text: '📅 Tanggal', callback_data: `edit_date_${itemId}` },
                  { text: '🗑️ Hapus', callback_data: `del_item_${itemId}` }
                ],
                [{ text: '🔙 Kembali', callback_data: `cancel_manage` }]
              ]
            };
            const { editMessageText } = require('@/lib/telegram');
            await editMessageText(chatId, messageId, `⚙️ <b>Kelola Item: ${item.title_for_list}</b>\n\nSilakan pilih aksi:`, { parse_mode: 'HTML', reply_markup: kb });
          }
        }
        else if (data.startsWith('edit_date_')) {
          const itemId = data.replace('edit_date_', '');
          await supabaseAdmin.from('admin_sessions').upsert({
             admin_id: userId, flow: 'edit', step: 'date', payload: { item_id: itemId, message_id: messageId, return_to_review: false }
          });
          await sendMessage(chatId, `Silakan ketik tanggal baru (Contoh: <code>1 May</code> atau <code>2026-05-01</code>):`, { parse_mode: 'HTML' });
        }
        else if (data.startsWith('del_mode_')) {
          const parts = data.split('_');
          const start = parts[2];
          const end = parts[3];
          const { data: items } = await supabaseAdmin
            .from('parsed_items')
            .select('id, title_for_list')
            .eq('status', 'approved')
            .gte('telegram_post_date', `${start}T00:00:00.000Z`)
            .lte('telegram_post_date', `${end}T23:59:59.999Z`);
          
          if (!items || items.length === 0) {
            await answerCallbackQuery(callbackQueryId, `Tidak ada item untuk dihapus`);
            return;
          }

          const kb = {
            inline_keyboard: [
              ...items.map(item => ([{ text: `🗑️ ${item.title_for_list}`, callback_data: `del_item_${item.id}` }])),
              [{ text: '🔙 Kembali', callback_data: 'cancel_manage' }]
            ]
          };
          await sendMessage(chatId, `<b>Mode Hapus</b>\nKlik pada project yang ingin dihapus dari daftar:`, { parse_mode: 'HTML', reply_markup: kb });
        }
        else if (data.startsWith('del_item_')) {
          const itemId = data.replace('del_item_', '');
          const { data: item } = await supabaseAdmin.from('parsed_items').select('title_for_list').eq('id', itemId).single();
          await supabaseAdmin.from('parsed_items').delete().eq('id', itemId);
          await sendMessage(chatId, `🗑️ <b>${item?.title_for_list || 'Item'}</b> berhasil dihapus.`);
        }
        else if (data === 'cancel_manage') {
          // Just delete the sub-menu message to "go back"
          const { deleteMessage } = require('@/lib/telegram');
          await deleteMessage(chatId, messageId);
        }
        else if (data.startsWith('cancel_move_')) {
          await showNextReviewItem(chatId, messageId);
        }
        else if (data.startsWith('view_status_')) {
          const status = data.replace('view_status_', '');
          await answerCallbackQuery(callbackQueryId);
          const today = new Date().toISOString().split('T')[0];
          const { data: items } = await supabaseAdmin.from('parsed_items').select('*').eq('status', status).eq('date_found', today);
          
          if (!items || items.length === 0) {
             await sendMessage(chatId, `No ${status} items found today.`);
          } else {
             let msg = `📋 <b>Today's ${status.toUpperCase()} Items:</b>\n\n`;
             items.forEach(item => {
                msg += `- [${item.category}] ${item.title_for_list} (ID: ${item.display_id || item.id})\n`;
             });
             await sendMessage(chatId, msg);
          }
        }
        else if (data === 'send_to_channel') {
          const channelId = process.env.TELEGRAM_RECAP_CHANNEL_ID;
          const imageUrl = process.env.RECAP_IMAGE_URL;
          const text = callbackQuery.message.text || callbackQuery.message.caption || '';
          
          if (!channelId) {
            await sendMessage(chatId, '❌ Gagal: TELEGRAM_RECAP_CHANNEL_ID belum dikonfigurasi.');
            return;
          }

          await sendRecap(channelId, text, imageUrl);
          await sendMessage(chatId, '✅ <b>Berhasil!</b> Rekap sudah dikirim ke channel.');
        }
        else if (data.startsWith('gen_recap_')) {
          // gen_recap_2026-05-01_2026-05-05
          const parts = data.split('_');
          const end = parts.pop()!;
          const start = parts.pop()!;
          const recapDraft = await generateRecapDraft(start, end);
          await sendAdminRecapDraft(recapDraft);
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
