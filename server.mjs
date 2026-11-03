import http from 'http';
import fs from 'fs';
import path from 'path';
import os from 'os';

const PORT = Number(process.env.PORT) || 3000;
const ROOT = process.cwd();
const SAVE_DIR = path.join(ROOT, 'save');
const SAVE_FILE = path.join(SAVE_DIR, 'profile.json');
const COOP_RECORDS_FILE = path.join(SAVE_DIR, 'coop-records.json');

fs.mkdirSync(SAVE_DIR, { recursive: true });

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.ogg': 'audio/ogg',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.glb': 'model/gltf-binary',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf'
};

// ============================================================================
// Local & LAN Co-op Multiplayer Coordinator State
// ============================================================================
const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const rooms = new Map();        // code -> RoomState
const players = new Map();      // playerId -> PlayerPresence
const invites = new Map();      // targetPlayerId -> Map<code, InviteObj>
const partyRuns = new Map();    // partyId -> PartyRunState
const runBuilds = new Map();    // runId -> BuildObj
let coopRecords = [];           // Persisted team records for /coop/board & /standing

try {
  if (fs.existsSync(COOP_RECORDS_FILE)) {
    const parsed = JSON.parse(fs.readFileSync(COOP_RECORDS_FILE, 'utf8'));
    if (Array.isArray(parsed)) coopRecords = parsed;
  }
} catch {}

function saveCoopRecords() {
  try {
    fs.writeFileSync(COOP_RECORDS_FILE, JSON.stringify(coopRecords.slice(0, 200), null, 2), 'utf8');
  } catch {}
}

function getLanAddresses() {
  const list = [];
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      if (net.family === 'IPv4' && !net.internal) {
        list.push(net.address);
      }
    }
  }
  return list;
}

function generateRoomCode() {
  for (let attempt = 0; attempt < 100; attempt++) {
    let code = '';
    for (let i = 0; i < 4; i++) {
      code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
    }
    if (!rooms.has(code)) return code;
  }
  return 'PB' + Math.floor(10 + Math.random() * 89);
}

function getPlayerFromReq(req, fallbackBody = {}) {
  let p = null;
  const header = req.headers['x-pb-player'];
  if (typeof header === 'string' && header.trim()) {
    try {
      p = JSON.parse(decodeURIComponent(header));
    } catch {
      try { p = JSON.parse(header); } catch {}
    }
  }
  const auth = req.headers['authorization'] || '';
  const token = auth.replace(/^Bearer\s+/i, '').trim();
  const id = p?.id || fallbackBody?.userId || (token ? `trainer-${token.replace(/[^a-zA-Z0-9_-]/g, '').slice(-12)}` : 'offline-trainer-1');
  const existing = players.get(id);
  const now = Date.now();

  const merged = {
    id,
    name: p?.name || existing?.name || 'Entrenador',
    guest: false,
    avatar: p?.avatar ?? existing?.avatar ?? '',
    frame: p?.frame ?? existing?.frame ?? '',
    title: p?.title ?? existing?.title ?? '',
    banner: p?.banner ?? existing?.banner ?? '',
    tag: p?.tag ?? existing?.tag ?? null,
    species: Number(p?.species || existing?.species || 4),
    skin: p?.skin !== undefined ? p.skin : (existing?.skin ?? null),
    skins: Array.isArray(p?.skins) ? p.skins : (existing?.skins || []),
    maps: { forest: 3, desert: 3, coast: 3, glacier: 3, ...(existing?.maps || {}), ...(p?.maps || {}) },
    league: Number(p?.league ?? existing?.league ?? 151),
    shinies: Number(p?.shinies ?? existing?.shinies ?? 0),
    achievements: Number(p?.achievements ?? existing?.achievements ?? 0),
    lastSeen: now
  };
  players.set(id, merged);
  return merged;
}

function desiredSize(room) {
  return room.want && room.want >= 2 && room.want <= 4 ? room.want : 4;
}

function nextFreeSlot(room) {
  const used = new Set(room.members.map(m => m.slot));
  for (let s = 0; s < 4; s++) {
    if (!used.has(s)) return s;
  }
  return room.members.length;
}

function makeMember(player, slot, isHost, species, skin, ready = false) {
  return {
    id: player.id,
    slot,
    name: player.name || 'Entrenador',
    species: Number(species || player.species || 4),
    skin: skin !== undefined ? skin : (player.skin ?? null),
    avatar: player.avatar || '',
    frame: player.frame || '',
    tag: player.tag || null,
    title: player.title || '',
    ready: Boolean(isHost || ready),
    host: Boolean(isHost),
    guest: false,
    maps: { forest: 3, desert: 3, coast: 3, glacier: 3 },
    lastSeen: Date.now()
  };
}

