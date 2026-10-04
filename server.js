'use strict';

const path = require('path');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');

const PORT = process.env.PORT || 3000;

const app = express();
app.set('trust proxy', 1);

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' },
  pingTimeout: 25000,
  pingInterval: 20000,
});

app.use(express.static(__dirname, { index: 'index.html', maxAge: '1h' }));
app.get(
  ['/server.js', '/package.json', '/package-lock.json', '/render.yaml'],
  (_req, res) => res.sendStatus(404)
);
app.get('/health', (_req, res) => res.json({ ok: true, uptime: process.uptime() }));

/* ─────────── config ─────────── */

const MODES = {
  premier:     { label: 'Premier',     teamSize: 5, blurb: 'Ranked 5v5' },
  wingman:     { label: 'Wingman',     teamSize: 2, blurb: 'Duo 2v2' },
  competitive: { label: 'Competitive', teamSize: 5, blurb: 'Classic 5v5' },
};

const MIN_CODE_LEN   = 3;
const MAX_CODE_LEN   = 64;
const MAX_CHAT_LEN   = 300;
const PARTY_TTL_MS   = 1000 * 60 * 20;
const WAITING_TTL_MS = 1000 * 60 * 20;

const CALLSIGNS = [
  'VIPER','GHOST','NOMAD','RAVEN','ONYX','ECHO','HAVOC','FROST','JINX','KILO',
  'LYNX','MAVERICK','NOVA','ORION','PHANTOM','QUASAR','RIFT','SABLE','TALON',
  'VECTOR','WRAITH','ZENITH','APEX','BLITZ','COBRA','DELTA','EMBER','FLINT',
];

/* ─────────── state ─────────── */

const parties = new Map();
const waiting = new Map();

let partySeq = 0;
let msgSeq = 0;

/* ─────────── helpers ─────────── */

const rand = (n) => Math.floor(Math.random() * n);
const makeCallsign = () =>
  `${CALLSIGNS[rand(CALLSIGNS.length)]}-${String(rand(90) + 10)}`;

const slotsLeft = (p) => p.needed - p.members.length;

