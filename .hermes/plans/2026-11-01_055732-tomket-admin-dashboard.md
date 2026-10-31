# Tomket Admin Dashboard Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Build a small, private web dashboard for the existing Tomket bot so King can review, clean, categorize, preview, and publish recap items faster than through Telegram one-by-one.

**Architecture:** Keep the existing Next.js app and Supabase schema. Add server-only Route Handlers for every dashboard mutation, reusing the existing `supabaseAdmin` service-role client exclusively on the server. The UI is an internal single-page admin workspace: a filterable item table, detail/editor drawer, bulk actions, recap preview, and an explicit publish action to the configured Telegram channel.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Tailwind 4, existing `@supabase/supabase-js`, existing Telegram helpers. No new UI/auth dependency.

---

## Product scope

### Included in v1

1. **Private dashboard access**
   - A `/admin` login page guarded by one `DASHBOARD_PASSWORD` environment variable.
   - Server-set, signed HttpOnly session cookie. No password is ever shipped to browser JavaScript.
   - `/admin` and all `/api/admin/*` routes reject unauthenticated requests.

2. **Review table for `parsed_items`**
   - Default sort: newest / selected date range first.
   - Filters: date range, status, category, keyword.
   - Columns: display ID, post date, title, category, status, source link, confidence.
   - Empty state: clear explanation and reset filters action.

3. **Fast item operations, matching existing bot capability**
   - Edit title, category, and post date.
   - Approve, skip, and delete single items.
   - Multi-select with bulk approve, skip, category move, and delete.
   - Create manual item through `/add` equivalent.
   - Import textarea through `/import` equivalent, including `CATEGORY | Project Name | Link` rows.
   - Every mutation creates an `action_logs` row, consistent with bot behavior.

4. **Recap workspace**
   - Explicit start/end range, with quick preset for 13–31.
   - Preview uses the exact recap formatting logic, including `📢 LIST GARAPAN ...`.
   - Preview lists the exact approved items included and permits opening the table filtered to the same range.
   - Publish button sends through the existing Telegram `sendRecap` helper only after an in-UI confirmation step.

5. **Weekly workspace**
   - Review all approved `weekly_shared=false` items.
   - Preview unsent weekly recap.
   - Send through the existing logic and only mark items as shared after successful channel response.
   - Remove one item from weekly as `SKIPPED`, matching the bot’s existing `/week_reset` semantics.

6. **Status/history**
   - Counts for pending, approved, skipped, and unshared weekly items.
   - Last 10 `weekly_recaps` batches, equivalent to `/week_history`.

### Explicitly excluded from v1

- Public-facing pages.
- Multi-user roles, accounts, OAuth, password reset, or audit UI beyond existing `action_logs` writes.
- Realtime subscriptions, optimistic offline queue, pagination virtualization, export files, analytics charts.
- Replacing or removing Telegram bot commands. The bot remains a valid fallback.

## UX direction

- Internal operational tool, not marketing site.
- Light, dense-but-readable desktop-first table. Mobile remains usable for quick approve/skip and preview, but bulk cleaning is optimized for desktop.
- One restrained green accent for approvals/publish. Amber for pending, red only destructive actions.
- Native form controls and `<dialog>` confirmation where sufficient. No icon/UI library.
- Buttons state the action: `Approve selected`, `Move to Testnet`, `Preview recap`, `Send to channel`.
- Delete and publish must always present scope/count in confirmation copy.

## Data and security rules

- `SUPABASE_SERVICE_ROLE_KEY` stays server-only. Never prefix it `NEXT_PUBLIC_`.
- Authenticate all page data and mutation endpoints server-side, not only by hiding UI controls.
- Validate all incoming route payloads: UUID/item IDs, allowed status values, known categories, ISO dates, title length, and source URLs.
- Filter all user-controlled text through existing `escapeHtml` before Telegram-bound recap output.
- Publish is a side effect: show range, item count, destination channel configuration state, and preview before confirmation.
- Keep server-side action logging for dashboard changes. Use `admin_id: 0` with action types prefixed `dashboard_` unless a dashboard-specific actor identity is intentionally added later.

---

## Current repo context

