import { supabaseAdmin } from './supabaseAdmin';
import { sendMessage, sendAdminRecapDraft, sendAdminItemPreview } from './telegram';
import { generateRecapDraft } from './recapGenerator';
import { DatabaseParsedItem } from '@/types';

export const handleAdminCommand = async (chatId: number, text: string) => {
  const parts = text.split(' ');
  const command = parts[0].toLowerCase();

  try {
    if (command === '/pending') {
      const { data, error } = await supabaseAdmin
        .from('parsed_items')
        .select('*')
        .eq('status', 'pending')
        .order('created_at', { ascending: false })
        .limit(5);

      if (error) throw error;
      if (!data || data.length === 0) {
        await sendMessage(chatId, 'No pending items.');
        return;
      }
      
      for (const item of data) {
        await sendAdminItemPreview(item as DatabaseParsedItem);
      }
    } 
    else if (command === '/approve' && parts[1]) {
      const itemId = parts[1];
      const { error } = await supabaseAdmin.from('parsed_items').update({ status: 'approved' }).eq('id', itemId);
      if (error) throw error;
      await sendMessage(chatId, `✅ Item ${itemId} approved.`);
    }
    else if (command === '/skip' && parts[1]) {
      const itemId = parts[1];
      const { error } = await supabaseAdmin.from('parsed_items').update({ status: 'skipped' }).eq('id', itemId);
      if (error) throw error;
      await sendMessage(chatId, `❌ Item ${itemId} skipped.`);
    }
    else if (command === '/move' && parts[1] && parts[2]) {
      const itemId = parts[1];
      const newCategory = parts[2].toUpperCase();
      const { error } = await supabaseAdmin.from('parsed_items').update({ category: newCategory }).eq('id', itemId);
      if (error) throw error;
      await sendMessage(chatId, `🔁 Item ${itemId} moved to ${newCategory}.`);
    }
    else if (command === '/edit' && parts[1] && parts.length > 2) {
      const itemId = parts[1];
      const newTitle = parts.slice(2).join(' ');
      const { error } = await supabaseAdmin.from('parsed_items').update({ title_for_list: newTitle }).eq('id', itemId);
      if (error) throw error;
      await sendMessage(chatId, `✏️ Item ${itemId} title updated to: ${newTitle}`);
    }
    else if ((command === '/recap' || command === '/preview') && parts[1] && parts[2]) {
      const startDate = parts[1];
      const endDate = parts[2];
      const recapDraft = await generateRecapDraft(startDate, endDate);
      await sendAdminRecapDraft(recapDraft);
    }
    else if (command === '/generate' && parts[1] && parts[2]) {
        // Alias for /recap
        const startDate = parts[1];
        const endDate = parts[2];
        const recapDraft = await generateRecapDraft(startDate, endDate);
        await sendAdminRecapDraft(recapDraft);
    }
    else if (command === '/add') {
        // /add CATEGORY | Project Name | Source Link
        const payloadStr = text.replace('/add ', '').trim();
        const payloadParts = payloadStr.split('|').map(s => s.trim());
        if (payloadParts.length === 3) {
            const category = payloadParts[0].toUpperCase();
            const projectName = payloadParts[1];
            const sourceLink = payloadParts[2];
            
            const newItem = {
                source_channel: 'admin_manual',
                message_id: Date.now(), // dummy
                source_link: sourceLink,
                original_text: 'Manual addition',
                category: category,
                project_name: projectName,
                title_for_list: projectName,
                summary: 'Manual entry',
                action: 'Manual entry',
                confidence: 1,
                status: 'pending',
                reason: 'Manually added by admin',
                telegram_post_date: new Date().toISOString()
            };
            
            const { data, error } = await supabaseAdmin.from('parsed_items').insert(newItem).select().single();
            if (error) throw error;
            await sendMessage(chatId, `✅ Item manually added! ID: ${data.id}`);
            await sendAdminItemPreview(data as DatabaseParsedItem);
        } else {
            await sendMessage(chatId, `Usage: /add CATEGORY | Project Name | Source Link`);
        }
    }
    else if (command === '/skipped' && parts[1] && parts[2]) {
        const startDate = parts[1];
        const endDate = parts[2];
        const endDateTime = `${endDate}T23:59:59.999Z`;
        const { data, error } = await supabaseAdmin
            .from('parsed_items')
            .select('*')
            .eq('status', 'skipped')
            .gte('telegram_post_date', `${startDate}T00:00:00.000Z`)
            .lte('telegram_post_date', endDateTime)
            .order('telegram_post_date', { ascending: true });
            
        if (error) throw error;
        if (!data || data.length === 0) {
            await sendMessage(chatId, `No skipped items found between ${startDate} and ${endDate}.`);
            return;
        }
        
        let msg = `❌ Skipped Items (${startDate} to ${endDate}):\n\n`;
        for (const item of data) {
            msg += `- [${item.category}] ${item.title_for_list} (ID: ${item.id})\n`;
        }
        await sendMessage(chatId, msg);
    }
    else if (command === '/restore' && parts[1]) {
        const itemId = parts[1];
        const { error } = await supabaseAdmin.from('parsed_items').update({ status: 'pending' }).eq('id', itemId);
        if (error) throw error;
        await sendMessage(chatId, `✅ Item ${itemId} restored to pending.`);
    }
    else {
      await sendMessage(chatId, 'Unknown command or missing parameters.');
    }
  } catch (error: any) {
    console.error('Command Error:', error);
    await sendMessage(chatId, `Error executing command: ${error.message}`);
  }
};
