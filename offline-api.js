import * as def from './assets/defineProperty-DVBPR9km-mvznto7p.js';

const STORAGE_KEY = 'pb.offline.state.v1';
const DEVICE_ID_KEY = 'pb.offline.deviceId';
const TAB_NAME_KEY = 'pb.offline.tabName';
const API_ORIGIN = 'https://api.pokebonk.com';

// 0. Optimize WebRTC for Local / LAN Co-op so ICE gathering completes in <10ms
// without waiting 6s for external STUN timeouts when offline.
if (typeof window !== 'undefined' && typeof window.RTCPeerConnection === 'function') {
  const OrigPeerConnection = window.RTCPeerConnection;
  const PatchedPeerConnection = function (config) {
    const cleanConfig = { ...(config || {}), iceServers: [] };
    delete cleanConfig.iceTransportPolicy;
    return new OrigPeerConnection(cleanConfig);
  };
  PatchedPeerConnection.prototype = OrigPeerConnection.prototype;
  Object.setPrototypeOf(PatchedPeerConnection, OrigPeerConnection);
  window.RTCPeerConnection = PatchedPeerConnection;
}

// 1. Mock Cloudflare Turnstile so offline auth never blocks or times out
window.turnstile = {
  render(el, opts) {
    setTimeout(() => opts?.callback?.('offline-turnstile-token'), 10);
    return 'offline-widget-1';
  },
  reset() {},
  remove() {}
};

// 2. Default Profile & State Management
function createDefaultProfile(name = 'Entrenador') {
  return {
    v: 1,
    name,
    created: Date.now(),
    stardust: 500,
    totalStardust: 500,
    bonk: 0,
    totalBonk: 0,
    unlocked: [1, 4, 7],
    league: [1, 4, 7],
    starter: 4,
    forms: [],
    research: {},
    captured: { 1: Date.now(), 4: Date.now(), 7: Date.now() },
    seen: [1, 4, 7],
    played: [],
    shinies: [],
    classics: [],
    skins: [],
    team: [4],
    lab: {},
    biomes: { forest: 0 },
    quests: {},
    counters: {},
    runs: [],
    best: {},
    times: {},
    kills: {},
    medals: {},
    endless: {},
    treasures: {},
    events: {},
    settings: {
      master: 0.8,
      music: 0.5,
      sfx: 0.7,
      cries: 0.6,
      quality: 'high',
      aimMode: 'auto',
      sensitivity: 1,
      invertY: false,
      damageNumbers: true,
      floatText: true,
      shakeOn: true,
      screenShake: 1,
      fov: 70,
      showFps: false,
      reduceFlashes: false,
      pixel: 0,
      muteHidden: true,
      theme: 'auto',
      hudScale: 1,
      hudOpacity: 1,
      bossBarOpacity: 1,
      bossHpText: 'num',
      showBanners: true,
      showMinimap: true,
      showLadder: true,
      showToasts: true,
      showStreak: true,
      showItems: true,
      mapScale: 1,
      mapIcons: 1,
      mapNorthUp: false,
      fxOpacity: 1,
      ownFxOpacity: 1,
      fxGlow: 1,
      touchScale: 1,
      camDist: 9,
      calmCandies: false,
      pickupFx: 'full',
      mateFx: 'full',
      skipEmptyLevelUp: false,
      hideOwnFx: false,
      fixedStick: false,
      padRumble: true,
      padDead: 0.15,
      autoUlt: false,
      ultPose: true,
      tours: '',
      hintsSeen: '',
      tips: true
    },
    lastSpecies: 4,
    lastBiome: 'forest',
    banished: [],
    itemsOwned: [],
    itemsOff: [],
    daily: { idx: 0, ids: [], prog: [0, 0, 0], claimed: [0, 0, 0, 0], rerolls: 0 },
    weekly: { idx: 0, ids: [], prog: [0, 0, 0], claimed: [0, 0, 0, 0], rerolls: 0 },
    dailyStreak: { last: 0, n: 0 },
    bag: {},
    avatar: '',
    frame: '',
    title: '',
    banner: '',
    cosmetics: []
  };
}

function getDeviceId() {
  try {
    let devId = localStorage.getItem(DEVICE_ID_KEY);
    if (!devId) {
      devId = Math.random().toString(36).slice(2, 6);
      localStorage.setItem(DEVICE_ID_KEY, devId);
    }
    return devId;
  } catch {
    return 'loc1';
  }
}

const deviceId = getDeviceId();
let tabSlot = 1;
let tabIdentityResolved = false;
let tabIdentityPromise = null;

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && parsed.profile) {
        parsed.profile = { ...createDefaultProfile(parsed.account?.name || 'Entrenador'), ...parsed.profile };
        parsed.account = {
          id: parsed.account?.id || `trainer-${deviceId}-1`,
          name: parsed.account?.name || parsed.profile.name || 'Entrenador',
          token: parsed.account?.token || `token-${deviceId}-1`,
          guest: false
        };
        return parsed;
      }
    }
  } catch (e) {
    console.warn('[OfflineAPI] Failed to read localStorage:', e);
  }
  const initial = {
    account: {
      id: `trainer-${deviceId}-1`,
      name: 'Entrenador',
      token: `token-${deviceId}-1`,
      guest: false
    },
    profile: createDefaultProfile('Entrenador'),
    records: [],
    endlessRecords: [],
    builds: {}
  };
  saveState(initial);
  return initial;
}

function getTabAccount() {
  const baseName = (state?.profile?.name || state?.account?.name || 'Entrenador').replace(/\s+#\d+$/, '');
  let customTabName = '';
  try {
    customTabName = (sessionStorage.getItem(TAB_NAME_KEY) || '').trim();
  } catch {}
  const name = customTabName || (tabSlot === 1 ? baseName : `${baseName} #${tabSlot}`);
  const id = `trainer-${deviceId}-${tabSlot}`;
  const token = `token-${deviceId}-${tabSlot}`;
  return { id, name, token, guest: false };
}

// Acquire a per-tab lock so multiple tabs on the same browser automatically become Player 1, Player 2, Player 3, Player 4!
function ensureTabIdentity() {
  if (tabIdentityResolved) return Promise.resolve(getTabAccount());
  if (tabIdentityPromise) return tabIdentityPromise;

  tabIdentityPromise = (async () => {
    if (navigator.locks?.request) {
      for (let s = 1; s <= 16; s++) {
        const acquired = await new Promise(resolve => {
          navigator.locks.request(`pb-offline-tab-${s}`, { ifAvailable: true }, lock => {
            if (!lock) {
              resolve(false);
              return;
            }
            tabSlot = s;
            resolve(true);
            // Hold lock for the lifetime of this tab
            return new Promise(() => {});
          }).catch(() => resolve(false));
        });
        if (acquired) break;
      }
    } else {
      try {
        let s = Number(sessionStorage.getItem('pb.offline.tabSlot'));
        if (!s) {
          s = Math.floor(1 + Math.random() * 999);
          sessionStorage.setItem('pb.offline.tabSlot', String(s));
        }
        tabSlot = s;
      } catch {}
    }
    tabIdentityResolved = true;
    const acc = getTabAccount();
    try {
      localStorage.setItem('pb.session', JSON.stringify(acc));
    } catch {}
    return acc;
  })();

  return tabIdentityPromise;
}

const origFetch = window.fetch.bind(window);

function saveState(st, syncDisk = true) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(st));
    const acc = getTabAccount();
    localStorage.setItem('pb.session', JSON.stringify(acc));
  } catch (e) {
    console.warn('[OfflineAPI] Failed to save localStorage:', e);
  }
  if (syncDisk) {
    origFetch('/api/local-save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(st)
    }).catch(() => {});
  }
}