- Existing bot entry point: `src/app/api/telegram/webhook/route.ts`.
- Existing recap format/query logic: `src/lib/recapGenerator.ts`.
- Existing Telegram publish helpers: `src/lib/telegram.ts`.
- Existing database service client: `src/lib/supabaseAdmin.ts`.
- Existing bot command behavior: `src/lib/adminCommands.ts`.
- Existing item/session/action types: `src/types/index.ts`.
- The current home page is only the stock Next.js placeholder: `src/app/page.tsx`.
- `parsed_items`, `weekly_recaps`, and `action_logs` already exist. Verify current production schema includes weekly fields before implementation.

---

### Task 1: Freeze API contracts and dashboard data types

**Objective:** Define the narrow data shapes and validation boundaries the dashboard will use before UI work.

**Files:**
- Create: `src/lib/adminDashboard.ts`
- Modify: `src/types/index.ts`
- Test: `src/lib/adminDashboard.test.ts` (Node built-in `assert`, no new test framework)

**Step 1: Define typed primitives**

Create local/shared types for:

```ts
export const DASHBOARD_CATEGORIES = [...CATEGORY_KEYS] as const;
export const DASHBOARD_STATUSES = ['pending', 'approved', 'skipped', 'posted'] as const;

export type DashboardItemPatch = Pick<DatabaseParsedItem,
  'title_for_list' | 'project_name' | 'category' | 'telegram_post_date' | 'status'
>;
```

Add only reusable types to `src/types/index.ts`; keep route-only request types near their handlers.

**Step 2: Implement payload validators**

Implement small parsing functions without dependencies:
- `parseDateRange`
- `parseItemPatch`
- `parseBulkAction`
- `parseImportLines`

They must reject invalid JSON shapes, unknown category/status values, invalid ISO date strings, blank titles, and malformed/non-HTTP source URLs with an actionable error message.

**Step 3: Write focused assert tests**

Cover one valid input and one rejected input per validator, including invalid category and malformed import row.

**Step 4: Verify**

Run:

```bash
node --import tsx src/lib/adminDashboard.test.ts
```

If `tsx` is not installed, use a small existing-compatible TypeScript compilation check instead. Do not add a test dependency just for this.

**Step 5: Commit**

```bash
git add src/lib/adminDashboard.ts src/types/index.ts src/lib/adminDashboard.test.ts
git commit -m "feat: add dashboard payload validation"
```

---

### Task 2: Add password session and route guard

**Objective:** Make the dashboard private before exposing item data or mutation endpoints.

**Files:**
- Create: `src/lib/dashboardAuth.ts`
- Create: `src/app/admin/login/page.tsx`
- Create: `src/app/api/admin/login/route.ts`
- Create: `src/app/api/admin/logout/route.ts`
- Create: `src/app/admin/layout.tsx`
- Modify: `.env.example` (create if absent)
- Test: `src/lib/dashboardAuth.test.ts`

**Step 1: Define environment contract**

Document:

```env
DASHBOARD_PASSWORD=
DASHBOARD_SESSION_SECRET=
```

Use Web Crypto / Node `crypto` HMAC to sign an expiration-bearing session payload. Do not store plaintext password in a cookie.

**Step 2: Implement login/logout Route Handlers**

- Compare submitted password using timing-safe comparison.
- On success, set `HttpOnly`, `Secure` in production, `SameSite=Lax`, `Path=/` session cookie.
- On failure, return 401 without leaking whether environment configuration is missing.
- Logout clears the exact cookie.

**Step 3: Implement `/admin` guard**

The admin layout checks cookie validity on the server and redirects to `/admin/login` if invalid.

**Step 4: Test contract**

Test valid session, tampered token, expired token, wrong password, and absent environment behavior.

**Step 5: Verify manually**

- Start local app.
- `/admin` redirects when logged out.
- Bad password stays rejected.
- Correct login reaches placeholder admin shell.
- `/api/admin/*` is still inaccessible without auth.

**Step 6: Commit**

```bash
git add src/lib/dashboardAuth.ts src/app/admin src/app/api/admin .env.example src/lib/dashboardAuth.test.ts
git commit -m "feat: protect admin dashboard"
```

---

### Task 3: Build read-only admin API and item table shell

**Objective:** Render real Supabase items with filters, loading, error, and empty states.

