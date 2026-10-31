import { AIResponse } from '@/types';
import { fetchWithTimeout } from './fetchHelper';

const GROQ_MODEL = process.env.GROQ_MODEL || 'qwen/qwen3.8-27b';

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

export const parseWithGroq = async (
  text: string,
  timeout = 7000
): Promise<{ data: AIResponse | null, error: string | null, rawResponse: string | null, model: string }> => {
  const apiKey = process.env.GROQ_API_KEY;
  const model = GROQ_MODEL;

  if (!apiKey) {
    return { data: null, error: 'GROQ_API_KEY is not configured', rawResponse: null, model: `groq/${model}` };
  }

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
      const errText = await response.text();
      console.error('[GROQ] Request failed with status', response.status, ':', errText);
      return { data: null, error: `Groq error HTTP ${response.status}: ${errText}`, rawResponse: null, model: `groq/${model}` };
    }

    const json = await response.json();
    const rawText = json.choices?.[0]?.message?.content || '';
    
    let cleanJson = rawText.trim();
    if (cleanJson.startsWith('```json')) cleanJson = cleanJson.replace(/```json/g, '');
    if (cleanJson.endsWith('```')) cleanJson = cleanJson.replace(/```/g, '');

    const parsed = JSON.parse(cleanJson) as AIResponse;
    return { data: parsed, error: null, rawResponse: rawText, model: `groq/${model}` };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[GROQ] Parse exception:', message);
    return { data: null, error: message || 'Unknown Groq error', rawResponse: null, model: `groq/${model}` };
  }
};

export const parseWithAI = parseWithGroq;
