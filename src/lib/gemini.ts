import { GeminiResponse } from '@/types';
import { fetchWithTimeout } from './fetchHelper';

const GEMINI_API_KEYS = (process.env.GEMINI_API_KEYS || '').split(',').map(k => k.trim()).filter(Boolean);
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-flash-latest';

let currentKeyIndex = 0;

const getNextApiKey = (): string => {
  if (GEMINI_API_KEYS.length === 0) {
    throw new Error('No Gemini API keys configured.');
  }
  const key = GEMINI_API_KEYS[currentKeyIndex];
  currentKeyIndex = (currentKeyIndex + 1) % GEMINI_API_KEYS.length;
  return key;
};

const SYSTEM_PROMPT = `You are an AI parser for a crypto airdrop Telegram channel. Extract actionable crypto project info (supports English & Indonesian).

VALID CATEGORIES (HIGHEST TO LOWEST PRIORITY):
1. WL_EARLY_ACCESS: Whitelist, waitlist, WL, early access, register, allowlist, daftar, akses awal. (OVERRIDES airdrop/campaign)
2. CLAIM_CHECK_ELIGIBLE: Claim, klaim, check eligible, allocation, snapshot, vesting. (NOT for mainnet launch)
3. TESTNET: Testnet tasks, faucet
4. MAINNET: Mainnet launch or live
5. NODE: Running nodes
6. MINING_DEPIN: Mining, DePIN
7. RETROACTIVE: Retroactive drops
8. UPDATE: Task updates, migrations, new missions (#update, #info)
9. AIRDROP: New airdrop/farm/campaign tasks (DEFAULT if no higher category matches)
10. SKIP: Chatter, banter, questions, proof of withdrawal, memes, no actionable project

STRICT SKIP RULES (Set is_valid: false, category: "SKIP", project_name: null, confidence: 0.1):
- General chatting, questions, banter (e.g. "bisa nganu ga?", "yang garap kemarin dapet ga?", "isi quiz", "temen gw").
- Earnings/withdrawal chatter (e.g. "bisa wd", "fee wd 1$", "land jir mayan", "dapet 20k").
- Casual comments without a specific actionable crypto project link/campaign.
- project_name MUST be a real crypto brand/protocol (max 4 words, NO emojis). Never use verbs or conversational words as project_name.

OUTPUT JSON FORMAT ONLY:
{
  "items": [
    {
      "is_valid": true,
      "category": "WL_EARLY_ACCESS",
      "project_name": "BrandName",
      "title_for_list": "BrandName",
      "summary": "1-2 sentence English summary",
      "action": "Action to take",
      "confidence": 0.95,
      "reason": "Reason for classification"
    }
  ]
}`;

const parseWithGroq = async (
  text: string,
  timeout = 6000
): Promise<{ data: GeminiResponse | null, error: string | null, rawResponse: string | null, model: string } | null> => {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return null;

  const model = process.env.GROQ_MODEL || 'qwen/qwen3.8-27b';

  try {
    const response = await fetchWithTimeout(
      'https://api.groq.com/openai/v1/chat/completions',
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: text }
          ],
          response_format: { type: 'json_object' },
          temperature: 0.1
        })
      },
      timeout
    );

    if (!response.ok) {
      const err = await response.text();
      console.error('[GROQ] Request failed:', err);
      return null;
    }

    const json = await response.json();
    const rawText = json.choices?.[0]?.message?.content || '';
    let cleanJson = rawText.trim();
    if (cleanJson.startsWith('```json')) cleanJson = cleanJson.replace(/```json/g, '');
    if (cleanJson.endsWith('```')) cleanJson = cleanJson.replace(/```/g, '');

    const parsed = JSON.parse(cleanJson) as GeminiResponse;
    return { data: parsed, error: null, rawResponse: rawText, model: `groq/${model}` };
  } catch (error: any) {
    console.error('[GROQ] Error:', error.message);
    return null;
  }
};

export const parseWithGemini = async (
  text: string,
  attempt = 1,
  deadline = Date.now() + 8000
): Promise<{ data: GeminiResponse | null, error: string | null, rawResponse: string | null, model: string }> => {
  // 1. Try Groq AI first if GROQ_API_KEY is configured
  if (process.env.GROQ_API_KEY && attempt === 1) {
    const groqRes = await parseWithGroq(text, Math.min(6000, deadline - Date.now()));
    if (groqRes && groqRes.data && groqRes.data.items && groqRes.data.items.length > 0) {
      return groqRes;
    }
  }

  // 2. Fallback to Gemini AI
  const remaining = deadline - Date.now();
  if (remaining <= 500) {
    return { data: null, error: 'AI request timed out (budget exhausted)', rawResponse: null, model: GEMINI_MODEL };
  }

  if (GEMINI_API_KEYS.length === 0) {
    return { data: null, error: 'No Gemini API keys configured', rawResponse: null, model: GEMINI_MODEL };
  }

  const apiKey = getNextApiKey();
  const model = GEMINI_MODEL; // e.g., gemini-1.5-flash

  try {
    const response = await fetchWithTimeout(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
      {
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
      },
      remaining
    );

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
    if (attempt < GEMINI_API_KEYS.length && Date.now() < deadline) {
      return parseWithGemini(text, attempt + 1, deadline);
    }
    return { data: null, error: error.message || 'Unknown Gemini error', rawResponse: null, model };
  }
};
