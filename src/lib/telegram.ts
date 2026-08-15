import { DatabaseParsedItem } from '@/types';
import { fetchWithTimeout } from './fetchHelper';

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_ADMIN_IDS = (process.env.TELEGRAM_ADMIN_IDS || '').split(',').map(id => id.trim());

const TELEGRAM_API_URL = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}`;

export const escapeHtml = (str: string): string => {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
};

export const isAdmin = (userId: number): boolean => {
  return TELEGRAM_ADMIN_IDS.includes(userId.toString());
};

export const getAdminIds = (): string[] => TELEGRAM_ADMIN_IDS;

/**
 * Fetch the original date of a Telegram message by forwarding it silently
 * to the first admin's DM, reading the forward_date, then deleting it.
 * Returns null if unable to fetch.
 */
export const fetchTelegramMessageDate = async (sourceLink: string): Promise<Date | null> => {
  try {
    const match = sourceLink.match(/t\.me\/(?:c\/(\d+)|([^/]+))\/(\d+)/);
    if (!match) return null;

    const privateChatId = match[1];
    const username = match[2];
    const messageId = parseInt(match[3]);

    const fromChatId = privateChatId ? `-100${privateChatId}` : `@${username}`;
    const adminId = TELEGRAM_ADMIN_IDS[0];
    if (!adminId) return null;

    const fwdRes = await fetchWithTimeout(`${TELEGRAM_API_URL}/forwardMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: adminId,
        from_chat_id: fromChatId,
        message_id: messageId,
        disable_notification: true
      })
    }, 5000);

    const fwdData = await fwdRes.json();
    if (!fwdData.ok || !fwdData.result) return null;

    const originalDate = fwdData.result.forward_date
      ? new Date(fwdData.result.forward_date * 1000)
      : new Date(fwdData.result.date * 1000);

    await fetchWithTimeout(`${TELEGRAM_API_URL}/deleteMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: adminId,
        message_id: fwdData.result.message_id
      })
    }, 5000);

    return originalDate;
  } catch (e) {
    console.error('[fetchTelegramMessageDate] failed:', e);
    return null;
  }
};

export const sendMessage = async (chatId: string | number, text: string, options: any = {}) => {
  try {
    const response = await fetchWithTimeout(`${TELEGRAM_API_URL}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: 'HTML',
        disable_web_page_preview: options.link_preview_options ? undefined : (options.disable_web_page_preview ?? true),
        ...options,
      }),
    }, 5000);
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error(`Telegram sendMessage failed for chat ${chatId}:`, errorText);
      return null;
    }
    const resData = await response.json();
    if (!resData.ok) {
      console.error(`Telegram sendMessage API error for chat ${chatId}:`, resData);
      return null;
    }
    return resData;
  } catch (error) {
    console.error('Error sending telegram message:', error);
    return null;
  }
};

export const answerCallbackQuery = async (callbackQueryId: string, text?: string) => {
  try {
    await fetchWithTimeout(`${TELEGRAM_API_URL}/answerCallbackQuery`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        callback_query_id: callbackQueryId,
        text,
      }),
    }, 5000);
  } catch (error) {
    console.error('Error answering callback query:', error);
  }
};

export const editMessageText = async (chatId: string | number, messageId: number, text: string, options: any = {}) => {
  try {
    await fetchWithTimeout(`${TELEGRAM_API_URL}/editMessageText`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        message_id: messageId,
        text,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
        ...options,
      }),
    }, 5000);
  } catch (error) {
    console.error('Error editing telegram message:', error);
  }
};

export const deleteMessage = async (chatId: string | number, messageId: number) => {
  try {
    await fetchWithTimeout(`${TELEGRAM_API_URL}/deleteMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, message_id: messageId })
    }, 5000);
  } catch (e) {
    console.error('[deleteMessage] failed:', e);
  }
};

export const sendPhoto = async (chatId: string | number, photoUrl: string, caption?: string, options: any = {}) => {
  try {
    const response = await fetchWithTimeout(`${TELEGRAM_API_URL}/sendPhoto`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        photo: photoUrl,
        caption: caption,
        parse_mode: 'HTML',
        ...options,
      }),
    }, 5000);
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error(`Telegram sendPhoto failed for chat ${chatId}:`, errorText);
      return null;
    }
    const resData = await response.json();
    if (!resData.ok) {
      console.error(`Telegram sendPhoto API error for chat ${chatId}:`, resData);
      return null;
    }
    return resData;
  } catch (error) {
    console.error('Error sending photo:', error);
    return null;
  }
};

/**
 * Unified helper to send a recap (image + text) as a single message.
 * If text is > 1000 chars (Telegram caption limit is 1024 including HTML tags),
 * it uses a hidden link in sendMessage to keep it as one message with image preview.
 */
export const sendRecap = async (chatId: string | number, text: string, imageUrl?: string, options: any = {}) => {
  if (imageUrl) {
    // Telegram caption limit is strictly 1024 characters including HTML tags.
    if (text.length > 950) {
      // Use sendMessage with hidden image preview link
      const unifiedText = `<a href="${imageUrl}">&#8205;</a>${text}`;
      return await sendMessage(chatId, unifiedText, { 
        ...options, 
        link_preview_options: {
          is_disabled: false,
          url: imageUrl,
          show_above_text: true,
          prefer_large_media: true
        }
      });
    } else {
      // If it fits comfortably under 950 chars, send as photo with caption
      const res = await sendPhoto(chatId, imageUrl, text, options);
      if (res && res.ok) return res;
      
      // Fallback to sendMessage if sendPhoto failed
      const unifiedText = `<a href="${imageUrl}">&#8205;</a>${text}`;
      return await sendMessage(chatId, unifiedText, {
        ...options,
        link_preview_options: {
          is_disabled: false,
          url: imageUrl,
          show_above_text: true,
          prefer_large_media: true
        }
      });
    }
  } else {
    return await sendMessage(chatId, text, options);
  }
};