function recomputeVotes(room) {
  const nonHostIds = room.members.filter(m => m.id !== room.host).map(m => m.id);
  for (const vId of [...room.votesSet]) {
    if (!nonHostIds.includes(vId)) room.votesSet.delete(vId);
  }
  if (nonHostIds.length === 0 || room.votesSet.size === 0) {
    room.votes = null;
    return false;
  }
  const need = Math.floor(nonHostIds.length / 2) + 1;
  room.votes = {
    n: room.votesSet.size,
    need,
    by: [...room.votesSet]
  };
  return room.votesSet.size >= need;
}

function syncRoomFlags(room) {
  if (!room.members.length) return;
  if (!room.members.some(m => m.id === room.host)) {
    room.host = room.members[0].id;
    room.votesSet.clear();
  }
  for (const m of room.members) {
    m.host = m.id === room.host;
    if (m.host) m.ready = true;
  }
  recomputeVotes(room);
}

function serializeRoom(room) {
  syncRoomFlags(room);
  return {
    code: room.code,
    version: room.version,
    state: room.state,
    host: room.host,
    pub: room.pub,
    want: room.want,
    anyMap: Boolean(room.anyMap),
    anyTier: Boolean(room.anyTier),
    biome: room.biome,
    tier: room.tier,
    party: room.party,
    leadLeft: null,
    votes: room.votes,
    members: room.members.map(m => ({
      id: m.id,
      slot: m.slot,
      name: m.name,
      species: m.species,
      skin: m.skin,
      avatar: m.avatar,
      frame: m.frame,
      tag: m.tag,
      title: m.title,
      ready: m.ready,
      host: m.host,
      guest: false,
      maps: m.maps
    }))
  };
}

function removePlayerFromRoom(room, userId) {
  const idx = room.members.findIndex(m => m.id === userId);
  if (idx === -1) return false;
  room.members.splice(idx, 1);
  room.votesSet.delete(userId);
  if (room.members.length === 0) {
    rooms.delete(room.code);
    return true;
  }
  syncRoomFlags(room);
  room.version++;
  return true;
}

function removePlayerFromOtherRooms(userId, exceptCode = null) {
  for (const [code, room] of rooms.entries()) {
    if (code !== exceptCode && room.members.some(m => m.id === userId)) {
      removePlayerFromRoom(room, userId);
    }
  }
}

function countSeekingPlayers() {
  let count = 0;
  for (const room of rooms.values()) {
    if (room.state === 'lobby' && (room.pub === 1 || room.pub === 2)) {
      count += room.members.length;
    }
  }
  return count;
}

function readJsonBody(req) {
  return new Promise(resolve => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch {
        resolve({});
      }
    });
  });
}

function sendJson(res, status, data) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-PB-Player'
  });
  res.end(JSON.stringify(data));
}

