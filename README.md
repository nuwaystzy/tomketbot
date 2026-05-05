# Airdrop Recap Telegram Bot

A Next.js serverless application that monitors a Telegram channel for new crypto airdrop/project opportunities, uses Gemini AI to filter and categorize them, saves them to Supabase, and provides an admin interface via Telegram DMs to generate daily/weekly recaps.

## Features

- **Automated Monitoring:** Listens to Telegram channel posts via Webhook.
- **AI-Powered Parsing:** Uses Gemini Pro to extract project names, categories, and actions.
- **Cost Saving:** Rule-based prefilter to avoid calling Gemini for obvious chatter.
- **Resilience:** Multi-key support for Gemini API with fallback to manual admin review.
- **Admin Interface:** Approve/Skip items, move categories, edit names, and generate recaps directly from Telegram DMs.

## Prerequisites

- Node.js 18+
- [Supabase](https://supabase.com) Project
- Telegram Bot Token (from BotFather)
- Gemini API Key (from Google AI Studio)
- Vercel account (for deployment)

## Setup Instructions

1. **Clone the repository and install dependencies:**
   ```bash
   npm install
   ```

2. **Database Setup:**
   - Go to your Supabase project.
   - Open the SQL Editor and run the SQL provided in `supabase/schema.sql`.

3. **Environment Variables:**
   - Copy `.env.example` to `.env.local`:
     ```bash
     cp .env.example .env.local
     ```
   - Fill in the required credentials. Find your Telegram User ID using `@userinfobot` on Telegram.

4. **Run Locally:**
   - Since this relies on webhooks, you need a public URL. You can use `ngrok`:
     ```bash
     ngrok http 3000
     ```
   - Start the Next.js dev server:
     ```bash
     npm run dev
     ```
   - Set the webhook to your ngrok URL:
     ```bash
     curl -F "url=https://<your-ngrok-url>/api/telegram/webhook" -F "secret_token=<YOUR_WEBHOOK_SECRET>" https://api.telegram.org/bot<YOUR_BOT_TOKEN>/setWebhook
     ```

## Deployment (Vercel)

1. Push this code to a GitHub repository.
2. Import the project into Vercel.
3. Add all the environment variables from `.env.local` to Vercel's Environment Variables settings.
4. Deploy.
5. Set the webhook to your Vercel URL:
   ```bash
   curl -F "url=https://<your-vercel-app>.vercel.app/api/telegram/webhook" -F "secret_token=<YOUR_WEBHOOK_SECRET>" https://api.telegram.org/bot<YOUR_BOT_TOKEN>/setWebhook
   ```

## Admin Commands

Send these commands directly to your Bot in Telegram:

- `/pending` - View up to 5 pending items.
- `/approve <item_id>` - Approve an item.
- `/skip <item_id>` - Skip an item.
- `/move <item_id> <CATEGORY>` - Move an item to a new category.
- `/edit <item_id> <New Name>` - Edit the project name.
- `/add <CATEGORY> | <Project Name> | <Source Link>` - Manually add an item.
- `/recap YYYY-MM-DD YYYY-MM-DD` - Generate a recap for the given dates.
- `/preview YYYY-MM-DD YYYY-MM-DD` - Preview the recap.
- `/skipped YYYY-MM-DD YYYY-MM-DD` - View skipped items for the given dates.
- `/restore <item_id>` - Restore a skipped item to pending.
