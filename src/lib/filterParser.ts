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
  const chatId = message.chat.id;
  
  // Only process if it's from a whitelisted channel OR if it's sent directly to the bot in DM by an admin
  const isDM = message.chat.type === 'private';
  
  if (!isDM) {
    if (!channelUsername && !TELEGRAM_SOURCE_CHANNELS.includes(chatId.toString())) {
      return; // Not whitelisted private channel
    }
    
    if (channelUsername && TELEGRAM_SOURCE_CHANNELS.length > 0 && !TELEGRAM_SOURCE_CHANNELS.includes(channelUsername)) {
      return; // Not a whitelisted public channel
    }
  } else {
    // If it's a DM, ensure it's from an admin
    const { isAdmin } = require('./telegram');
    if (!isAdmin(message.from?.id || 0)) return;
  }

  const text = message.text || message.caption || '';
  if (!text) return;

  const messageId = message.message_id;
  const sourceLink = channelUsername ? `https://t.me/${channelUsername}/${messageId}` : `Direct Message`;
  const telegramPostDate = new Date(message.date * 1000).toISOString();

  // 1. Rule-based prefilter
  if (!isPotentiallyActionable(text)) {
    // Save as skipped
    await supabaseAdmin.from('parsed_items').insert({
      source_channel: channelUsername || chatId.toString(),
      message_id: messageId,
      source_link: sourceLink,
      original_text: text,
      category: 'SKIP',
      project_name: 'Prefiltered',
      title_for_list: 'Prefiltered',
      summary: 'Dropped by prefilter (no links/keywords)',
      action: 'None',
      confidence: 0,
      status: 'skipped',
      reason: 'Prefilter: Not actionable',
      telegram_post_date: telegramPostDate
    });
    return;
  }

  // 2. Call Gemini
  const promptInput = `
Source Channel: ${channelUsername ? '@' + channelUsername : chatId}
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
      source_channel: channelUsername || chatId.toString(),
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
         if (item.category === 'PENDING_REVIEW') {
             itemsToSave.push({
                source_channel: channelUsername || chatId.toString(),
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
         } else {
             // Save AI skips so admin can see them in /status -> Skipped
             itemsToSave.push({
                source_channel: channelUsername || chatId.toString(),
                message_id: messageId,
                source_link: sourceLink,
                original_text: text,
                category: item.category || 'SKIP',
                project_name: item.project_name || 'Unknown',
                title_for_list: item.title_for_list || 'Unknown',
                summary: item.summary,
                action: item.action,
                confidence: item.confidence,
                status: 'skipped',
                reason: item.reason || 'AI classified as SKIP',
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
        source_channel: channelUsername || chatId.toString(),
        message_id: messageId,
        source_link: sourceLink,
        original_text: text,
        category: item.category,
        project_name: item.project_name,
        title_for_list: item.title_for_list,
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
