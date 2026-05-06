-- Migration: Weekly Sharing System
-- Run this in Supabase Dashboard > SQL Editor

-- 1. Add weekly sharing columns to parsed_items
ALTER TABLE parsed_items
  ADD COLUMN IF NOT EXISTS weekly_shared BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS weekly_shared_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS weekly_batch_id TEXT;

-- 2. Create weekly_recaps table
CREATE TABLE IF NOT EXISTS weekly_recaps (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  batch_id TEXT UNIQUE NOT NULL,
  channel_id TEXT,
  message_id TEXT,
  total_items INTEGER DEFAULT 0,
  item_ids TEXT[],
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 3. Create index for faster queries
CREATE INDEX IF NOT EXISTS idx_parsed_items_weekly_shared ON parsed_items(weekly_shared) WHERE status = 'approved';
CREATE INDEX IF NOT EXISTS idx_weekly_recaps_created ON weekly_recaps(created_at DESC);