let state = loadState();
ensureTabIdentity().then(() => {
  sendPresenceHeartbeat();
});

// Sync from disk save on startup if running via server.mjs
origFetch('/api/local-save')
  .then(r => (r.ok ? r.json() : null))
  .then(diskState => {
    if (diskState && diskState.profile) {
      const localRuns = state.profile?.runs?.length || 0;
      const diskRuns = diskState.profile?.runs?.length || 0;
      const localDust = state.profile?.totalStardust || 0;
      const diskDust = diskState.profile?.totalStardust || 0;
      if (diskRuns >= localRuns && diskDust >= localDust) {
        state = diskState;
        saveState(state, false);
      } else {
        saveState(state, true);
      }
    }
  })
  .catch(() => {});

// Ensure session exists immediately on first load so user skips auth prompt
if (!localStorage.getItem('pb.session')) {
  localStorage.setItem('pb.session', JSON.stringify(getTabAccount()));
}

// Keep tabs in sync when Unlock All or currency changes in another tab
window.addEventListener('storage', e => {
  if (e.key === STORAGE_KEY && e.newValue) {
    try {
      const updated = JSON.parse(e.newValue);
      if (updated && updated.profile) {
        state = updated;
      }
    } catch {}
  }
});

// Build X-PB-Player metadata header for server.mjs Co-op coordinator
function buildPlayerHeader() {
  const acc = getTabAccount();
  const p = state.profile || {};
  const payload = {
    id: acc.id,
    name: acc.name,
    guest: false,
    avatar: p.avatar || '',
    frame: p.frame || '',
    title: p.title || '',
    banner: p.banner || '',
    species: p.lastSpecies || p.starter || 4,
    skins: p.skins || [],
    maps: { forest: 3, desert: 3, coast: 3, glacier: 3, ...(p.biomes || {}) },
    league: (p.league || []).length,
    shinies: (p.shinies || []).length,
    achievements: Object.keys(p.quests || {}).length
  };
  return encodeURIComponent(JSON.stringify(payload));
}

