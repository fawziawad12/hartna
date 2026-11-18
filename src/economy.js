// The progression ladder (phase 3). Phase 1 only shows it; nothing earns money yet.
// Money is virtual only and never converts to real money.
// Every resident starts with ONLY a phone (no house).
export const CURRENCY = { ar: 'قرش', emoji: '🪙' };

export const LADDER = [
  { key: 'phone', ar: 'موبايل', emoji: '📱', price: 0, incomePerHour: 1 },
  { key: 'stall', ar: 'بسطة', emoji: '🛒', price: 500, incomePerHour: 4 },
  { key: 'shop', ar: 'دكان', emoji: '🏪', price: 3000, incomePerHour: 15 },
  { key: 'house', ar: 'بيت', emoji: '🏠', price: 12000, incomePerHour: 0 },
  { key: 'car', ar: 'سيارة', emoji: '🚗', price: 30000, incomePerHour: 0 },
  { key: 'building', ar: 'عمارة', emoji: '🏢', price: 150000, incomePerHour: 120 },
  { key: 'tower', ar: 'برج', emoji: '🏙️', price: 1000000, incomePerHour: 600 },
];

const rank = (key) => LADDER.findIndex((t) => t.key === key);

export function currentTier(resident) {
  let best = 0;
  for (const a of resident.assets || []) best = Math.max(best, rank(a.type));
  return LADDER[Math.max(0, best)];
}

export function nextTier(resident) {
  const i = rank(currentTier(resident).key);
  return LADDER[i + 1] || null;
}

// Owned places (stall, shop, house, building, tower) point at a plot id from the city,
// e.g. { type: 'stall', plotId: 'stall-12' }. The city shows the owner's name on them.
export function ownedPlots(residents) {
  const map = new Map();
  for (const r of residents) for (const a of r.assets || []) if (a.plotId) map.set(a.plotId, { resident: r, asset: a });
  return map;
}
