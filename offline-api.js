import * as def from './assets/defineProperty-quYBDGFA-mvsqtoo8.js';

const STORAGE_KEY = 'pb.offline.state.v1';
const API_ORIGIN = 'https://api.pokebonk.com';

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

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && parsed.profile) {
        parsed.profile = { ...createDefaultProfile(parsed.account?.name || 'Entrenador'), ...parsed.profile };
        return parsed;
      }
    }
  } catch (e) {
    console.warn('[OfflineAPI] Failed to read localStorage:', e);
  }
  const initial = {
    account: {
      id: 'offline-trainer-0001',
      name: 'Entrenador',
      token: 'offline-token-0001',
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

function saveState(st, syncDisk = true) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(st));
    // Also ensure pb.session is populated so the client boots directly into the menu
    if (st.account) {
      localStorage.setItem('pb.session', JSON.stringify(st.account));
    }
  } catch (e) {
    console.warn('[OfflineAPI] Failed to save localStorage:', e);
  }
  if (syncDisk) {
    fetch('/api/local-save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(st)
    }).catch(() => {});
  }
}

let state = loadState();

// Sync from disk save on startup if running via server.mjs
fetch('/api/local-save')
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

// Ensure session exists immediately on first load so user skips auth prompt if desired
if (!localStorage.getItem('pb.session') && state.account) {
  localStorage.setItem('pb.session', JSON.stringify(state.account));
}

// 3. Helper functions for profile progression
const LAB_MAP = new Map((def.Wn || []).map(x => [x.id, x]));
const ITEMS_SHOP_MAP = new Map((def.Un || []).map(x => [x.key, x]));
const DAILY_SHOP_MAP = new Map((def.rr || []).map(x => [x.id, x]));
const QUESTS_LIST = def.qn || [];
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
  const day = def.Cr ? def.Cr(Date.now()) : Math.floor(Date.now() / 86400000);
  const bought = p.shop && p.shop.day === day ? p.shop.n : {};
  const n = bought[id] ?? 0;
  if (n >= item.daily) return false;
  const cost = def.ai ? def.ai(item, n) : item.price;
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
  if (q.look && def.dn) {
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
  if (def.ui) {
    const nextTask = def.ui(period, blk.idx || 1, slot, blk.rerolls);
    if (nextTask && nextTask.id) {
      blk.ids[slot] = nextTask.id;
      blk.prog[slot] = 0;
    }
  }
  return true;
}

