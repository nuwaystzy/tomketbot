import { TelegramUpdate, TelegramMessage, DatabaseParsedItem } from '@/types';
import { parseWithGemini } from './gemini';
import { supabaseAdmin } from './supabaseAdmin';
import { sendAdminItemPreview, isAdmin } from './telegram';

const TELEGRAM_SOURCE_CHANNELS = (process.env.TELEGRAM_SOURCE_CHANNELS || '').split(',').map(c => c.trim().toLowerCase());

// Rule-based prefilter - lax enough to catch all legit posts
const isPotentiallyActionable = (text: string): boolean => {
  if (!text) return false;
  
  const lowerText = text.toLowerCase();

  // Always pass if it contains a URL
  if (text.includes('http') || text.includes('t.me/') || text.includes('.xyz') || text.includes('.io') || text.includes('.com')) {
    return true;
  }

  // Always pass if short #hashtag message (might be a tag-only update)
  if (text.startsWith('#')) return true;

  // Skip very short messages without links
  if (text.length < 20) return false;

  // Broad keyword check (multi-language)
  const actionKeywords = [
    // English
    'new', 'join', 'claim', 'mint', 'testnet', 'waitlist', 'node', 'airdrop', 'task',
    'point', 'register', 'submit', 'faucet', 'update', 'launch', 'live', 'open', 'now',
    'reward', 'eligible', 'snapshot', 'allocation', 'phase', 'season', 'check',
    // Indonesian
    'daftar', 'cek', 'klaim', 'hadiah', 'gratis', 'bergabung', 'ayo', 'ikut', 'migrasi',
    'alokasi', 'snapshot', 'eligibel', 'mainnet', 'airdrop'
  ];
  const hasKeyword = actionKeywords.some(kw => lowerText.includes(kw));
  if (hasKeyword) return true;

  // Hard-skip only pure social phrases
  const hardSkip = ['good morning', 'selamat pagi', 'gm ', '^gm$', '^gn$', 'market crash'];
  if (hardSkip.some(phrase => lowerText.includes(phrase))) return false;

  // Default: pass if longer than 100 chars (let AI decide)
  return text.length > 100;
};