/**
 * Send recap in multiple message chunks if total text exceeds 4000 characters.
 */
export const sendRecapInChunks = async (chatId: string | number, text: string, imageUrl?: string, options: any = {}) => {
  if (text.length <= 3900) {
    return await sendRecap(chatId, text, imageUrl, options);
  }

  const lines = text.split('\n');
  const chunks: string[] = [];
  let currentChunk = '';

  for (const line of lines) {
    if ((currentChunk + line + '\n').length > 3800) {
      chunks.push(currentChunk.trim());
      currentChunk = line + '\n';
    } else {
      currentChunk += line + '\n';
    }
  }
  if (currentChunk.trim()) {
    chunks.push(currentChunk.trim());
  }

  let lastRes = null;
  for (let i = 0; i < chunks.length; i++) {
    const chunkText = chunks[i];
    const isLast = i === chunks.length - 1;
    const chunkOptions = isLast ? options : {};
    const isFirst = i === 0;

    if (isFirst && imageUrl) {
      lastRes = await sendRecap(chatId, chunkText, imageUrl, chunkOptions);
    } else {
      lastRes = await sendMessage(chatId, chunkText, chunkOptions);
    }
  }

  return lastRes;
};

export const getCategoryKeyboard = (itemId: string | number) => {
  const { CATEGORY_KEYS, getCategoryLabel } = require('./categories');
  const keyboard = [];
  let row = [];
  for (let i = 0; i < CATEGORY_KEYS.length; i++) {
    row.push({ text: getCategoryLabel(CATEGORY_KEYS[i]), callback_data: `move_to_${CATEGORY_KEYS[i]}_${itemId}` });
    if (row.length === 2 || i === CATEGORY_KEYS.length - 1) {
      keyboard.push(row);
      row = [];
    }
  }
  keyboard.push([{ text: '🔙 Cancel Move', callback_data: `cancel_move_${itemId}` }]);
  return { inline_keyboard: keyboard };
};

export const sendAdminItemPreview = async (item: DatabaseParsedItem, targetChatId?: number, editMessageId?: number) => {
  const confPercent = item.confidence ? Math.round(item.confidence * 100) : 0;
  
  const showOriginalPreview = !item.project_name || item.project_name === 'Unknown' || item.project_name.includes('Perlu Review');
  const originalPreview = showOriginalPreview && item.original_text
    ? `\n<b>Teks Asli:</b> <i>${escapeHtml((item.original_text || '').substring(0, 250))}...</i>` 
    : '';
  
  const text = `
${item.status === 'pending' ? '⚠️ <b>Pending Review</b>' : '✅ <b>Approved Item</b>'}

<b>Kategori:</b> ${item.category}
<b>Project:</b> ${escapeHtml(item.project_name || '❓ Tidak Terdeteksi')}
<b>Source:</b> ${item.source_link}
<b>Confidence:</b> ${confPercent}%
<b>Summary:</b> ${escapeHtml(item.summary || 'N/A')}
<b>Action:</b> ${escapeHtml(item.action || 'N/A')}${originalPreview}

<i>ID: ${item.display_id || item.id}</i>
`;

  let inlineKeyboard: any = { inline_keyboard: [] };
  
  if (item.status === 'pending') {
    inlineKeyboard = {
      inline_keyboard: [
        [
          { text: '✅ Approve & Next', callback_data: `app_next_${item.id}` },
          { text: '❌ Skip & Next', callback_data: `skip_next_${item.id}` },
        ],
        [
          { text: '🔁 Move', callback_data: `move_cat_${item.id}` },
          { text: '✏️ Edit', callback_data: `edit_name_${item.id}` },
        ]
      ],
    };
  }

  if (targetChatId) {
    if (editMessageId) {
      return await editMessageText(targetChatId, editMessageId, text, { reply_markup: inlineKeyboard });
    } else {
      return await sendMessage(targetChatId, text, { reply_markup: inlineKeyboard });
    }
  } else {
    const admins = getAdminIds();
    await Promise.all(admins.map(adminId => {
      if (adminId) return sendMessage(adminId, text, { reply_markup: inlineKeyboard });
      return Promise.resolve();
    }));
  }
};

export const sendAdminRecapDraft = async (text: string, start: string, end: string) => {
  const admins = getAdminIds();
  const imageUrl = process.env.RECAP_IMAGE_URL;

  // Detect if this is a weekly status-based recap or a date-based recap
  const isWeeklyMode = start === 'week_unshared';
  const sendCallbackData = isWeeklyMode
    ? 'send_week_unshared'
    : `send_channel_${start}_${end}`;

  const kb = {
    inline_keyboard: [[{ text: '🚀 Kirim ke Channel', callback_data: sendCallbackData }]]
  };

  const results = await Promise.all(admins.map(async (adminId) => {
    if (!adminId) return null;
    const res = await sendRecapInChunks(adminId, text, imageUrl, { reply_markup: kb });
    if (!res) {
      // If sending with photo/preview failed, try fallback plain text sendMessage
      const fallbackRes = await sendMessage(adminId, text, { reply_markup: kb });
      if (!fallbackRes) {
        await sendMessage(adminId, `❌ <b>Gagal mengirim draf rekap.</b>\nPastikan format teks valid.`);
      }
      return fallbackRes;
    }
    return res;
  }));

  return results;
};