async function handleMultiplayerApi(req, res, urlObj) {
  const subPath = urlObj.pathname.replace(/^\/api\/mp/, '');
  const method = (req.method || 'GET').toUpperCase();
  if (method === 'OPTIONS') {
    return sendJson(res, 200, { ok: true });
  }

  const body = method === 'POST' || method === 'PUT' ? await readJsonBody(req) : {};
  const me = getPlayerFromReq(req, body);

  // 1. Server LAN & Room Overview for F9 Offline Toolbox
  if (subPath === '/info' && method === 'GET') {
    const activeRooms = [];
    for (const r of rooms.values()) {
      activeRooms.push({
        code: r.code,
        state: r.state,
        biome: r.biome,
        tier: r.tier,
        pub: r.pub,
        members: r.members.map(m => ({ id: m.id, name: m.name, species: m.species, host: m.host })),
        max: desiredSize(r)
      });
    }
    const onlinePlayers = [...players.values()]
      .filter(p => Date.now() - p.lastSeen < 60000)
      .map(p => ({ id: p.id, name: p.name, species: p.species }));
    return sendJson(res, 200, {
      port: PORT,
      lanIps: getLanAddresses(),
      me: { id: me.id, name: me.name },
      onlinePlayers,
      activeRooms
    });
  }

  // 2. Heartbeat / Presence update
  if (subPath === '/hello' && method === 'POST') {
    for (const room of rooms.values()) {
      const m = room.members.find(x => x.id === me.id);
      if (m) {
        m.name = me.name;
        m.avatar = me.avatar;
        m.frame = me.frame;
        m.title = me.title;
        m.lastSeen = Date.now();
      }
    }
    return sendJson(res, 200, { ok: true, me });
  }

  // 3. Friends & Players discovery (auto-populates all local tabs / LAN players as online friends!)
  if (subPath === '/friends' && method === 'GET') {
    const now = Date.now();
    const friendList = [...players.values()]
      .filter(p => p.id !== me.id && now - p.lastSeen < 600000)
      .map(p => ({
        id: p.id,
        name: p.name,
        avatar: p.avatar || '',
        frame: p.frame || '',
        title: p.title || '',
        species: p.species || 4,
        skins: p.skins || [],
        online: now - p.lastSeen < 45000,
        seen: p.lastSeen
      }))
      .sort((a, b) => Number(b.online) - Number(a.online) || a.name.localeCompare(b.name));
    return sendJson(res, 200, {
      friends: friendList,
      incoming: [],
      outgoing: []
    });
  }

  if (subPath === '/players/search' && method === 'GET') {
    const q = (urlObj.searchParams.get('q') || '').trim().toLowerCase();
    const list = [...players.values()]
      .filter(p => p.id !== me.id && (!q || p.name.toLowerCase().includes(q)))
      .slice(0, 10)
      .map(p => ({
        id: p.id,
        name: p.name,
        avatar: p.avatar || '',
        frame: p.frame || '',
        species: p.species || 4
      }));
    return sendJson(res, 200, list);
  }

  if (subPath === '/players' && method === 'GET') {
    const targetId = urlObj.searchParams.get('id');
    const targetName = urlObj.searchParams.get('name');
    let target = me;
    if (targetId && players.has(targetId)) {
      target = players.get(targetId);
    } else if (targetName) {
      const found = [...players.values()].find(p => p.name.toLowerCase() === targetName.toLowerCase());
      if (found) target = found;
    }
    return sendJson(res, 200, {
      id: target.id,
      name: target.name,
      avatar: target.avatar || '',
      frame: target.frame || '',
      title: target.title || '',
      banner: target.banner || '',
      lastSpecies: target.species || 4,
      league: target.league || 151,
      shinies: target.shinies || 0,
      achievements: target.achievements || 0
    });
  }

  // 4. Co-op Shared Run Seed & Result Tracking
  if (subPath === '/runs/start' && method === 'POST') {
    const partyId = body.party;
    let seed = (Math.random() * 0xffffffff) >>> 0;
    if (partyId) {
      let party = partyRuns.get(partyId);
      if (!party) {
        // Check if a room owns this party
        let roomForParty = null;
        for (const r of rooms.values()) {
          if (r.party === partyId) {
            roomForParty = r;
            break;
          }
        }
        party = {
          party: partyId,
          code: roomForParty?.code || null,
          seed: roomForParty?.seed || seed,
          biome: body.biome || roomForParty?.biome || 'forest',
          tier: body.mode === 'endless' ? 3 : Number(body.tier ?? roomForParty?.tier ?? 0),
          size: roomForParty?.members?.length || 2,
          createdAt: Date.now(),
          finishedAt: null,
          live: true,
          members: new Map()
        };
        partyRuns.set(partyId, party);
      }
      seed = party.seed;
      const runId = `coop-run-${partyId}-${me.id}`;
      party.members.set(me.id, {
        id: me.id,
        name: me.name,
        avatar: me.avatar || '',
        frame: me.frame || '',
        tag: me.tag || null,
        species: Number(body.species || me.species || 4),
        level: 1,
        kills: 0,
        damage: 0,
        stage: 1,
        done: false,
        moves: [],
        items: [],
        run: runId
      });
      return sendJson(res, 200, {
        id: runId,
        seed,
        party: partyId,
        boosts: body.boosts || [],
        ranked: true,
        offline: false
      });
    }
    return sendJson(res, 200, {
      id: 'offline-run-' + Date.now().toString(36),
      seed,
      boosts: body.boosts || [],
      ranked: true,
      offline: false
    });
  }

  if (subPath === '/runs/finish' && method === 'POST') {
    const r = body.result || {};
    const runId = body.runId || ('run-' + Date.now().toString(36));
    if (r.build) {
      runBuilds.set(runId, r.build);
    }
    const partyMatch = typeof runId === 'string' ? runId.match(/^coop-run-(party-[^-]+-[^-]+)-/) : null;
    const partyId = body.party || r.party || (partyMatch ? partyMatch[1] : null);
    let coopSummary = null;
    if (partyId) {
      let party = partyRuns.get(partyId);
      if (!party) {
        party = {
          party: partyId,
          code: null,
          seed: 1,
          biome: r.biome || 'forest',
          tier: r.mode === 'endless' ? 3 : Number(r.tier ?? 0),
          size: 2,
          createdAt: Date.now() - Math.round((r.time || 60) * 1000),
          finishedAt: Date.now(),
          live: false,
          members: new Map()
        };
        partyRuns.set(partyId, party);
      }
      const prev = party.members.get(me.id) || {
        id: me.id,
        name: me.name,
        avatar: me.avatar || '',
        frame: me.frame || '',
        tag: me.tag || null,
        species: r.finalSpecies || r.species || me.species || 4,
        run: runId
      };
      const moves = Array.isArray(r.build?.moves)
        ? r.build.moves.filter(Boolean).map(m => ({ k: m.key || m.k || m.id, lv: m.level || m.lv || 1 }))
        : [];
      const items = r.build?.items && typeof r.build.items === 'object'
        ? Object.entries(r.build.items).filter(([, cnt]) => cnt > 0)
        : [];
      party.members.set(me.id, {
        ...prev,
        name: me.name,
        avatar: me.avatar || prev.avatar || '',
        frame: me.frame || prev.frame || '',
        species: Number(r.finalSpecies || r.species || prev.species || 4),
        level: Number(r.level || prev.level || 1),
        kills: Number(r.kills ?? prev.kills ?? 0),
        damage: Math.round(Number(r.damage ?? prev.damage ?? 0)),
        stage: Number(r.stage || prev.stage || 1),
        done: true,
        moves,
        items,
        run: runId
      });
      party.time = Math.max(party.time || 0, Number(r.time || 0));
      party.victory = Boolean(party.victory || r.victory);
      party.finishedAt = Date.now();
      const allDone = [...party.members.values()].every(m => m.done);
      party.live = !allDone;

      const membersArr = [...party.members.values()];
      const totalKills = membersArr.reduce((acc, m) => acc + (m.kills || 0), 0);
      const teamSize = Math.max(2, Math.min(4, membersArr.length || party.size || 2));
      const teamKey = `${membersArr.map(m => m.id).sort().join(',')}|${party.biome}|${party.tier}`;

      const existingIdx = coopRecords.findIndex(rec => rec.party === partyId || rec.teamKey === teamKey);
      const prevRec = existingIdx >= 0 && coopRecords[existingIdx].party !== partyId ? coopRecords[existingIdx] : null;
      const entry = {
        party: partyId,
        teamKey,
        size: teamSize,
        biome: party.biome,
        tier: party.tier,
        kills: totalKills,
        time: party.time || Number(r.time || 0),
        victory: Boolean(party.victory),
        finished: party.finishedAt,
        members: membersArr.map(m => ({
          id: m.id,
          name: m.name,
          avatar: m.avatar,
          frame: m.frame,
          species: m.species,
          kills: m.kills
        }))
      };
      if (existingIdx >= 0) {
        const old = coopRecords[existingIdx];
        const better = party.tier === 3
          ? entry.time >= (old.time || 0)
          : entry.kills >= (old.kills || 0);
        if (better || old.party === partyId) {
          coopRecords[existingIdx] = entry;
        }
      } else {
        coopRecords.push(entry);
      }
      saveCoopRecords();

      const matchingTeams = coopRecords
        .filter(rec => rec.biome === party.biome && rec.tier === party.tier && rec.size === teamSize)
        .sort((a, b) => party.tier === 3 ? (b.time - a.time) || (b.kills - a.kills) : (b.kills - a.kills) || (a.time - b.time));
      const rankIdx = matchingTeams.findIndex(rec => rec.party === partyId || rec.teamKey === teamKey);

      coopSummary = {
        size: teamSize,
        teamKills: totalKills,
        time: entry.time,
        best: prevRec ? prevRec.kills : null,
        bestTime: prevRec ? prevRec.time : null,
        rank: rankIdx >= 0 ? rankIdx + 1 : 1,
        teams: Math.max(1, matchingTeams.length),
        members: membersArr.map(m => ({
          id: m.id,
          name: m.name,
          species: m.species,
          kills: m.kills,
          done: Boolean(m.done)
        }))
      };
    }
    return sendJson(res, 200, { ok: true, ...(coopSummary ? { coop: coopSummary } : {}) });
  }

  if (subPath.startsWith('/runs/') && subPath.endsWith('/build') && method === 'GET') {
    const runId = decodeURIComponent(subPath.split('/')[2] || '');
    return sendJson(res, 200, runBuilds.get(runId) || { moves: [], items: {} });
  }

  // 5. /coop/* Endpoints
  if (subPath === '/coop/access') {
    return sendJson(res, 200, { show: true, play: true, mode: 'open' });
  }

  if (subPath === '/coop/ice') {
    // Empty servers array signals local/LAN direct host candidates without waiting on external STUN timeouts
    return sendJson(res, 200, { servers: [] });
  }

  if (subPath === '/coop/seeking') {
    return sendJson(res, 200, { n: countSeekingPlayers() });
  }

  if (subPath === '/coop/invites' && method === 'GET') {
    const userInvites = invites.get(me.id);
    if (!userInvites) return sendJson(res, 200, []);
    const list = [];
    for (const [code, inv] of userInvites.entries()) {
      const r = rooms.get(code);
      if (!r || r.state !== 'lobby' || r.members.some(m => m.id === me.id) || Date.now() - inv.created > 300000) {
        userInvites.delete(code);
        continue;
      }
      list.push(inv);
    }
    return sendJson(res, 200, list);
  }

  const declineMatch = subPath.match(/^\/coop\/invites\/([^/]+)\/decline$/);
  if (declineMatch && method === 'POST') {
    const code = decodeURIComponent(declineMatch[1]).toUpperCase();
    invites.get(me.id)?.delete(code);
    return sendJson(res, 200, { ok: true });
  }

  if (subPath === '/coop/board' && method === 'GET') {
    const size = Number(urlObj.searchParams.get('size') || 2);
    const biome = urlObj.searchParams.get('biome') || 'forest';
    const tier = Number(urlObj.searchParams.get('tier') || 0);
    const filtered = coopRecords
      .filter(r => r.size === size && r.biome === biome && r.tier === tier)
      .sort((a, b) => (tier === 3 ? (b.time || 0) - (a.time || 0) : (b.kills || 0) - (a.kills || 0)));
    const entries = filtered.map((r, idx) => ({
      rank: idx + 1,
      party: r.party,
      kills: r.kills,
      time: r.time,
      victory: r.victory,
      finished: r.finished,
      members: r.members,
      me: r.members.some(m => m.id === me.id)
    }));
    const myBest = entries.find(e => e.me) || null;
    return sendJson(res, 200, {
      season: 2,
      teams: entries.length,
      entries,
      me: myBest
    });
  }

  if (subPath === '/coop/team' && method === 'GET') {
    const partyId = urlObj.searchParams.get('party') || '';
    const party = partyRuns.get(partyId);
    if (party) {
      const membersArr = [...party.members.values()];
      const kills = membersArr.reduce((s, m) => s + (m.kills || 0), 0);
      return sendJson(res, 200, {
        party: party.party,
        biome: party.biome,
        tier: party.tier,
        size: membersArr.length || party.size || 2,
        kills,
        time: party.time || 0,
        victory: Boolean(party.victory),
        finished: party.finishedAt || Date.now(),
        live: Boolean(party.live),
        members: membersArr
      });
    }
    const rec = coopRecords.find(r => r.party === partyId);
    if (rec) {
      return sendJson(res, 200, {
        party: rec.party,
        biome: rec.biome,
        tier: rec.tier,
        size: rec.size,
        kills: rec.kills,
        time: rec.time,
        victory: rec.victory,
        finished: rec.finished || Date.now(),
        live: false,
        members: rec.members.map(m => ({
          ...m,
          level: 20,
          damage: (m.kills || 0) * 150,
          stage: 3,
          done: true,
          moves: [],
          items: [],
          run: ''
        }))
      });
    }
    return sendJson(res, 404, { error: 'Team run not found' });
  }

  // POST /coop/rooms -> Create Room
  if (subPath === '/coop/rooms' && method === 'POST') {
    removePlayerFromOtherRooms(me.id);
    const code = generateRoomCode();
    const member = makeMember(me, 0, true, body.species, body.skin, true);
    const room = {
      code,
      version: 1,
      state: 'lobby',
      host: me.id,
      pub: 0,
      want: 4,
      anyMap: false,
      anyTier: false,
      biome: 'forest',
      tier: 0,
      party: null,
      seed: (Math.random() * 0xffffffff) >>> 0,
      votesSet: new Set(),
      votes: null,
      members: [member],
      signals: [],
      sigSeq: 0,
      chat: [],
      chatSeq: 0,
      createdAt: Date.now()
    };
    rooms.set(code, room);
    return sendJson(res, 200, {
      me: me.id,
      room: serializeRoom(room),
      signals: [],
      chat: []
    });
  }

  // POST /coop/quick -> Quickplay Matchmaking
  if (subPath === '/coop/quick' && method === 'POST') {
    const mode = body.mode === 'survival' ? 'survival' : 'classic';
    const wantSize = [2, 3, 4].includes(Number(body.size)) ? Number(body.size) : 0;
    const wantBiome = typeof body.biome === 'string' ? body.biome : '';
    const wantTier = Number.isInteger(body.tier) ? body.tier : -1;
    const fromCode = typeof body.from === 'string' ? body.from.toUpperCase() : '';

    // Search for an open public/seeking room that matches
    let matchRoom = null;
    for (const r of rooms.values()) {
      if (r.code === fromCode) continue;
      if (r.state !== 'lobby') continue;
      if (r.pub !== 1 && r.pub !== 2) continue;
      const cap = desiredSize(r);
      if (r.members.length >= cap || r.members.length >= 4) continue;

      const rMode = r.tier === 3 ? 'survival' : 'classic';
      if (!body.wide) {
        if (rMode !== mode) continue;
        if (wantSize && cap !== wantSize && r.want !== 0) continue;
        if (wantBiome && !r.anyMap && r.biome !== wantBiome) continue;
        if (mode === 'classic' && wantTier >= 0 && !r.anyTier && r.tier !== wantTier) continue;
      }
      matchRoom = r;
      break;
    }

    if (matchRoom) {
      removePlayerFromOtherRooms(me.id, matchRoom.code);
      let existing = matchRoom.members.find(m => m.id === me.id);
      if (!existing) {
        const slot = nextFreeSlot(matchRoom);
        existing = makeMember(me, slot, false, body.species, body.skin, true);
        matchRoom.members.push(existing);
      }
      if (wantBiome && matchRoom.anyMap) {
        matchRoom.biome = wantBiome;
        matchRoom.anyMap = false;
      }
      if (mode === 'classic' && wantTier >= 0 && matchRoom.anyTier) {
        matchRoom.tier = wantTier;
        matchRoom.anyTier = false;
      }
      if (wantSize && (!matchRoom.want || matchRoom.want === 4)) {
        matchRoom.want = wantSize;
      }
      matchRoom.version++;
      return sendJson(res, 200, {
        moved: true,
        me: me.id,
        room: serializeRoom(matchRoom),
        signals: [],
        chat: matchRoom.chat.slice(-40),
        seeking: countSeekingPlayers()
      });
    }

    // If polling from an existing public room and no other match found, stay put
    if (fromCode && rooms.has(fromCode)) {
      return sendJson(res, 200, {
        moved: false,
        seeking: countSeekingPlayers()
      });
    }

    // Otherwise create a new public room
    removePlayerFromOtherRooms(me.id);
    const code = generateRoomCode();
    const member = makeMember(me, 0, true, body.species, body.skin, true);
    const room = {
      code,
      version: 1,
      state: 'lobby',
      host: me.id,
      pub: 1,
      want: wantSize || 4,
      anyMap: !wantBiome,
      anyTier: mode === 'classic' && wantTier < 0,
      biome: wantBiome || 'forest',
      tier: mode === 'survival' ? 3 : (wantTier >= 0 ? wantTier : 0),
      party: null,
      seed: (Math.random() * 0xffffffff) >>> 0,
      votesSet: new Set(),
      votes: null,
      members: [member],
      signals: [],
      sigSeq: 0,
      chat: [],
      chatSeq: 0,
      createdAt: Date.now()
    };
    rooms.set(code, room);
    return sendJson(res, 200, {
      moved: true,
      me: me.id,
      room: serializeRoom(room),
      signals: [],
      chat: [],
      seeking: countSeekingPlayers()
    });
  }

  // Room-specific routes: /coop/rooms/:code[...]
  const roomMatch = subPath.match(/^\/coop\/rooms\/([^/]+)(\/.*)?$/);
  if (roomMatch) {
    const code = decodeURIComponent(roomMatch[1]).toUpperCase();
    const action = roomMatch[2] || '';
    const room = rooms.get(code);

    if (!room) {
      return sendJson(res, 404, { error: 'Esa sala ya no existe o se ha cerrado.' });
    }

    // POST /coop/rooms/:code/join
    if (action === '/join' && method === 'POST') {
      removePlayerFromOtherRooms(me.id, code);
      let member = room.members.find(m => m.id === me.id);
      if (!member) {
        if (room.state !== 'lobby') {
          return sendJson(res, 409, { error: 'La partida de esa sala ya ha empezado.' });
        }
        if (room.members.length >= 4 || room.members.length >= desiredSize(room)) {
          return sendJson(res, 409, { error: 'La sala está llena.' });
        }
        const slot = nextFreeSlot(room);
        member = makeMember(me, slot, false, body.species, body.skin, false);
        room.members.push(member);
        room.version++;
      } else {
        if (body.species) member.species = Number(body.species);
        if (body.skin !== undefined) member.skin = body.skin;
        member.name = me.name;
        member.lastSeen = Date.now();
        room.version++;
      }
      invites.get(me.id)?.delete(code);
      return sendJson(res, 200, {
        me: me.id,
        room: serializeRoom(room),
        signals: room.signals.filter(s => s.to === me.id),
        chat: room.chat.slice(-40)
      });
    }

    // Verify membership for all other room actions
    const member = room.members.find(m => m.id === me.id);
    if (!member) {
      if (action === '/leave') return sendJson(res, 200, { ok: true });
      return sendJson(res, 403, { error: 'Ya no estás en esta sala.' });
    }
    member.lastSeen = Date.now();
    member.name = me.name || member.name;
    member.avatar = me.avatar ?? member.avatar;
    member.frame = me.frame ?? member.frame;
    member.title = me.title ?? member.title;

    // GET /coop/rooms/:code (Poll)
    if (action === '' && method === 'GET') {
      const after = Number(urlObj.searchParams.get('after') || 0);
      const chatAfter = Number(urlObj.searchParams.get('chat') || 0);
      const clientVersion = Number(urlObj.searchParams.get('v') || 0);

      const newSignals = room.signals.filter(s => s.to === me.id && s.id > after);
      const newChat = room.chat.filter(c => c.id > chatAfter);

      if (clientVersion === room.version && newSignals.length === 0 && newChat.length === 0) {
        return sendJson(res, 200, {
          same: true,
          me: me.id,
          signals: [],
          chat: []
        });
      }

      return sendJson(res, 200, {
        same: false,
        me: me.id,
        room: serializeRoom(room),
        signals: newSignals,
        chat: newChat
      });
    }

    // POST /coop/rooms/:code/me
    if (action === '/me' && method === 'POST') {
      if (body.species !== undefined) member.species = Number(body.species);
      if (body.skin !== undefined) member.skin = body.skin;
      if (body.ready !== undefined) member.ready = member.host ? true : Boolean(body.ready);
      room.version++;
      return sendJson(res, 200, {
        me: me.id,
        room: serializeRoom(room),
        signals: [],
        chat: []
      });
    }

    // POST /coop/rooms/:code/open
    if (action === '/open' && method === 'POST') {
      if (room.host === me.id) {
        room.pub = body.on ? 2 : 0;
        if ([2, 3, 4].includes(Number(body.size))) {
          room.want = Number(body.size);
        }
        room.version++;
      }
      return sendJson(res, 200, {
        me: me.id,
        room: serializeRoom(room),
        signals: [],
        chat: []
      });
    }

    // POST /coop/rooms/:code/settings
    if (action === '/settings' && method === 'POST') {
      if (room.host === me.id) {
        if (typeof body.biome === 'string' && body.biome) {
          room.biome = body.biome;
          room.anyMap = false;
        }
        if (Number.isInteger(body.tier) && body.tier >= 0 && body.tier <= 3) {
          room.tier = body.tier;
          room.anyTier = false;
        }
        room.version++;
      }
      return sendJson(res, 200, {
        me: me.id,
        room: serializeRoom(room),
        signals: [],
        chat: []
      });
    }

    // POST /coop/rooms/:code/signal
    if (action === '/signal' && method === 'POST') {
      if (body.to && body.kind) {
        room.signals.push({
          id: ++room.sigSeq,
          from: me.id,
          to: String(body.to),
          kind: String(body.kind),
          data: typeof body.data === 'string' ? body.data : JSON.stringify(body.data || ''),
          at: Date.now()
        });
        if (room.signals.length > 250) {
          room.signals.splice(0, room.signals.length - 250);
        }
      }
      return sendJson(res, 200, { ok: true });
    }

    // POST /coop/rooms/:code/chat
    if (action === '/chat' && method === 'POST') {
      const text = typeof body.text === 'string' ? body.text.trim().slice(0, 140) : '';
      if (text) {
        room.chat.push({
          id: ++room.chatSeq,
          from: me.id,
          name: member.name,
          text,
          at: Date.now()
        });
        if (room.chat.length > 100) {
          room.chat.splice(0, room.chat.length - 100);
        }
      }
      return sendJson(res, 200, { ok: true });
    }

    // POST /coop/rooms/:code/vote
    if (action === '/vote' && method === 'POST') {
      if (me.id !== room.host) {
        if (room.votesSet.has(me.id)) room.votesSet.delete(me.id);
        else room.votesSet.add(me.id);
        if (recomputeVotes(room)) {
          // Vote passed: rotate host to next member and remove AFK host
          const oldHost = room.host;
          removePlayerFromRoom(room, oldHost);
        } else {
          room.version++;
        }
      }
      return sendJson(res, 200, {
        me: me.id,
        room: serializeRoom(room),
        signals: [],
        chat: []
      });
    }

    // POST /coop/rooms/:code/kick
    if (action === '/kick' && method === 'POST') {
      if (room.host === me.id && body.user && body.user !== me.id) {
        removePlayerFromRoom(room, String(body.user));
      }
      return sendJson(res, 200, {
        me: me.id,
        room: serializeRoom(room),
        signals: [],
        chat: []
      });
    }

    // POST /coop/rooms/:code/leave
    if (action === '/leave' && method === 'POST') {
      const soft = urlObj.searchParams.get('soft') === '1';
      if (!soft) {
        removePlayerFromRoom(room, me.id);
      }
      return sendJson(res, 200, { ok: true });
    }

    // POST /coop/rooms/:code/start
    if (action === '/start' && method === 'POST') {
      if (room.host === me.id && room.members.length >= 2) {
        room.state = 'started';
        room.party = `party-${room.code.toLowerCase()}-${Date.now().toString(36)}`;
        room.seed = (Math.random() * 0xffffffff) >>> 0;
        room.chat = [];
        room.version++;
        partyRuns.set(room.party, {
          party: room.party,
          code: room.code,
          seed: room.seed,
          biome: room.biome,
          tier: room.tier,
          size: room.members.length,
          createdAt: Date.now(),
          finishedAt: null,
          live: true,
          members: new Map(
            room.members.map(m => [
              m.id,
              {
                id: m.id,
                name: m.name,
                avatar: m.avatar || '',
                frame: m.frame || '',
                tag: m.tag || null,
                species: m.species || 4,
                level: 1,
                kills: 0,
                damage: 0,
                stage: 1,
                done: false,
                moves: [],
                items: [],
                run: ''
              }
            ])
          )
        });
      }
      return sendJson(res, 200, {
        me: me.id,
        room: serializeRoom(room),
        signals: [],
        chat: []
      });
    }

    // POST /coop/rooms/:code/again
    if (action === '/again' && method === 'POST') {
      if (room.state === 'started' && (!body.party || room.party === body.party)) {
        room.state = 'lobby';
        for (const m of room.members) {
          m.ready = m.id === room.host;
        }
        room.version++;
      }
      return sendJson(res, 200, {
        me: me.id,
        room: serializeRoom(room),
        signals: [],
        chat: []
      });
    }

    // POST /coop/rooms/:code/invite
    if (action === '/invite' && method === 'POST') {
      const targetUser = String(body.user || '');
      if (targetUser) {
        if (!invites.has(targetUser)) invites.set(targetUser, new Map());
        invites.get(targetUser).set(room.code, {
          code: room.code,
          created: Date.now(),
          from: {
            id: me.id,
            name: me.name,
            avatar: me.avatar || '',
            frame: me.frame || '',
            species: member.species || me.species || 4,
            skins: me.skins || []
          }
        });
      }
      return sendJson(res, 200, { ok: true });
    }

    // GET /coop/rooms/:code/standing
    if (action === '/standing' && method === 'GET') {
      const memberIdsKey = room.members.map(m => m.id).sort().join(',');
      const teamKey = `${memberIdsKey}|${room.biome}|${room.tier}`;
      const sameCategory = coopRecords
        .filter(r => r.size === room.members.length && r.biome === room.biome && r.tier === room.tier)
        .sort((a, b) => (room.tier === 3 ? (b.time || 0) - (a.time || 0) : (b.kills || 0) - (a.kills || 0)));
      const idx = sameCategory.findIndex(r => r.teamKey === teamKey);
      const best = idx >= 0
        ? {
            rank: idx + 1,
            kills: sameCategory[idx].kills,
            time: sameCategory[idx].time
          }
        : null;
      return sendJson(res, 200, {
        ranked: true,
        biome: room.biome,
        tier: room.tier,
        teams: Math.max(1, sameCategory.length),
        best
      });
    }
  }

  return sendJson(res, 200, { ok: true });
}

