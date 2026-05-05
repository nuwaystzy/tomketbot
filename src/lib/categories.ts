export const CATEGORIES = {
  TESTNET: 'TESTNET',
  RETROACTIVE: 'RETROACTIVE',
  AIRDROP: 'AIRDROP/CAMPAIGN',
  WAITLIST: 'WAITLIST',
  NODE: 'NODE',
  MAINNET: 'MAINNET',
  MINING_DEPIN: 'MINING/DEPIN',
  WL_EARLY_ACCESS: 'WL/EARLY ACCESS',
  CLAIM_CHECK_ELIGIBLE: 'CLAIM/CHECK ELIGIBLE',
  UPDATE: 'UPDATE'
} as const;

export const CATEGORY_KEYS = Object.keys(CATEGORIES);

export const CATEGORY_ORDER = [
  'TESTNET',
  'RETROACTIVE',
  'AIRDROP',
  'WAITLIST',
  'NODE',
  'MAINNET',
  'CLAIM',
  'DEPIN',
  'UPDATE',
  'PENDING_REVIEW'
];

export const CATEGORY_EMOJIS: Record<string, string> = {
  'TESTNET': '🧪',
  'RETROACTIVE': '🔙',
  'AIRDROP': '🪂',
  'WAITLIST': '📝',
  'NODE': '🖥️',
  'MAINNET': '🌐',
  'CLAIM': '💰',
  'DEPIN': '📡',
  'UPDATE': '🔄',
  'PENDING_REVIEW': '❓',
  'OTHER': '📌'
};

export const getCategoryLabel = (key: string): string => {
  return CATEGORIES[key as keyof typeof CATEGORIES] || key;
};

export const resolveCategoryAlias = (input: string): string => {
  const upper = input.toUpperCase().trim();
  
  if (upper === 'WL') return 'WAITLIST';
  if (upper === 'CLAIM') return 'CLAIM';
  if (upper === 'DEPIN') return 'DEPIN';
  if (upper === 'RETRO') return 'RETROACTIVE';
  
  // Try to find exact or partial match
  for (const key of CATEGORY_KEYS) {
    if (key === upper || CATEGORIES[key as keyof typeof CATEGORIES].includes(upper)) {
      return key;
    }
  }
  
  return upper; // Fallback to raw string
};
