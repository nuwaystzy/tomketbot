export const CATEGORIES = {
  NODE: 'NODE',
  TESTNET: 'TESTNET',
  MAINNET: 'MAINNET',
  RETROACTIVE: 'RETROACTIVE',
  AIRDROP_CAMPAIGN: 'AIRDROP CAMPAIGN',
  MINING_DEPIN: 'MINING/DEPIN',
  WL_EARLY_ACCESS: 'WL/EARLY ACCESS',
  CLAIM_CHECK_ELIGIBLE: 'CLAIM/CHECK ELIGIBLE',
} as const;

export const CATEGORY_KEYS = Object.keys(CATEGORIES);

export const getCategoryLabel = (key: string): string => {
  return CATEGORIES[key as keyof typeof CATEGORIES] || key;
};
