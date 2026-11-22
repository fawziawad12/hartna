# مدينتنا · Madinatna

مدينة عربية قديمة ثلاثية الأبعاد بتكبر مع متابعين [@_madinatna](https://www.instagram.com/_madinatna/). كل واحد بيعلّق على إنستغرام بيصير ساكن بالمدينة: بيبلّش بموبايل بس، وبيمشي بالأزقة واسمه فوق راسه.

A 3D old Arabic neighbourhood (Three.js) that grows with an Instagram community. Phase 1: the map.

## Run

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # static site in dist/ (deploy to Vercel / Netlify as-is)
```

## Admin mode

Visitors only see orbit, tour, follow, shop and names. Open the site once with `?admin=hartna-admin` to unlock the admin buttons in that browser (reels 9:16, clean recording, manual day/night); `?admin=off` locks them again. Esc leaves recording mode. This only hides buttons; it is not a security feature.

Day and night follow the real time in Jordan (Asia/Amman).

## Money and shop

Money is virtual and computed from each resident's `joinedAt`: everyone earns 6 🪙 per hour, plus the hourly income of anything they own (`src/economy.js`, `SHOP`). Buying works once the Supabase backend is connected (below); without it the shop only shows prices.

## Backend (Supabase, free)

1. Create a project on supabase.com (region Frankfurt).
2. SQL Editor: paste `supabase/schema.sql` and Run (safe to re-run).
3. Set the admin password (SQL Editor, change the text):
   `insert into settings values ('admin_password_hash', encode(extensions.digest('YOUR-PASSWORD','sha256'),'hex')) on conflict (key) do update set value = excluded.value;`
4. Put the Project URL and anon key in `src/config.js`, build and deploy.
5. Instagram: when you have a long-lived Instagram token (Instagram API with Instagram Login, professional account),
   `insert into settings values ('ig_token', 'TOKEN') on conflict (key) do update set value = excluded.value;`
   Comments are then pulled every 5 minutes automatically: new commenters join the city, each comment pays +50 (max 10 a day), and a login code in a comment logs that person in.

How login works: a visitor types their Instagram username, gets a code like `HRT-4821`, and comments it on any post. When the comment arrives, the site gives them a session; no passwords. Until Instagram is connected, the admin can approve a code by hand (admin tools in 👤 حسابي, admin mode only).

All game rules live in two places that must agree: `src/economy.js` (what the site shows) and `hartna_price` / `hartna_income` in `supabase/schema.sql` (what the server charges).

## Controls

| Key | Button | |
|---|---|---|
| O | 🌀 دوران | Orbit (drag / zoom), slow auto-rotate |
| C | 🎬 جولة | Cinematic fly-through, loops (for reels) |
| F | 🚶 لحّق ساكن | Follow a resident (or click anyone in the street) |
| N | 🌙 ليل/نهار | Day ↔ night |
| L | 🏷️ الأسماء | Show / hide name tags |
| R | 📱 ريلز 9:16 | Vertical 9:16 frame for screen-recording reels |
| H | 👁️ تسجيل | Hide all UI for a clean recording |

URL options: `?mode=cinema`, `?time=night`, `?reels`, `?followers=25000` (preview minaret growth), `?duration=90` (fly-through length in seconds).

## Data: `public/data/residents.json`

Only real followers live in the city. To add someone, add a line at the END of the list (order = join order):

```json
{
  "instagram": "whatif_dream",
  "followers": 5,
  "residents": [
    { "username": "mo_awad0", "name": "مُحَمَّد عَواد" },
    { "username": "fawzi_1_1", "name": "Fawzi" }
  ]
}
```

- The city has exactly **100 buildings**. The first 100 residents each get one free building (a small one-person house, two floors, with their name and a flag on the roof); the nearest buildings to the square go to the earliest residents. The rest of the land is empty foundations for future growth.
- Resident #101 and after start with only a phone 📱.
- Optional per resident: `joinedAt`, `money` (virtual), `assets`.

Later phases: an Instagram comments webhook will append residents to this data; the economy (phase 3) adds owned places as assets with a plot id, e.g. `{ "type": "stall", "plotId": "stall-12" }`, and the city shows the owner's name over that plot. The ladder lives in `src/economy.js`: 📱 phone → 🛒 stall → 🏪 shop → 🏠 house → 🚗 car → 🏢 building → 🏙️ tower.

The city is generated from a fixed seed, so plot ids (`stall-1` … `stall-78`, `house-<block>-<n>`) are stable between loads, and each house has its own random stream so changing one never reshapes the others.

## The minaret

The minaret in the square grows with the follower count (`src/minaret.js`): about 26 m at the start, 45 m at 1k, 75 m at 10k and 110 m at 1M followers.

## Files

- `src/city.js`: alleys, houses, domes, mashrabiyas, lanterns, souq stalls, arches, khan, walls, oasis
- `src/residents.js`: walking residents with name tags
- `src/minaret.js`: the landmark that grows
- `src/cinematic.js`: the reel camera path
- `src/economy.js`: progression ladder and data model
