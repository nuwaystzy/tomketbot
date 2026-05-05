import { DatabaseParsedItem } from '@/types';

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_ADMIN_IDS = (process.env.TELEGRAM_ADMIN_IDS || '').split(',').map(id => id.trim());

const TELEGRAM_API_URL = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}`;

export const isAdmin = (userId: number): boolean => {
  return TELEGRAM_ADMIN_IDS.includes(userId.toString());
};

export const getAdminIds = (): string[] => TELEGRAM_ADMIN_IDS;

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
      console.error('Telegram sendMessage failed:', await response.text());
    }
    return response.json();
  } catch (error) {
    console.error('Error sending telegram message:', error);
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

export const sendAdminItemPreview = async (item: DatabaseParsedItem) => {
  const text = `
<b>${item.status === 'pending' ? '⚠️ Pending Review' : '✅ New Item Detected'}</b>

<b>Category:</b> ${item.category}
<b>Project:</b> ${item.title_for_list}
<b>Source:</b> ${item.source_link}
<b>Confidence:</b> ${item.confidence ? Math.round(item.confidence * 100) : 0}%
<b>Reason:</b> ${item.reason}

<b>Summary:</b> ${item.summary}
<b>Action:</b> ${item.action}

<i>ID: ${item.id}</i>
`;

  const inlineKeyboard = {
    inline_keyboard: [
      [
        { text: '✅ Approve', callback_data: `approve_${item.id}` },
        { text: '❌ Skip', callback_data: `skip_${item.id}` },
      ],
    ],
  };

  const admins = getAdminIds();
  for (const adminId of admins) {
    if (adminId) {
      await sendMessage(adminId, text, { reply_markup: inlineKeyboard });
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
