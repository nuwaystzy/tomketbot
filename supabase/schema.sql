-- Schema for Airdrop Recap Telegram Bot

-- Create sources table
CREATE TABLE IF NOT EXISTS sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_username text UNIQUE NOT NULL,
  title text,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

-- Create parsed_items table
CREATE TABLE IF NOT EXISTS parsed_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_channel text NOT NULL,
  message_id bigint NOT NULL,
  source_link text,
  original_text text,
  category text,
  project_name text,
  title_for_list text,
  summary text,
  action text,
  confidence numeric,
  status text DEFAULT 'pending', -- pending, approved, skipped, posted
  reason text,
  period_start date,
  period_end date,
  raw_ai_response jsonb,
  ai_model text,
  ai_error text,
  raw_update jsonb,
  telegram_post_date timestamptz,
  date_found date DEFAULT CURRENT_DATE,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(source_channel, message_id, project_name)
);

-- Create recap_batches table
CREATE TABLE IF NOT EXISTS recap_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  period_start date,
  period_end date,
  status text DEFAULT 'draft', -- draft, sent
  recap_text text,
  sent_to_admin_at timestamptz,
  created_at timestamptz DEFAULT now()
);

-- Create recap_batch_items table
CREATE TABLE IF NOT EXISTS recap_batch_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid REFERENCES recap_batches(id) ON DELETE CASCADE,
  parsed_item_id uuid REFERENCES parsed_items(id) ON DELETE CASCADE,
  category text,
  sort_order int DEFAULT 0
);

-- Add index for efficient querying
CREATE INDEX IF NOT EXISTS idx_parsed_items_status ON parsed_items(status);
CREATE INDEX IF NOT EXISTS idx_parsed_items_date_found ON parsed_items(date_found);
CREATE INDEX IF NOT EXISTS idx_parsed_items_telegram_post_date ON parsed_items(telegram_post_date);

-- UX Enhancements Schema Updates
ALTER TABLE parsed_items ADD COLUMN IF NOT EXISTS display_id BIGSERIAL UNIQUE;

CREATE TABLE IF NOT EXISTS admin_sessions (
  admin_id bigint PRIMARY KEY,
  flow text,
  step text,
  payload jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS action_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id bigint,
  action_type text,
  target_item_id uuid REFERENCES parsed_items(id) ON DELETE CASCADE,
  previous_state jsonb,
  new_state jsonb,
  created_at timestamptz DEFAULT now()
);
