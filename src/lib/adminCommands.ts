import { supabaseAdmin } from './supabaseAdmin';
import { sendMessage, sendAdminRecapDraft, sendAdminItemPreview, getCategoryKeyboard, fetchTelegramMessageDate } from './telegram';
import { generateRecapDraft } from './recapGenerator';
import { DatabaseParsedItem } from '@/types';
import { resolveCategoryAlias, CATEGORY_KEYS } from './categories';

export const logAction = async (adminId: number, actionType: string, itemId: string, prevState: any, newState: any) => {
  await supabaseAdmin.from('action_logs').insert({
    admin_id: adminId,
    action_type: actionType,
    target_item_id: itemId,
    previous_state: prevState,
    new_state: newState
  });
};

export const handleAdminCommand = async (chatId: number, userId: number, text: string) => {
  const parts = text.split(' ');
  const command = parts[0].toLowerCase();

  // Check active session first
  const { data: session } = await supabaseAdmin.from('admin_sessions').select('*').eq('admin_id', userId).single();
  if (session) {
    if (command.startsWith('/') && command !== '/cancel') {
      // User typed a new command while in a session. Cancel the session automatically.
      await supabaseAdmin.from('admin_sessions').delete().eq('admin_id', userId);
      await sendMessage(chatId, '⚠️ Previous wizard was automatically cancelled.');
    } else {
      await processSessionStep(chatId, userId, text, session);
      return;
    }
  }

  try {
    if (command === '/review') {
      await showNextReviewItem(chatId);
    }
    else if (command === '/pending') {
      const { data, error } = await supabaseAdmin
        .from('parsed_items')
        .select('*')
        .eq('status', 'pending')
        .order('created_at', { ascending: true }); // Oldest first

      if (error) throw error;
      if (!data || data.length === 0) {
        await sendMessage(chatId, 'No pending items.');
        return;
      }
      
      let msg = `⚠️ <b>Pending Items (${data.length}):</b>\n\n`;
      data.slice(0, 10).forEach(item => {
        msg += `- [${item.category}] ${item.title_for_list} (ID: ${item.display_id || item.id})\n`;
      });
      if (data.length > 10) msg += `\n...and ${data.length - 10} more. Use /review to process them.`;
      
      await sendMessage(chatId, msg);
    }
    else if (command === '/today' || command === '/week') {
      const isWeek = command === '/week';
      
      const getJakartaDate = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(d);
      const now = new Date();
      const endDateStr = getJakartaDate(now);
      
      let startDateStr: string;
      if (isWeek) {
        const d = new Date(now);
        d.setDate(d.getDate() - 6);
        startDateStr = getJakartaDate(d);
      } else {
        startDateStr = endDateStr;
      }

      const { data, error } = await supabaseAdmin
        .from('parsed_items')
        .select('*')
        .eq('status', 'approved')
        .gte('telegram_post_date', `${startDateStr}T00:00:00.000Z`)
        .lte('telegram_post_date', `${endDateStr}T23:59:59.999Z`)
        .order('telegram_post_date', { ascending: true });
        
      if (error) throw error;
      if (!data || data.length === 0) {
        await sendMessage(chatId, `Tidak ada item yang disetujui untuk ${command}.`);
        return;
      }

      // Group by category for preview
      const { CATEGORY_KEYS, getCategoryLabel } = require('./categories');
      const grouped: Record<string, any[]> = {};
      data.forEach((item: any) => {
        if (!grouped[item.category]) grouped[item.category] = [];
        grouped[item.category].push(item);
      });

      let msg = `✅ <b>Item Disetujui (${command}):</b>\n\n`;
      const allCats = [...CATEGORY_KEYS, ...Object.keys(grouped).filter(c => !CATEGORY_KEYS.includes(c))];
      
      for (const catKey of allCats) {
        if (grouped[catKey] && grouped[catKey].length > 0) {
          const label = getCategoryLabel ? getCategoryLabel(catKey) : catKey;
          msg += `<b>${label}</b>\n`;
          grouped[catKey].forEach((item: any) => {
            const id = item.display_id || item.id;
            msg += `• ${item.title_for_list} <b>[ID:${id}]</b>\n`;
          });
          msg += '\n';
        }
      }

      // Compute actual date range from items
      const dates = data.map((i: any) => i.telegram_post_date?.split('T')[0]).filter(Boolean).sort();
      const actualStart = dates[0] || startDateStr;
      const actualEnd = dates[dates.length - 1] || endDateStr;
      
      const inlineKeyboard = {
        inline_keyboard: [
          [{ text: `📝 Buat Rekap Final (${command})`, callback_data: `gen_recap_${actualStart}_${actualEnd}` }],
          [{ text: `🗑️ Hapus Item dari Daftar`, callback_data: `del_mode_${startDateStr}_${endDateStr}` }]
        ]
      };
      

      await sendMessage(chatId, msg, { reply_markup: inlineKeyboard });
    }
    else if (command === '/status') {
      const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(new Date());
      const { data, error } = await supabaseAdmin.from('parsed_items').select('status, telegram_post_date');
      if (error) throw error;
      
      const items = data || [];
      const todayItems = items.filter(i => i.telegram_post_date === today);
      
      const msg = `📊 <b>System Status</b>\n\n` +
      `<b>Today:</b>\n` +
      `- Detected: ${todayItems.length}\n` +
      `- Pending: ${todayItems.filter(i => i.status === 'pending').length}\n` +
      `- Approved: ${todayItems.filter(i => i.status === 'approved').length}\n` +
      `- Skipped: ${todayItems.filter(i => i.status === 'skipped').length}\n\n` +
      `<b>All Time:</b>\n` +
      `- Total Pending: ${items.filter(i => i.status === 'pending').length}\n`;
      
      const inlineKeyboard = {
        inline_keyboard: [
          [
            { text: '👁️ Pending (Today)', callback_data: `view_status_pending` },
            { text: '👁️ Approved (Today)', callback_data: `view_status_approved` }
          ],
          [
            { text: '👁️ Skipped (Today)', callback_data: `view_status_skipped` }
          ]
        ]
      };
      
      await sendMessage(chatId, msg, { reply_markup: inlineKeyboard });
    }
    else if (command === '/import') {
      const lines = text.split('\n').slice(1).map(l => l.trim()).filter(l => l.length > 0);
      if (lines.length === 0) {
        await sendMessage(chatId, `Usage:\n/import [approve]\nCATEGORY | Project Name | Link\nCATEGORY | Project 2 | Link`);
        return;
      }
      
      const autoApprove = parts[1]?.toLowerCase() === 'approve';
      let added = 0;
      for (const line of lines) {
        const p = line.split('|').map(s => s.trim());
        if (p.length === 3) {
          const cat = resolveCategoryAlias(p[0]);
          await supabaseAdmin.from('parsed_items').insert({
            source_channel: 'admin_import',
            message_id: Date.now() + added,
            source_link: p[2],
            original_text: line,
            category: cat,
            project_name: p[1],
            title_for_list: p[1],
            summary: 'Bulk import',
            action: 'Bulk import',
            confidence: 1,
            status: autoApprove ? 'approved' : 'pending',
            reason: 'Manually imported by admin',
            telegram_post_date: new Date().toISOString()
          });
          added++;
        }
      }
      await sendMessage(chatId, `✅ Imported ${added} items as ${autoApprove ? 'approved' : 'pending'}.`);
    }
    else if (command === '/add') {
      if (parts.length > 1) {
        // One-line format: /add CATEGORY | Project Name | Link
        const payloadStr = text.replace('/add ', '').trim();
        const p = payloadStr.split('|').map(s => s.trim());
        if (p.length === 3) {
          const sourceLink = p[2];
          // Auto-detect original post date from t.me link
          const originalDate = await fetchTelegramMessageDate(sourceLink);
          const telegramPostDate = originalDate ? originalDate.toISOString() : new Date().toISOString();
          const dateInfo = originalDate ? `📅 Tanggal terdeteksi: ${originalDate.toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })}` : '📅 Tanggal: sekarang (link bukan dari Telegram)';

          const { data } = await supabaseAdmin.from('parsed_items').insert({
            source_channel: 'admin_manual', message_id: Date.now(), source_link: sourceLink, original_text: payloadStr,
            category: resolveCategoryAlias(p[0]), project_name: p[1], title_for_list: p[1],
            summary: 'Manual entry', action: 'Manual entry', confidence: 1, status: 'pending', reason: 'Manually added by admin',
            telegram_post_date: telegramPostDate
          }).select().single();
          await sendMessage(chatId, `✅ Item berhasil ditambahkan!\n${dateInfo}\nID: ${data?.display_id || data?.id}`);
          if (data) await sendAdminItemPreview(data as DatabaseParsedItem, chatId);
        } else {
          await sendMessage(chatId, `Format: /add KATEGORI | Nama Project | Link\nAtau ketik /add untuk wizard.`);
        }
      } else {
        // Guided wizard start
        await supabaseAdmin.from('admin_sessions').upsert({ admin_id: userId, flow: 'add', step: 'category', payload: {} });
        await sendMessage(chatId, `🧙‍♂️ <b>Wizard Tambah Project</b>\n\nPilih kategori:`, { reply_markup: getCategoryKeyboard('wizard') });
      }
    }
    else if (command === '/settings') {
      const { count: totalItems } = await supabaseAdmin
        .from('parsed_items')
        .select('*', { count: 'exact', head: true });

      const msg = `⚙️ <b>Pengaturan Bot</b>\n\n` +
      `<b>Source Channel:</b> ${process.env.TELEGRAM_SOURCE_CHANNELS}\n` +
      `<b>Model AI:</b> ${process.env.GEMINI_MODEL}\n` +
      `<b>Jumlah Admin:</b> ${(process.env.TELEGRAM_ADMIN_IDS || '').split(',').length}\n` +
      `<b>Total Item di DB:</b> ${totalItems || 0}\n\n` +
      `<b>Kebijakan Retensi Data:</b>\n` +
      `- Skipped: dihapus setelah <b>7 hari</b>\n` +
      `- Pending kadaluarsa: dihapus setelah <b>14 hari</b>\n` +
      `- Approved: disimpan <b>6 bulan</b>\n` +
      `- Log aksi: dihapus setelah <b>30 hari</b>\n\n` +
      `<i>Auto-cleanup berjalan setiap hari pukul 08:00 WIB</i>`;
      await sendMessage(chatId, msg);
    }
    else if (command === '/undo') {
      const { data, error } = await supabaseAdmin.from('action_logs')
        .select('*').eq('admin_id', userId).order('created_at', { ascending: false }).limit(1).single();
      if (error || !data) {
        await sendMessage(chatId, `No recent actions found to undo.`);
        return;
      }
      
      const { target_item_id, previous_state } = data;
      await supabaseAdmin.from('parsed_items').update(previous_state).eq('id', target_item_id);
      
      // Delete the log so it can't be undone twice
      await supabaseAdmin.from('action_logs').delete().eq('id', data.id);
      
      await sendMessage(chatId, `✅ Undo successful! Item status reverted.`);
    }
    else {
      await sendMessage(chatId, 'Unknown command. Use /review, /today, /week, /status, /import, /add, /undo, /settings.');
    }
  } catch (error: any) {
    console.error('Command Error:', error);
    await sendMessage(chatId, `Error executing command: ${error.message}`);
  }
};

