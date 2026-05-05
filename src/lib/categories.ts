export const CATEGORIES = {
  TESTNET: 'TESTNET',
  RETROACTIVE: 'RETROACTIVE',
  AIRDROP: 'AIRDROP/CAMPAIGN',
  NODE: 'NODE',
  MAINNET: 'MAINNET',
  MINING_DEPIN: 'MINING/DEPIN',
  WL_EARLY_ACCESS: 'WL/EARLY ACCESS',
  CLAIM_CHECK_ELIGIBLE: 'CLAIM/CHECK ELIGIBLE',
  UPDATE: 'UPDATE'
} as const;

export const CATEGORY_KEYS = Object.keys(CATEGORIES);

export const getCategoryLabel = (key: string): string => {
  return CATEGORIES[key as keyof typeof CATEGORIES] || key;
};

export const resolveCategoryAlias = (input: string): string => {
  const upper = input.toUpperCase().trim();
  
  if (upper === 'WL' || upper === 'WAITLIST') return 'WL_EARLY_ACCESS';
  if (upper === 'CLAIM') return 'CLAIM_CHECK_ELIGIBLE';
  if (upper === 'DEPIN' || upper === 'MINING') return 'MINING_DEPIN';
  if (upper === 'RETRO') return 'RETROACTIVE';
  
  // Try to find exact or partial match
  for (const key of CATEGORY_KEYS) {
    const label = CATEGORIES[key as keyof typeof CATEGORIES];
    if (key === upper || label.toUpperCase().includes(upper)) {
      return key;
    }
  }
  
  return upper; // Fallback to raw string
};
