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

export const CATEGORY_KEYS = Object.keys(CATEGORIES) as (keyof typeof CATEGORIES)[];

export const getCategoryLabel = (key: string): string => {
  return CATEGORIES[key as keyof typeof CATEGORIES] || key;
};

export const resolveCategoryAlias = (input: string): string => {
  const upper = input.toUpperCase().trim();
  
  // WL/EARLY ACCESS aliases
  if (['WL', 'WAITLIST', 'WHITELIST', 'EARLY ACCESS', 'EARLY_ACCESS', 'ALLOWLIST', 'REGISTRATION', 'PRE-REGISTER'].includes(upper)) return 'WL_EARLY_ACCESS';
  if (upper.includes('WHITELIST') || upper.includes('WAITLIST') || upper.includes('EARLY ACCESS')) return 'WL_EARLY_ACCESS';
  
  // CLAIM/CHECK ELIGIBLE aliases
  if (['CLAIM', 'ELIGIBLE', 'ALLOCATION', 'SNAPSHOT', 'VESTING', 'CHECK ELIGIBLE', 'CHECK_ELIGIBLE', 'CLAIMABLE'].includes(upper)) return 'CLAIM_CHECK_ELIGIBLE';
  if (upper.includes('CLAIM') || upper.includes('ELIGIBLE') || upper.includes('ALLOCATION') || upper.includes('VESTING')) return 'CLAIM_CHECK_ELIGIBLE';
  
  // Other aliases
  if (upper === 'DEPIN' || upper === 'MINING') return 'MINING_DEPIN';
  if (upper === 'RETRO' || upper === 'RETROACTIVE') return 'RETROACTIVE';
  if (upper === 'CAMPAIGN' || upper === 'AIRDROP/CAMPAIGN') return 'AIRDROP';
  
  // Try to find exact or partial match
  for (const key of CATEGORY_KEYS) {
    const label = CATEGORIES[key];
    if (key === upper || label.toUpperCase().includes(upper)) {
      return key;
    }
  }
  
  return upper;
};
