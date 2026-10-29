import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';

const BASE_URL = 'https://pokebonk.com';
const ROOT_DIR = process.cwd();
const force = process.argv.includes('--force');
const allDex = process.argv.includes('--all-dex');

async function fetchText(url) {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return await res.text();
}

async function downloadFile(relPath, overwrite = true) {
  relPath = relPath.replace(/^\.?\//, '');
  const dest = path.join(ROOT_DIR, relPath);
  if (!overwrite && fs.existsSync(dest) && fs.statSync(dest).size > 0) {
    return false;
  }
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const res = await fetch(`${BASE_URL}/${relPath}`, { cache: 'no-store' });
  if (!res.ok) {
    console.warn(`  [skip] ${relPath} (HTTP ${res.status})`);
    return false;
  }
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(dest, buf);
  console.log(`  [saved] ${relPath} (${(buf.length / 1024).toFixed(1)} KB)`);
  return true;
}

console.log('=== PokéBonk Auto-Updater ===');

// 1. Check live version.json vs local version.json
let liveVersion = { build: 'unknown', version: 'unknown' };
let localVersion = { build: 'none', version: 'none' };

try {
  liveVersion = JSON.parse(await fetchText(`${BASE_URL}/version.json`));
} catch (e) {
  console.error(`Could not reach ${BASE_URL}/version.json: ${e.message}`);
  process.exit(1);
}

if (fs.existsSync(path.join(ROOT_DIR, 'version.json'))) {
  try {
    localVersion = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'version.json'), 'utf8'));
  } catch {}
}

console.log(`Local version : ${localVersion.version} (build ${localVersion.build})`);
console.log(`Live version  : ${liveVersion.version} (build ${liveVersion.build})`);

if (
  !force &&
  liveVersion.build === localVersion.build &&
  liveVersion.version === localVersion.version
) {
  console.log('\nAlready on the latest build! Checking for any missing assets...');
} else {
  console.log('\nNew update detected (or --force used)! Scraping updated bundles & data...');
}

// 2. Fetch live index.html and save index_raw.html + version.json
fs.writeFileSync(path.join(ROOT_DIR, 'version.json'), JSON.stringify(liveVersion, null, 2));
const rawHtml = await fetchText(`${BASE_URL}/`);
fs.writeFileSync(path.join(ROOT_DIR, 'index_raw.html'), rawHtml);

// 3. Parse entry JS & preload links from index_raw.html
const assetRefs = new Set();
const htmlAssetRe = /(?:src|href)=["'](?:\.\/|\/)?(assets\/[^"'?#]+)["']/g;
let m;
while ((m = htmlAssetRe.exec(rawHtml)) !== null) {
  assetRefs.add(m[1]);
}

let entryBootJs = null;
for (const ref of assetRefs) {
  await downloadFile(ref, true);
  if (ref.startsWith('assets/main-') && ref.endsWith('.js')) {
    entryBootJs = ref;
  }
}

if (!entryBootJs) {
  throw new Error('Could not find main entry JS in live index.html');
}

// 4. Parse boot loader JS for __vite__mapDeps and dynamic language imports
const bootCode = fs.readFileSync(path.join(ROOT_DIR, entryBootJs), 'utf8');
const depRe = /["']\.\/([^"']+\.(?:js|css))["']/g;
let definePropJs = null;
let mainGameJs = null;

while ((m = depRe.exec(bootCode)) !== null) {
  const rel = `assets/${m[1]}`;
  assetRefs.add(rel);
  await downloadFile(rel, true);
  if (m[1].startsWith('defineProperty-') && m[1].endsWith('.js')) {
    definePropJs = rel;
  } else if (m[1].startsWith('main-') && m[1].endsWith('.js') && rel !== entryBootJs) {
    mainGameJs = rel;
  }
}

// 5. Patch index.html for offline play (inject ./offline-api.js and remove external Cloudflare script)
let patchedHtml = rawHtml
  .replace(/<script[^>]*challenges\.cloudflare\.com\/turnstile[^>]*><\/script>\s*/gi, '')
  .replace(/(?:href|src)=["']\/(assets\/|icons\/|favicon\.ico|manifest\.webmanifest)/g, (full, p1) => {
    const attr = full.startsWith('href') ? 'href' : 'src';
    return `${attr}="./${p1}`;
  });

