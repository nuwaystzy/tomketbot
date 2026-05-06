import { TelegramUpdate, TelegramMessage, DatabaseParsedItem } from '@/types';
import { parseWithGemini } from './gemini';
import { supabaseAdmin } from './supabaseAdmin';
import { sendAdminItemPreview, isAdmin } from './telegram';

const TELEGRAM_SOURCE_CHANNELS = (process.env.TELEGRAM_SOURCE_CHANNELS || '').split(',').map(c => c.trim().toLowerCase());

export const getJakartaDate = (date: Date = new Date()) => {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(date);
};

// Rule-based prefilter - lax enough to catch all legit posts
const isPotentiallyActionable = (text: string): boolean => {
  if (!text) return false;
  
  const lowerText = text.toLowerCase();
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  const firstLine = lines[0] || '';
  const firstLineWords = firstLine.replace(/https?:\/\/\S+/g, '').trim().split(/\s+/).filter(Boolean);

  // Always pass if it contains a URL
  if (text.includes('http') || text.includes('t.me/') || text.includes('.xyz') || text.includes('.io') || text.includes('.com')) {
    // BUT reject if first line is clearly just a social comment + link
    // Patterns: very short (≤4 words) non-project phrases before the URL
    const SOCIAL_COMMENT_PHRASES = [
      'rame tuh', 'cek aja', 'mantap', 'bagus ini', 'keren ini', 'info dong',
      'share dong', 'gimana nih', 'wkwk', 'haha', 'lol', 'check this', 'see this',
      'look at this', 'nice one', 'fyi', 'just sharing', 'share aja',
    ];
    if (SOCIAL_COMMENT_PHRASES.some(p => lowerText.startsWith(p) || lowerText.includes('\n' + p))) {
      return false;
    }
    // Reject if ONLY 1-2 casual words before the link with no project-specific keywords
    if (firstLineWords.length <= 3 && !firstLine.match(/[A-Z][a-z]+[A-Z]|[A-Z]{2,}/)) {
      // First line has no CamelCase or ALL-CAPS word = likely not a project name
      const hasProjectKeyword = ['airdrop', 'waitlist', 'testnet', 'claim', 'mainnet',
        'node', 'wl', 'whitelist', 'mint', 'nft', 'token', 'reward', 'quiz', 'faucet',
        'update', 'launch', 'register', 'season', 'phase'].some(k => lowerText.includes(k));
      if (!hasProjectKeyword) return false;
    }
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
    'quiz', 'form', 'answer',
    // Indonesian
    'daftar', 'cek', 'klaim', 'hadiah', 'gratis', 'bergabung', 'ayo', 'ikut', 'migrasi',
    'alokasi', 'snapshot', 'eligibel', 'mainnet', 'airdrop'
  ];
  const hasKeyword = actionKeywords.some(kw => lowerText.includes(kw));
  if (hasKeyword) return true;

  // Hard-skip pure social phrases
  const hardSkip = [
    'good morning', 'selamat pagi', 'gm ', 'market crash',
    'rame tuh', 'mantap bro', 'keren bro', 'info dong', 'share dong'
  ];
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
  const telegramPostDate = new Date(message.date * 1000).toISOString();

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

  const cleanProjectName = (name: string): string => {
    if (!name) return 'Unknown';
    // Remove emojis and common symbols using a regex that matches extended pictographic characters
    let clean = name.replace(/[\p{Emoji_Presentation}\p{Extended_Pictographic}\uFE0F\u200D🌟✨🔥🚀⭐👍]/gu, '').trim();
    // Remove multiple spaces
    clean = clean.replace(/\s+/g, ' ');
    // Limit to max 4 words
    const words = clean.split(' ');
    if (words.length > 4) {
      clean = words.slice(0, 4).join(' ');
    }
    return clean || 'Unknown';
  };

  if (error || !data || !data.items || data.items.length === 0) {
    // REGEX FALLBACK: If Gemini fails, try to parse manually
    const u = text.toUpperCase();
    const hasLink = text.includes('http') || (message.entities && message.entities.some((e: any) => e.type === 'url' || e.type === 'text_link'));
    const isKeywordRich = ['AIRDROP', 'WL ', 'WAITLIST', 'TESTNET', 'CLAIM', 'UPDATE', 'QUIZ', 'FORM'].some(k => u.includes(k));
    
    if (hasLink || isKeywordRich) {
      console.log(`[FILTER] Gemini failed, using Regex Fallback for msg_id=${messageId}`);
      const urlMatch = text.match(/https?:\/\/[^\s]+/);
      const url = urlMatch ? urlMatch[0] : sourceLink;
      const lines = text.split('\n').filter(l => l.trim().length > 0);
      
      // Better name extraction: use first line, clean it up
      let firstLine = lines[0].replace(/https?:\/\/[^\s]+/g, '').trim();
      if (!firstLine && lines.length > 1) {
        firstLine = lines[1].replace(/https?:\/\/[^\s]+/g, '').trim();
      }
      let name = firstLine.substring(0, 40)
        .replace(/#/g, '')
        .replace(/\*/g, '')
        .replace(/:/g, '')
        .trim() || 'New Project';
      
      name = cleanProjectName(name);

      // Reject if name is still a social comment phrase (not a project name)
      const SOCIAL_PHRASES = [
        'rame tuh', 'cek aja', 'mantap', 'bagus ini', 'keren ini', 'info dong',
        'share dong', 'check this', 'see this', 'look at this', 'nice one',
        'just sharing', 'new project'
      ];
      const nameLower = name.toLowerCase();
      if (SOCIAL_PHRASES.some(p => nameLower === p || nameLower.startsWith(p)) || name.split(' ').length <= 1 && name.length < 4) {
        // Demote to pending for human review
        itemsToSave.push({
          source_channel: channelUsername || chatId.toString(),
          message_id: messageId,
          source_link: sourceLink,
          original_text: text,
          category: 'PENDING_REVIEW',
          project_name: '⚠️ Perlu Review Manual',
          title_for_list: '⚠️ Perlu Review Manual',
          summary: `Nama tidak terdeteksi sebagai project: "${name}". Teks asli: ${text.substring(0, 150)}`,
          action: null,
          confidence: 0,
          status: 'pending',
          reason: `Regex Fallback: nama '${name}' terlihat seperti komentar sosial, bukan project`,
          raw_ai_response: rawResponse,
          ai_model: 'regex-fallback',
          raw_update: update,
          telegram_post_date: telegramPostDate
        });
        return;
      }
      let cat = 'AIRDROP';
      const firstLineU = firstLine.toUpperCase();
      
      // If the title explicitly says UPDATE, prioritize it
      if (firstLineU.includes('UPDATE')) cat = 'UPDATE';
      else if (u.includes('WAITLIST') || u.includes('WL ')) cat = 'WL_EARLY_ACCESS';
      else if (u.includes('CLAIM') || u.includes('CHECK ELIGIBLE')) cat = 'CLAIM_CHECK_ELIGIBLE';
      else if (u.includes('MAINNET')) cat = 'MAINNET';
      else if (u.includes('TESTNET') || u.includes('FAUCET')) cat = 'TESTNET';
      else if (u.includes('NODE')) cat = 'NODE';
      else if (u.includes('UPDATE') || u.includes('INFO') || u.includes('MIGRATION')) cat = 'UPDATE';
      else if (u.includes('QUIZ') || u.includes('ANSWER') || u.includes('FORM')) cat = 'AIRDROP';

      itemsToSave.push({
        source_channel: channelUsername || chatId.toString(),
        message_id: messageId,
        source_link: sourceLink,
        original_text: text,
        category: cat as any,
        project_name: name,
        title_for_list: name,
        summary: text.substring(0, 150).replace(/\n/g, ' '),
        action: `Join/Check at ${url}`,
        confidence: 0.86,
        status: 'approved',
        reason: 'Auto-detected via Enhanced Regex Fallback',
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

      const cleanedName = cleanProjectName(item.project_name || (forceValid ? 'Update' : 'Unknown'));
      const cleanedTitle = cleanProjectName(item.title_for_list || (forceValid ? 'Update' : 'Unknown'));

      itemsToSave.push({
        source_channel: channelUsername || chatId.toString(),
        message_id: messageId,
        source_link: sourceLink,
        original_text: text,
        category: finalCategory,
        project_name: cleanedName,
        title_for_list: cleanedTitle,
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
