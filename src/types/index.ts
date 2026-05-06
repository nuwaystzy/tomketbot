export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  channel_post?: TelegramMessage;
  edited_channel_post?: TelegramMessage;
  callback_query?: TelegramCallbackQuery;
}

export interface TelegramMessage {
  message_id: number;
  from?: {
    id: number;
    is_bot: boolean;
    first_name: string;
    username?: string;
  };
  chat: {
    id: number;
    title?: string;
    username?: string;
    type: string;
  };
  date: number;
  text?: string;
  caption?: string;
  entities?: TelegramEntity[];
  caption_entities?: TelegramEntity[];
}

export interface TelegramEntity {
  offset: number;
  length: number;
  type: string;
  url?: string;
}

export interface TelegramCallbackQuery {
  id: string;
  from: {
    id: number;
    is_bot: boolean;
    first_name: string;
    username?: string;
  };
  message?: TelegramMessage;
  data?: string;
}

export interface ParsedItem {
  is_valid: boolean;
  category: string;
  project_name: string | null;
  title_for_list: string | null;
  summary: string | null;
  action: string | null;
  confidence: number;
  reason: string;
}

export interface GeminiResponse {
  items: ParsedItem[];
}

export interface DatabaseParsedItem {
  id?: string;
  display_id?: string;
  source_channel: string;
  message_id: number;
  source_link: string;
  original_text: string;
  category: string;
  project_name: string | null;
  title_for_list: string | null;
  summary: string | null;
  action: string | null;
  confidence: number | null;
  status: 'pending' | 'approved' | 'skipped' | 'posted';
  reason: string | null;
  raw_ai_response?: any;
  ai_model?: string;
  ai_error?: string | null;
  raw_update?: any;
  telegram_post_date?: string;
  date_found?: string;
  weekly_shared?: boolean;
  weekly_shared_at?: string | null;
  weekly_batch_id?: string | null;
}

export interface AdminSession {
  admin_id: number;
  flow: string;
  step: string;
  payload: any;
}

export interface ActionLog {
  id?: string;
  admin_id: number;
  action_type: string;
  target_item_id: string;
  previous_state: any;
  new_state: any;
}

export interface WeeklyRecap {
  id?: string;
  batch_id: string;
  channel_id?: string;
  message_id?: string;
  total_items: number;
  item_ids: string[];
  created_at?: string;
}
