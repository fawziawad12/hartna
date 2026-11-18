// The progression ladder (phase 3). Phase 1 only shows it; nothing earns money yet.
// Money is virtual only and never converts to real money.
// Every resident starts with ONLY a phone (no house),
// except the first FREE_BUILDINGS residents, who get a free building.
export const CURRENCY = { ar: 'قرش', emoji: '🪙' };

export const FREE_BUILDINGS = 100;

// The data file is kept simple so names can be added by hand, in join order:
//   { "username": "mo_awad0", "name": "مُحَمَّد عَواد" }
// This turns it into full resident records.
export function normalizeResidents(list) {
  const seen = new Set();
  const out = [];
  for (const raw of list) {
    const username = String(raw.username || '').trim().replace(/^@/, '');
    if (!username || seen.has(username.toLowerCase())) continue;
    seen.add(username.toLowerCase());
    const number = out.length + 1;
    const assets = raw.assets ? [...raw.assets] : [{ type: 'phone' }];
    if (number <= FREE_BUILDINGS && !assets.some((a) => a.type === 'building')) assets.push({ type: 'building', free: true });
    out.push({
      id: raw.id || username,
      number,
      username,
      displayName: raw.name || raw.displayName || username,
      joinedAt: raw.joinedAt || null,
      money: raw.money || 0,
      assets,
    });
  }
  return out;
}

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
