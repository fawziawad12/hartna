import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

export const online = !!(SUPABASE_URL && SUPABASE_ANON_KEY);

const ERRORS = {
  'not enough money': 'ما معك مصاري كفاية 🪙',
  'not logged in': 'لازم تسجّل دخول أول',
  'already owned': 'هاد عندك أصلاً',
  'you need a house first': 'لازم يكون عندك بيت أول',
  'not your house': 'هاد مش بيتك',
  'not for sale': 'هاد البيت مش معروض للبيع',
  'already yours': 'هاد بيتك أصلاً',
  'buy it first': 'لازم تشتريه أول',
  'bad username': 'اسم المستخدم مش مزبوط',
  'not admin': 'كلمة سر الأدمن غلط',
  'unknown item': 'هاد الغرض مش موجود',
  'name too long': 'الاسم طويل كتير',
};

export async function rpc(fn, args = {}) {
  if (!online) throw new Error('offline');
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    // new "sb_publishable_" keys go only in the apikey header; old JWT anon keys also as Bearer
    headers: { apikey: SUPABASE_ANON_KEY, 'Content-Type': 'application/json', ...(SUPABASE_ANON_KEY.startsWith('sb_') ? {} : { Authorization: `Bearer ${SUPABASE_ANON_KEY}` }) },
    body: JSON.stringify(args),
  });
  const text = await res.text();
  const body = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const msg = body?.message || res.statusText;
    const err = new Error(ERRORS[msg] || msg);
    err.raw = msg;
    throw err;
  }
  return body;
}