**Files:**
- Create: `src/app/api/admin/items/route.ts`
- Create: `src/components/admin/ItemTable.tsx`
- Create: `src/components/admin/ItemFilters.tsx`
- Create: `src/components/admin/AdminShell.tsx`
- Create: `src/app/admin/page.tsx`
- Modify: `src/app/globals.css`

**Step 1: Implement `GET /api/admin/items`**

Accept and validate query params:

```text
start=YYYY-MM-DD
end=YYYY-MM-DD
status=pending|approved|skipped|posted
category=<known category>
q=<free text, max 100 chars>
```

Return only fields needed by table plus total count. Filter search against `title_for_list` and `project_name`. Use an explicit limit of 200 for v1, with response metadata saying when results are capped.

**Step 2: Build admin shell**

Use a small navigation: `Review`, `Recap`, `Weekly`, `History`. Do not create dead links; pages/sections exist before links ship.

**Step 3: Build filter/table client island**

- Native date inputs
- Status/category selects
- Search input
- `13–31` quick filter only fills actual dates selected by user context, it must not hard-code a past year
- Read-only rows, source opens in a new tab with `rel="noreferrer"`

**Step 4: States**

Render loading, request error with retry, no results, and capped results state.

**Step 5: Verify**

- Authenticated table reflects real data.
- Date, category, status, and keyword filters combine correctly.
- Source links work.
- No Supabase service role string appears in page source/client bundle.

**Step 6: Commit**

```bash
git add src/app/admin src/app/api/admin/items src/components/admin src/app/globals.css
git commit -m "feat: add dashboard item review table"
```

---

### Task 4: Add single-item editor and action log mutations

**Objective:** Support all high-frequency item decisions without Telegram.

**Files:**
- Create: `src/app/api/admin/items/[id]/route.ts`
- Create: `src/components/admin/ItemEditor.tsx`
- Modify: `src/components/admin/ItemTable.tsx`
- Modify: `src/lib/adminDashboard.ts`

**Step 1: Implement server mutations**

- `PATCH /api/admin/items/[id]` updates only validated title/category/date/status fields.
- `DELETE /api/admin/items/[id]` deletes only after item ID validation.
- Read prior value, write `action_logs`, then mutate database.

**Step 2: Build editor drawer/dialog**

- Editable title, category, post date, status.
- Read-only original text and source URL.
- Explicit buttons `Approve`, `Skip`, `Save changes`, `Delete item`.
- Delete confirmation names the item before executing.

**Step 3: Keep client table synchronized**

After a successful mutation, refetch from the server. Do not fake optimistic state for v1.

**Step 4: Verify**

Edit an item and inspect Supabase row/action log. Approve and skip one item. Ensure delete requires confirmation and row disappears only after successful API response.

**Step 5: Commit**

```bash
git add src/app/api/admin/items src/components/admin src/lib/adminDashboard.ts
git commit -m "feat: add dashboard item editing"
```

---

### Task 5: Add selection and bulk operations

**Objective:** Make the dashboard materially faster for cleaning a 13–31 recap range.

**Files:**
- Create: `src/app/api/admin/items/bulk/route.ts`
- Create: `src/components/admin/BulkActionBar.tsx`
- Modify: `src/components/admin/ItemTable.tsx`
- Modify: `src/components/admin/ItemFilters.tsx`

**Step 1: Implement validated bulk route**

Payload shape:

```ts
{ ids: string[]; action: 'approve' | 'skip' | 'move_category' | 'delete'; category?: string }
```

- Maximum 200 IDs.
- Use one database mutation per action where possible.
- Log one action record per affected item, preserving undo/audit compatibility.
- Reject `move_category` with no valid category.

**Step 2: Build bulk toolbar**

- Checkbox per row plus select-all visible rows.
- Show selected count.
- Actions: approve, skip, move category, delete.
- Destructive confirmations specify exact selected count.

**Step 3: Verify**

Use a harmless selected set to verify each non-destructive action. Confirm action log count matches mutated row count. Verify selection resets after successful refresh.

**Step 4: Commit**

```bash
git add src/app/api/admin/items/bulk src/components/admin
git commit -m "feat: add dashboard bulk item actions"
```

---

### Task 6: Add manual item and import flows

**Objective:** Match the bot’s `/add` and `/import` capabilities.