export const showNextReviewItem = async (chatId: number, editMessageId?: number) => {
  const { data, error } = await supabaseAdmin
    .from('parsed_items')
    .select('*')
    .eq('status', 'pending')
    .order('created_at', { ascending: true })
    .limit(1)
    .single();

  if (error || !data) {
    const text = '🎉 All pending items reviewed! No pending items left.';
    if (editMessageId) {
      await sendMessage(chatId, text); // Don't edit into "All done", send a new one so the old card disappears? No, better to edit.
      // Wait, let's edit the card to say all done.
      const { editMessageText } = require('./telegram');
      await editMessageText(chatId, editMessageId, text);
    } else {
      await sendMessage(chatId, text);
    }
    return;
  }
  
  await sendAdminItemPreview(data as DatabaseParsedItem, chatId, editMessageId);
};

export const processSessionStep = async (chatId: number, userId: number, text: string, session: any) => {
  try {
    if (text.toLowerCase() === '/cancel') {
      await supabaseAdmin.from('admin_sessions').delete().eq('admin_id', userId);
      await sendMessage(chatId, '❌ Action cancelled.');
      return;
    }

    if (session.flow === 'add') {
      if (session.step === 'name') {
        const payload = { ...session.payload, name: text };
        await supabaseAdmin.from('admin_sessions').update({ step: 'link', payload }).eq('admin_id', userId);
        await sendMessage(chatId, `Project name set to: <b>${text}</b>\n\nNow send the source link:`, { parse_mode: 'HTML' });
      } 
      else if (session.step === 'link') {
        const payload = session.payload;
        const sourceLink = text;
        // Auto-detect original post date from t.me link
        const originalDate = await fetchTelegramMessageDate(sourceLink);
        const telegramPostDate = originalDate ? originalDate.toISOString() : new Date().toISOString();
        const dateInfo = originalDate
          ? `📅 Tanggal terdeteksi: ${originalDate.toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })}`
          : '📅 Tanggal: sekarang';

        const { data } = await supabaseAdmin.from('parsed_items').insert({
          source_channel: 'admin_manual', message_id: Date.now(), source_link: sourceLink, original_text: `Manual addition`,
          category: payload.category, project_name: payload.name, title_for_list: payload.name,
          summary: 'Manual entry', action: 'Manual entry', confidence: 1, status: 'pending', reason: 'Wizard',
          telegram_post_date: telegramPostDate
        }).select().single();
        
        await supabaseAdmin.from('admin_sessions').delete().eq('admin_id', userId);
        await sendMessage(chatId, `✅ Wizard selesai! ${dateInfo}\nID: ${data?.display_id || data?.id}`);
        if (data) await sendAdminItemPreview(data as DatabaseParsedItem, chatId);
      }
    }
    else if (session.flow === 'edit') {
      if (session.step === 'name') {
        const itemId = session.payload.item_id;
        
        // Get previous state
        const { data: item } = await supabaseAdmin.from('parsed_items').select('*').eq('id', itemId).single();
        if (item) {
          await logAction(userId, 'edit_name', itemId, { title_for_list: item.title_for_list }, { title_for_list: text });
          await supabaseAdmin.from('parsed_items').update({ title_for_list: text }).eq('id', itemId);
          await sendMessage(chatId, `✅ Name updated to: <b>${text}</b>`, { parse_mode: 'HTML' });
        }
        
        await supabaseAdmin.from('admin_sessions').delete().eq('admin_id', userId);
        
        // Return to review
        if (session.payload.return_to_review) {
          await showNextReviewItem(chatId, session.payload.message_id);
        }
      } 
      else if (session.step === 'date') {
        const itemId = session.payload.item_id;
        const dateInput = text.trim();
        
        // Basic date parsing helper
        const parseInputDate = (str: string): Date | null => {
          const d = new Date(str);
          if (!isNaN(d.getTime())) return d;
          // Try "1 May" format
          const currentYear = new Date().getFullYear();
          const d2 = new Date(`${str} ${currentYear}`);
          if (!isNaN(d2.getTime())) return d2;
          return null;
        };

        const newDate = parseInputDate(dateInput);
        if (!newDate) {
          await sendMessage(chatId, `❌ Format tanggal tidak dikenali. Coba: <code>1 May</code> atau <code>2026-05-01</code>`, { parse_mode: 'HTML' });
          return;
        }

        const { data: item } = await supabaseAdmin.from('parsed_items').select('*').eq('id', itemId).single();
        if (item) {
          await logAction(userId, 'edit_date', itemId, { telegram_post_date: item.telegram_post_date }, { telegram_post_date: newDate.toISOString() });
          await supabaseAdmin.from('parsed_items').update({ telegram_post_date: newDate.toISOString() }).eq('id', itemId);
          await sendMessage(chatId, `✅ Tanggal <b>${item.title_for_list}</b> berhasil diupdate ke: <b>${newDate.toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })}</b>`, { parse_mode: 'HTML' });
        }
        
        await supabaseAdmin.from('admin_sessions').delete().eq('admin_id', userId);
        if (session.payload.return_to_review) {
          await showNextReviewItem(chatId, session.payload.message_id);
        }
      }
      else {
        await sendMessage(chatId, `Please use the buttons above or type /cancel to abort.`);
      }
    } else {
      await sendMessage(chatId, `Please use the buttons above or type /cancel to abort.`);
    }
  } catch (error: any) {
    console.error('Session Error:', error);
    await sendMessage(chatId, `Wizard Error: ${error.message}\nType /cancel to abort.`);
  }
};
