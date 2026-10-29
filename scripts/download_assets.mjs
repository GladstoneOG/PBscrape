import fs from 'fs';
import path from 'path';
import * as def from '../assets/defineProperty-quYBDGFA-mvsqtoo8.js';

const BASE_URL = 'https://pokebonk.com';
const ROOT_DIR = process.cwd();

const urlsToDownload = new Map(); // relativePath -> fullUrl

function addAsset(relPath) {
  relPath = relPath.replace(/^\.?\//, '');
  if (!relPath || urlsToDownload.has(relPath)) return;
  urlsToDownload.set(relPath, `${BASE_URL}/${relPath}`);
}

// 1. Root & PWA files
[
  'favicon.ico',
  'manifest.webmanifest',
  'version.json',
  'icons/favicon-96.png',
  'icons/apple-touch-icon.png',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'social/card-es.jpg',
].forEach(addAsset);

// 2. All CSS url(...) references (fonts, etc.)
const cssFiles = fs.readdirSync('assets').filter(f => f.endsWith('.css'));
for (const cf of cssFiles) {
  const css = fs.readFileSync(path.join('assets', cf), 'utf8');
  const re = /url\(([^)]+)\)/g;
  let m;
  while ((m = re.exec(css)) !== null) {
    const u = m[1].replace(/['"]/g, '').trim();
    if (u.startsWith('./')) {
      addAsset(`assets/${u.slice(2)}`);
    } else if (u.startsWith('/')) {
      addAsset(u.slice(1));
    }
  }
}

// 3. Environment packs
addAsset('assets/env/common/atlas.json');
addAsset('assets/env/common/atlas.png');
addAsset('assets/env/common/hazards.png');

const biomes = [
  'coast', 'desert', 'forest', 'frostlake', 'glacier',
  'graveyard', 'ruins', 'sanctum', 'stormcape', 'tower', 'volcano'
];
for (const b of biomes) {
  for (const f of ['atlas.json', 'atlas.png', 'ground.png', 'cliff.png', 'path.png']) {
    addAsset(`assets/env/${b}/${f}`);
  }
}

// 4. 3D Models (.glb)
const models = [
  'ball', 'portal', 'sanct_portal', 'ruin_portal', 'storm_portal', 'frost_portal', 'tower_portal',
  'chest', 'freechest', 'cursedchest', 'altar', 'greed', 'goldrock', 'cage', 'boss',
  'shrine', 'ruin_altar', 'storm_altar', 'frost_altar', 'challenge', 'cursed',
  'bounceshroom', 'slots', 'fossil', 'totem', 'porygon', 'billpc', 'nest', 'bill',
  'desert_hoodoo', 'desert_boulder', 'desert_skull', 'desert_pebbles', 'desert_rockpile',
  'glacier_spire', 'glacier_pillar', 'glacier_boulder', 'glacier_crystals',
  'coast_stack', 'coast_boulder',
  'ruins_hoodoo', 'ruins_obelisk', 'ruins_arch', 'ruins_statue', 'ruins_brazier',
  'ruins_obelisk_broken', 'ruins_column', 'ruins_fossil', 'ruins_crystals', 'ruins_pots', 'ruins_bones',
  'storm_coil', 'storm_rod', 'storm_tower', 'storm_pillar', 'storm_gate',
  'frost_lamp', 'frost_crystal', 'frost_pillar', 'frost_gate',
  'sanct_bramble', 'sanct_root', 'sanct_pillar', 'sanct_gate',
  'ruin_pillar', 'ruin_gate',
  'tentacle',
  'halloween_pumpkin', 'halloween_pumpkins',
  'johto_torii', 'johto_tower',
  'tower_altar', 'tower_banner', 'tower_bell', 'tower_candelabra', 'tower_column',
  'tower_gengar_grave', 'tower_grave_a', 'tower_grave_b', 'tower_grave_c',
  'tower_marowak_shrine', 'tower_pillar', 'tower_pots', 'tower_rail', 'tower_rubble',
  'tower_spire', 'tower_stairs', 'tower_wall_bay', 'tower_wall_plain'
];
for (const m of models) {
  addAsset(`assets/models/${m}.glb`);
}

// 5. Music (.ogg)
const tracks = ['menu', 'halloween-menu', 'ingame1', 'ingame2', 'ingame3', 'ingame4', 'boss'];
for (const t of tracks) {
  addAsset(`assets/music/${t}.ogg`);
}

// 6. Items (.png)
const itemsJson = JSON.parse(fs.readFileSync('data/items.json', 'utf8'));
for (const [key, val] of Object.entries(itemsJson)) {
  if (val.icon) addAsset(`assets/${val.icon}`);
  addAsset(`assets/items/${key}.png`);
}
for (const arr of [def.hi, def.bi, def.Wn, def.zn, def.rr, def.Un]) {
  if (!Array.isArray(arr)) continue;
  for (const it of arr) {
    if (it.icon) addAsset(`assets/items/${it.icon}.png`);
    if (it.key) addAsset(`assets/items/${it.key}.png`);
    if (it.id) addAsset(`assets/items/${it.id}.png`);
  }
}
if (Array.isArray(def.st)) {
  for (const k of def.st) addAsset(`assets/items/${k}.png`);
}
[
  'comet-shard', 'magnet', 'oran-berry', 'poke-ball', 'rare-candy', 'repel',
  'nugget', 'big-nugget', 'tm-fighting', 'tm-psychic', 'tm-steel', 'tm-electric',
  'tm-normal', 'tm-case', 'master-ball', 'moon-stone', 'soda-pop', 'lucky-egg', 'amulet-coin'
].forEach(k => addAsset(`assets/items/${k}.png`));
addAsset('assets/icons/100.png');

// 7. UI Assets
// 7a. Types
const typesJson = JSON.parse(fs.readFileSync('data/types.json', 'utf8'));
for (const t of typesJson.types || Object.keys(typesJson.names || {})) {
  addAsset(`assets/ui/types/${t}.png`);
  addAsset(`assets/ui/banners/type-${t}.jpg`);
  addAsset(`assets/ui/frames/type-${t}.png`);
}

// 7b. Avatars, Banners, Frames, Clan Deco/Sym from defineProperty
if (Array.isArray(def.x)) {
  for (const av of def.x) addAsset(`assets/ui/avatars/${av.id}.png`);
}
if (Array.isArray(def.y)) {
  for (const c of def.y) {
    const [kind, id] = (c.id || '').split(':');
    if (kind === 'tr') addAsset(`assets/ui/avatars/${id}.png`);
    if (kind === 'frame') addAsset(`assets/ui/frames/${id}.png`);
    if (kind === 'bg') addAsset(`assets/ui/banners/${id}.jpg`);
    if (kind === 'deco') addAsset(`assets/ui/clan/deco/${id}.png`);
    if (kind === 'sym') addAsset(`assets/ui/clan/sym/${id}.png`);
  }
}
if (Array.isArray(def.v)) {
  for (const b of def.v) {
    const id = b.id.replace(/^bg:/, '');
    addAsset(`assets/ui/banners/${id}.jpg`);
  }
}
[
  'dex', 'master', 'mon-ace', 'mon-master', 'candle', 'spectral', 'tower', 'look-stone',
  'clan-star', 'top1', 'top3', 'top10', 'top25', 'top50', 'top100'
].forEach(f => {
  addAsset(`assets/ui/frames/${f}.png`);
  addAsset(`assets/ui/banners/${f}.jpg`);
});
if (Array.isArray(def.Yn)) {
  for (const r of def.Yn) {
    addAsset(`assets/ui/frames/${r.id}.png`);
    addAsset(`assets/ui/ranks/${r.id}.png`);
  }
}
if (Array.isArray(def.Q)) {
  for (const r of def.Q) addAsset(`assets/ui/frames/${r.id.replace(/^frame:/, '')}.png`);
}
if (Array.isArray(def.tn)) {
  const styles = new Set(def.tn.map(x => x.style).filter(Boolean));
  for (const s of styles) {
    addAsset(`assets/ui/frames/look-${s}.png`);
    addAsset(`assets/ui/banners/look-${s}.jpg`);
  }
}
if (Array.isArray(def.et)) {
  for (const d of def.et) addAsset(`assets/ui/clan/deco/${d.id}.png`);
}
if (Array.isArray(def.it)) {
  for (const s of def.it) addAsset(`assets/ui/clan/sym/${s.id}.png`);
}
if (Array.isArray(def.tt)) {
  for (const s of def.tt) {
    const [k, id] = s.id.split(':');
    if (k === 'sym') addAsset(`assets/ui/clan/sym/${id}.png`);
    if (k === 'deco') addAsset(`assets/ui/clan/deco/${id}.png`);
  }
}
['pioneer', 'candelabra'].forEach(d => addAsset(`assets/ui/clan/deco/${d}.png`));
['sprout', 'cubone', 'egg'].forEach(s => addAsset(`assets/ui/clan/sym/${s}.png`));

// 7c. Events, Ranks, Treasures, Pings, Icons
['tower.jpg', 'tower-banner.jpg', 'tower-card.jpg'].forEach(f => addAsset(`assets/ui/events/${f}`));
if (Array.isArray(def.Kn)) {
  for (const r of def.Kn) {
    addAsset(`assets/ui/ranks/${r.id}.png`);
    addAsset(`assets/ui/icons/${r.icon || r.id}.png`);
  }
}
if (Array.isArray(def.Kt)) {
  for (const t of def.Kt) addAsset(`assets/ui/treasures/bg-${t.id}.png`);
}
['here', 'boss', 'item', 'portal', 'thanks', 'wait', 'danger', 'help'].forEach(p => addAsset(`assets/ui/pings/${p}.png`));

const uiIcons = [
  'aim', 'banish', 'blessing', 'bonk', 'bonk-big', 'brush', 'bug', 'champion', 'chat',
  'check', 'clan', 'coin', 'crown', 'dash', 'egg', 'friend-add', 'friends', 'fullscreen',
  'fullscreen-exit', 'globe', 'gold', 'silver', 'bronze', 'diamond', 'master', 'idea',
  'invite', 'jump', 'leave', 'lock', 'looks', 'mail', 'maldicion',
  'map-ball', 'map-freeball', 'map-cursedball', 'map-unown', 'map-bonk', 'map-boss',
  'map-portal', 'map-shrine', 'map-challenge', 'map-cursed', 'map-cage', 'map-rock',
  'map-shroom', 'map-bill', 'map-escalera', 'map-torre',
  'megaphone', 'mission', 'mut-dynamax', 'mut-metronome', 'mut-candy', 'mut-glass',
  'news', 'ofrenda', 'pause', 'pin',
  'r-gg', 'r-love', 'r-fire', 'r-star', 'r-lol', 'r-wow',
  'record', 'request', 'reroll', 'research', 'rival', 'rotate', 'send',
  'shiny-charm', 'shiny-classic', 'skip', 'slots',
  'st-burn', 'st-poison', 'st-para', 'st-sleep', 'st-frozen', 'st-chill',
  'st-stun', 'st-confuse', 'st-charm', 'st-root', 'st-pull', 'st-wet',
  'st-curse', 'st-healblock', 'st-shield',
  'stardust', 'streak', 'target', 'torre', 'treasure', 'unlock', 'vela'
];
for (const ic of uiIcons) addAsset(`assets/ui/icons/${ic}.png`);

// 8. Pokemon Assets
// Default: 1..251 (Gen 1 Kanto + Gen 2 Johto), or 1..1025 with --all-dex
const maxId = process.argv.includes('--all-dex') ? 1025 : 251;
const spritesJson = JSON.parse(fs.readFileSync('data/sprites.json', 'utf8'));
for (let id = 1; id <= maxId; id++) {
  addAsset(`assets/cries/${id}.ogg`);
  addAsset(`assets/icons/${id}.png`);
  addAsset(`assets/portraits/${id}.png`);
  addAsset(`assets/portraits-shiny/${id}.png`);
  addAsset(`assets/front/${id}.png`);
  const sp = spritesJson[String(id)];
  if (sp && !sp.fallback) {
    addAsset(`assets/pmd/${id}.png`);
    addAsset(`assets/pmd-shiny/${id}.png`);
  } else if (sp && sp.fallback) {
    addAsset(`assets/${sp.fallback}`);
  }
}

console.log(`Prepared ${urlsToDownload.size} asset URLs to download (maxDex=${maxId}).`);

const entries = [...urlsToDownload.entries()];
let completed = 0;
let downloaded = 0;
let skipped = 0;
let notFound = 0;
let failed = 0;

const CONCURRENCY = 30;
let idx = 0;

async function worker() {
  while (idx < entries.length) {
    const current = idx++;
    const [relPath, url] = entries[current];
    const dest = path.join(ROOT_DIR, relPath);
    if (fs.existsSync(dest) && fs.statSync(dest).size > 0) {
      skipped++;
      completed++;
      continue;
    }
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    let ok = false;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await fetch(url);
        if (res.status === 404) {
          notFound++;
          ok = true;
          break;
        }
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const buf = Buffer.from(await res.arrayBuffer());
        fs.writeFileSync(dest, buf);
        downloaded++;
        ok = true;
        break;
      } catch (e) {
        if (attempt === 2) {
          failed++;
          console.error(`Failed: ${relPath} (${e.message})`);
        } else {
          await new Promise(r => setTimeout(r, 300 * (attempt + 1)));
        }
      }
    }
    completed++;
    if (completed % 200 === 0 || completed === entries.length) {
      console.log(`Progress: ${completed}/${entries.length} (downloaded=${downloaded}, skipped=${skipped}, 404=${notFound}, failed=${failed})`);
    }
  }
}

await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));
console.log(`Done! Total=${entries.length}, Downloaded=${downloaded}, Skipped=${skipped}, 404=${notFound}, Failed=${failed}`);