**Files:**
- Create: `src/app/api/admin/items/import/route.ts`
- Create: `src/components/admin/AddItemDialog.tsx`
- Create: `src/components/admin/ImportItemsDialog.tsx`
- Modify: `src/app/admin/page.tsx`
- Modify: `src/lib/adminDashboard.ts`

**Step 1: Manual item route/form**

Fields: category, project title, source URL, status (default pending), post date (default now in Jakarta). Build server-generated source text/reason consistent with existing command behavior.

**Step 2: Import route/form**

Accept multiline format:

```text
CATEGORY | Project Name | https://source.example
```

Provide a per-line validation result before final submit: valid, invalid reason, duplicate warning. Do not insert until user confirms the valid row count.

**Step 3: Verify**

Create one manual item and import a mix of valid/invalid lines. Verify valid insertions, rejected lines, action logs, and table filters.

**Step 4: Commit**

```bash
git add src/app/api/admin/items/import src/components/admin src/app/admin/page.tsx src/lib/adminDashboard.ts
git commit -m "feat: add dashboard item import"
```

---

### Task 7: Build custom recap preview and publish flow

**Objective:** Safely create and send `LIST GARAPAN` date-range recaps from the dashboard.

**Files:**
- Create: `src/app/api/admin/recap/preview/route.ts`
- Create: `src/app/api/admin/recap/send/route.ts`
- Create: `src/components/admin/RecapWorkspace.tsx`
- Modify: `src/lib/recapGenerator.ts`
- Modify: `src/app/admin/page.tsx`

**Step 1: Extract shared recap item query**

Refactor only if needed so dashboard preview and Telegram `/recap` use the same server-side generator. Preserve exact existing output format and date-range timezone (`Asia/Jakarta`).

**Step 2: Implement preview route**

Return:
- formatted recap text
- effective date range
- exact included item IDs/count
- grouped item summary

No Telegram side effects from preview.

**Step 3: Implement send route**

- Require authenticated admin session.
- Regenerate recap from dates server-side, never trust client preview text.
- Require `{ confirmed: true }`.
- Check `TELEGRAM_RECAP_CHANNEL_ID` exists.
- Call `sendRecap`.
- Return Telegram result or a safe error.

**Step 4: Build recap workspace**

- Start/end date controls, validation, and `13–31` quick fill.
- Preview panel with monospaced rendered text.
- Item count and `Review these items` action applying same filters in review table.
- `Send to channel` opens native confirmation dialog showing range and item count.

**Step 5: Verify**

- Preview range matches `/recap` output for same approved dataset.
- A failed send does not write weekly flags or claim success.
- A successful test-channel send uses configured destination only after explicit confirmation.

**Step 6: Commit**

```bash
git add src/app/api/admin/recap src/components/admin/RecapWorkspace.tsx src/lib/recapGenerator.ts src/app/admin/page.tsx
git commit -m "feat: add dashboard recap preview"
```

---

### Task 8: Add weekly operations and recap history

**Objective:** Match `/week`, `/week_reset`, and `/week_history` from the dashboard.

**Files:**
- Create: `src/app/api/admin/weekly/preview/route.ts`
- Create: `src/app/api/admin/weekly/send/route.ts`
- Create: `src/app/api/admin/weekly/items/[id]/route.ts`
- Create: `src/app/api/admin/weekly/history/route.ts`
- Create: `src/components/admin/WeeklyWorkspace.tsx`
- Create: `src/components/admin/WeeklyHistory.tsx`
- Modify: `src/app/admin/page.tsx`

**Step 1: Preview unsent weekly items**

Reuse `generateWeeklyUnsharedDraft()` and return its generated text, item count, and item IDs.

**Step 2: Send weekly route**

Port the existing webhook behavior exactly:
1. regenerate fresh draft
2. send Telegram recap
3. only on successful response: insert `weekly_recaps`, set `weekly_shared`, `weekly_shared_at`, `weekly_batch_id`

**Step 3: Weekly remove/reset controls**

- Remove item from current weekly list: mark `weekly_shared=true`, `weekly_batch_id='SKIPPED'`.
- Reset item: set weekly fields back to null/false.
- Both must confirm action and write an audit log.

**Step 4: History view**

Display last 10 batches from `weekly_recaps`: batch ID, timestamp, total, channel message ID.

**Step 5: Verify**

