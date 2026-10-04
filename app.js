/* ═══════════════════════════════════════════════════════════════
   CS2 HVH TEAM FINDER — client
   Match sound is now:
     • Unlocked on first user interaction (iOS/Android requirement)
     • Played exactly ONCE per real match for BOTH sides
     • Backed up by vibration on mobile
   ═══════════════════════════════════════════════════════════════ */

(() => {
  'use strict';

  const $  = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];

  const MODES_FALLBACK = {
    premier:     { label: 'Premier',     teamSize: 5, blurb: 'Ranked 5v5' },
    wingman:     { label: 'Wingman',     teamSize: 2, blurb: 'Duo 2v2' },
    competitive: { label: 'Competitive', teamSize: 5, blurb: 'Classic 5v5' },
  };

  /* ═══════════════════════════════════════════════════════════
     AUDIO ENGINE
     ═══════════════════════════════════════════════════════════ */

  const audio = {
    ctx: null,
    unlocked: false,

    init() {
      if (this.ctx) return;
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      try { this.ctx = new AC(); } catch { /* noop */ }
    },

    /**
     * Called on every user interaction. Mobile browsers
     * (especially iOS Safari) require resume() inside a
     * user-gesture handler, and it can fail silently the
     * first few times — so we just keep trying.
     */
    unlock() {
      this.init();
      if (!this.ctx) return;
      if (this.ctx.state === 'suspended') {
        this.ctx.resume().then(() => {
          if (!this.unlocked) {
            this.unlocked = true;
            // Prime the pipeline with a silent blip.
            this.tone(1, 0.01, 'sine', 0.0001);
          }
        }).catch(() => {});
      } else {
        this.unlocked = true;
      }
    },

    /** Low-level tone generator. Auto-resumes if needed. */
    tone(freq, dur = .09, type = 'sine', gain = .045, delay = 0) {
      if (!this.ctx) return;
      const c = this.ctx;
      if (c.state === 'suspended') c.resume().catch(() => {});

      const t0 = c.currentTime + delay;
      const osc = c.createOscillator();
      const g = c.createGain();

      osc.type = type;
      osc.frequency.setValueAtTime(freq, t0);
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.linearRampToValueAtTime(gain, t0 + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      osc.connect(g).connect(c.destination);
      osc.start(t0);
      osc.stop(t0 + dur + .05);
    },

    /* ── small UI sounds ─────────────────────────────── */
    click() { this.tone(520, .05, 'square', .022); },
    error() { this.tone(170, .17, 'sawtooth', .032); },

    /* ── the big one ─────────────────────────────────── */
    /**
     * Distinctive 4-note ascending chime (C5 – E5 – G5 – C6).
     * Long enough and loud enough to be heard even on
     * a phone at low volume. Played for BOTH the host and
     * the joiner the moment a real match happens.
     */
    match() {
      this.tone(523,  .14, 'triangle', .07, 0.00); // C5
      this.tone(659,  .14, 'triangle', .07, 0.14); // E5
      this.tone(784,  .14, 'triangle', .07, 0.28); // G5
      this.tone(1046, .34, 'triangle', .07, 0.42); // C6
    },
  };

  /**
   * Play the match chime + vibrate. Safe to call outside a user
   * gesture as long as the AudioContext has already been unlocked
   * by an earlier tap.
   */
  function playMatchSound() {
    audio.unlock();          // best-effort resume
    audio.match();           // the chime

    if (navigator.vibrate) {
      // 3 short pulses — feels like a notification.
      try { navigator.vibrate([90, 60, 90, 60, 160]); } catch { /* noop */ }
    }
  }

  /* Unlock audio on ANY first user interaction.
     Cheap and idempotent, so we attach it to many events. */
  function unlockAudioHandler() { audio.unlock(); }
  ['touchstart', 'touchend', 'pointerdown', 'mousedown', 'keydown', 'click']
    .forEach((evt) => {
      document.addEventListener(evt, unlockAudioHandler, { passive: true });
    });

  /* If the tab goes to background and comes back, re-resume. */
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) audio.unlock();
  });

  /* ═══════════════════════════════════════════════════════════
     TOASTS
     ═══════════════════════════════════════════════════════════ */

  const toastBox = $('#toasts');
  function toast(text, kind = 'info', ms = 4200) {
    if (!toastBox) return;
    const el = document.createElement('div');
    el.className = `toast ${kind}`;
    el.textContent = text;
    toastBox.appendChild(el);
    setTimeout(() => {
      el.classList.add('out');
      setTimeout(() => el.remove(), 300);
    }, ms);
  }

  /* ═══════════════════════════════════════════════════════════
     ICONS
     ═══════════════════════════════════════════════════════════ */

  const MODE_ICONS = {
    premier: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l7 3v6c0 4.2-2.9 7.6-7 9-4.1-1.4-7-4.8-7-9V6l7-3z"/><path d="M12 8.6l1.25 2.6 2.85.4-2.05 2 .48 2.85L12 15.1l-2.53 1.35.48-2.85-2.05-2 2.85-.4L12 8.6z"/></svg>`,
    wingman: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="8" r="3.3"/><path d="M2.9 19.6a6.15 6.15 0 0112.2 0"/><circle cx="17.6" cy="9.4" r="2.55"/><path d="M15.3 19.6a5.6 5.6 0 016.8-5.05"/></svg>`,
    competitive: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="7.4"/><circle cx="12" cy="12" r="1.9"/><path d="M12 2.2v3.6M12 18.2v3.6M2.2 12h3.6M18.2 12h3.6"/></svg>`,
  };

  const COPY_ICON  = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 012-2h9"/></svg>`;
  const CHECK_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>`;

  /* ═══════════════════════════════════════════════════════════
     STATE
     ═══════════════════════════════════════════════════════════ */

  const S = {
    id: null,
    callsign: null,
    modes: { ...MODES_FALLBACK },
    stats: null,
    role: null,
    mode: null,
    needed: null,
    code: '',
    party: null,
    phase: 'setup',
    startedAt: 0,
    everConnected: false,
    hadPartyBeforeDrop: false,
    socketOnline: false,
    /** Highest member count we've seen for the current party.
     *  Used to detect "new joiner arrived" vs "same party update". */
    lastMemberCount: -1,
    /** True once we've played the match chime for this party. */
    matchChimePlayed: false,
  };

  const panels = {
    setup:     $('#panel-setup'),
    searching: $('#panel-searching'),
    matched:   $('#panel-matched'),
  };

  const setupPanel = $('#panel-setup');
  const modeStep   = setupPanel ? setupPanel.querySelector('[data-step="mode"]') : null;

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

  /* ═══════════════════════════════════════════════════════════
     STEP VISIBILITY
     ═══════════════════════════════════════════════════════════ */

  function setStepState(node, state) {
    if (!node) return;
    node.classList.remove('is-locked', 'is-active');
    node.style.display = '';
    node.style.pointerEvents = '';

    if (state === 'hidden') {
      node.style.display = 'none';
      return;
    }
    if (state === 'locked') {
      node.classList.add('is-locked');
      node.style.pointerEvents = 'none';
      return;
    }
    node.classList.add('is-active');
  }

  function refreshSteps() {
    setStepState(modeStep, S.role ? 'active' : 'locked');

    if (S.role && S.mode) setStepState(el.stepPlayers, 'active');
    else                  setStepState(el.stepPlayers, 'locked');

    setStepState(el.stepCode, S.mode ? 'active' : 'locked');

    if (el.stepPlayers) {
      const title = el.stepPlayers.querySelector('.step-title');
      if (title) {
        title.textContent = S.role === 'joiner'
          ? 'How many players should the lobby need?'
          : 'How many players do you need?';
      }
    }

    if (el.codeStepNum) el.codeStepNum.textContent = '04';
  }

  /* ═══════════════════════════════════════════════════════════
     LIVE INDICATOR + STATS
     ═══════════════════════════════════════════════════════════ */

  function setLive(mode) {
    if (!el.livePill) return;
    el.livePill.classList.remove('online', 'offline');
    if (mode === 'online') {
      el.livePill.classList.add('online');
      el.liveText.textContent = 'Connected';
    } else {
      el.livePill.classList.add('offline');
      el.liveText.textContent = 'Offline';
    }
  }

  function renderStats(stats) {
    if (!stats) return;
    S.stats = stats;

    $$('.mode-card').forEach((card) => {
      const key = card.dataset.mode;
      const s = stats[key] || { openSlots: 0, waiting: 0 };
      const badge = card.querySelector('.mode-badge');
      const label = card.querySelector('.badge-text');
      if (!badge || !label) return;
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
    if (S.socketOnline && el.liveText) {
      el.liveText.textContent = online > 0 ? `${online} searching now` : 'Connected';
    }
    if (el.footCount) {
      el.footCount.textContent = `${t.parties || 0} open ${t.parties === 1 ? 'party' : 'parties'}`;
    }
  }

  /* ═══════════════════════════════════════════════════════════
     MODE GRID
     ═══════════════════════════════════════════════════════════ */

  function buildModeGrid() {
    if (!el.modeGrid) return;
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

    if (S.mode) {
      $$('.mode-card', el.modeGrid).forEach((c) =>
        c.classList.toggle('selected', c.dataset.mode === S.mode)
      );
    }
  }

  /* ═══════════════════════════════════════════════════════════
     SELECTION
     ═══════════════════════════════════════════════════════════ */

  function selectRole(role) {
    S.role = role;
    $$('.role-card').forEach((c) =>
      c.classList.toggle('selected', c.dataset.role === role)
    );
    if (S.mode) buildCountGrid(S.mode);
    refreshSteps();
    audio.click();
    updateSearchBtn();
  }

  function selectMode(mode) {
    S.mode = mode;
    $$('.mode-card').forEach((c) =>
      c.classList.toggle('selected', c.dataset.mode === mode)
    );
    buildCountGrid(mode);
    refreshSteps();
    audio.click();
    updateSearchBtn();
  }

  function buildCountGrid(mode) {
    if (!el.countGrid) return;
    const teamSize = (S.modes[mode] && S.modes[mode].teamSize) || 5;
    const max = Math.max(1, teamSize - 1);
    const options = [];
    for (let n = 1; n <= max; n++) options.push(n);
    const prev = S.needed;

    el.countGrid.innerHTML = options.map((n) => `
      <button class="count-btn" data-count="${n}" type="button">
        <span class="count-num">${n}</span>
        <span class="count-lbl">${n === 1 ? 'player' : 'players'}</span>
      </button>`).join('');

    if (el.countHint) {
      el.countHint.textContent = S.role === 'joiner'
        ? `Pick how many open slots the lobby you join should have (max ${max}).`
        : `You'll be the lobby leader — pick how many open slots to fill (max ${max}).`;
    }

    let target = null;
    if (prev && options.includes(prev)) {
      target = el.countGrid.querySelector(`.count-btn[data-count="${prev}"]`);
    }
    if (!target) target = el.countGrid.querySelector('.count-btn');

    if (target) {
      S.needed = parseInt(target.dataset.count, 10);
      target.classList.add('selected');
    }
  }

  function updateSearchBtn() {
    if (!el.searchBtn) return;
    const codeOk = S.code.length >= 3 && !/\s/.test(S.code);
    const ok = !!(S.role && S.mode && S.needed && codeOk);
    el.searchBtn.disabled = !ok;
    const label = el.searchBtn.querySelector('.btn-label');
    if (label) {
      label.textContent = S.role === 'joiner' ? 'Find a team' : 'Search for teammates';
    }
  }

  /* ═══════════════════════════════════════════════════════════
     PHASE TRANSITIONS
     ═══════════════════════════════════════════════════════════ */

  function showPanel(name) {
    Object.entries(panels).forEach(([key, node]) => {
      if (!node) return;
      node.classList.toggle('hidden', key !== name);
    });
  }

  function goSearching() {
    S.phase = 'searching';
    if (!S.startedAt) S.startedAt = Date.now();

    const modeLabel = (S.modes[S.mode] && S.modes[S.mode].label) || S.mode || '—';
    if (el.qMode) el.qMode.textContent = modeLabel;
    if (el.qRole) el.qRole.textContent = S.role === 'host' ? 'Lobby leader' : 'Solo player';
    if (el.searchingTitle) {
      el.searchingTitle.textContent = S.role === 'host'
        ? 'Opening your lobby…'
        : 'Scanning for open parties…';
    }
    if (el.searchingSub) {
      el.searchingSub.textContent = S.role === 'host'
        ? 'Players will appear here the moment they match with you.'
        : `Waiting for a ${modeLabel} lobby that needs ${S.needed} player${S.needed === 1 ? '' : 's'}.`;
    }
    if (el.qTime) el.qTime.textContent = '00:00';
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
    S.lastMemberCount = -1;
    S.matchChimePlayed = false;
    if (el.searchBtn) el.searchBtn.disabled = false;
    clearChat('host');
    clearChat('joiner');
    refreshSteps();
    updateSearchBtn();
    showPanel('setup');
  }

  setInterval(() => {
    if (S.phase !== 'searching' || !S.startedAt || !el.qTime) return;
    const secs = Math.floor((Date.now() - S.startedAt) / 1000);
    const mm = String(Math.floor(secs / 60)).padStart(2, '0');
    const ss = String(secs % 60).padStart(2, '0');
    el.qTime.textContent = `${mm}:${ss}`;
  }, 500);

  /* ═══════════════════════════════════════════════════════════
     PARTY RENDERING
     ═══════════════════════════════════════════════════════════ */

  function renderParty() {
    const p = S.party;
    if (!p) return;

    if (S.role === 'host') {
      if (el.hostView)   el.hostView.classList.remove('hidden');
      if (el.joinerView) el.joinerView.classList.add('hidden');
      renderHostView(p);
    } else {
      if (el.joinerView) el.joinerView.classList.remove('hidden');
      if (el.hostView)   el.hostView.classList.add('hidden');
      renderJoinerView(p);
    }
  }

  function renderHostView(p) {
    if (el.hostPartyId) el.hostPartyId.textContent = p.id;
    if (el.hostFilled)  el.hostFilled.textContent = p.filled;
    if (el.hostNeeded)  el.hostNeeded.textContent = p.needed;

    const pct = p.needed > 0 ? Math.round((p.filled / p.needed) * 100) : 0;
    if (el.hostPct) el.hostPct.textContent = `${pct}%`;
    if (el.hostBar) el.hostBar.style.width = `${pct}%`;

    if (el.hostStatus && el.hostStatusText) {
      if (p.full) {
        el.hostStatus.classList.add('is-full');
        el.hostStatusText.textContent = 'Party full — send the invites!';
      } else {
        el.hostStatus.classList.remove('is-full');
        const left = p.slotsLeft;
        el.hostStatusText.textContent = `Waiting for ${left} more player${left === 1 ? '' : 's'}…`;
      }
    }
    if (el.hostSub) {
      el.hostSub.textContent = p.full
        ? 'Everyone below is waiting in CS2 for your invite.'
        : 'Copy a code and invite them in CS2.';
    }

    if (!el.hostCodeList) return;
    el.hostCodeList.innerHTML = '';
    if (p.members.length === 0) {
      if (el.hostEmpty) el.hostEmpty.classList.remove('hidden');
    } else {
      if (el.hostEmpty) el.hostEmpty.classList.add('hidden');
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
    if (el.joinerMessage) {
      el.joinerMessage.innerHTML =
        `You've been matched up with someone who is searching for ` +
        `<b>${n} Player${n === 1 ? '' : 's'}</b>! ` +
        `You'll receive an invite shortly, Please keep CS2 open.`;
    }
  }

  /* ═══════════════════════════════════════════════════════════
     CHAT
     ═══════════════════════════════════════════════════════════ */

  const chatLogs   = { host: el.hostChatLog, joiner: el.joinerChatLog };
  const chatCounts = { host: el.hostChatCount, joiner: el.joinerChatCount };
  const chatStore  = { host: [], joiner: [] };

  function activeChatKey() { return S.role === 'host' ? 'host' : 'joiner'; }

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

  /* ═══════════════════════════════════════════════════════════
     UTILITIES
     ═══════════════════════════════════════════════════════════ */

  function escapeHtml(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function initials(callsign) {
    return escapeHtml(String(callsign || '?').charAt(0).toUpperCase());
  }

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

  /* ═══════════════════════════════════════════════════════════
     EVENT LISTENERS
     ═══════════════════════════════════════════════════════════ */

  buildModeGrid();

  $$('.role-card').forEach((card) => {
    card.addEventListener('click', () => selectRole(card.dataset.role));
  });

  if (el.modeGrid) {
    el.modeGrid.addEventListener('click', (e) => {
      const card = e.target.closest('.mode-card');
      if (!card) return;
      selectMode(card.dataset.mode);
    });
  }

  if (el.countGrid) {
    el.countGrid.addEventListener('click', (e) => {
      const btn = e.target.closest('.count-btn');
      if (!btn) return;
      S.needed = parseInt(btn.dataset.count, 10);
      $$('.count-btn', el.countGrid).forEach((b) =>
        b.classList.toggle('selected', b === btn)
      );
      audio.click();
      updateSearchBtn();
    });
  }

  if (el.codeInput) {
    el.codeInput.addEventListener('input', () => {
      S.code = el.codeInput.value.trim();
      el.codeInput.classList.remove('invalid');
      updateSearchBtn();
      saveCode();
    });
    el.codeInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && el.searchBtn && !el.searchBtn.disabled) el.searchBtn.click();
    });
  }

  if (el.clearCode) {
    el.clearCode.addEventListener('click', () => {
      if (!el.codeInput) return;
      el.codeInput.value = '';
      S.code = '';
      el.codeInput.classList.remove('invalid');
      el.codeInput.focus();
      saveCode();
      updateSearchBtn();
    });
  }

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

  $$('.chat-form').forEach((form) => {
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const input = form.querySelector('input');
      const text = input ? input.value.trim() : '';
      if (!text) return;
      if (socket && S.socketOnline) {
        socket.emit('chat:send', { text });
      } else {
        toast('Not connected — cannot send message.', 'warn');
      }
      if (input) input.value = '';
      audio.tone(760, .045, 'sine', .02);
    });
  });

  if (el.cancelBtn)   el.cancelBtn.addEventListener('click', () => { audio.click(); doCancel(); });
  if (el.hostCancel)  el.hostCancel.addEventListener('click', () => { audio.click(); doCancel(); });
  if (el.joinerAgain) el.joinerAgain.addEventListener('click', () => { audio.click(); doCancel(); });
  if (el.searchBtn)   el.searchBtn.addEventListener('click', submitSearch);

  renderChat('host');
  renderChat('joiner');

  const STORE_KEY = 'cs2-hvh-code';
  function saveCode() {
    try { localStorage.setItem(STORE_KEY, S.code); } catch { /* noop */ }
  }
  function restoreCode() {
    try {
      const v = localStorage.getItem(STORE_KEY);
      if (v && el.codeInput && !el.codeInput.value) {
        el.codeInput.value = v;
        S.code = v.trim();
        updateSearchBtn();
      }
    } catch { /* noop */ }
  }
  restoreCode();

  /* ═══════════════════════════════════════════════════════════
     SEARCH SUBMIT
     ═══════════════════════════════════════════════════════════ */

  function submitSearch() {
    audio.unlock();                // unlock inside the user gesture
    if (el.formError) el.formError.textContent = '';
    if (el.codeInput) el.codeInput.classList.remove('invalid');

    if (S.code.length < 3 || /\s/.test(S.code)) {
      if (el.codeInput) el.codeInput.classList.add('invalid');
      if (el.formError) el.formError.textContent = 'Enter a valid CS2 invite code.';
      audio.error();
      return;
    }

    if (!socket || !S.socketOnline) {
      if (el.formError) el.formError.textContent = 'Not connected to server. Please reload.';
      toast('Not connected to the server. Reload the page.', 'error', 6000);
      audio.error();
      return;
    }

    el.searchBtn.disabled = true;
    audio.click();

    // Reset match-tracking flags so the NEXT party:update can be the first match.
    S.lastMemberCount = -1;
    S.matchChimePlayed = false;

    if (S.role === 'host') {
      socket.emit('search:host',
        { mode: S.mode, needed: S.needed, code: S.code },
        (res) => {
          if (!res || !res.ok) {
            if (el.formError) el.formError.textContent = (res && res.error) || 'Something went wrong.';
            el.searchBtn.disabled = false;
            audio.error();
            return;
          }
          // Mark this as our own creation — the initial member count is 0.
          S.lastMemberCount = 0;
          S.party = res.party;
          goMatched();
          renderParty();
        });
    } else {
      socket.emit('search:join',
        { mode: S.mode, needed: S.needed, code: S.code },
        (res) => {
          if (!res || !res.ok) {
            if (el.formError) el.formError.textContent = (res && res.error) || 'Something went wrong.';
            el.searchBtn.disabled = false;
            audio.error();
            return;
          }
          if (res.queued) {
            S.startedAt = Date.now();
            goSearching();
          } else {
            // Instant match — we joined an existing party.
            S.party = res.party;
            S.lastMemberCount = res.party.members.length;
            goMatched();
            renderParty();
            // Play chime now (outside the normal party:update path).
            if (!S.matchChimePlayed) {
              S.matchChimePlayed = true;
              playMatchSound();
            }
          }
        });
    }
  }

  function doCancel() {
    if (socket && S.socketOnline) {
      socket.emit('search:cancel', {}, () => {
        S.party = null;
        S.startedAt = 0;
        resetToSetup();
      });
    } else {
      S.party = null;
      S.startedAt = 0;
      resetToSetup();
    }
  }

  /* ═══════════════════════════════════════════════════════════
     SOCKET
     ═══════════════════════════════════════════════════════════ */

  let socket = null;

  (function initSocket() {
    if (typeof io !== 'function') {
      console.error('[CS2 Finder] socket.io client script not loaded.');
      setLive('offline');
      toast('Could not load real-time engine. Reload the page.', 'error', 8000);
      return;
    }

    try {
      socket = io({ transports: ['websocket', 'polling'] });
    } catch (err) {
      console.error('[CS2 Finder] socket init failed:', err);
      setLive('offline');
      toast('Real-time connection failed. Reload the page.', 'error', 8000);
      return;
    }

    socket.on('connect', () => {
      S.socketOnline = true;
      if (S.everConnected && S.hadPartyBeforeDrop) {
        toast('Reconnected — your previous search was closed.', 'warn', 5000);
      }
      S.everConnected = true;
      S.hadPartyBeforeDrop = false;
      setLive('online');
    });

    socket.on('disconnect', () => {
      S.socketOnline = false;
      S.hadPartyBeforeDrop = S.hadPartyBeforeDrop || !!S.party;
      setLive('offline');
      if (S.phase !== 'setup') toast('Connection lost. Reconnecting…', 'error');
    });

    socket.on('connect_error', () => {
      S.socketOnline = false;
      setLive('offline');
    });

    socket.on('hello', (data) => {
      S.id = data.id;
      S.callsign = data.callsign;
      if (data.modes) {
        S.modes = data.modes;
        buildModeGrid();
      }
      renderStats(data.stats);
    });

    socket.on('stats', renderStats);

    socket.on('queue:waiting', (info) => {
      goSearching();
      S.startedAt = info.since || Date.now();
    });

    /* ───────────────────────────────────────────────────
       PARTY UPDATE — this is where the match chime fires.
       Rules:
         • Host : chime plays only when a NEW joiner appears
                  (member count grows past the previous count).
         • Joiner: chime plays the first time they enter the
                  matched phase.
       The `matchChimePlayed` flag guarantees we never
       double-play within a single match, and `lastMemberCount`
       guarantees the host doesn't hear the chime for their
       own party creation.
       ─────────────────────────────────────────────────── */
    socket.on('party:update', (party) => {
      const prevCount  = S.lastMemberCount;
      const newCount   = party.members.length;
      const wasMatched = S.phase === 'matched';

      S.party = party;
      goMatched();
      renderParty();

      let shouldPlay = false;

      if (S.role === 'joiner') {
        // Joiner enters matched for the first time → chime.
        if (!wasMatched && !S.matchChimePlayed) shouldPlay = true;
      } else if (S.role === 'host') {
        // Host: only when member count actually increased and there's at least one member.
        if (newCount > 0 && newCount > prevCount && !S.matchChimePlayed) {
          shouldPlay = true;
        }
      }

      if (shouldPlay) {
        S.matchChimePlayed = true;
        playMatchSound();
        if (S.role === 'host') {
          toast(`New player joined! (${newCount}/${party.needed})`, 'success', 5000);
        }
      }

      S.lastMemberCount = newCount;
    });

    /* ───────────────────────────────────────────────────
       PARTY FULL — no sound here. The chime already fired in
       party:update when the last joiner arrived. We only show
       a success toast for the host.
       ─────────────────────────────────────────────────── */
    socket.on('party:full', (party) => {
      S.party = party;
      renderParty();
      if (S.role === 'host') {
        toast('Party full — invite everyone!', 'success', 6000);
        // Optional: a subtle confirm blip, distinct from the match chime.
        audio.tone(880, .1, 'sine', .03);
        audio.tone(1320, .16, 'sine', .03, .1);
      }
    });

    socket.on('party:closed', ({ reason }) => {
      S.party = null;
      S.phase = 'setup';
      S.lastMemberCount = -1;
      S.matchChimePlayed = false;
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
  })();

  /* ═══════════════════════════════════════════════════════════
     BOOT
     ═══════════════════════════════════════════════════════════ */

  refreshSteps();
  updateSearchBtn();
  setLive('offline');

  window.addEventListener('beforeunload', () => {
    if (socket && S.phase !== 'setup') socket.emit('search:cancel', {});
  });

})();
