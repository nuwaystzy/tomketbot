import { supabaseAdmin } from './supabaseAdmin';
import { sendMessage, sendAdminRecapDraft, sendAdminItemPreview, getCategoryKeyboard } from './telegram';
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
  // Check active session first
  const { data: session } = await supabaseAdmin.from('admin_sessions').select('*').eq('admin_id', userId).single();
  if (session) {
    await processSessionStep(chatId, userId, text, session);
    return;
  }

  const parts = text.split(' ');
  const command = parts[0].toLowerCase();

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
      
      let startDateStr;
      let endDateStr = new Date().toISOString().split('T')[0];
      
      if (isWeek) {
        const d = new Date();
        const day = d.getDay() || 7; 
        d.setHours(-24 * (day - 1));
        startDateStr = d.toISOString().split('T')[0];
      } else {
        startDateStr = endDateStr;
      }

      const { data, error } = await supabaseAdmin
        .from('parsed_items')
        .select('*')
        .eq('status', 'approved')
        .gte('telegram_post_date', `${startDateStr}T00:00:00.000Z`);
        
      if (error) throw error;
      if (!data || data.length === 0) {
        await sendMessage(chatId, `No approved items found for ${command}.`);
        return;
      }

      let msg = `✅ <b>Approved Items (${command}):</b>\n\n`;
      data.forEach(item => {
        msg += `- [${item.category}] ${item.title_for_list}\n`;
      });
      
      const inlineKeyboard = {
        inline_keyboard: [
          [{ text: `📝 Generate Final Recap (${command})`, callback_data: `gen_recap_${startDateStr}_${endDateStr}` }]
        ]
      };
      
      await sendMessage(chatId, msg, { reply_markup: inlineKeyboard });
    }
    else if (command === '/status') {
      const today = new Date().toISOString().split('T')[0];
      const { data, error } = await supabaseAdmin.from('parsed_items').select('status, date_found');
      if (error) throw error;
      
      const items = data || [];
      const todayItems = items.filter(i => i.date_found === today);
      
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
        // One-line format
        const payloadStr = text.replace('/add ', '').trim();
        const p = payloadStr.split('|').map(s => s.trim());
        if (p.length === 3) {
          const { data } = await supabaseAdmin.from('parsed_items').insert({
            source_channel: 'admin_manual', message_id: Date.now(), source_link: p[2], original_text: payloadStr,
            category: resolveCategoryAlias(p[0]), project_name: p[1], title_for_list: p[1],
            summary: 'Manual entry', action: 'Manual entry', confidence: 1, status: 'pending', reason: 'Manually added by admin',
            telegram_post_date: new Date().toISOString()
          }).select().single();
          await sendMessage(chatId, `✅ Item manually added! ID: ${data?.display_id || data?.id}`);
          if (data) await sendAdminItemPreview(data as DatabaseParsedItem, chatId);
        } else {
          await sendMessage(chatId, `Usage: /add CATEGORY | Project Name | Source Link\nOr just /add for guided wizard.`);
        }
      } else {
        // Guided wizard start
        await supabaseAdmin.from('admin_sessions').upsert({ admin_id: userId, flow: 'add', step: 'category', payload: {} });
        await sendMessage(chatId, `🧙‍♂️ <b>Add Project Wizard</b>\n\nPlease select a category:`, getCategoryKeyboard('wizard'));
      }
    }
    else if (command === '/settings') {
      const msg = `⚙️ <b>Settings</b>\n\n` +
      `- Source Channels: ${process.env.TELEGRAM_SOURCE_CHANNELS}\n` +
      `- Gemini Model: ${process.env.GEMINI_MODEL}\n` +
      `- Admin Count: ${(process.env.TELEGRAM_ADMIN_IDS || '').split(',').length}\n`;
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
        const { data } = await supabaseAdmin.from('parsed_items').insert({
          source_channel: 'admin_manual', message_id: Date.now(), source_link: text, original_text: `Manual addition`,
          category: payload.category, project_name: payload.name, title_for_list: payload.name,
          summary: 'Manual entry', action: 'Manual entry', confidence: 1, status: 'pending', reason: 'Wizard',
          telegram_post_date: new Date().toISOString()
        }).select().single();
        
        await supabaseAdmin.from('admin_sessions').delete().eq('admin_id', userId);
        await sendMessage(chatId, `✅ Wizard Complete! Item added with ID: ${data?.display_id || data?.id}`);
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
    }
  } catch (error: any) {
    console.error('Session Error:', error);
    await sendMessage(chatId, `Wizard Error: ${error.message}\nType /cancel to abort.`);
  }
};
