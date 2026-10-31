import { DatabaseParsedItem } from '@/types';
import { fetchWithTimeout } from './fetchHelper';
import { CATEGORY_KEYS, getCategoryLabel } from './categories';
import fs from 'fs';
import path from 'path';

type TelegramOptions = {
  disable_web_page_preview?: boolean;
  link_preview_options?: unknown;
  reply_markup?: unknown;
  [key: string]: unknown;
};
type InlineKeyboard = { inline_keyboard: Array<Array<{ text: string; callback_data: string }>> };

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

export const sendMessage = async (chatId: string | number, text: string, options: TelegramOptions = {}) => {
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

export const editMessageText = async (chatId: string | number, messageId: number, text: string, options: TelegramOptions = {}) => {
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

const getLocalPhotoBuffer = (filePath?: string): { buffer: Buffer; filename: string } | null => {
  const candidatePaths = [
    filePath,
    process.env.RECAP_IMAGE_PATH,
    path.join(process.cwd(), 'public', 'recap.jpg'),
    path.join(process.cwd(), 'public', '123.jpg'),
    'C:\\Users\\noways\\Downloads\\123.jpg',
  ].filter(Boolean) as string[];

  for (const p of candidatePaths) {
    try {
      if (typeof p === 'string' && fs.existsSync(p)) {
        const stats = fs.statSync(p);
        if (stats.isFile() && stats.size > 0) {
          return { buffer: fs.readFileSync(p), filename: path.basename(p) };
        }
      }
    } catch {
      // ignore
    }
  }
  return null;
};

export const sendPhoto = async (chatId: string | number, photoInput?: string | Buffer, caption?: string, options: TelegramOptions = {}) => {
  try {
    // 1. If photoInput is a web URL (http:// or https://) AND NOT placehold.co:
    if (typeof photoInput === 'string' && /^https?:\/\//i.test(photoInput) && !photoInput.includes('placehold.co')) {
      const response = await fetchWithTimeout(`${TELEGRAM_API_URL}/sendPhoto`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          photo: photoInput,
          caption: caption,
          parse_mode: 'HTML',
          ...options,
        }),
      }, 5000);

      if (response.ok) {
        const resData = await response.json();
        if (resData.ok) return resData;
      }
      console.warn(`Telegram sendPhoto via URL (${photoInput}) failed, attempting local file upload fallback...`);
    }

    // 2. Try uploading local photo file via FormData
    let photoBuffer: Buffer | null = null;
    let filename = 'recap.jpg';

    if (Buffer.isBuffer(photoInput)) {
      photoBuffer = photoInput;
    } else if (typeof photoInput === 'string' && !photoInput.startsWith('http')) {
      const local = getLocalPhotoBuffer(photoInput);
      if (local) {
        photoBuffer = local.buffer;
        filename = local.filename;
      }
    }

    if (!photoBuffer) {
      const local = getLocalPhotoBuffer();
      if (local) {
        photoBuffer = local.buffer;
        filename = local.filename;
      }
    }

    if (photoBuffer) {
      const formData = new FormData();
      formData.append('chat_id', chatId.toString());
      formData.append('photo', new Blob([new Uint8Array(photoBuffer)], { type: filename.endsWith('.png') ? 'image/png' : 'image/jpeg' }), filename);
      if (caption) formData.append('caption', caption || '');
      formData.append('parse_mode', 'HTML');

      if (options.reply_markup) {
        formData.append('reply_markup', typeof options.reply_markup === 'string' ? options.reply_markup : JSON.stringify(options.reply_markup));
      }

      const response = await fetchWithTimeout(`${TELEGRAM_API_URL}/sendPhoto`, {
        method: 'POST',
        body: formData,
      }, 12000);

      if (response.ok) {
        const resData = await response.json();
        if (resData.ok) return resData;
      } else {
        const errorText = await response.text();
        console.error(`Telegram sendPhoto FormData failed for chat ${chatId}:`, errorText);
      }
    }

    // 3. Last resort fallback if URL was passed but placehold.co or failed
    if (typeof photoInput === 'string' && photoInput.startsWith('http')) {
      const response = await fetchWithTimeout(`${TELEGRAM_API_URL}/sendPhoto`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          photo: photoInput,
          caption: caption,
          parse_mode: 'HTML',
          ...options,
        }),
      }, 5000);

      if (response.ok) {
        const resData = await response.json();
        if (resData.ok) return resData;
      }
    }

    return null;
  } catch (error) {
    console.error('Error sending photo:', error);
    return null;
  }
};

/**
 * Unified helper to send a recap (image + text) as a single message.
 * Uses Telegram link_preview_options (show_above_text: true, prefer_large_media: true)
 * to display a large photo banner at the top while allowing up to 4,096 characters,
 * preventing long lists from splitting into multiple bubbles.
 */
export const sendRecap = async (chatId: string | number, text: string, imageUrl?: string, options: TelegramOptions = {}) => {
  const webImageUrl = (imageUrl && /^https?:\/\//i.test(imageUrl) && !imageUrl.includes('placehold.co'))
    ? imageUrl
    : (process.env.RECAP_IMAGE_URL && /^https?:\/\//i.test(process.env.RECAP_IMAGE_URL))
      ? process.env.RECAP_IMAGE_URL
      : 'https://files.catbox.moe/lvcn57.jpg';

  const unifiedText = `<a href="${webImageUrl}">&#8205;</a>${text}`;

  // If total length fits within Telegram's 4,096 character limit:
  if (unifiedText.length <= 4000) {
    const res = await sendMessage(chatId, unifiedText, {
      ...options,
      link_preview_options: {
        is_disabled: false,
        url: webImageUrl,
        show_above_text: true,
        prefer_large_media: true,
      }
    });
    if (res && res.ok) return res;

    // Fallback if link_preview failed: try sendPhoto
    const photoRes = await sendPhoto(chatId, webImageUrl, text.substring(0, 1000), options);
    if (photoRes && photoRes.ok) return photoRes;
    return await sendMessage(chatId, text, options);
  }

  // Only if text strictly exceeds 4,000 characters, split into chunks
  const lines = text.split('\n');
  let chunk1 = `<a href="${webImageUrl}">&#8205;</a>`;
  let chunk2 = '';
  let isChunk1 = true;

  for (const line of lines) {
    if (isChunk1 && (chunk1 + line + '\n').length > 3900) {
      isChunk1 = false;
    }
    if (isChunk1) {
      chunk1 += line + '\n';
    } else {
      chunk2 += line + '\n';
    }
  }

  const res1 = await sendMessage(chatId, chunk1.trim(), {
    link_preview_options: {
      is_disabled: false,
      url: webImageUrl,
      show_above_text: true,
      prefer_large_media: true,
    }
  });
  const res2 = await sendMessage(chatId, chunk2.trim(), options);
  return res2 || res1;
};

export const getCategoryKeyboard = (itemId: string | number) => {
  const keyboard: InlineKeyboard['inline_keyboard'] = [];
  let row: Array<{ text: string; callback_data: string }> = [];
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

  let inlineKeyboard: InlineKeyboard = { inline_keyboard: [] };
  
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
  const imageUrl = process.env.RECAP_IMAGE_URL || 'public/recap.jpg';

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
    const res = await sendRecap(adminId, text, imageUrl, { reply_markup: kb });
    if (!res) {
      // If sending with photo failed, try fallback plain text sendMessage
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