// ============================================================================
// HTTP Server
// ============================================================================
const server = http.createServer((req, res) => {
  const urlObj = new URL(req.url || '/', `http://localhost:${PORT}`);
  const pathname = decodeURIComponent(urlObj.pathname);

  // 1. Local & LAN Co-op Multiplayer Coordinator API
  if (pathname.startsWith('/api/mp/')) {
    handleMultiplayerApi(req, res, urlObj).catch(err => {
      sendJson(res, 500, { error: err.message || 'Internal server error' });
    });
    return;
  }

  // 2. Local disk save persistence endpoint
  if (pathname === '/api/local-save') {
    if (req.method === 'GET') {
      if (fs.existsSync(SAVE_FILE)) {
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end(fs.readFileSync(SAVE_FILE, 'utf8'));
      } else {
        res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: 'No save file yet' }));
      }
      return;
    }
    if (req.method === 'POST') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        try {
          JSON.parse(body); // validate JSON
          fs.writeFileSync(SAVE_FILE, body, 'utf8');
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ ok: true }));
        } catch (e) {
          res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ error: e.message }));
        }
      });
      return;
    }
  }

  // 3. Resolve static file (strip SPA route prefixes like /coop/ABCD or /entrenador/Name if assets are requested relatively)
  let cleanPathname = pathname.replace(/^\/(coop|entrenador)(?=\/)/i, '');
  let relPath = cleanPathname === '/' ? '/index.html' : cleanPathname;
  let filePath = path.normalize(path.join(ROOT, relPath));

  // Prevent path traversal outside ROOT
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    const ext = path.extname(filePath).toLowerCase();
    if (!ext) {
      filePath = path.join(ROOT, 'index.html');
    } else {
      res.writeHead(404);
      res.end('Not Found');
      return;
    }
  }

  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';
  res.writeHead(200, {
    'Content-Type': contentType,
    'Cache-Control': 'no-cache'
  });
  fs.createReadStream(filePath).pipe(res);
});

server.listen(PORT, '0.0.0.0', () => {
  const lanIps = getLanAddresses();
  console.log(`\n======================================================`);
  console.log(`  PokéBonk Offline + Local/LAN Co-op Server running!`);
  console.log(`  Local:    http://localhost:${PORT}`);
  for (const ip of lanIps) {
    console.log(`  LAN Co-op: http://${ip}:${PORT}`);
  }
  console.log(`  Save file: ${SAVE_FILE}`);
  console.log(`  Press F9 in-game to open the Offline & Co-op Toolbox!`);
  console.log(`======================================================\n`);
});