function finishRunOffline(body) {
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
  const score = def.Zr ? def.Zr(r) : Math.round((r.kills || 0) * 2 + (r.time || 0) * 3);
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
    if (def.zr) {
      const earnedMedal = def.zr(r.biome, r.tier || 0, r.time, true);
      const prevMedal = p.medals[biomeKey] ?? 0;
      if (earnedMedal > prevMedal) {
        medal = earnedMedal;
        const dustTable = [0, 120, 200, 320, 500];
        for (let m = prevMedal + 1; m <= earnedMedal; m++) {
          medalDust += dustTable[m] || 150;
        }
        p.medals[biomeKey] = earnedMedal;
      }
    }
  }

  p.kills[biomeKey] = Math.max(p.kills[biomeKey] ?? 0, r.kills || 0);
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
  const evDef = (def.Cn || [])[0];
  if (evDef) {
    p.events = p.events || {};
    const evState = p.events[evDef.id] || { pts: 0, got: [], quests: [], c: {}, best: null };
    const addPts = typeof evDef.pointsFor === 'function' ? evDef.pointsFor(r) : Math.min(10, Math.floor((r.kills || 0) / 250));
    evState.pts = (evState.pts || 0) + addPts;
    if (typeof evDef.countersFor === 'function') {
      const cAdd = evDef.countersFor(r);
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
      const tDef = def.li ? def.li(tid) : null;
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

  const recordId = 'run-' + Date.now().toString(36);
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

  saveState(state);

  return {
    profile: p,
    record,
    stardust: totalEarnedDust,
    bonk,
    pb,
    prevBest,
    medal,
    medalDust,
    ranked: true,
    tasks: completedTasks
  };
}

// 4. Offline HTTP Router
async function handleApiRequest(urlObj, method, bodyText) {
  const path = urlObj.pathname.replace(/^\/api/, '');
  const body = bodyText ? JSON.parse(bodyText) : {};

  // /status
  if (path === '/status') {
    const season = def.ei ? def.ei(Date.now()) : {
      n: 2, name: '', start: Date.now() - 86400000 * 3, end: Date.now() + 86400000 * 14, live: true, dust: 1, message: '', next: null
    };
    const events = (def.Cn || []).map(ev => ({
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
      season,
      events,
      registration: { inviteOnly: false }
    };
  }

  // /auth/*
  if (path === '/auth/me') {
    return state.account;
  }
  if (path === '/auth/guest') {
    state.account = {
      id: state.account?.id || 'offline-trainer-0001',
      name: state.account?.name || 'Entrenador',
      token: 'offline-token-0001',
      guest: true
    };
    saveState(state);
    return state.account;
  }
  if (path === '/auth/register' || path === '/auth/login' || path === '/auth/upgrade') {
    const name = (body.name || state.account?.name || 'Entrenador').trim();
    state.account = {
      id: state.account?.id || 'offline-trainer-0001',
      name,
      token: 'offline-token-0001',
      guest: false
    };
    state.profile.name = name;
    saveState(state);
    return state.account;
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
    return { now: Date.now(), profile: state.profile };
  }
  if (path === '/profile/prefs' && method === 'PUT') {
    Object.assign(state.profile, body);
    saveState(state);
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
    return { profile: state.profile };
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
    return { profile: state.profile };
  }

  // Direct shop / lab / quest / task / treasure endpoints
  if (path === '/lab/buy') {
    applyBuyLab(state.profile, body.id);
    saveState(state);
    return { profile: state.profile };
  }
  if (path === '/items/buy') {
    applyBuyItem(state.profile, body.key);
    saveState(state);
    return { profile: state.profile };
  }
  if (path === '/items/archive') {
    applyArchiveItem(state.profile, body.key, body.off);
    saveState(state);
    return { profile: state.profile };
  }
  if (path === '/shop/buy') {
    applyBuyShop(state.profile, body.id);
    saveState(state);
    return { profile: state.profile };
  }
  if (path === '/quests/claim') {
    applyClaimQuest(state.profile, body.id);
    saveState(state);
    return { profile: state.profile };
  }
  if (path === '/tasks/claim') {
    applyClaimTask(state.profile, body.period, body.slot);
    saveState(state);
    return { profile: state.profile };
  }
  if (path === '/tasks/reroll') {
    applyRerollTask(state.profile, body.period, body.slot);
    saveState(state);
    return { profile: state.profile };
  }
  if (path === '/treasures/spin') {
    const wheelId = body.wheel;
    const wheel = (def.Kt || []).find(w => w.id === wheelId);
    const p = state.profile;
    p.treasures = p.treasures || {};
    const won = p.treasures[wheelId]?.won || [];
    const cost = def.Jt ? def.Jt(p, wheel || { id: wheelId }) : 3;
    if (wheel && cost != null && (p.bonk ?? 0) >= cost && won.length < 10) {
      p.bonk -= cost;
      const avail = wheel.prizes.filter(pr => !won.includes(pr.id));
      const picked = avail[Math.floor(Math.random() * avail.length)] || wheel.prizes[0];
      won.push(picked.id);
      p.treasures[wheelId] = { won };
      // Grant prize
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
      if (picked.look && def. on) {
        const code = def.on(wheel.starter, picked.look);
        if (!p.skins.includes(code)) p.skins.push(code);
      }
      saveState(state);
      return { profile: p, spin: { prize: picked.id } };
    }
    return { profile: p, spin: { prize: wheel?.prizes?.[0]?.id || 'dust1' } };
  }

  // /runs/*
  if (path === '/runs' && method === 'POST') {
    const seed = (Math.random() * 0xffffffff) >>> 0;
    const dayInfo = def.V && def.Cr ? def.V(def.Cr(Date.now())) : null;
    return {
      id: 'offline-run-' + Date.now().toString(36),
      seed: body.mode === 'mutation' && dayInfo ? dayInfo.seed : seed,
      boosts: body.boosts || [],
      ranked: true,
      offline: false,
      ...(body.mode === 'mutation' && dayInfo ? { mutation: dayInfo.mutation.id } : {})
    };
  }
  if (/^\/runs\/[^/]+\/(checkpoint|suspend|resume)$/.test(path)) {
    return { ok: true };
  }
  if (/^\/runs\/[^/]+\/finish$/.test(path)) {
    return finishRunOffline(body);
  }
  if (/^\/runs\/([^/]+)\/build$/.test(path)) {
    const id = path.split('/')[2];
    return state.builds[id] || { moves: [], items: {} };
  }

  // /records & /leaderboard
  if (path === '/records') {
    return state.records || [];
  }
  if (path === '/records/endless') {
    return state.endlessRecords || [];
  }
  if (path === '/leaderboard') {
    const season = def.ei ? def.ei(Date.now()) : { n: 2, live: true };
    const entries = (state.records || []).slice(0, 25).map((r, idx) => ({
      rank: idx + 1,
      id: state.account.id,
      name: state.profile.name,
      avatar: state.profile.avatar,
      frame: state.profile.frame,
      title: state.profile.title,
      species: r.finalSpecies || r.species || 4,
      value: r.kills || r.score || 100,
      time: r.time || 600,
      runId: r.id,
      me: true
    }));
    return { info: season, entries, me: entries[0] || null, total: entries.length };
  }
  if (path === '/leaderboard/pokemon') {
    return { entries: [] };
  }
  if (path === '/seasons/awards') {
    return [];
  }

  // /events/* & /mutation
  if (path.startsWith('/events/')) {
    const parts = path.split('/');
    const evId = decodeURIComponent(parts[2] || 'halloween26');
    const sub = parts[3];
    const evDef = (def.Cn || []).find(x => x.id === evId) || (def.Cn || [])[0];
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
      return { profile: p };
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
      return { profile: p };
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
    const day = dayParam ? Number(dayParam) : (def.Cr ? def.Cr(Date.now()) : 1);
    const info = def.V ? def.V(day) : null;
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
    state.account.name = name;
    state.profile.name = name;
    saveState(state);
    return { name };
  }
  if (path === '/account/reset') {
    state.profile = createDefaultProfile(state.account.name);
    state.records = [];
    state.endlessRecords = [];
    saveState(state);
    return { ok: true };
  }

  // /clans/* & /mail/* & /players/*
  if (path === '/clans/status') return { mail: 0 };
  if (path === '/mail') return [];
  if (path === '/players') {
    return {
      id: state.account.id,
      name: state.profile.name,
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

  return {};
}

// 5. Intercept window.fetch for https://api.pokebonk.com
const origFetch = window.fetch.bind(window);
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
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  }
  return origFetch(input, init);
};

// 6. Sandbox / Unlock-All & Save Manager Toolbox (Press F9 to toggle)
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
  for (const item of def.Wn || []) {
    p.lab[item.id] = item.max;
  }

  // Unlock all shop items
  for (const item of def.Un || []) {
    if (!p.itemsOwned.includes(item.key)) p.itemsOwned.push(item.key);
  }

  // Fill bag with boost items
  for (const item of def.rr || []) {
    p.bag[item.id] = 9;
  }

  // Unlock all cosmetics
  for (const c of def.y || []) {
    if (c.id && !p.cosmetics.includes(c.id)) p.cosmetics.push(c.id);
  }
  for (const av of def.x || []) {
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
  function toggleModal() {
    if (modal) {
      modal.remove();
      modal = null;
      return;
    }
    modal = document.createElement('div');
    modal.style.cssText = 'position:fixed;inset:0;z-index:2147483646;background:rgba(12,10,24,0.78);display:flex;align-items:center;justify-content:center;font-family:system-ui,sans-serif;backdrop-filter:blur(4px)';
    const card = document.createElement('div');
    card.style.cssText = 'background:#1e1938;color:#fff;border:2px solid #4a3e7a;border-radius:20px;padding:24px;max-width:420px;width:90%;display:flex;flex-direction:column;gap:12px;box-shadow:0 20px 50px rgba(0,0,0,0.6)';
    card.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
        <strong style="font-size:20px;color:#ffd23a">⚡ PokéBonk Offline Toolbox</strong>
        <span style="font-size:12px;opacity:0.7">F9</span>
      </div>
      <p style="margin:0;font-size:13px;color:#b8b0d8;line-height:1.4">
        Running 100% offline. Your save is stored locally in your browser and synced to <code>save/profile.json</code>.
      </p>
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
      <button id="pb-off-close" style="padding:9px 14px;border:0;border-radius:12px;background:#352d5c;color:#fff;font-weight:600;cursor:pointer;margin-top:4px">
        Close
      </button>
    `;
    modal.appendChild(card);
    modal.addEventListener('click', e => {
      if (e.target === modal) toggleModal();
    });
    document.body.appendChild(modal);

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
  }

  window.addEventListener('keydown', e => {
    if (e.code === 'F9') {
      e.preventDefault();
      toggleModal();
    }
  });

  window.pokebonkOffline = {
    get state() { return state; },
    unlockEverything,
    addCurrency,
    exportSave,
    importSave,
    toggleToolbox: toggleModal
  };
}

mountOfflineToolbox();
console.log('[PokéBonk Offline] Local backend active. Press F9 anytime to open the Offline Toolbox.');
