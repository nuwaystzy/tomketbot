import { DatabaseParsedItem } from '@/types';

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_ADMIN_IDS = (process.env.TELEGRAM_ADMIN_IDS || '').split(',').map(id => id.trim());

const TELEGRAM_API_URL = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}`;

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
    // Parse t.me/username/messageId or t.me/c/chatId/messageId
    const match = sourceLink.match(/t\.me\/(?:c\/(\d+)|([^/]+))\/(\d+)/);
    if (!match) return null;

    const privateChatId = match[1]; // for private channels: t.me/c/123/456
    const username = match[2];       // for public channels: t.me/channel/456
    const messageId = parseInt(match[3]);

    const fromChatId = privateChatId ? `-100${privateChatId}` : `@${username}`;
    const adminId = TELEGRAM_ADMIN_IDS[0];
    if (!adminId) return null;

    // Forward silently to first admin DM
    const fwdRes = await fetch(`${TELEGRAM_API_URL}/forwardMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: adminId,
        from_chat_id: fromChatId,
        message_id: messageId,
        disable_notification: true
      })
    });

    const fwdData = await fwdRes.json();
    if (!fwdData.ok || !fwdData.result) return null;

    // forward_date = original post date (Unix timestamp)
    const originalDate = fwdData.result.forward_date
      ? new Date(fwdData.result.forward_date * 1000)
      : new Date(fwdData.result.date * 1000);

    // Delete the forwarded message immediately to keep DM clean
    await fetch(`${TELEGRAM_API_URL}/deleteMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: adminId,
        message_id: fwdData.result.message_id
      })
    });

    return originalDate;
  } catch (e) {
    console.error('[fetchTelegramMessageDate] failed:', e);
    return null;
  }
};

export const sendMessage = async (chatId: string | number, text: string, options: any = {}) => {
  try {
    const response = await fetch(`${TELEGRAM_API_URL}/sendMessage`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
        ...options,
      }),
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error(`Telegram sendMessage failed for chat ${chatId}:`, errorText);
      return null;
    }
    return await response.json();
  } catch (error) {
    console.error('Error sending telegram message:', error);
    return null;
  }
};

export const broadcastToAdmins = async (text: string) => {
  const admins = getAdminIds();
  for (const adminId of admins) {
    if (adminId) {
      await sendMessage(adminId, text);
    }
  }
};

export const answerCallbackQuery = async (callbackQueryId: string, text?: string) => {
  try {
    await fetch(`${TELEGRAM_API_URL}/answerCallbackQuery`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        callback_query_id: callbackQueryId,
        text,
      }),
    });
  } catch (error) {
    console.error('Error answering callback query:', error);
  }
};

export const editMessageText = async (chatId: string | number, messageId: number, text: string, options: any = {}) => {
  try {
    await fetch(`${TELEGRAM_API_URL}/editMessageText`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        chat_id: chatId,
        message_id: messageId,
        text,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
        ...options,
      }),
    });
  } catch (error) {
    console.error('Error editing telegram message:', error);
  }
};

const getConfidenceLabel = (conf: number | null): string => {
  if (conf === null) return 'Unknown';
  if (conf >= 0.85) return '🟢 High';
  if (conf >= 0.60) return '🟡 Medium';
  return '🔴 Low';
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
  const confLabel = getConfidenceLabel(item.confidence);

  // Show original text preview when project name is Unknown or AI failed
  const showOriginalPreview = !item.project_name || item.project_name === 'Unknown' || item.project_name.includes('Perlu Review');
  const originalPreview = showOriginalPreview && item.original_text
    ? `\n<b>Teks Asli:</b> <i>${(item.original_text || '').substring(0, 250)}...</i>` 
    : '';
  
  const text = `
${item.status === 'pending' ? '⚠️ <b>Pending Review</b>' : '✅ <b>Approved Item</b>'}

<b>Kategori:</b> ${item.category}
<b>Project:</b> ${item.project_name || '❓ Tidak Terdeteksi'}
<b>Source:</b> ${item.source_link}
<b>Confidence:</b> ${confPercent}% (${confLabel})
<b>Reason:</b> ${item.reason || 'N/A'}
<b>Summary:</b> ${item.summary || 'N/A'}
<b>Action:</b> ${item.action || 'N/A'}${originalPreview}

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
    // Broadcast
    const admins = getAdminIds();
    for (const adminId of admins) {
      if (adminId) {
        await sendMessage(adminId, text, { reply_markup: inlineKeyboard });
      }
    }
  }
};

export const sendAdminRecapDraft = async (text: string) => {
  const admins = getAdminIds();
  for (const adminId of admins) {
    if (adminId) {
      await sendMessage(adminId, text);
    }
  }
};
