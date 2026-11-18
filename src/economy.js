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
    if (number <= FREE_BUILDINGS && !assets.some((a) => a.type === 'home')) assets.push({ type: 'home', free: true });
    out.push({
      id: raw.id || username,
      number,
      username,
      displayName: raw.name || raw.displayName || username,
      joinedAt: raw.joinedAt || null,
      money: raw.money || 0,
      spent: raw.spent || 0,
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

// ---- Earning ---------------------------------------------------------------
// Everyone earns just by living in the city. Money is computed from the join time,
// so it keeps growing even when nobody has the page open.
export const BASE_INCOME_PER_HOUR = 6; // the phone

export const EARN_RULES = [
  { emoji: '📱', ar: 'كل ساعة إنت ساكن بالحارة', amount: BASE_INCOME_PER_HOUR, live: true },
  { emoji: '💬', ar: 'كل تعليق على بوست', amount: 50, live: false },
  { emoji: '📣', ar: 'تعمل منشن للحساب بالستوري', amount: 200, live: false },
];

export function incomePerHour(resident) {
  let total = BASE_INCOME_PER_HOUR;
  for (const a of resident.assets || []) {
    const item = SHOP.find((i) => i.key === a.type);
    if (item && item.incomePerHour) total += item.incomePerHour;
  }
  return total;
}

export function moneyNow(resident, now = Date.now()) {
  const start = resident.joinedAt ? Date.parse(resident.joinedAt + (resident.joinedAt.length <= 10 ? 'T00:00:00+03:00' : '')) : now;
  const hours = Math.max(0, (now - start) / 3600000);
  return Math.floor((resident.money || 0) + hours * incomePerHour(resident) - (resident.spent || 0));
}

// ---- The shop --------------------------------------------------------------
export const SHOP = [
  { key: 'stall', emoji: '🛒', ar: 'بسطة بالسوق', desc: 'بتبيع عليها وبتجيبلك دخل', price: 500, incomePerHour: 4 },
  { key: 'shop', emoji: '🏪', ar: 'دكان', desc: 'دخل أكبر من البسطة', price: 3000, incomePerHour: 15 },
  { key: 'rent', emoji: '🔑', ar: 'أجّر بيتك', desc: 'بتأجّر بيتك لناس وبتقبض كل ساعة', price: 1500, incomePerHour: 10 },
  { key: 'floor', emoji: '🧱', ar: 'كبّر بيتك (طابق زيادة)', desc: 'بيتك بيعلى طابق', price: 8000, incomePerHour: 0 },
  { key: 'house', emoji: '🏠', ar: 'بيت تاني', desc: 'بيت جديد باسمك بالحارة', price: 12000, incomePerHour: 0 },
  { key: 'car', emoji: '🚗', ar: 'سيارة', desc: 'سيارة بتمشي بشوارع الحارة', price: 30000, incomePerHour: 0 },
  { key: 'building', emoji: '🏢', ar: 'عمارة', desc: 'عمارة كاملة بشقق للأجار', price: 150000, incomePerHour: 120 },
  { key: 'tower', emoji: '🏙️', ar: 'برج', desc: 'أعلى شي بالحارة', price: 1000000, incomePerHour: 600 },
];

export const fmt = (n) => Math.floor(n).toLocaleString('en-US');