Test preview and history read-only. For destructive state toggles, inspect row values before and after. Test actual channel send only after King explicitly approves a send, otherwise mock by asserting route requests are blocked without confirmation.

**Step 6: Commit**

```bash
git add src/app/api/admin/weekly src/components/admin/WeeklyWorkspace.tsx src/components/admin/WeeklyHistory.tsx src/app/admin/page.tsx
git commit -m "feat: add dashboard weekly recap controls"
```

---

### Task 9: Finish dashboard copy, metadata, and integration QA

**Objective:** Ship a clear internal tool without placeholder Next.js content.

**Files:**
- Modify: `src/app/layout.tsx`
- Modify: `src/app/page.tsx`
- Modify: `src/app/globals.css`
- Modify: `README.md`

**Step 1: Replace boilerplate metadata**

Set title/description to Tomket Admin context. Keep `/` simple: redirect to `/admin` if authenticated or `/admin/login` otherwise, rather than retaining a stock marketing page.

**Step 2: Document operations**

README must cover:
- required Vercel environment variables
- password/session setup
- dashboard capabilities
- local run commands
- separation of preview vs Telegram publish

Never put secret values into README or examples.

**Step 3: Run full checks**

```bash
npm run lint
npx tsc --noEmit
npm run build
git diff --check
```

**Step 4: Render verification**

Use production build/start, then verify:
- unauthenticated `/admin` redirect
- login form and keyboard navigation
- review table loading/error/empty states
- editor and bulk confirmations
- recap preview and confirmation dialog
- weekly view/history
- browser console has no errors
- no horizontal overflow at desktop and narrow layout

**Step 5: Commit and open PR**

```bash
git add src/app/layout.tsx src/app/page.tsx src/app/globals.css README.md
git commit -m "docs: document tomket admin dashboard"
git push origin feat/tomket-admin-dashboard
gh pr create --base main --head feat/tomket-admin-dashboard --title "feat: add Tomket admin dashboard"
```

---

## Migration and deployment checklist

1. Confirm `parsed_items` has `weekly_shared`, `weekly_shared_at`, and `weekly_batch_id`. If not, run committed migration `supabase/migrations/weekly_sharing.sql` before enabling weekly view.
2. Add Vercel environment variables:
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `TELEGRAM_BOT_TOKEN`
   - `TELEGRAM_RECAP_CHANNEL_ID`
   - optional `RECAP_IMAGE_URL`
   - `DASHBOARD_PASSWORD`
   - `DASHBOARD_SESSION_SECRET` (at least 32 random bytes encoded safely)
3. Do not change webhook URL or bot command configuration.
4. Deploy preview first. Test login and data reads on preview before production.
5. First production publish stays manual: open preview, review exact item count/list, press send, verify Telegram message arrived before treating recap as sent.

## Risks and tradeoffs

| Risk | Mitigation |
|---|---|
| Service role key exposure | All Supabase work remains Route Handler/server component only; audit client bundle before deploy. |
| Accidental bulk change | Explicit selected-count confirmation, capped batches, server validation, action logs. |
| Accidental Telegram publish | Preview is separate from send; send regenerates server-side and requires confirmation. |
| Bot/dashboard behavior drifts | Reuse `recapGenerator.ts`, `sendRecap`, and weekly generation logic instead of duplicate formatting/query code. |
| Password-only dashboard is simple but not multi-user | It fits private single-owner use now. Add OAuth/RBAC only when another operator genuinely needs access. |
| Large historical list | v1 caps table results at 200. Add server pagination only if it becomes a real problem. |

## Acceptance criteria

- [ ] `/admin` cannot show data or mutate state without a valid signed session.
- [ ] Review table filters real Supabase `parsed_items` by date/status/category/search.
- [ ] King can bulk clean 13–31: approve, skip, move category, and delete with confirmation.
- [ ] Dashboard supports manual add and formatted imports.
- [ ] Recap preview produces the existing `LIST GARAPAN` format and includes only approved items in range.
- [ ] Publishing requires explicit confirmation and uses configured Telegram channel.
- [ ] Weekly preview/send/history behavior preserves current bot semantics.
- [ ] `npm run lint`, `npx tsc --noEmit`, `npm run build`, and `git diff --check` all pass.
- [ ] No service-role key or Telegram token reaches browser source/bundle.