if (!patchedHtml.includes('./offline-api.js')) {
  patchedHtml = patchedHtml.replace(
    /(<script\s+type="module"[^>]*src="\.\/assets\/main-[^"]+"[^>]*><\/script>)/i,
    `<script type="module" src="./offline-api.js"></script>\n    $1`
  );
}
fs.writeFileSync(path.join(ROOT_DIR, 'index.html'), patchedHtml);
console.log('  [patched] index.html with ./offline-api.js');

// 6. Update defineProperty import inside offline-api.js and scripts/download_assets.mjs if hash changed
if (definePropJs) {
  const defFile = path.basename(definePropJs);

  const offlineApiPath = path.join(ROOT_DIR, 'offline-api.js');
  if (fs.existsSync(offlineApiPath)) {
    const code = fs.readFileSync(offlineApiPath, 'utf8');
    const updated = code.replace(
      /from\s+['"]\.\/assets\/defineProperty-[^'"]+\.js['"]/,
      `from './assets/${defFile}'`
    );
    if (updated !== code) {
      fs.writeFileSync(offlineApiPath, updated);
      console.log(`  [updated] offline-api.js -> ./assets/${defFile}`);
    }
  }

  const dlScriptPath = path.join(ROOT_DIR, 'scripts', 'download_assets.mjs');
  if (fs.existsSync(dlScriptPath)) {
    const code = fs.readFileSync(dlScriptPath, 'utf8');
    const updated = code.replace(
      /from\s+['"]\.\.\/assets\/defineProperty-[^'"]+\.js['"]/,
      `from '../assets/${defFile}'`
    );
    if (updated !== code) {
      fs.writeFileSync(dlScriptPath, updated);
      console.log(`  [updated] scripts/download_assets.mjs -> ../assets/${defFile}`);
    }
  }
}

// 7. Download all JSON databases in data/
console.log('\nUpdating JSON databases in data/...');
const jsonFiles = [
  'data/pokemon.json',
  'data/sprites.json',
  'data/moves.json',
  'data/abilities.json',
  'data/items.json',
  'data/learnsets.json',
  'data/types.json',
  'data/news.json',
  'data/i18n/en.json',
  'data/i18n/es.json',
  'data/i18n/fr.json',
  'data/i18n/ja.json',
  'data/i18n/ko.json',
  'data/i18n/pt.json',
  'data/i18n/ru.json',
  'data/i18n/zh.json',
  'data/i18n/zht.json'
];
for (const jf of jsonFiles) {
  await downloadFile(jf, true);
}

// 8. Scan main game bundle for any newly added .glb models, biomes, or music tracks
if (mainGameJs && fs.existsSync(path.join(ROOT_DIR, mainGameJs))) {
  const gameCode = fs.readFileSync(path.join(ROOT_DIR, mainGameJs), 'utf8');

  // Find any explicit assets/models/*.glb or model keys in the bundle
  const glbRe = /assets\/models\/([a-z0-9_-]+)\.glb/gi;
  while ((m = glbRe.exec(gameCode)) !== null) {
    await downloadFile(`assets/models/${m[1]}.glb`, false);
  }

  // Find any music tracks
  const musicRe = /assets\/music\/([a-z0-9_-]+)\.ogg/gi;
  while ((m = musicRe.exec(gameCode)) !== null) {
    await downloadFile(`assets/music/${m[1]}.ogg`, false);
  }
}

// 9. Run scripts/download_assets.mjs to fetch all remaining models, sprites, UI icons, and fonts
console.log('\nRunning asset downloader for models, biomes, sprites, audio & UI...');
const dlArgs = [path.join(ROOT_DIR, 'scripts', 'download_assets.mjs')];
if (allDex) dlArgs.push('--all-dex');
execFileSync(process.execPath, dlArgs, { stdio: 'inherit' });

console.log(`\nUpdate complete! Local copy is now at v${liveVersion.version} (build ${liveVersion.build}).`);