function sanitizeCode(v) {
  if (typeof v !== 'string') return null;
  const c = v.trim();
  if (c.length < MIN_CODE_LEN || c.length > MAX_CODE_LEN) return null;
  if (/\s/.test(c)) return null;
  if (/[<>"'`]/.test(c)) return null;
  return c;
}

function publicParty(p) {
  return {
    id: p.id,
    mode: p.mode,
    modeLabel: MODES[p.mode].label,
    needed: p.needed,
    filled: p.members.length,
    slotsLeft: slotsLeft(p),
    full: slotsLeft(p) <= 0,
    createdAt: p.createdAt,
    host: { callsign: p.host.callsign },
    members: p.members.map((m) => ({
      callsign: m.callsign,
      code: m.code,
      joinedAt: m.joinedAt,
    })),
  };
}

/**
 * Find the best open party for a given mode.
 * If `preferredNeeded` is provided, exact matches are preferred.
 * Falls back to oldest open party of that mode.
 */
function findOpenParty(mode, preferredNeeded) {
  let bestExact = null;
  let bestAny = null;

  for (const p of parties.values()) {
    if (p.mode !== mode) continue;
    if (slotsLeft(p) <= 0) continue;

    if (preferredNeeded && p.needed === preferredNeeded) {
      if (!bestExact || p.createdAt < bestExact.createdAt) bestExact = p;
    }
    if (!bestAny || p.createdAt < bestAny.createdAt) bestAny = p;
  }

  return bestExact || bestAny;
}

function getStats() {
  const out = { _total: { openSlots: 0, waiting: 0, parties: parties.size } };
  for (const key of Object.keys(MODES)) {
    out[key] = {
      label: MODES[key].label,
      teamSize: MODES[key].teamSize,
      openSlots: 0,
      parties: 0,
      waiting: 0,
    };
  }
  for (const p of parties.values()) {
    const s = out[p.mode];
    if (!s) continue;
    s.openSlots += Math.max(0, slotsLeft(p));
    s.parties += 1;
  }
  for (const w of waiting.values()) {
    const s = out[w.mode];
    if (!s) continue;
    s.waiting += 1;
  }
  for (const key of Object.keys(MODES)) {
    out._total.openSlots += out[key].openSlots;
    out._total.waiting += out[key].waiting;
  }
  return out;
}

function broadcastStats() {
  io.emit('stats', getStats());
}

/* ─────────── party ops ─────────── */

function addMember(party, socket) {
  const member = {
    socketId: socket.id,
    code: socket.data.code,
    callsign: socket.data.callsign,
    joinedAt: Date.now(),
  };
  party.members.push(member);

  socket.data.partyId = party.id;
  socket.data.role = 'joiner';
  socket.join('party:' + party.id);

  io.to('party:' + party.id).emit('party:update', publicParty(party));

  if (slotsLeft(party) <= 0) {
    io.to('party:' + party.id).emit('party:full', publicParty(party));
  }
  broadcastStats();
  return member;
}

function removeMember(party, socket) {
  const i = party.members.findIndex((m) => m.socketId === socket.id);
  if (i === -1) return false;
  party.members.splice(i, 1);
  socket.leave('party:' + party.id);
  socket.data.partyId = null;
  io.to('party:' + party.id).emit('party:update', publicParty(party));
  broadcastStats();
  tryFill(party.mode);
  return true;
}

function closeParty(partyId, reason, exceptSocket) {
  const party = parties.get(partyId);
  if (!party) return;
  const target = exceptSocket
    ? exceptSocket.to('party:' + partyId)
    : io.to('party:' + partyId);

  target.emit('party:closed', { reason, partyId });
  parties.delete(partyId);

  for (const m of party.members) {
    const s = io.sockets.sockets.get(m.socketId);
    if (s) {
      s.data.partyId = null;
      s.leave('party:' + partyId);
    }
  }
  broadcastStats();
}

/**
 * tryFill — pull waiting joiners into open parties.
 * Waiter order is preserved; each waiter's preferred `needed`
 * is used to pick the best party for them.
 */
function tryFill(mode) {
  let guard = 0;
  while (guard++ < 1000) {
    let entry = null;
    for (const w of waiting.values()) {
      if (w.mode === mode) { entry = w; break; }
    }
    if (!entry) return;

    const party = findOpenParty(mode, entry.needed);
    if (!party) return;

    waiting.delete(entry.socketId);
    const socket = io.sockets.sockets.get(entry.socketId);
    if (!socket) continue;

    socket.data.code = entry.code;
    socket.data.role = 'joiner';
    addMember(party, socket);
  }
}

/* ─────────── sockets ─────────── */

io.on('connection', (socket) => {
  socket.data.callsign = makeCallsign();
  socket.data.partyId = null;
  socket.data.role = null;
  socket.data.code = null;

  socket.emit('hello', {
    id: socket.id,
    callsign: socket.data.callsign,
    modes: MODES,
    stats: getStats(),
  });

  /* host */
  socket.on('search:host', (payload = {}, ack = () => {}) => {
    if (typeof ack !== 'function') ack = () => {};
    if (socket.data.partyId) return ack({ ok: false, error: 'You are already in a search.' });

    const mode = payload.mode;
    if (!MODES[mode]) return ack({ ok: false, error: 'Pick a valid game mode.' });

    const code = sanitizeCode(payload.code);
    if (!code) return ack({ ok: false, error: 'Enter a valid CS2 invite code.' });

    const max = MODES[mode].teamSize - 1;
    let needed = parseInt(payload.needed, 10);
    if (!Number.isFinite(needed) || needed < 1 || needed > max) {
      return ack({ ok: false, error: `Players needed must be between 1 and ${max}.` });
    }

    socket.data.code = code;

    const party = {
      id: 'P' + (++partySeq).toString(36).toUpperCase(),
      mode,
      needed,
      createdAt: Date.now(),
      host: { socketId: socket.id, code, callsign: socket.data.callsign },
      members: [],
    };

    parties.set(party.id, party);
    socket.data.partyId = party.id;
    socket.data.role = 'host';
    socket.join('party:' + party.id);

    ack({ ok: true, party: publicParty(party) });
    socket.emit('party:update', publicParty(party));

    tryFill(mode);
    broadcastStats();
  });

  /* joiner — now also accepts `needed` as a preference */
  socket.on('search:join', (payload = {}, ack = () => {}) => {
    if (typeof ack !== 'function') ack = () => {};
    if (socket.data.partyId) return ack({ ok: false, error: 'You are already in a search.' });

    const mode = payload.mode;
    if (!MODES[mode]) return ack({ ok: false, error: 'Pick a valid game mode.' });

    const code = sanitizeCode(payload.code);
    if (!code) return ack({ ok: false, error: 'Enter a valid CS2 invite code.' });

    const max = MODES[mode].teamSize - 1;
    let needed = parseInt(payload.needed, 10);
    if (!Number.isFinite(needed) || needed < 1 || needed > max) {
      // If invalid, just treat as no preference rather than failing.
      needed = null;
    }

    socket.data.code = code;
    socket.data.role = 'joiner';
    socket.data.mode = mode;

    const party = findOpenParty(mode, needed);
    if (party) {
      addMember(party, socket);
      ack({ ok: true, party: publicParty(party) });
      return;
    }

    waiting.set(socket.id, {
      socketId: socket.id,
      mode,
      needed,
      code,
      callsign: socket.data.callsign,
      since: Date.now(),
    });

    ack({ ok: true, queued: true });
    socket.emit('queue:waiting', {
      mode,
      modeLabel: MODES[mode].label,
      needed,
      since: Date.now(),
    });
    broadcastStats();
  });

  /* cancel */
  socket.on('search:cancel', (_payload, ack = () => {}) => {
    if (typeof ack !== 'function') ack = () => {};

    const partyId = socket.data.partyId;
    if (partyId) {
      const party = parties.get(partyId);
      if (party) {
        if (party.host.socketId === socket.id) {
          closeParty(partyId, 'host_cancelled', socket);
        } else {
          removeMember(party, socket);
        }
      }
      socket.data.partyId = null;
      socket.leave('party:' + partyId);
    }

    waiting.delete(socket.id);
    socket.data.mode = null;
    broadcastStats();
    ack({ ok: true });
  });

  /* chat */
  socket.on('chat:send', (payload = {}) => {
    const partyId = socket.data.partyId;
    if (!partyId) return;
    const party = parties.get(partyId);
    if (!party) return;

    let text = typeof payload.text === 'string' ? payload.text.trim() : '';
    if (!text) return;
    text = text.slice(0, MAX_CHAT_LEN);

    io.to('party:' + partyId).emit('chat:message', {
      id: (++msgSeq).toString(36),
      fromId: socket.id,
      from: socket.data.callsign,
      text,
      at: Date.now(),
    });
  });

  /* disconnect */
  socket.on('disconnect', () => {
    waiting.delete(socket.id);

    const partyId = socket.data.partyId;
    if (partyId) {
      const party = parties.get(partyId);
      if (party) {
        if (party.host.socketId === socket.id) {
          closeParty(partyId, 'host_left', socket);
        } else {
          removeMember(party, socket);
        }
      }
    }
    broadcastStats();
  });
});

/* ─────────── housekeeping ─────────── */

setInterval(() => {
  const now = Date.now();
  let changed = false;

  for (const [id, p] of parties) {
    if (now - p.createdAt > PARTY_TTL_MS) {
      closeParty(id, 'expired');
      changed = true;
    }
  }
  for (const [sid, w] of waiting) {
    if (now - w.since > WAITING_TTL_MS) {
      waiting.delete(sid);
      changed = true;
    }
  }
  if (changed) broadcastStats();
}, 60_000).unref();

server.listen(PORT, () => {
  console.log(`▲ CS2 HVH Team Finder listening on :${PORT}`);
});
