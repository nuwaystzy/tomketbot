import { GeminiResponse } from '@/types';

const GEMINI_API_KEYS = (process.env.GEMINI_API_KEYS || '').split(',').map(k => k.trim()).filter(Boolean);
const GEMINI_MODEL = 'gemini-1.5-flash';

let currentKeyIndex = 0;

const getNextApiKey = (): string => {
  if (GEMINI_API_KEYS.length === 0) {
    throw new Error('No Gemini API keys configured.');
  }
  const key = GEMINI_API_KEYS[currentKeyIndex];
  currentKeyIndex = (currentKeyIndex + 1) % GEMINI_API_KEYS.length;
  return key;
};

const SYSTEM_PROMPT = `You are an AI parser for a crypto airdrop recap Telegram channel.

Your job is to extract actionable crypto project info from Telegram posts, including posts in Indonesian.

VALID categories (pick one, follow PRIORITY ORDER below):
- TESTNET: testing network participation, testnet faucet
- MAINNET: mainnet launch announcements, mainnet operational, node running on mainnet
- RETROACTIVE: retroactive airdrop for past users
- AIRDROP: new airdrop, farm, or campaign tasks (ONLY if no higher-priority category matches)
- NODE: running nodes
- MINING_DEPIN: mining or DePIN project
- WL_EARLY_ACCESS: Waitlists, whitelists, registration, early access, allowlists, pre-registration
- CLAIM_CHECK_ELIGIBLE: Claim portals, token claims, allocation checkers, eligibility checks, snapshot results, vesting schedules
- UPDATE: Ongoing task updates, new missions for existing projects, migrations
- PENDING_REVIEW: uncertain, needs human review
- SKIP: not relevant (meme, general chat, price talk, no action needed)

═══════════════════════════════════════════
CATEGORY PRIORITY (HIGHEST TO LOWEST):
═══════════════════════════════════════════
1. WL_EARLY_ACCESS - If ANY of these words appear: "whitelist", "waitlist", "WL", "early access", "allowlist", "register", "registration", "sign up", "daftar", "akses awal", "pre-register" → ALWAYS use WL_EARLY_ACCESS. This OVERRIDES "airdrop" or "campaign" keywords.
2. CLAIM_CHECK_ELIGIBLE - If ANY of these words appear: "claim", "klaim", "check eligible", "cek eligible", "eligibility", "allocation", "alokasi", "snapshot", "vesting", "claim portal", "claim live", "token distribution" → use CLAIM_CHECK_ELIGIBLE. NOT for mainnet launches.
3. TESTNET/MAINNET/NODE/MINING_DEPIN - Specific infrastructure categories
4. RETROACTIVE - For retroactive drops
5. UPDATE - For updates to existing projects
6. AIRDROP - DEFAULT category. Only use if NONE of the above match.

═══════════════════════════════════════════
EXAMPLES OF CORRECT CLASSIFICATION:
═══════════════════════════════════════════
- "Boili Whitelist is now open" → WL_EARLY_ACCESS (NOT AIRDROP)
- "Join MovePay early access" → WL_EARLY_ACCESS (NOT AIRDROP)
- "Cresera registration is live" → WL_EARLY_ACCESS (NOT AIRDROP)
- "XYZ Airdrop Waitlist" → WL_EARLY_ACCESS (waitlist overrides airdrop)
- "ABC Campaign + Whitelist" → WL_EARLY_ACCESS (whitelist overrides campaign)
- "Claim your KAIO tokens" → CLAIM_CHECK_ELIGIBLE (NOT AIRDROP)
- "Check your eligibility for XYZ" → CLAIM_CHECK_ELIGIBLE
- "OFC Vesting is live" → CLAIM_CHECK_ELIGIBLE
- "Raven Market rewards claim" → CLAIM_CHECK_ELIGIBLE
- "New airdrop campaign for ABC" → AIRDROP (no WL/claim keywords)
- "Mawari Mainnet is live" → MAINNET (NOT CLAIM_CHECK_ELIGIBLE)

EXTRACTION RULES:
1. project_name: Extract the EXACT project name from the text. Look for brand names, product names, or proper nouns. Remove ALL emojis. Do NOT write "Unknown".
2. title_for_list: Same as project_name. MUST be completely free of emojis and strictly MAXIMUM 4 WORDS long.
3. summary: 1-2 sentences summarizing what the post is about IN ENGLISH.
4. action: What should the user DO? (e.g., "Check allocation", "Register waitlist", "Claim tokens"). If no action, null.
5. confidence: Float 0.0-1.0. How confident are you this is a valid airdrop opportunity?
6. reason: Why did you classify it this way?

IMPORTANT:
- If the text explicitly announces an "Update" regarding rules, limits, or ongoing tasks, categorize as UPDATE.
- Posts announcing a Mainnet is live/operational MUST be categorized as MAINNET or UPDATE, NOT CLAIM_CHECK_ELIGIBLE.
- Posts in Indonesian should be understood the same as English.
- "Cek alokasi" = "Check allocation" = CLAIM_CHECK_ELIGIBLE.
- "Migrasi" = "Migration" = UPDATE.
- If a URL is present and the post mentions a project (even if very short like "Jule Waitlist"), it's VALID.
- Be aggressive in identifying project names from short text.
- NEVER return project_name as null or "Unknown" if there is any brand or proper noun.

RETURN JSON ONLY. No markdown. No explanation outside JSON.

Format:
{
  "items": [
    {
      "is_valid": true,
      "category": "CLAIM_CHECK_ELIGIBLE",
      "project_name": "AntFun",
      "title_for_list": "AntFun",
      "summary": "AntFun has announced Phase 1 mapping results. Users can now check their airdrop allocation.",
      "action": "Check allocation at antfundrop.xyz",
      "confidence": 0.92,
      "reason": "Contains allocation check link and airdrop date announcement"
    }
  ]
}`;

export const parseWithGemini = async (text: string, attempt = 1): Promise<{ data: GeminiResponse | null, error: string | null, rawResponse: string | null, model: string }> => {
  const apiKey = getNextApiKey();
  const model = GEMINI_MODEL; // e.g., gemini-1.5-pro

  try {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        contents: [{
          parts: [{ text }]
        }],
        systemInstruction: {
          parts: [{ text: SYSTEM_PROMPT }]
        },
        generationConfig: {
          responseMimeType: "application/json",
          temperature: 0.2
        },
        safetySettings: [
          { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
          { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
          { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
          { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" }
        ]
      })
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(JSON.stringify(errorData));
    }

    const result = await response.json();
    const rawText = result.candidates?.[0]?.content?.parts?.[0]?.text || '';
    
    let cleanJson = rawText.trim();
    if (cleanJson.startsWith('```json')) cleanJson = cleanJson.replace(/```json/g, '');
    if (cleanJson.endsWith('```')) cleanJson = cleanJson.replace(/```/g, '');

    const parsed = JSON.parse(cleanJson) as GeminiResponse;
    return { data: parsed, error: null, rawResponse: rawText, model };
  } catch (error: any) {
    console.error(`Gemini attempt ${attempt} failed:`, error.message);
    if (attempt < GEMINI_API_KEYS.length) {
      return parseWithGemini(text, attempt + 1);
    }
    return { data: null, error: error.message || 'Unknown Gemini error', rawResponse: null, model };
  }
};