async function callMpServer(mpPath, method = 'GET', bodyObj = null) {
  await ensureTabIdentity();
  const res = await origFetch(`/api/mp${mpPath}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'X-PB-Player': buildPlayerHeader()
    },
    body: bodyObj && (method === 'POST' || method === 'PUT') ? JSON.stringify(bodyObj) : undefined
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || data.message || `HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

function sendPresenceHeartbeat() {
  callMpServer('/hello', 'POST', {}).catch(() => {});
}

setInterval(sendPresenceHeartbeat, 15000);

// 3. Auto-discover game definitions from defineProperty-*.js by structural shape
// so Rollup export alias renames across game updates can never break offline-api.js.
const defValues = Object.values(def);
function findDefArray(pred) {
  return defValues.find(v => Array.isArray(v) && v.length > 0 && pred(v)) || [];
}
function findDefFunc(re) {
  return defValues.find(v => typeof v === 'function' && re.test(v.toString())) || null;
}
function safeCall(fn, fallback, ...args) {
  if (typeof fn !== 'function') return fallback;
  try {
    const res = fn(...args);
    return res !== undefined ? res : fallback;
  } catch {
    return fallback;
  }
}

const LAB_LIST = findDefArray(a => a.some(x => x && x.id === 'slot-move' && typeof x.max === 'number'));
const ITEMS_SHOP_LIST = findDefArray(a => a.some(x => x && x.key === 'soda-pop' && typeof x.price === 'number'));
const DAILY_SHOP_LIST = findDefArray(a => a.some(x => x && x.id === 'rare-candy' && typeof x.daily === 'number'));
const QUESTS_LIST = findDefArray(a => a.length > 50 && a[0]?.id && typeof a[0]?.goal === 'number' && typeof a[0]?.reward === 'number');
const EVENTS_LIST = findDefArray(a => a[0]?.id && Array.isArray(a[0]?.track) && Array.isArray(a[0]?.quests));
const WHEELS_LIST = findDefArray(a => a[0]?.id && a[0]?.starter && Array.isArray(a[0]?.prizes));
const COSMETICS_LIST = findDefArray(a => a.length > 20 && a.some(x => String(x?.id).startsWith('tr:')));
const AVATARS_LIST = findDefArray(a => a.some(x => x && x.id === 'boy' && x.free));

const fnCalcScore = findDefFunc(/e\.mode===[`'"]endless[`'"]\?Math\.round\(e\.kills\*2/);
const fnCalcMedal = findDefFunc(/for\(let \w+=0;\w+<\w+\.length;\w+\+\+\)\w+<=\w+\[\w+\]&&\(\w+=\w+\+1\);return \w+/);
const fnGetTaskById = findDefFunc(/\.daily\.flat\(\)\.concat\(/);
const fnPickTask = findDefFunc(/977\+\w+\*131/);
const fnGetSeasonInfo = findDefFunc(/start:\w+\?\.start\?\?0,end:\w+\?\.end\?\?0,live:/);
const fnGetDayIndex = findDefFunc(/^e=>Math\.floor\(\(e-\w+\)\/\w+\)\+1$/);
const fnGetMutationForDay = findDefFunc(/mutation:\w+\[\w+\],biome:/);
const fnGetShopCost = findDefFunc(/Math\.round\(e\.price\*\(1\+/);
const fnEncodeLookSkin = findDefFunc(/t===[`'"]shiny[`'"]\?e:t===[`'"]spectral[`'"]\?-e/);

const LAB_MAP = new Map(LAB_LIST.map(x => [x.id, x]));
const ITEMS_SHOP_MAP = new Map(ITEMS_SHOP_LIST.map(x => [x.key, x]));
const DAILY_SHOP_MAP = new Map(DAILY_SHOP_LIST.map(x => [x.id, x]));
const BIOMES_CHAIN = ['forest', 'desert', 'coast', 'glacier'];

function ensureBiomesUnlocked(p) {
  p.biomes = p.biomes || { forest: 0 };
  if (!('forest' in p.biomes)) p.biomes.forest = 0;
  for (let i = 1; i < BIOMES_CHAIN.length; i++) {
    const prev = BIOMES_CHAIN[i - 1];
    const cur = BIOMES_CHAIN[i];
    if ((p.biomes[prev] ?? -1) >= 1 && !(cur in p.biomes)) {
      p.biomes[cur] = 0;
    }
  }
}

function applyBuyLab(p, id) {
  const item = LAB_MAP.get(id);
  if (!item) return false;
  const lv = p.lab[id] ?? 0;
  if (lv >= item.max) return false;
  const cost = typeof item.cost === 'function' ? item.cost(lv) : 100 * (lv + 1);
  if (p.stardust < cost) return false;
  p.stardust -= cost;
  p.lab[id] = lv + 1;
  return true;
}

function applyBuyItem(p, key) {
  const item = ITEMS_SHOP_MAP.get(key);
  if (!item || p.itemsOwned.includes(key) || p.stardust < item.price) return false;
  p.stardust -= item.price;
  p.itemsOwned.push(key);
  return true;
}

function applyBuyShop(p, id) {
  const item = DAILY_SHOP_MAP.get(id);
  if (!item) return false;
  const day = safeCall(fnGetDayIndex, Math.floor(Date.now() / 86400000), Date.now());
  const bought = p.shop && p.shop.day === day ? p.shop.n : {};
  const n = bought[id] ?? 0;
  if (n >= item.daily) return false;
  const cost = safeCall(fnGetShopCost, item.price, item, n);
  if (p.stardust < cost) return false;
  p.stardust -= cost;
  p.bag[id] = Math.min(9, (p.bag[id] ?? 0) + 1);
  p.shop = { day, n: { ...bought, [id]: n + 1 } };
  return true;
}

function applyArchiveItem(p, key, off) {
  if (off) {
    if (!p.itemsOff.includes(key)) p.itemsOff.push(key);
  } else {
    p.itemsOff = p.itemsOff.filter(k => k !== key);
  }
  return true;
}

function applyClaimQuest(p, id) {
  const q = QUESTS_LIST.find(x => x.id === id);
  if (!q || p.quests[id]) return false;
  p.quests[id] = 1;
  const reward = q.reward || 50;
  p.stardust += reward;
  p.totalStardust += reward;
  if (q.title && !p.cosmetics.includes(`title:q:${q.id}`)) {
    p.cosmetics.push(`title:q:${q.id}`);
  }
  if (q.look && q.look.style) {
    const lk = `frame:look-${q.look.style}`;
    if (!p.cosmetics.includes(lk)) p.cosmetics.push(lk);
  }
  return true;
}

function applyClaimTask(p, period, slot) {
  const blk = p[period];
  if (!blk || blk.claimed[slot]) return false;
  blk.claimed[slot] = 1;
  const rewards = period === 'weekly' ? [300, 450, 700, 500] : [60, 100, 160, 150];
  const dust = rewards[slot] || 100;
  p.stardust += dust;
  p.totalStardust += dust;
  if (slot < 3) {
    p.counters.tasks = (p.counters.tasks ?? 0) + 1;
  } else if (period === 'daily') {
    p.dailyStreak = { last: blk.idx, n: (p.dailyStreak?.n ?? 0) + 1 };
    p.bag['rare-candy'] = Math.min(9, (p.bag['rare-candy'] ?? 0) + 1);
  } else if (period === 'weekly') {
    p.bag['master-ball'] = Math.min(9, (p.bag['master-ball'] ?? 0) + 1);
  }
  return true;
}

function applyRerollTask(p, period, slot) {
  const blk = p[period];
  if (!blk || slot < 0 || slot > 2) return false;
  blk.rerolls = (blk.rerolls ?? 0) + 1;
  const nextTask = safeCall(fnPickTask, null, period, blk.idx || 1, slot, blk.rerolls);
  if (nextTask && nextTask.id) {
    blk.ids[slot] = nextTask.id;
    blk.prog[slot] = 0;
  }
  return true;
}

function computeRunScoreFallback(r) {
  const kills = r.kills || 0;
  const time = r.time || 0;
  const damage = r.damage || 0;
  const bosses = r.bosses || 0;
  const stage = r.stage || 1;
  const tier = r.tier || 0;
  if (r.mode === 'endless') {
    return Math.round(kills * 2 + time * 4 + damage / 200 + bosses * 800 + (r.legendaries || 0) * 2000);
  }
  if (r.mode === 'tower') {
    return Math.round(kills * 2 + time * 3 + damage / 200 + (stage - 1) * 800 + bosses * 500 + (r.victory ? 6000 : 0));
  }
  return Math.round(
    Math.round(kills * 2 + time * 3 + damage / 200 + (stage - 1) * 1500 + bosses * 800 + (r.victory ? 6000 : 0)) *
      (1 + tier * 0.5)
  );
}

async function finishRunOffline(body, runIdFromUrl) {
  const p = state.profile;
  const r = body?.result || {};
  const prog = r.progress || {};

  // 1. Merge counters, research, seen, forms, shinies, classics, league
  for (const [k, v] of Object.entries(prog.counters || {})) {
    p.counters[k] = (p.counters[k] ?? 0) + v;
  }
  for (const [k, v] of Object.entries(prog.research || {})) {
    p.research[+k] = (p.research[+k] ?? 0) + v;
  }
  for (const s of [...(prog.seen || []), ...(prog.shinies || []), ...(prog.classics || []), r.species, r.finalSpecies]) {
    if (s && !p.seen.includes(s)) p.seen.push(s);
  }
  for (const f of prog.forms || []) {
    if (!p.forms.includes(f)) p.forms.push(f);
  }
  for (const sh of prog.shinies || []) {
    if (!p.shinies.includes(sh)) p.shinies.push(sh);
  }
  for (const cl of prog.classics || []) {
    if (!p.classics.includes(cl)) p.classics.push(cl);
  }
  for (const lg of prog.league || []) {
    if (!p.league.includes(lg)) p.league.push(lg);
    if (!p.unlocked.includes(lg)) p.unlocked.push(lg);
    p.captured[lg] ??= Date.now();
  }
  if (r.species && !p.played.includes(r.species)) {
    p.played.push(r.species);
  }

  // 2. Score & Stardust calculation
  const fallbackScore = computeRunScoreFallback(r);
  const rawScore = safeCall(fnCalcScore, fallbackScore, r);
  const score = typeof rawScore === 'number' && !Number.isNaN(rawScore) ? rawScore : fallbackScore;

  const baseDust = Math.max(
    10,
    Math.round(
      (r.kills || 0) * 0.12 +
      (r.time || 0) * 0.18 +
      ((r.stage || 1) - 1) * 45 +
      (r.bosses || 0) * 35 +
      (r.legendaries || 0) * 80 +
      (r.victory ? 150 : 0)
    )
  );
  const tierMul = 1 + (r.tier || 0) * 0.25;
  let stardust = Math.round(baseDust * tierMul);

  // 3. Biome progression & Time Trial Medals
  let medal = 0;
  let medalDust = 0;
  const biomeKey = `${r.biome}-${r.tier || 0}`;
  const prevBest = p.times[biomeKey] ?? null;
  const prevKills = p.kills[biomeKey] ?? null;
  let pb = false;

  if (r.victory && r.mode !== 'endless' && r.mode !== 'tower') {
    const curTier = p.biomes[r.biome] ?? 0;
    if ((r.tier || 0) + 1 > curTier) {
      p.biomes[r.biome] = (r.tier || 0) + 1;
    }
    ensureBiomesUnlocked(p);

    if (prevBest === null || r.time < prevBest) {
      p.times[biomeKey] = r.time;
      pb = true;
    }
    const earnedMedal = safeCall(fnCalcMedal, 0, r.biome, r.tier || 0, r.time, true);
    const prevMedal = p.medals[biomeKey] ?? 0;
    if (typeof earnedMedal === 'number' && earnedMedal > prevMedal) {
      medal = earnedMedal;
      const dustTable = [0, 120, 200, 320, 500];
      for (let m = prevMedal + 1; m <= earnedMedal; m++) {
        medalDust += dustTable[m] || 150;
      }
      p.medals[biomeKey] = earnedMedal;
    }
  }

  const killsPb = prevKills === null || (r.kills || 0) > prevKills;
  p.kills[biomeKey] = Math.max(prevKills ?? 0, r.kills || 0);
  if (r.mode === 'endless') {
    const prevEnd = p.endless[r.biome] || { time: 0, kills: 0, score: 0 };
    if ((r.time || 0) > prevEnd.time) {
      p.endless[r.biome] = {
        time: r.time || 0,
        kills: r.kills || 0,
        score,
        species: r.finalSpecies || r.species,
        date: Date.now()
      };
    }
  }

  // 4. Bonkoins
  const bonk = Math.min(3, (r.bosses || 0) > 0 ? Math.ceil(((r.bosses || 0) + (r.legendaries || 0)) / 2) : 0);
  p.bonk = (p.bonk ?? 0) + bonk;
  p.totalBonk = (p.totalBonk ?? 0) + bonk;

  // 5. Event progression (Halloween Lavender Tower, etc.)
  const evDef = EVENTS_LIST[0];
  if (evDef) {
    p.events = p.events || {};
    const evState = p.events[evDef.id] || { pts: 0, got: [], quests: [], c: {}, best: null };
    const addPts = safeCall(evDef.pointsFor, Math.min(10, Math.floor((r.kills || 0) / 250)), r);
    evState.pts = (evState.pts || 0) + addPts;
    const cAdd = safeCall(evDef.countersFor, {}, r);
    if (cAdd && typeof cAdd === 'object') {
      for (const [ck, cv] of Object.entries(cAdd)) {
        if (ck === 'floor') {
          evState.c[ck] = Math.max(evState.c[ck] ?? 0, cv);
        } else {
          evState.c[ck] = (evState.c[ck] ?? 0) + cv;
        }
      }
    }
    p.events[evDef.id] = evState;
  }

  // 6. Daily & Weekly task progress
  const completedTasks = [];
  for (const period of ['daily', 'weekly']) {
    const blk = p[period];
    if (!blk || !Array.isArray(blk.ids)) continue;
    blk.ids.forEach((tid, idx) => {
      const tDef = safeCall(fnGetTaskById, null, tid);
      if (!tDef) return;
      const before = blk.prog[idx] ?? 0;
      let inc = 0;
      if (tDef.metric === 'kills' || tDef.metric === 'runKills') inc = r.kills || 0;
      else if (tDef.metric === 'time') inc = r.time || 0;
      else if (tDef.metric === 'level') inc = r.level || 1;
      else if (tDef.metric === 'wins' && r.victory) inc = 1;
      else if (tDef.metric === 'bosses') inc = (r.bosses || 0) + (r.legendaries || 0);
      else inc = Math.max(1, Math.floor((r.kills || 0) / 50));

      const after = tDef.metric === 'level' || tDef.metric === 'runKills'
        ? Math.max(before, inc)
        : before + inc;
      blk.prog[idx] = Math.min(tDef.goal, after);
      if (before < tDef.goal && blk.prog[idx] >= tDef.goal) {
        completedTasks.push({ id: tid, period });
      }
    });
  }

  // 7. Total Stardust & Run Record
  const totalEarnedDust = stardust + medalDust;
  p.stardust += totalEarnedDust;
  p.totalStardust += totalEarnedDust;

  const recordId = runIdFromUrl || ('run-' + Date.now().toString(36));
  const record = {
    ...r,
    id: recordId,
    date: Date.now(),
    score,
    stardust: totalEarnedDust,
    ranked: true
  };

  p.runs = [record, ...(p.runs || [])].slice(0, 50);
  if (r.build) {
    state.builds[recordId] = r.build;
  }
  if (r.mode === 'endless') {
    state.endlessRecords = [record, ...(state.endlessRecords || [])].slice(0, 50);
  } else {
    state.records = [record, ...(state.records || [])].slice(0, 50);
  }

  // Sync Co-op team result to server.mjs if this was a Co-op run
  const partyMatch = typeof recordId === 'string' ? recordId.match(/^coop-run-(party-[^-]+-[^-]+)-/) : null;
  const partyId = r.party || (partyMatch ? partyMatch[1] : null);
  let coopSummary = null;
  if (partyId || r.build) {
    try {
      const mpRes = await callMpServer('/runs/finish', 'POST', {
        runId: recordId,
        party: partyId,
        result: r
      });
      if (mpRes?.coop) coopSummary = mpRes.coop;
    } catch {}
  }
  if (!coopSummary && partyId) {
    const acc = getTabAccount();
    coopSummary = {
      size: 2,
      teamKills: r.kills || 0,
      time: r.time || 0,
      best: null,
      bestTime: null,
      rank: 1,
      teams: 1,
      members: [
        {
          id: acc.id,
          name: acc.name,
          species: r.finalSpecies || r.species || 4,
          kills: r.kills || 0,
          done: true
        }
      ]
    };
  }

  saveState(state);

  return {
    profile: { ...p, name: getTabAccount().name },
    record,
    stardust: totalEarnedDust,
    bonk,
    pb,
    prevBest,
    prevKills,
    weekPb: killsPb,
    killsPb,
    kills: {
      season: 2,
      live: true,
      week: 1,
      playersWeek: 1,
      all: 1,
      playersAll: 1,
      dust: 1,
      ends: Date.now() + 86400000 * 14
    },
    ...(coopSummary ? { coop: coopSummary } : {}),
    medal,
    medalDust,
    ranked: true,
    tasks: completedTasks
  };
}

// 4. Offline & Local/LAN Co-op HTTP Router
async function handleApiRequest(urlObj, method, bodyText) {
  await ensureTabIdentity();
  const path = urlObj.pathname.replace(/^\/api/, '');
  const body = bodyText ? JSON.parse(bodyText) : {};
  const tabAcc = getTabAccount();

  // Forward all /coop/* requests to server.mjs multiplayer coordinator
  if (path.startsWith('/coop')) {
    return await callMpServer(path + urlObj.search, method, body);
  }

  // Forward /friends* and /players* to server.mjs so tabs & LAN peers appear as Online Friends
  if (path === '/friends') {
    if (method === 'GET') {
      try {
        return await callMpServer('/friends', 'GET');
      } catch {
        return { friends: [], incoming: [], outgoing: [] };
      }
    }
    return { ok: true };
  }
  if (path.startsWith('/friends/')) {
    return { ok: true };
  }
  if (path === '/players/search') {
    try {
      return await callMpServer('/players/search' + urlObj.search, 'GET');
    } catch {
      return [];
    }
  }
  if (path === '/players') {
    try {
      return await callMpServer('/players' + urlObj.search, 'GET');
    } catch {
      return {
        id: tabAcc.id,
        name: tabAcc.name,
        avatar: state.profile.avatar,
        frame: state.profile.frame,
        title: state.profile.title,
        banner: state.profile.banner,
        lastSpecies: state.profile.lastSpecies,
        league: state.profile.league.length,
        shinies: state.profile.shinies.length,
        achievements: Object.keys(state.profile.quests).length
      };
    }
  }

  // /status
  if (path === '/status') {
    const defaultSeason = {
      n: 2, name: '', start: Date.now() - 86400000 * 3, end: Date.now() + 86400000 * 14, live: true, dust: 1, message: '', next: null
    };
    const season = safeCall(fnGetSeasonInfo, defaultSeason, Date.now());
    const events = EVENTS_LIST.map(ev => ({
      id: ev.id,
      name: ev.name,
      desc: ev.desc,
      color: ev.color,
      mode: ev.mode,
      biome: ev.biome,
      start: Date.now() - 86400000 * 5,
      end: Date.now() + 86400000 * 30,
      live: true,
      claimable: true,
      state: 'auto',
      points: ev.points,
      art: ev.art
    }));
    return {
      maintenance: { on: false, title: '', message: '', eta: 0 },
      bypass: false,
      season: typeof season === 'object' && season ? season : defaultSeason,
      events,
      registration: { inviteOnly: false }
    };
  }

  // /auth/*
  if (path === '/auth/me') {
    return tabAcc;
  }
  if (path === '/auth/guest') {
    return tabAcc;
  }
  if (path === '/auth/register' || path === '/auth/login' || path === '/auth/upgrade') {
    const name = (body.name || tabAcc.name || 'Entrenador').trim();
    if (tabSlot === 1) {
      state.account.name = name;
      state.profile.name = name;
      saveState(state);
    } else {
      try { sessionStorage.setItem(TAB_NAME_KEY, name); } catch {}
    }
    sendPresenceHeartbeat();
    return getTabAccount();
  }
  if (path === '/auth/logout') {
    return {};
  }
  if (path === '/auth/name') {
    return { available: true };
  }

  // /profile
  if (path === '/profile' && method === 'GET') {
    ensureBiomesUnlocked(state.profile);
    return { now: Date.now(), profile: { ...state.profile, name: tabAcc.name } };
  }
  if (path === '/profile/prefs' && method === 'PUT') {
    Object.assign(state.profile, body);
    saveState(state);
    sendPresenceHeartbeat();
    return { ok: true };
  }
  if (path === '/profile/starter' && method === 'POST') {
    const id = Number(body.id) || 4;
    state.profile.starter = id;
    state.profile.lastSpecies = id;
    for (const stId of [1, 4, 7, id]) {
      if (!state.profile.unlocked.includes(stId)) state.profile.unlocked.push(stId);
      if (!state.profile.league.includes(stId)) state.profile.league.push(stId);
      state.profile.captured[stId] ??= Date.now();
    }
    if (!state.profile.team.length) state.profile.team = [id];
    saveState(state);
    return { profile: { ...state.profile, name: tabAcc.name } };
  }
  if (path === '/profile/actions' && method === 'POST') {
    for (const act of body.actions || []) {
      if (act.k === 'lab') applyBuyLab(state.profile, act.id);
      else if (act.k === 'item') applyBuyItem(state.profile, act.key);
      else if (act.k === 'shop') applyBuyShop(state.profile, act.id);
      else if (act.k === 'archive') applyArchiveItem(state.profile, act.key, act.off);
      else if (act.k === 'quest') applyClaimQuest(state.profile, act.id);
      else if (act.k === 'task') applyClaimTask(state.profile, act.period, act.slot);
    }
    saveState(state);
    return { profile: { ...state.profile, name: tabAcc.name } };
  }

  // Direct shop / lab / quest / task / treasure endpoints
  if (path === '/lab/buy') {
    applyBuyLab(state.profile, body.id);
    saveState(state);
    return { profile: { ...state.profile, name: tabAcc.name } };
  }
  if (path === '/items/buy') {
    applyBuyItem(state.profile, body.key);
    saveState(state);
    return { profile: { ...state.profile, name: tabAcc.name } };
  }
  if (path === '/items/archive') {
    applyArchiveItem(state.profile, body.key, body.off);
    saveState(state);
    return { profile: { ...state.profile, name: tabAcc.name } };
  }
  if (path === '/shop/buy') {
    applyBuyShop(state.profile, body.id);
    saveState(state);
    return { profile: { ...state.profile, name: tabAcc.name } };
  }
  if (path === '/quests/claim') {
    applyClaimQuest(state.profile, body.id);
    saveState(state);
    return { profile: { ...state.profile, name: tabAcc.name } };
  }
  if (path === '/tasks/claim') {
    applyClaimTask(state.profile, body.period, body.slot);
    saveState(state);
    return { profile: { ...state.profile, name: tabAcc.name } };
  }
  if (path === '/tasks/reroll') {
    applyRerollTask(state.profile, body.period, body.slot);
    saveState(state);
    return { profile: { ...state.profile, name: tabAcc.name } };
  }
  if (path === '/treasures/spin') {
    const wheelId = body.wheel;
    const wheel = WHEELS_LIST.find(w => w.id === wheelId);
    const p = state.profile;
    p.treasures = p.treasures || {};
    const won = p.treasures[wheelId]?.won || [];
    const cost = won.length < 10 ? 3 : null;
    if (wheel && cost != null && (p.bonk ?? 0) >= cost && won.length < 10) {
      p.bonk -= cost;
      const avail = wheel.prizes.filter(pr => !won.includes(pr.id));
      const picked = avail[Math.floor(Math.random() * avail.length)] || wheel.prizes[0];
      won.push(picked.id);
      p.treasures[wheelId] = { won };
      if (picked.dust) {
        p.stardust += picked.dust;
        p.totalStardust += picked.dust;
      }
      if (picked.item) {
        p.bag[picked.item] = Math.min(9, (p.bag[picked.item] ?? 0) + (picked.n || 1));
      }
      if (picked.cosmetic && !p.cosmetics.includes(picked.cosmetic)) {
        p.cosmetics.push(picked.cosmetic);
      }
      if (picked.look) {
        const code = safeCall(fnEncodeLookSkin, null, wheel.starter, picked.look);
        if (code != null && !p.skins.includes(code)) p.skins.push(code);
      }
      saveState(state);
      return { profile: { ...p, name: tabAcc.name }, spin: { prize: picked.id } };
    }
    return { profile: { ...p, name: tabAcc.name }, spin: { prize: wheel?.prizes?.[0]?.id || 'dust1' } };
  }

  // /runs/*
  if (path === '/runs' && method === 'POST') {
    if (body.party) {
      try {
        return await callMpServer('/runs/start', 'POST', body);
      } catch {
        // Fallback deterministic seed from party string
        let h = 2166136261;
        for (let i = 0; i < body.party.length; i++) {
          h ^= body.party.charCodeAt(i);
          h = Math.imul(h, 16777619);
        }
        return {
          id: `coop-run-${body.party}-${tabAcc.id}`,
          seed: h >>> 0,
          party: body.party,
          boosts: body.boosts || [],
          ranked: true,
          offline: false
        };
      }
    }
    const seed = (Math.random() * 0xffffffff) >>> 0;
    const dayIdx = safeCall(fnGetDayIndex, 1, Date.now());
    const dayInfo = safeCall(fnGetMutationForDay, null, dayIdx);
    return {
      id: 'offline-run-' + Date.now().toString(36),
      seed: body.mode === 'mutation' && dayInfo ? dayInfo.seed : seed,
      boosts: body.boosts || [],
      ranked: true,
      offline: false,
      ...(body.mode === 'mutation' && dayInfo ? { mutation: dayInfo.mutation.id } : {})
    };
  }
  if (/^\/runs\/[^/]+\/(checkpoint|suspend|resume|recover|discard)$/.test(path)) {
    return { ok: true };
  }
  if (/^\/runs\/([^/]+)\/save$/.test(path)) {
    const id = decodeURIComponent(path.split('/')[2] || '');
    state.savedRuns = state.savedRuns || {};
    if (method === 'PUT') {
      state.savedRuns[id] = body;
      saveState(state);
      return { ok: true };
    }
    if (state.savedRuns[id]) return state.savedRuns[id];
    const err = new Error('Save not found');
    err.status = 404;
    throw err;
  }
  if (path === '/runs/saved') {
    return { saved: null };
  }
  if (/^\/runs\/([^/]+)\/finish$/.test(path)) {
    const runId = decodeURIComponent(path.split('/')[2] || '');
    return await finishRunOffline(body, runId);
  }
  if (/^\/runs\/([^/]+)\/build$/.test(path)) {
    const id = decodeURIComponent(path.split('/')[2] || '');
    if (state.builds[id]) return state.builds[id];
    try {
      return await callMpServer(`/runs/${encodeURIComponent(id)}/build`, 'GET');
    } catch {
      return { moves: [], items: {} };
    }
  }

  // /profile/stash (Build Planner & Presets cloud sync introduced in v0.8.90)
  if (path === '/profile/stash' && method === 'GET') {
    return state.stash || {};
  }
  if (path.startsWith('/profile/stash/') && method === 'PUT') {
    const key = decodeURIComponent(path.split('/')[3] || '');
    state.stash = state.stash || {};
    state.stash[key] = { data: body.data, updated: body.updated || Date.now() };
    saveState(state);
    return { kept: false, data: body.data, updated: state.stash[key].updated };
  }

  // /records & /leaderboard
  if (path === '/records') {
    return state.records || [];
  }
  if (path === '/records/endless') {
    return state.endlessRecords || [];
  }
  if (path === '/leaderboard') {
    const defaultSeason = { n: 2, live: true };
    const season = safeCall(fnGetSeasonInfo, defaultSeason, Date.now());
    const entries = (state.records || []).slice(0, 25).map((r, idx) => ({
      rank: idx + 1,
      id: tabAcc.id,
      name: tabAcc.name,
      avatar: state.profile.avatar,
      frame: state.profile.frame,
      title: state.profile.title,
      species: r.finalSpecies || r.species || 4,
      value: r.kills || r.score || 100,
      time: r.time || 600,
      runId: r.id,
      me: true
    }));
    return { info: typeof season === 'object' && season ? season : defaultSeason, entries, me: entries[0] || null, total: entries.length };
  }
  if (path === '/leaderboard/pokemon') {
    return { entries: [] };
  }
  if (path === '/seasons/awards') {
    return [];
  }
  if (path === '/seasons/claim') {
    return { profile: { ...state.profile, name: tabAcc.name } };
  }

  // /events/* & /mutation
  if (path.startsWith('/events/')) {
    const parts = path.split('/');
    const evId = decodeURIComponent(parts[2] || 'halloween26');
    const sub = parts[3];
    const evDef = EVENTS_LIST.find(x => x.id === evId) || EVENTS_LIST[0];
    const p = state.profile;
    p.events = p.events || {};
    const evState = p.events[evId] || { pts: 0, got: [], quests: [], c: {}, best: null };
    p.events[evId] = evState;

    if (sub === 'track' && method === 'POST') {
      const step = Number(body.step);
      const tr = evDef?.track?.[step];
      if (tr && !evState.got.includes(step) && evState.pts >= tr.at) {
        evState.got.push(step);
        if (tr.reward?.dust) {
          p.stardust += tr.reward.dust;
          p.totalStardust += tr.reward.dust;
        }
        for (const c of tr.reward?.cosmetics || []) {
          if (!p.cosmetics.includes(c)) p.cosmetics.push(c);
        }
        for (const b of tr.reward?.bag || []) {
          p.bag[b] = Math.min(9, (p.bag[b] ?? 0) + 1);
        }
        saveState(state);
      }
      return { profile: { ...p, name: tabAcc.name } };
    }
    if (sub === 'quest' && method === 'POST') {
      const qId = body.quest;
      const q = evDef?.quests?.find(x => x.id === qId);
      if (q && !evState.quests.includes(qId)) {
        evState.quests.push(qId);
        if (q.reward?.dust) {
          p.stardust += q.reward.dust;
          p.totalStardust += q.reward.dust;
        }
        for (const c of q.reward?.cosmetics || []) {
          if (!p.cosmetics.includes(c)) p.cosmetics.push(c);
        }
        saveState(state);
      }
      return { profile: { ...p, name: tabAcc.name } };
    }
    return {
      entries: [],
      clans: [],
      me: null,
      players: 1
    };
  }

  if (path === '/mutation') {
    const dayParam = urlObj.searchParams.get('day');
    const day = dayParam ? Number(dayParam) : safeCall(fnGetDayIndex, 1, Date.now());
    const info = safeCall(fnGetMutationForDay, null, day);
    return {
      day,
      mutation: info?.mutation?.id || 'metronome',
      biome: info?.biome || 'forest',
      entries: [],
      me: null,
      players: 1
    };
  }

  // /news
  if (path === '/news') {
    try {
      const res = await origFetch('./data/news.json');
      if (res.ok) {
        const list = await res.json();
        if (urlObj.searchParams.get('head')) {
          return { id: list[0]?.id || 1, date: list[0]?.date || Date.now() };
        }
        return list;
      }
    } catch {}
    return urlObj.searchParams.get('head') ? { id: 1, date: Date.now() } : [];
  }

  // /account/*
  if (path === '/account/rename') {
    if (method === 'GET') return { wait: 0 };
    const name = (body.name || 'Entrenador').trim();
    if (tabSlot === 1) {
      state.account.name = name;
      state.profile.name = name;
      saveState(state);
    } else {
      try { sessionStorage.setItem(TAB_NAME_KEY, name); } catch {}
    }
    sendPresenceHeartbeat();
    return { name: getTabAccount().name };
  }
  if (path === '/account/reset' || path === '/account/delete') {
    state.profile = createDefaultProfile(state.account.name);
    state.records = [];
    state.endlessRecords = [];
    saveState(state);
    return { ok: true };
  }
  if (path === '/account/password') {
    return { closed: 0 };
  }

  // /clans/*, /mail/* & /feedback
  if (path === '/clans/status') return { mail: 0 };
  if (path === '/clans/board') {
    const defaultSeason = { n: 2, live: true, start: Date.now() - 86400000 * 3, end: Date.now() + 86400000 * 14, dust: 1 };
    const season = safeCall(fnGetSeasonInfo, defaultSeason, Date.now());
    return {
      info: typeof season === 'object' && season ? season : defaultSeason,
      entries: [],
      clans: 0,
      me: null
    };
  }
  if (path === '/clans/search') return [];
  if (path === '/mail') return [];
  if (path === '/feedback' || path.endsWith('/report')) return { ok: true };

  return {};
}

// 5. Intercept window.fetch for https://api.pokebonk.com
window.fetch = async function (input, init) {
  const urlStr = typeof input === 'string' ? input : input instanceof URL ? input.href : input?.url || '';
  if (urlStr.startsWith(API_ORIGIN)) {
    try {
      const urlObj = new URL(urlStr);
      const method = (init?.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();
      let bodyText = '';
      if (typeof init?.body === 'string') {
        bodyText = init.body;
      }
      const result = await handleApiRequest(urlObj, method, bodyText);
      return new Response(JSON.stringify(result), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    } catch (err) {
      console.error('[OfflineAPI] Error handling request:', urlStr, err);
      return new Response(JSON.stringify({ error: err.message || 'Offline API error' }), {
        status: err.status || 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  }
  return origFetch(input, init);
};

// 6. Sandbox / Unlock-All, Save Manager & Local Co-op Toolbox (Press F9 to toggle)
function unlockEverything() {
  const p = state.profile;
  p.stardust = Math.max(p.stardust, 99999);
  p.totalStardust = Math.max(p.totalStardust, 99999);
  p.bonk = Math.max(p.bonk, 99);
  p.totalBonk = Math.max(p.totalBonk, 99);

  // Unlock all 151 Kanto Pokemon + playable roster
  for (let id = 1; id <= 151; id++) {
    if (!p.unlocked.includes(id)) p.unlocked.push(id);
    if (!p.league.includes(id)) p.league.push(id);
    if (!p.seen.includes(id)) p.seen.push(id);
    if (!p.shinies.includes(id)) p.shinies.push(id);
    if (!p.classics.includes(id)) p.classics.push(id);
    p.captured[id] ??= Date.now();
    p.research[id] = 100;
  }

  // Unlock all biomes at max tier (Nightmare unlocked)
  for (const b of BIOMES_CHAIN) {
    p.biomes[b] = Math.max(p.biomes[b] ?? 0, 3);
  }

  // Max out all Lab upgrades
  for (const item of LAB_LIST) {
    p.lab[item.id] = item.max;
  }

  // Unlock all shop items
  for (const item of ITEMS_SHOP_LIST) {
    if (!p.itemsOwned.includes(item.key)) p.itemsOwned.push(item.key);
  }

  // Fill bag with boost items
  for (const item of DAILY_SHOP_LIST) {
    p.bag[item.id] = 9;
  }

  // Unlock all cosmetics
  for (const c of COSMETICS_LIST) {
    if (c.id && !p.cosmetics.includes(c.id)) p.cosmetics.push(c.id);
  }
  for (const av of AVATARS_LIST) {
    if (av.id && !p.cosmetics.includes(`tr:${av.id}`)) p.cosmetics.push(`tr:${av.id}`);
  }

  saveState(state);
  location.reload();
}

function addCurrency() {
  state.profile.stardust += 10000;
  state.profile.totalStardust += 10000;
  state.profile.bonk = (state.profile.bonk ?? 0) + 25;
  state.profile.totalBonk = (state.profile.totalBonk ?? 0) + 25;
  saveState(state);
  location.reload();
}

function exportSave() {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `pokebonk-save-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
}

function importSave() {
  const inp = document.createElement('input');
  inp.type = 'file';
  inp.accept = '.json';
  inp.onchange = async () => {
    const file = inp.files?.[0];
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text());
      if (parsed && parsed.profile) {
        state = parsed;
        saveState(state);
        location.reload();
      }
    } catch (e) {
      alert('Invalid save file: ' + e.message);
    }
  };
  inp.click();
}

function mountOfflineToolbox() {
  let modal = null;
  async function toggleModal() {
    if (modal) {
      modal.remove();
      modal = null;
      return;
    }
    const acc = getTabAccount();
    modal = document.createElement('div');
    modal.style.cssText = 'position:fixed;inset:0;z-index:2147483646;background:rgba(12,10,24,0.78);display:flex;align-items:center;justify-content:center;font-family:system-ui,sans-serif;backdrop-filter:blur(4px)';
    const card = document.createElement('div');
    card.style.cssText = 'background:#1e1938;color:#fff;border:2px solid #4a3e7a;border-radius:20px;padding:24px;max-width:460px;width:92%;display:flex;flex-direction:column;gap:12px;box-shadow:0 20px 50px rgba(0,0,0,0.6)';
    card.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:2px">
        <strong style="font-size:20px;color:#ffd23a">⚡ PokéBonk Offline & Co-op Toolbox</strong>
        <span style="font-size:12px;opacity:0.7">F9</span>
      </div>
      <div style="background:#28214a;border:1px solid #4a3e7a;border-radius:12px;padding:12px;font-size:12.5px;display:flex;flex-direction:column;gap:8px">
        <div style="display:flex;justify-content:space-between;align-items:center">
          <span>👤 <b>This Window:</b> <code style="color:#7cf5a6">${acc.name}</code> (Slot #${tabSlot})</span>
          <button id="pb-off-newtab" style="padding:5px 10px;border:0;border-radius:8px;background:#2f7bf5;color:#fff;font-weight:700;font-size:11.5px;cursor:pointer">
            ➕ Open 2nd Co-op Window
          </button>
        </div>
        <div id="pb-off-lan" style="color:#b8b0d8;line-height:1.4">
          🌐 Checking LAN Co-op status…
        </div>
      </div>
      <button id="pb-off-unlock" style="padding:11px 16px;border:0;border-radius:12px;background:#24b463;color:#fff;font-weight:700;cursor:pointer">
        🔓 Unlock All (151 Pokémon, Biomes, Lab & Shiny Skins)
      </button>
      <button id="pb-off-dust" style="padding:11px 16px;border:0;border-radius:12px;background:#7c4dff;color:#fff;font-weight:700;cursor:pointer">
        ✨ Add +10,000 Stardust & +25 Bonkoins
      </button>
      <div style="display:flex;gap:8px">
        <button id="pb-off-export" style="flex:1;padding:10px;border:1px solid #5a4e8a;border-radius:12px;background:#2b244d;color:#fff;font-weight:600;cursor:pointer">
          💾 Export Save
        </button>
        <button id="pb-off-import" style="flex:1;padding:10px;border:1px solid #5a4e8a;border-radius:12px;background:#2b244d;color:#fff;font-weight:600;cursor:pointer">
          📂 Import Save
        </button>
      </div>
      <button id="pb-off-reset" style="padding:9px 14px;border:1px solid #8a3040;border-radius:12px;background:transparent;color:#ff7a8a;font-weight:600;cursor:pointer">
        🗑️ Reset to Fresh Starter Save
      </button>
      <button id="pb-off-close" style="padding:9px 14px;border:0;border-radius:12px;background:#352d5c;color:#fff;font-weight:600;cursor:pointer;margin-top:2px">
        Close
      </button>
    `;
    modal.appendChild(card);
    modal.addEventListener('click', e => {
      if (e.target === modal) toggleModal();
    });
    document.body.appendChild(modal);

    card.querySelector('#pb-off-newtab').onclick = () => {
      window.open(location.origin + location.pathname, '_blank');
    };
    card.querySelector('#pb-off-unlock').onclick = unlockEverything;
    card.querySelector('#pb-off-dust').onclick = addCurrency;
    card.querySelector('#pb-off-export').onclick = exportSave;
    card.querySelector('#pb-off-import').onclick = importSave;
    card.querySelector('#pb-off-reset').onclick = () => {
      if (confirm('Reset your offline progress back to a fresh starter save?')) {
        state.profile = createDefaultProfile(state.account.name);
        state.records = [];
        state.endlessRecords = [];
        saveState(state);
        location.reload();
      }
    };
    card.querySelector('#pb-off-close').onclick = toggleModal;

    try {
      const info = await callMpServer('/info', 'GET');
      const lanEl = card.querySelector('#pb-off-lan');
      if (lanEl) {
        const lanUrl = info.lanIps?.[0] ? `http://${info.lanIps[0]}:${info.port}` : location.origin;
        const roomsStr = info.activeRooms?.length
          ? info.activeRooms.map(r => `<b>${r.code}</b> (${r.members.length}/${r.max})`).join(', ')
          : 'None yet';
        lanEl.innerHTML = `
          <div>🌐 <b>LAN Co-op URL:</b> <code style="color:#ffd23a">${lanUrl}</code></div>
          <div>🟢 <b>Online Players:</b> ${info.onlinePlayers?.length || 1} &nbsp;·&nbsp; 🏠 <b>Active Rooms:</b> ${roomsStr}</div>
        `;
      }
    } catch {}
  }

  window.addEventListener('keydown', e => {
    if (e.code === 'F9') {
      e.preventDefault();
      toggleModal();
    }
  });

  window.pokebonkOffline = {
    get state() { return state; },
    get tabAccount() { return getTabAccount(); },
    unlockEverything,
    addCurrency,
    exportSave,
    importSave,
    toggleToolbox: toggleModal
  };
}

mountOfflineToolbox();
console.log('[PokéBonk Offline] Local & LAN Co-op backend active. Press F9 anytime to open the Toolbox.');
