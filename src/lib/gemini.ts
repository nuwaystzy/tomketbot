import { GeminiResponse } from '@/types';

const GEMINI_API_KEYS = (process.env.GEMINI_API_KEYS || '').split(',').map(k => k.trim()).filter(Boolean);
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-pro';

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

VALID categories (pick one):
- TESTNET: testing network participation
- MAINNET: mainnet launch with action required
- RETROACTIVE: retroactive airdrop for past users
- AIRDROP_CAMPAIGN: new airdrop, farm, or campaign tasks
- MINING_DEPIN: mining or DePIN project
- WL_EARLY_ACCESS: Waitlists, registration for early access, allowlists.
- CLAIM_CHECK_ELIGIBLE: Allocation checkers, claim portals, snapshot results.
- UPDATE: Ongoing task updates, new missions for existing projects, migrations.
- PENDING_REVIEW: uncertain, needs human review
- SKIP: not relevant (meme, general chat, price talk, no action needed)

EXTRACTION RULES:
1. project_name: Extract the EXACT project name from the text. Look for brand names, product names, or proper nouns. Do NOT write "Unknown".
2. title_for_list: Same as project_name, short and clean (2-4 words max). No emojis.
3. summary: 1-2 sentences summarizing what the post is about IN ENGLISH.
4. action: What should the user DO? (e.g., "Check allocation", "Register testnet", "Claim tokens"). If no action, null.
5. confidence: Float 0.0-1.0. How confident are you this is a valid airdrop opportunity?
6. reason: Why did you classify it this way?

IMPORTANT:
- Posts about allocation results, snapshots, launch dates ARE valid (category: CLAIM_CHECK_ELIGIBLE or UPDATE).
- Posts in Indonesian should be understood the same as English.
- "Cek alokasi" = "Check allocation" = valid CLAIM_CHECK_ELIGIBLE.
- "Migrasi" = "Migration" = valid action.
- If a URL is present and the post mentions a project (even if very short like "Jule Waitlist"), it's VALID.
- Be aggressive in identifying project names from short text.
- If the text is "ProjectName Waitlist", project_name is "ProjectName" and category is "WL_EARLY_ACCESS".
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
