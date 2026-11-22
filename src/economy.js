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
    const fromServer = raw.balanceAt != null;
    const number2 = raw.number || number;
    const assets = (raw.assets ? raw.assets.map((a) => ({ ...a })) : []).filter((a) => a.type !== 'phone');
    if (!fromServer && number2 <= FREE_BUILDINGS && !assets.some((a) => a.type === 'home')) assets.push({ type: 'home', plotIndex: number2 });
    for (const a of assets) if (a.type === 'home') a.free = true;
    out.push({
      id: raw.id || username,
      number: number2,
      username,
      displayName: raw.name || raw.displayName || username,
      joinedAt: raw.joinedAt || null,
      money: raw.money || 0,
      spent: raw.spent || 0,
      age: raw.age || null,
      balance: raw.balance,
      balanceAt: raw.balanceAt || null,
      income: raw.income ?? null,
      outfit: raw.outfit || 'hartna',
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
// The home you live in does NOT earn rent. Only extra houses you buy rent themselves out.
export const HOME_RENT_PER_HOUR = 0;
export const EXTRA_HOUSE_RENT_PER_HOUR = 4;
// Daily living costs: everyone eats, so food is taken out of your money a little every hour.
export const FOOD_PER_HOUR = 2;
export const FOOD_PER_DAY = FOOD_PER_HOUR * 24;
export const EXPENSE_RULES = [
  { emoji: '🍞', ar: 'أكل وشرب كل يوم', amount: FOOD_PER_DAY, note: 'بينخصم شوي شوي كل ساعة' },
];

export const EARN_RULES = [
  { emoji: '📱', ar: 'كل ساعة إنت ساكن بالمدينة', amount: BASE_INCOME_PER_HOUR, live: true, perHour: true },
  { emoji: '🏘️', ar: 'أجار كل بيت زيادة بتشتريه', amount: EXTRA_HOUSE_RENT_PER_HOUR, live: true, perHour: true },
  { emoji: '💬', ar: 'كل تعليق على بوست', amount: 50, live: false },
  { emoji: '📣', ar: 'تعمل منشن للحساب بالستوري', amount: 200, live: false },
];

export function incomePerHour(resident) {
  if (resident.income != null) return Number(resident.income);
  let total = BASE_INCOME_PER_HOUR - FOOD_PER_HOUR;
  const houses = (resident.assets || []).filter((a) => a.type === 'home' || a.type === 'house').length;
  total += Math.max(houses - 1, 0) * EXTRA_HOUSE_RENT_PER_HOUR; // the one you live in pays no rent
  for (const a of resident.assets || []) {
    if (a.type === 'house') continue;
    const item = SHOP.find((i) => i.key === a.type);
    if (item && item.incomePerHour) total += item.incomePerHour;
  }
  return total;
}

export function moneyNow(resident, now = Date.now()) {
  if (resident.balanceAt) return Math.floor(Number(resident.balance) + ((now - Date.parse(resident.balanceAt)) / 3600000) * incomePerHour(resident));
  const start = resident.joinedAt ? Date.parse(resident.joinedAt + (resident.joinedAt.length <= 10 ? 'T00:00:00+03:00' : '')) : now;
  const hours = Math.max(0, (now - start) / 3600000);
  return Math.floor((resident.money || 0) + hours * incomePerHour(resident) - (resident.spent || 0));
}

// ---- The shop --------------------------------------------------------------
export const SHOP = [
  { key: 'stall', emoji: '🛒', ar: 'بسطة بالسوق', desc: 'بتبيع عليها وبتجيبلك دخل', price: 500, incomePerHour: 4 },
  { key: 'shop', emoji: '🏪', ar: 'دكان', desc: 'دخل أكبر من البسطة', price: 3000, incomePerHour: 15 },
  { key: 'floor', emoji: '🧱', ar: 'كبّر بيتك (طابق زيادة)', desc: 'بيتك بيعلى طابق', price: 8000, incomePerHour: 0 },
  { key: 'house', emoji: '🏠', ar: 'بيت تاني', desc: 'بيت زيادة باسمك، بيتأجّر لحاله وبيجيبلك أجار', price: 12000, incomePerHour: 4 },
  { key: 'car', emoji: '🚗', ar: 'سيارة', desc: 'سيارة بتمشي بشوارع المدينة', price: 30000, incomePerHour: 0 },
  { key: 'building', emoji: '🏢', ar: 'عمارة', desc: 'عمارة كاملة بشقق للأجار', price: 150000, incomePerHour: 120 },
  { key: 'tower', emoji: '🏙️', ar: 'برج', desc: 'أعلى شي بالمدينة', price: 1000000, incomePerHour: 600 },
];


// The house market: list your house for sale at your own price, or buy a house a friend listed.
export const MARKET_RULES = [
  { emoji: '🏷️', ar: 'اعرض بيتك للبيع', desc: 'بتحط السعر اللي بدك ياه، وبيطلع بسوق البيوت' },
  { emoji: '🤝', ar: 'اشتري بيت صاحبك', desc: 'إذا عارض بيته، بتشتريه وبيصير باسمك' },
  { emoji: '🔑', ar: 'البيوت الزيادة بتتأجّر', desc: `بيتك اللي ساكن فيه ما بيتأجّر. كل بيت زيادة بتشتريه بيجيبلك ${EXTRA_HOUSE_RENT_PER_HOUR} 🪙 أجار كل ساعة` },
];

export const fmt = (n) => Math.floor(n).toLocaleString('en-US');

// ---- Clothes ---------------------------------------------------------------
// Everyone wears the same Hartna outfit by default; other outfits are sold in the clothes shop.
export const OUTFITS = [
  { key: 'hartna', ar: 'لبس مدينتنا', emoji: '🟢', price: 0, cloth: '#2f6b5a', pants: '#2a2a2a', robe: false, head: 'hair', headColor: '#1c120c' },
  { key: 'thobe', ar: 'ثوب وشماغ', emoji: '🤍', price: 800, cloth: '#f4f1ea', pants: '#f4f1ea', robe: true, head: 'keffiyehRed', headColor: '#b8322c' },
  { key: 'abaya', ar: 'عباية وحجاب', emoji: '🖤', price: 800, cloth: '#1f1f2a', pants: '#1f1f2a', robe: true, head: 'hijab', headColor: '#3b2b4a' },
  { key: 'jalabiya', ar: 'جلابية مطرّزة', emoji: '🧡', price: 1200, cloth: '#b5523b', pants: '#b5523b', robe: true, head: 'cap', headColor: '#f4f1ea' },
  { key: 'casual', ar: 'لبس عادي', emoji: '👕', price: 400, cloth: '#3b4a6b', pants: '#22304a', robe: false, head: 'cap', headColor: '#2b2b2b' },
  { key: 'gold', ar: 'لبس ذهبي', emoji: '✨', price: 20000, cloth: '#d4a94a', pants: '#3a2e25', robe: true, head: 'keffiyeh', headColor: '#d4a94a' },
];
export const outfitOf = (resident) => OUTFITS.find((o) => o.key === resident.outfit) || OUTFITS[0];