export const parseTelegramPost = async (update: TelegramUpdate) => {
  const message: TelegramMessage | undefined = update.channel_post || update.edited_channel_post || update.message;
  
  if (!message) return;

  const channelUsername = message.chat.username?.toLowerCase();
  const chatId = message.chat.id;
  const text = message.text || message.caption || '';
  const messageId = message.message_id;
  const isDM = message.chat.type === 'private';

  // Log to console (not to Telegram DM)
  console.log(`[FILTER] msg_id=${messageId} channel=${channelUsername || chatId} isDM=${isDM} textLen=${text.length}`);

  // Channel whitelist check
  if (!isDM) {
    if (!channelUsername && !TELEGRAM_SOURCE_CHANNELS.includes(chatId.toString())) {
      console.log(`[FILTER] Dropped: not whitelisted private channel ${chatId}`);
      return;
    }
    if (channelUsername && TELEGRAM_SOURCE_CHANNELS.length > 0 && !TELEGRAM_SOURCE_CHANNELS.includes(channelUsername)) {
      console.log(`[FILTER] Dropped: not whitelisted channel @${channelUsername}`);
      return;
    }
  } else {
    if (!isAdmin(message.from?.id || 0)) return;
  }

  if (!text) {
    console.log(`[FILTER] Dropped: no text`);
    return;
  }

  const sourceLink = channelUsername ? `https://t.me/${channelUsername}/${messageId}` : `DM`;
  const telegramPostDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(new Date(message.date * 1000));

  // 1. Rule-based prefilter
  if (!isPotentiallyActionable(text)) {
    console.log(`[FILTER] Prefilter dropped msg_id=${messageId}`);
    await supabaseAdmin.from('parsed_items').insert({
      source_channel: channelUsername || chatId.toString(),
      message_id: messageId,
      source_link: sourceLink,
      original_text: text,
      category: 'SKIP',
      project_name: 'Prefiltered',
      title_for_list: 'Prefiltered',
      summary: 'Dropped by prefilter',
      action: null,
      confidence: 0,
      status: 'skipped',
      reason: 'Prefilter: no keywords or URL',
      telegram_post_date: telegramPostDate
    });
    return;
  }

  // 2. Force #update tag - mark before AI call
  const isUpdateTag = text.toLowerCase().includes('#update') || text.toLowerCase().includes('#info');

  // 3. Call Gemini AI
  const promptInput = `Source Channel: ${channelUsername ? '@' + channelUsername : chatId}
Message ID: ${messageId}
Source Link: ${sourceLink}
Message Text:
${text}`;

  console.log(`[FILTER] Calling Gemini for msg_id=${messageId}...`);
  const { data, error, rawResponse, model } = await parseWithGemini(promptInput);

  let itemsToSave: DatabaseParsedItem[] = [];

  if (error || !data || !data.items || data.items.length === 0) {
    // REGEX FALLBACK: If Gemini fails, try to parse manually
    const u = text.toUpperCase();
    const urlMatch = text.match(/https?:\/\/[^\s]+/);
    
    if (urlMatch) {
      console.log(`[FILTER] Gemini failed, using Regex Fallback for msg_id=${messageId}`);
      const url = urlMatch[0];
      const lines = text.split('\n').filter(l => l.trim().length > 0);
      const name = lines[0].substring(0, 30).trim() || 'Project';
      
      let cat = 'AIRDROP';
      if (u.includes('WAITLIST') || u.includes('WL ')) cat = 'WL_EARLY_ACCESS';
      else if (u.includes('TESTNET') || u.includes('FAUCET')) cat = 'TESTNET';
      else if (u.includes('CLAIM') || u.includes('CHECK')) cat = 'CLAIM_CHECK_ELIGIBLE';
      else if (u.includes('NODE')) cat = 'NODE';
      else if (u.includes('UPDATE') || u.includes('INFO') || u.includes('MIGRATION')) cat = 'UPDATE';

      itemsToSave.push({
        source_channel: channelUsername || chatId.toString(),
        message_id: messageId,
        source_link: sourceLink,
        original_text: text,
        category: cat as any,
        project_name: name,
        title_for_list: name,
        summary: text.substring(0, 150).replace(/\n/g, ' '),
        action: `Visit ${url}`,
        confidence: 0.86,
        status: 'approved', // AUTO-APPROVE if URL found
        reason: 'Auto-detected via Regex Fallback',
        raw_ai_response: rawResponse,
        ai_model: 'regex-fallback',
        raw_update: update,
        telegram_post_date: telegramPostDate
      });
    } else {
      // Final fallback to manual review
      itemsToSave.push({
        source_channel: channelUsername || chatId.toString(),
        message_id: messageId,
        source_link: sourceLink,
        original_text: text,
        category: 'PENDING_REVIEW',
        project_name: '⚠️ Perlu Review Manual',
        title_for_list: '⚠️ Perlu Review Manual',
        summary: `Teks asli: ${text.substring(0, 200)}`,
        action: null,
        confidence: 0,
        status: 'pending',
        reason: error ? `AI Error: ${error.substring(0, 200)}` : 'AI tidak memberi respons valid',
        raw_ai_response: rawResponse,
        ai_model: model,
        ai_error: error,
        raw_update: update,
        telegram_post_date: telegramPostDate
      });
    }
  } else {
    data.items.forEach(item => {
      const forceValid = isUpdateTag;
      const shouldSkip = !forceValid && (!item.is_valid || item.category === 'SKIP');

      if (shouldSkip) {
        // Save as skipped (visible in /status → Skipped)
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
        return;
      }

      // Determine final category
      let finalCategory = item.category;
      if (forceValid && (item.category === 'SKIP' || !item.category)) {
        finalCategory = 'UPDATE';
      }

      // AUTO-APPROVE LOGIC:
      // If confidence >= 0.85 and has a valid project name, approve automatically
      const confidence = item.confidence || 0;
      const hasValidName = item.project_name && item.project_name !== 'Unknown';
      const isHighlyConfident = confidence >= 0.85 && hasValidName;
      const status = isHighlyConfident ? 'approved' : 'pending';
      const autoInfo = isHighlyConfident ? ' [AUTO-APPROVED]' : '';

      itemsToSave.push({
        source_channel: channelUsername || chatId.toString(),
        message_id: messageId,
        source_link: sourceLink,
        original_text: text,
        category: finalCategory,
        project_name: item.project_name || (forceValid ? 'Update' : 'Unknown'),
        title_for_list: item.title_for_list || (forceValid ? 'Update' : 'Unknown'),
        summary: item.summary,
        action: item.action,
        confidence: confidence,
        status: status,
        reason: (forceValid && !item.reason ? 'Forced by #update/#info tag' : item.reason) + autoInfo,
        raw_ai_response: rawResponse,
        ai_model: model,
        ai_error: null,
        raw_update: update,
        telegram_post_date: telegramPostDate
      });
    });
  }

  // 4. Save to Supabase and notify Admin
  for (const item of itemsToSave) {
    try {
      const { data: insertedItem, error: dbError } = await supabaseAdmin
        .from('parsed_items')
        .insert(item)
        .select()
        .single();
        
      if (dbError) {
        if (dbError.code === '23505') {
          console.log(`[FILTER] Duplicate: ${item.source_link}`);
        } else {
          console.error('[FILTER] Supabase insert error:', dbError);
        }
      } else if (insertedItem) {
        if (item.status === 'pending') {
          await sendAdminItemPreview(insertedItem as DatabaseParsedItem);
        }
      }
    } catch (e) {
      console.error('[FILTER] DB operation failed:', e);
    }
  }
};
