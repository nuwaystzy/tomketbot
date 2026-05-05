import { GoogleGenAI } from '@google/genai';
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

const SYSTEM_PROMPT = `You are an AI screening agent for a Telegram crypto airdrop recap bot.

The recap is ONLY for NEW project, campaign, or actionable crypto opportunity.

Classify each Telegram post into one of:
NODE
TESTNET
MAINNET
RETROACTIVE
AIRDROP_CAMPAIGN
MINING_DEPIN
WL_EARLY_ACCESS
CLAIM_CHECK_ELIGIBLE
SKIP
PENDING_REVIEW

Include only posts that give users something new/actionable to do:
join, register, claim, mint, testnet, waitlist, task, campaign, node, mining, check eligibility, submit form, earn points.

Skip:
jokes, memes, random comments, normal chat, market talk, generic update, tokenomics chart without action, repost with no new actionable info, short reaction, winner list if not useful, pure social media promotion.

Return JSON only. No markdown.

If multiple projects are found, return:
{
  "items": [
    {
      "is_valid": true,
      "category": "AIRDROP_CAMPAIGN",
      "project_name": "Example Project",
      "title_for_list": "Example Project",
      "summary": "New campaign detected",
      "action": "Complete campaign tasks",
      "confidence": 0.85,
      "reason": "Contains campaign task and registration"
    }
  ]
}

If not useful:
{
  "items": [
    {
      "is_valid": false,
      "category": "SKIP",
      "project_name": null,
      "title_for_list": null,
      "summary": null,
      "action": null,
      "confidence": 0.95,
      "reason": "No actionable airdrop opportunity"
    }
  ]
}

Important:
- project_name must be short and clean. Do not include emojis.
- title_for_list is just the project name, not a long sentence.
- If unsure, set category = "PENDING_REVIEW" or is_valid true with category "PENDING_REVIEW".
- ALWAYS return an object with an "items" array.`;

export const parseWithGemini = async (text: string, attempt = 1): Promise<{ data: GeminiResponse | null, error: string | null, rawResponse: string | null, model: string }> => {
  const apiKey = getNextApiKey();
  const ai = new GoogleGenAI({ apiKey });

  try {
    const response = await ai.models.generateContent({
        model: GEMINI_MODEL,
        contents: text,
        config: {
            systemInstruction: SYSTEM_PROMPT,
            responseMimeType: "application/json",
            temperature: 0.2
        }
    });

    const rawText = response.text || '';
    let cleanJson = rawText.trim();
    if (cleanJson.startsWith('```json')) cleanJson = cleanJson.replace(/```json/g, '');
    if (cleanJson.endsWith('```')) cleanJson = cleanJson.replace(/```/g, '');

    const parsed = JSON.parse(cleanJson) as GeminiResponse;
    return { data: parsed, error: null, rawResponse: rawText, model: GEMINI_MODEL };
  } catch (error: any) {
    console.error(`Gemini attempt ${attempt} failed:`, error.message);
    if (attempt < GEMINI_API_KEYS.length) {
      // Try next key if available
      return parseWithGemini(text, attempt + 1);
    }
    return { data: null, error: error.message || 'Unknown Gemini error', rawResponse: null, model: GEMINI_MODEL };
  }
};
