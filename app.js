/* ═══════════════════════════════════════════════════════════════
   CS2 HVH TEAM FINDER — client
   ═══════════════════════════════════════════════════════════════ */

(() => {
  'use strict';

  const $  = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];

  /* ─────────── tiny audio engine ─────────── */

  const audio = {
    ctx: null,
    ready: false,
    init() {
      if (this.ctx) return;
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      try { this.ctx = new AC(); this.ready = true; } catch { /* noop */ }
    },
    tone(freq, dur = .09, type = 'sine', gain = .045, delay = 0) {
      if (!this.ready || !this.ctx) return;
      const c = this.ctx;
      if (c.state === 'suspended') c.resume().catch(() => {});
      const t0 = c.currentTime + delay;
      const osc = c.createOscillator();
      const g = c.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, t0);
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.linearRampToValueAtTime(gain, t0 + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      osc.connect(g).connect(c.destination);
      osc.start(t0);
      osc.stop(t0 + dur + .03);
    },
    click()  { this.tone(520, .05, 'square', .022); },
    found()  { this.tone(700, .08, 'triangle', .04); this.tone(980, .11, 'triangle', .038, .09); },
    match()  { this.tone(600, .1, 'triangle', .05); this.tone(880, .1, 'triangle', .05, .1); this.tone(1180, .18, 'triangle', .045, .2); },
    error()  { this.tone(170, .17, 'sawtooth', .032); },
  };

  /* ─────────── toasts ─────────── */

  const toastBox = $('#toasts');
  function toast(text, kind = 'info', ms = 4200) {
    const el = document.createElement('div');
    el.className = `toast ${kind}`;
    el.textContent = text;
    toastBox.appendChild(el);
    setTimeout(() => {
      el.classList.add('out');
      setTimeout(() => el.remove(), 300);
    }, ms);
  }

  /* ─────────── icons ─────────── */

  const MODE_ICONS = {
    premier: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
      <path d="M12 3l7 3v6c0 4.2-2.9 7.6-7 9-4.1-1.4-7-4.8-7-9V6l7-3z"/>
      <path d="M12 8.6l1.25 2.6 2.85.4-2.05 2 .48 2.85L12 15.1l-2.53 1.35.48-2.85-2.05-2 2.85-.4L12 8.6z"/>
    </svg>`,
    wingman: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="9" cy="8" r="3.3"/>
      <path d="M2.9 19.6a6.15 6.15 0 0112.2 0"/>
      <circle cx="17.6" cy="9.4" r="2.55"/>
      <path d="M15.3 19.6a5.6 5.6 0 016.8-5.05"/>
    </svg>`,
    competitive: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="12" cy="12" r="7.4"/>
      <circle cx="12" cy="12" r="1.9"/>
      <path d="M12 2.2v3.6M12 18.2v3.6M2.2 12h3.6M18.2 12h3.6"/>
    </svg>`,
  };

  const COPY_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 012-2h9"/></svg>`;
  const CHECK_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>`;

  /* ─────────── state ─────────── */

  const S = {
    id: null,
    callsign: null,
    modes: {},
    stats: null,
    role: null,          // 'host' | 'joiner'
    mode: null,
    needed: null,
    code: '',
    party: null,
    phase: 'setup',      // setup | searching | matched
    startedAt: 0,
    everConnected: false,
    hadPartyBeforeDrop: false,
  };

  /* ─────────── socket ─────────── */

  const socket = io({ transports: ['websocket', 'polling'] });

  socket.on('connect', () => {
    if (S.everConnected && S.hadPartyBeforeDrop) {
      toast('Reconnected — your previous search was closed.', 'warn', 5000);
    }
    S.everConnected = true;
    S.hadPartyBeforeDrop = false;
    setLive('online');
  });

  socket.on('disconnect', () => {
    S.hadPartyBeforeDrop = S.hadPartyBeforeDrop || !!S.party;
    setLive('offline');
    if (S.phase !== 'setup') {
      toast('Connection lost. Reconnecting…', 'error');
    }
  });

  socket.on('connect_error', () => setLive('offline'));

  socket.on('hello', (data) => {
    S.id = data.id;
    S.callsign = data.callsign;
    S.modes = data.modes || {};
    buildModeGrid();
    renderStats(data.stats);
    restoreCode();
  });

  socket.on('stats', renderStats);

  socket.on('queue:waiting', (info) => {
    goSearching();
    S.startedAt = info.since || Date.now();
  });

  socket.on('party:update', (party) => {
    S.party = party;
    if (S.phase !== 'matched') {
      audio.match();
    }
    goMatched();
    renderParty();
  });

  socket.on('party:full', (party) => {
    S.party = party;
    renderParty();
    audio.match();
    if (S.role === 'host') toast('Party full — invite everyone!', 'success', 6000);
  });

  socket.on('party:closed', ({ reason }) => {
    S.party = null;
    S.phase = 'setup';
    const messages = {
      host_left: 'The lobby leader disconnected.',
      host_cancelled: 'The lobby leader closed the party.',
      expired: 'Your search timed out.',
    };
    toast(messages[reason] || 'Party closed.', 'warn');
    resetToSetup();
  });

  socket.on('chat:message', (msg) => {
    appendChat(msg);
    if (msg.fromId !== S.id) audio.tone(880, .05, 'sine', .02);
  });

  /* ─────────── DOM refs ─────────── */

  const panels = {
    setup:     $('#panel-setup'),
    searching: $('#panel-searching'),
    matched:   $('#panel-matched'),
  };

  const el = {
    modeGrid:     $('#modeGrid'),
    countGrid:    $('#countGrid'),
    countHint:    $('#countHint'),
    stepPlayers:  $('#stepPlayers'),
    stepCode:     $('#stepCode'),
    codeStepNum:  $('#codeStepNum'),
    codeInput:    $('#codeInput'),
    clearCode:    $('#clearCode'),
    searchBtn:    $('#searchBtn'),
    formError:    $('#formError'),
    livePill:     $('#livePill'),
    liveText:     $('#liveText'),
    footCount:    $('#footCount'),

    searchingTitle: $('#searchingTitle'),
    searchingSub:   $('#searchingSub'),
    qMode:          $('#qMode'),
    qRole:          $('#qRole'),
    qTime:          $('#qTime'),
    cancelBtn:      $('#cancelBtn'),

    hostView:       $('#hostView'),
    joinerView:     $('#joinerView'),

    hostStatus:     $('#hostStatus'),
    hostStatusText: $('#hostStatusText'),
    hostPartyId:    $('#hostPartyId'),
    hostSub:        $('#hostSub'),
    hostFilled:     $('#hostFilled'),
    hostNeeded:     $('#hostNeeded'),
    hostPct:        $('#hostPct'),
    hostBar:        $('#hostBar'),
    hostCodeList:   $('#hostCodeList'),
    hostEmpty:      $('#hostEmpty'),
    hostChatLog:    $('#hostChatLog'),
    hostChatCount:  $('#hostChatCount'),
    hostCancel:     $('#hostCancel'),

    joinerMessage:  $('#joinerMessage'),
    joinerChatLog:  $('#joinerChatLog'),
    joinerChatCount:$('#joinerChatCount'),
    joinerAgain:    $('#joinerAgain'),
  };

  /* ─────────── live indicator ─────────── */

  function setLive(mode) {
    el.livePill.classList.remove('online', 'offline');
    if (mode === 'online') {
      el.livePill.classList.add('online');
      el.liveText.textContent = 'Connected';
    } else {
      el.livePill.classList.add('offline');
      el.liveText.textContent = 'Reconnecting…';
    }
  }

  /* ─────────── stats ─────────── */

  function renderStats(stats) {
    if (!stats) return;
    S.stats = stats;

    $$('.mode-card').forEach((card) => {
      const key = card.dataset.mode;
      const s = stats[key] || { openSlots: 0, waiting: 0 };
      const badge = card.querySelector('.mode-badge');
      const label = card.querySelector('.badge-text');
      const total = (s.openSlots || 0) + (s.waiting || 0);

      badge.classList.remove('hot', 'live');
      if (total === 0) {
        label.textContent = 'No one searching';
      } else if ((s.openSlots || 0) > 0) {
        badge.classList.add('hot');
        label.textContent = `${s.openSlots} slot${s.openSlots === 1 ? '' : 's'} open`;
      } else {
        badge.classList.add('live');
        label.textContent = `${s.waiting} waiting`;
      }
    });

    const t = stats._total || { openSlots: 0, waiting: 0 };
    const online = (t.openSlots || 0) + (t.waiting || 0);
    if (el.livePill.classList.contains('online')) {
      el.liveText.textContent = online > 0
        ? `${online} searching now`
        : 'Connected';
    }
    el.footCount.textContent = `${t.parties || 0} open ${t.parties === 1 ? 'party' : 'parties'}`;
  }

  /* ─────────── mode grid ─────────── */

  function buildModeGrid() {
    if (!el.modeGrid || el.modeGrid.childElementCount) return;
    const order = ['premier', 'wingman', 'competitive'];
    const keys = order.filter((k) => S.modes[k]).concat(
      Object.keys(S.modes).filter((k) => !order.includes(k))
    );

    el.modeGrid.innerHTML = keys.map((key) => {
      const m = S.modes[key];
      return `
        <button class="mode-card" data-mode="${key}" type="button">
          <span class="mode-icon">${MODE_ICONS[key] || MODE_ICONS.competitive}</span>
          <span class="mode-name">${escapeHtml(m.label)}</span>
          <span class="mode-blurb">${escapeHtml(m.blurb || '')} · ${m.teamSize}v${m.teamSize}</span>
          <span class="mode-badge"><span class="bdot"></span><span class="badge-text">No one searching</span></span>
        </button>`;
    }).join('');

    el.modeGrid.addEventListener('click', (e) => {
      const card = e.target.closest('.mode-card');
      if (!card) return;
      selectMode(card.dataset.mode);
    });
  }

  /* ─────────── selection flow ─────────── */

  $$('.role-card').forEach((card) => {
    card.addEventListener('click', () => selectRole(card.dataset.role));
  });

  function selectRole(role) {
    S.role = role;
    $$('.role-card').forEach((c) => c.classList.toggle('selected', c.dataset.role === role));
    unlock('#stepCode');
    $('#panel-setup').querySelector('[data-step="mode"]').classList.remove('is-locked');
    $('#panel-setup').querySelector('[data-step="mode"]').classList.add('is-active');

    if (role === 'host') {
      el.stepPlayers.classList.remove('is-locked');
      el.stepPlayers.classList.add('is-active');
      el.codeStepNum.textContent = '04';
    } else {
      el.stepPlayers.classList.add('is-locked');
      el.stepPlayers.classList.remove('is-active');
      S.needed = null;
      el.codeStepNum.textContent = '03';
    }
    audio.click();
    updateSearchBtn();
  }

  function unlock(sel) {
    const node = $(sel);
    if (!node) return;
    node.classList.remove('is-locked');
    node.classList.add('is-active');
  }

  function selectMode(mode) {
    S.mode = mode;
    $$('.mode-card').forEach((c) => c.classList.toggle('selected', c.dataset.mode === mode));

    unlock('#stepCode');
    el.stepCode.classList.remove('is-locked');
    el.stepCode.classList.add('is-active');

    buildCountGrid(mode);

    if (S.role === 'host') {
      el.stepPlayers.classList.remove('is-locked');
      el.stepPlayers.classList.add('is-active');
    }

    audio.click();
    updateSearchBtn();
  }

  function buildCountGrid(mode) {
    const teamSize = (S.modes[mode] && S.modes[mode].teamSize) || 5;
    const max = Math.max(1, teamSize - 1);

    const options = [];
    for (let n = 1; n <= max; n++) options.push(n);

    el.countGrid.innerHTML = options.map((n) => `
      <button class="count-btn" data-count="${n}" type="button">
        <span class="count-num">${n}</span>
        <span class="count-lbl">${n === 1 ? 'player' : 'players'}</span>
      </button>`).join('');

    el.countHint.textContent = `You'll be the lobby leader — pick how many open slots to fill (max ${max}).`;

    el.countGrid.onclick = (e) => {
      const btn = e.target.closest('.count-btn');
      if (!btn) return;
      S.needed = parseInt(btn.dataset.count, 10);
      $$('.count-btn', el.countGrid).forEach((b) => b.classList.toggle('selected', b === btn));
      audio.click();
      updateSearchBtn();
    };

    // auto-select the first option
    const first = el.countGrid.querySelector('.count-btn');
    if (first && S.needed == null) {
      S.needed = parseInt(first.dataset.count, 10);
      first.classList.add('selected');
    }
  }

  /* ─────────── code input ─────────── */

  el.codeInput.addEventListener('input', () => {
    S.code = el.codeInput.value.trim();
    el.codeInput.classList.remove('invalid');
    updateSearchBtn();
    saveCode();
  });

  el.codeInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !el.searchBtn.disabled) el.searchBtn.click();
  });

  el.clearCode.addEventListener('click', () => {
    el.codeInput.value = '';
    S.code = '';
    el.codeInput.classList.remove('invalid');
    el.codeInput.focus();
    saveCode();
    updateSearchBtn();
  });

  const STORE_KEY = 'cs2-hvh-code';
  function saveCode() {
    try { localStorage.setItem(STORE_KEY, S.code); } catch { /* noop */ }
  }
  function restoreCode() {
    try {
      const v = localStorage.getItem(STORE_KEY);
      if (v && !el.codeInput.value) {
        el.codeInput.value = v;
        S.code = v.trim();
        updateSearchBtn();
      }
    } catch { /* noop */ }
  }

  /* ─────────── search button ─────────── */

  function updateSearchBtn() {
    const codeOk = S.code.length >= 3 && !/\s/.test(S.code);
    let ok = false;

    if (S.role === 'host') {
      ok = !!(S.mode && S.needed && codeOk);
    } else if (S.role === 'joiner') {
      ok = !!(S.mode && codeOk);
    }
    el.searchBtn.disabled = !ok;
    el.searchBtn.querySelector('.btn-label').textContent =
      S.role === 'joiner' ? 'Find a team' : 'Search for teammates';
  }

  /* ─────────── search submit ─────────── */

  el.searchBtn.addEventListener('click', () => {
    audio.init();
    el.formError.textContent = '';
    el.codeInput.classList.remove('invalid');

    if (S.code.length < 3 || /\s/.test(S.code)) {
      el.codeInput.classList.add('invalid');
      el.formError.textContent = 'Enter a valid CS2 invite code.';
      audio.error();
      return;
    }

    el.searchBtn.disabled = true;
    audio.click();

    if (S.role === 'host') {
      socket.emit('search:host',
        { mode: S.mode, needed: S.needed, code: S.code },
        (res) => {
          if (!res || !res.ok) {
            el.formError.textContent = (res && res.error) || 'Something went wrong.';
            el.searchBtn.disabled = false;
            audio.error();
            return;
          }
          S.party = res.party;
          goMatched();
          renderParty();
        });
    } else {
      socket.emit('search:join',
        { mode: S.mode, code: S.code },
        (res) => {
          if (!res || !res.ok) {
            el.formError.textContent = (res && res.error) || 'Something went wrong.';
            el.searchBtn.disabled = false;
            audio.error();
            return;
          }
          if (res.queued) {
            S.startedAt = Date.now();
            goSearching();
          } else {
            S.party = res.party;
            goMatched();
            renderParty();
          }
        });
    }
  });

  /* ─────────── phase transitions ─────────── */

  function showPanel(name) {
    Object.entries(panels).forEach(([key, node]) => {
      const on = key === name;
      node.classList.toggle('hidden', !on);
      if (on) {
        node.style.animation = 'none';
        void node.offsetWidth;
        node.style.animation = '';
      }
    });
  }

  function goSearching() {
    S.phase = 'searching';
    if (!S.startedAt) S.startedAt = Date.now();

    const modeLabel = (S.modes[S.mode] && S.modes[S.mode].label) || S.mode || '—';
    el.qMode.textContent = modeLabel;
    el.qRole.textContent = S.role === 'host' ? 'Lobby leader' : 'Solo player';

    el.searchingTitle.textContent = S.role === 'host'
      ? 'Opening your lobby…'
      : 'Scanning for open parties…';
    el.searchingSub.textContent = S.role === 'host'
      ? 'Players will appear here the moment they match with you.'
      : `Waiting for a ${modeLabel} lobby that needs players.`;

    el.qTime.textContent = '00:00';
    showPanel('searching');
  }

  function goMatched() {
    S.phase = 'matched';
    showPanel('matched');
  }

  function resetToSetup() {
    S.phase = 'setup';
    S.party = null;
    S.startedAt = 0;
    el.searchBtn.disabled = false;
    clearChat('host');
    clearChat('joiner');
    updateSearchBtn();
    showPanel('setup');
  }

  /* ─────────── elapsed timer ─────────── */

  setInterval(() => {
    if (S.phase !== 'searching' || !S.startedAt) return;
    const secs = Math.floor((Date.now() - S.startedAt) / 1000);
    const mm = String(Math.floor(secs / 60)).padStart(2, '0');
    const ss = String(secs % 60).padStart(2, '0');
    el.qTime.textContent = `${mm}:${ss}`;
  }, 500);

  /* ─────────── cancel ─────────── */

  function doCancel() {
    socket.emit('search:cancel', {}, () => {
      S.party = null;
      S.startedAt = 0;
      resetToSetup();
    });
  }

  el.cancelBtn.addEventListener('click', () => { audio.click(); doCancel(); });
  el.hostCancel.addEventListener('click', () => { audio.click(); doCancel(); });
  el.joinerAgain.addEventListener('click', () => { audio.click(); doCancel(); });

  window.addEventListener('beforeunload', () => {
    if (S.phase !== 'setup') socket.emit('search:cancel', {});
  });

  /* ─────────── render party ─────────── */

  function renderParty() {
    const p = S.party;
    if (!p) return;

    if (S.role === 'host') {
      el.hostView.classList.remove('hidden');
      el.joinerView.classList.add('hidden');
      renderHostView(p);
    } else {
      el.joinerView.classList.remove('hidden');
      el.hostView.classList.add('hidden');
      renderJoinerView(p);
    }
  }

  function renderHostView(p) {
    el.hostPartyId.textContent = p.id;
    el.hostFilled.textContent = p.filled;
    el.hostNeeded.textContent = p.needed;

    const pct = p.needed > 0 ? Math.round((p.filled / p.needed) * 100) : 0;
    el.hostPct.textContent = `${pct}%`;
    el.hostBar.style.width = `${pct}%`;

    if (p.full) {
      el.hostStatus.classList.add('is-full');
      el.hostStatusText.textContent = 'Party full — send the invites!';
      el.hostSub.textContent = 'Everyone below is waiting in CS2 for your invite.';
    } else {
      el.hostStatus.classList.remove('is-full');
      const left = p.slotsLeft;
      el.hostStatusText.textContent = `Waiting for ${left} more player${left === 1 ? '' : 's'}…`;
      el.hostSub.textContent = 'Copy a code and invite them in CS2.';
    }

    // code list
    el.hostCodeList.innerHTML = '';
    if (p.members.length === 0) {
      el.hostEmpty.classList.remove('hidden');
    } else {
      el.hostEmpty.classList.add('hidden');
      p.members.forEach((m, i) => {
        const li = document.createElement('li');
        li.className = 'code-item';
        li.style.animationDelay = `${i * 60}ms`;
        li.innerHTML = `
          <div class="code-avatar">${escapeHtml(initials(m.callsign))}</div>
          <div class="code-body">
            <div class="code-name">${escapeHtml(m.callsign)}</div>
            <div class="code-value" title="${escapeHtml(m.code)}">${escapeHtml(m.code)}</div>
          </div>
          <button class="copy-btn" type="button" data-code="${escapeHtml(m.code)}">
            ${COPY_ICON}<span>Copy</span>
          </button>`;
        el.hostCodeList.appendChild(li);
      });
    }
  }

  function renderJoinerView(p) {
    const n = p.needed;
    el.joinerMessage.innerHTML =
      `You've been matched up with someone who is searching for ` +
      `<b>${n} Player${n === 1 ? '' : 's'}</b>! ` +
      `You'll receive an invite shortly, Please keep CS2 open.`;
  }

  /* ─────────── copy buttons (delegated) ─────────── */

  document.addEventListener('click', async (e) => {
    const btn = e.target.closest('.copy-btn');
    if (!btn) return;
    const code = btn.dataset.code || '';
    const ok = await copyText(code);
    if (ok) {
      btn.classList.add('copied');
      btn.innerHTML = `${CHECK_ICON}<span>Copied</span>`;
      audio.tone(1000, .06, 'sine', .03);
      setTimeout(() => {
        btn.classList.remove('copied');
        btn.innerHTML = `${COPY_ICON}<span>Copy</span>`;
      }, 1600);
    } else {
      toast('Copy failed — select the code manually.', 'error');
    }
  });

  async function copyText(text) {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch { /* fall through */ }
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    } catch { return false; }
  }

  /* ─────────── chat ─────────── */

  const chatLogs = { host: el.hostChatLog, joiner: el.joinerChatLog };
  const chatCounts = { host: el.hostChatCount, joiner: el.joinerChatCount };
  const chatStore = { host: [], joiner: [] };

  function activeChatKey() {
    return S.role === 'host' ? 'host' : 'joiner';
  }

  function appendChat(msg) {
    const key = activeChatKey();
    chatStore[key].push(msg);
    renderChat(key);
  }

  function renderChat(key) {
    const log = chatLogs[key];
    const count = chatCounts[key];
    if (!log) return;

    const msgs = chatStore[key];
    if (count) count.textContent = msgs.length;

    if (msgs.length === 0) {
      log.innerHTML = `<div class="chat-empty">No messages yet — say hi.</div>`;
      return;
    }

    log.innerHTML = msgs.map((m) => `
      <div class="chat-msg ${m.fromId === S.id ? 'mine' : ''}">
        <span class="who">${escapeHtml(m.from)}</span><span class="txt">${escapeHtml(m.text)}</span>
      </div>`).join('');

    log.scrollTop = log.scrollHeight;
  }

  function clearChat(key) {
    chatStore[key] = [];
    renderChat(key);
  }

  $$('.chat-form').forEach((form) => {
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const key = form.dataset.chat;
      const input = form.querySelector('input');
      const text = input.value.trim();
      if (!text) return;
      socket.emit('chat:send', { text });
      input.value = '';
      audio.tone(760, .045, 'sine', .02);
    });
  });

  // initialise empty chat placeholders
  renderChat('host');
  renderChat('joiner');

  /* ─────────── utilities ─────────── */

  function escapeHtml(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function initials(callsign) {
    const s = String(callsign || '?');
    return escapeHtml(s.charAt(0).toUpperCase());
  }

  /* ─────────── mobile tap fallback ─────────── */
  /* Some mobile browsers (mostly iOS Safari with certain backdrop-filter
     combinations) still drop taps on buttons containing SVGs. This
     synthesizes a click from touchend when needed. */

  (function attachTapFallbacks() {
    const nodeList = () =>
      $$('.role-card, .mode-card, .count-btn, .btn-primary, .btn-ghost, .copy-btn, .icon-btn, .chat-form button');

    let lastTarget = null;
    let lastTime = 0;

    function synthClick(node) {
      const now = Date.now();
      if (node === lastTarget && now - lastTime < 400) return;
      lastTarget = node;
      lastTime = now;
      node.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    }

    // Delegated touchend on document — works for dynamically added buttons too.
    document.addEventListener('touchend', (e) => {
      const node = e.target.closest(
        '.role-card, .mode-card, .count-btn, .btn-primary, .btn-ghost, .copy-btn, .icon-btn, .chat-form button'
      );
      if (!node) return;
      // If the button is disabled, don't synth a click.
      if (node.disabled) return;
      // Inputs and other interactive elements are unaffected.
      e.preventDefault();
      synthClick(node);
    }, { passive: false });
  })();

  /* ─────────── boot ─────────── */

  updateSearchBtn();
  setLive('offline');
})();