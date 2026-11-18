# حارتنا · Hartna

حارة عربية قديمة ثلاثية الأبعاد بتكبر مع المتابعين. كل واحد بيعلّق على إنستغرام بيصير ساكن بالحارة: بيبلّش بموبايل بس، وبيمشي بالأزقة واسمه فوق راسه.

A 3D old Arabic neighbourhood (Three.js) that grows with an Instagram community. Phase 1: the map.

## Run

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # static site in dist/ (deploy to Vercel / Netlify as-is)
```

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

- The city has exactly **100 buildings**. The first 100 residents each get one free building (with their name and a flag on the roof); the nearest buildings to the square go to the earliest residents. The rest of the land is empty foundations for future growth.
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
