import { TelegramUpdate, TelegramMessage, DatabaseParsedItem } from '@/types';
import { parseWithGemini } from './gemini';
import { supabaseAdmin } from './supabaseAdmin';
import { sendAdminItemPreview } from './telegram';

const TELEGRAM_SOURCE_CHANNELS = (process.env.TELEGRAM_SOURCE_CHANNELS || '').split(',').map(c => c.trim().toLowerCase());

// Rule-based prefilter to save API quota
const isPotentiallyActionable = (text: string): boolean => {
  if (!text) return false;
  
  const lowerText = text.toLowerCase();
  
  // Skip very short messages without links
  if (text.length < 20 && !text.includes('http') && !text.includes('t.me')) return false;

  // Simple keyword check
  const actionKeywords = ['new', 'join', 'claim', 'mint', 'testnet', 'waitlist', 'node', 'airdrop', 'task', 'point', 'register', 'submit', 'faucet', 'update'];
  const hasKeyword = actionKeywords.some(kw => lowerText.includes(kw));
  
  if (!hasKeyword && !text.includes('http')) {
    return false;
  }

  // Known skip phrases
  const skipPhrases = ['good morning', 'gm', 'gn', 'market crash', 'btc', 'eth', 'wkwk', 'haha', 'lol', 'lmao'];
  if (skipPhrases.some(phrase => lowerText === phrase)) {
      return false;
  }

  return true;
};

export const parseTelegramPost = async (update: TelegramUpdate) => {
  const message: TelegramMessage | undefined = update.channel_post || update.edited_channel_post || update.message;
  
  if (!message) return;

  const channelUsername = message.chat.username?.toLowerCase();
  if (!channelUsername) return; // Only process public channels with usernames or adapt for private if ID based

  if (TELEGRAM_SOURCE_CHANNELS.length > 0 && !TELEGRAM_SOURCE_CHANNELS.includes(channelUsername)) {
    return; // Not a whitelisted channel
  }

  const text = message.text || message.caption || '';
  if (!text) return;

  const messageId = message.message_id;
  const sourceLink = `https://t.me/${channelUsername}/${messageId}`;
  const telegramPostDate = new Date(message.date * 1000).toISOString();

  // 1. Rule-based prefilter
  if (!isPotentiallyActionable(text)) {
    // We can just drop it to save db space/api, or log it if needed
    return;
  }

  // 2. Call Gemini
  const promptInput = `
Source Channel: @${channelUsername}
Message ID: ${messageId}
Source Link: ${sourceLink}
Message Text:
${text}
`;

  const { data, error, rawResponse, model } = await parseWithGemini(promptInput);

  let itemsToSave: DatabaseParsedItem[] = [];

  if (error || !data || !data.items || data.items.length === 0) {
    // Fallback: save as pending review
    itemsToSave.push({
      source_channel: channelUsername,
      message_id: messageId,
      source_link: sourceLink,
      original_text: text,
      category: 'PENDING_REVIEW',
      project_name: 'Unknown',
      title_for_list: 'Unknown',
      summary: null,
      action: null,
      confidence: 0,
      status: 'pending',
      reason: error ? 'Gemini Error: ' + error : 'Invalid AI Response',
      raw_ai_response: rawResponse,
      ai_model: model,
      ai_error: error,
      raw_update: update,
      telegram_post_date: telegramPostDate
    });
  } else {
    data.items.forEach(item => {
      // Skip logic from AI
      if (!item.is_valid || item.category === 'SKIP') {
         // We might not save SKIPs to keep db clean, but user requested recap to filter SKIP out, meaning they might be saved.
         // Let's only save valid or pending ones to save DB size, unless we want to track everything.
         // Actually, let's just drop SKIPs to save space, but if requested, save as 'skipped'.
         // The prompt says: "Bot harus mengabaikan pesan yang bukan new project/campaign."
         // Let's drop SKIP entirely unless the category is PENDING_REVIEW.
         if (item.category === 'PENDING_REVIEW') {
             itemsToSave.push({
                source_channel: channelUsername,
                message_id: messageId,
                source_link: sourceLink,
                original_text: text,
                category: item.category,
                project_name: item.project_name || 'Unknown',
                title_for_list: item.title_for_list || 'Unknown',
                summary: item.summary,
                action: item.action,
                confidence: item.confidence,
                status: 'pending',
                reason: item.reason,
                raw_ai_response: rawResponse,
                ai_model: model,
                ai_error: null,
                raw_update: update,
                telegram_post_date: telegramPostDate
             });
         }
         return;
      }

      itemsToSave.push({
        source_channel: channelUsername,
        message_id: messageId,
        source_link: sourceLink,
        original_text: text,
        category: item.category,
        project_name: item.project_name,
        title_for_list: item.title_for_list,
        summary: item.summary,
        action: item.action,
        confidence: item.confidence,
        status: 'pending', // all valid items go to pending for admin review
        reason: item.reason,
        raw_ai_response: rawResponse,
        ai_model: model,
        ai_error: null,
        raw_update: update,
        telegram_post_date: telegramPostDate
      });
    });
  }

  // 3. Save to Supabase and notify Admin
  for (const item of itemsToSave) {
    try {
      const { data: insertedItem, error: dbError } = await supabaseAdmin
        .from('parsed_items')
        .insert(item)
        .select()
        .single();
        
      if (dbError) {
        if (dbError.code === '23505') { // Unique violation
          console.log(`Duplicate item detected: ${item.source_link}`);
        } else {
          console.error('Supabase insert error:', dbError);
        }
      } else if (insertedItem) {
        // Send DM to admin
        await sendAdminItemPreview(insertedItem as DatabaseParsedItem);
      }
    } catch (e) {
      console.error('Database operation failed:', e);
    }
  }
};
