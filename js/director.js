/*
 * Decides which broadcast animation runs when (docs/GRAPHICS.md). A port of Robins Live's Director.kt,
 * so the stream, this overlay and Film Room follow the same rules: one moment at a time, a queue with
 * priorities and a longest wait, tags on the bar while nothing else is up.
 *
 * observe(match, extras, now) with every board; event(play, now) for a new play; card(type, now) for the
 * break card; frame(now) for what to draw. Times are milliseconds.
 */
(function (root) {
  'use strict';
  const M = root.RobinsMatch || (typeof require === 'function' ? require('./match.js') : null);

  // kind: [slot, seconds, maxWaitSeconds, priority]. A timeout comes after the plays already waiting, lasts until
  // 30 s after the call (no longest wait) and steps aside for a play or sub that arrives while it is up.
  // The match open (tournament, matchup, season, format) runs up to 45 s, or until the first point.
  const INTRO_MS = 45000;
  const KINDS = {
    RUN: ['B', 4, 0, 9], TIED: ['B', 3, 0, 9], CORRECTED: ['B', 3, 0, 9],
    PLAY: ['A', 5, 30, 1], MILESTONE: ['A', 5, 35, 1], SERVER: ['A', 4.5, 9, 5], SUB: ['A', 4.5, 20, 2],
    SET_WON: ['C', 7, 30, 0], MATCH_WON: ['C', 20, 60, 0], SET_STATS: ['C', 12, 60, 4], SET_START: ['C', 6, 180, 7],
    TIMEOUT: ['C', 30, 0, 3], INTRO: ['C', 45, 0, 0], POTM: ['C', 15, 60, 4], SPONSOR: ['C', 7, 45, 6],
  };
  const OVER_TIMEOUT = ['PLAY', 'MILESTONE', 'SUB'];
  /** Plays still go on after a break card up to this long; after a longer break they're old news. */
  const BREAK_KEEPS_PLAYS = 90000;
  const slot = k => KINDS[k][0];
  const seconds = k => KINDS[k][1];
  const maxWait = k => KINDS[k][2];
  const priority = k => KINDS[k][3];
  /** Who's serving waits a moment, so a kill or ace entered right after the point is shown first. */
  const SERVER_DELAY = 2500;

  // Points only: a dig wins nothing, so it isn't a play on the video (an old board's DIG is ignored).
  const STATS = [['kills', 'KILLS', 'KILL', 'KILL'], ['aces', 'ACES', 'ACE', 'ACE'], ['blocks', 'BLOCKS', 'BLOCK', 'BLOCK']];
  const statForPlay = kind => STATS.find(s => s[3] === kind) || null;

  function isMilestone(field, n) {
    if (field === 'kills') return n >= 5 && n % 5 === 0;
    if (field === 'aces' || field === 'blocks') return n >= 3 && n % 2 === 1;
    return false;
  }

  function statLine(p) {
    return STATS.filter(s => (p[s[0]] || 0) > 0).map(s => p[s[0]] + ' ' + (p[s[0]] === 1 ? s[2] : s[1])).join('  ·  ');
  }

  function ordinal(n) {
    const suffix = n % 100 >= 11 && n % 100 <= 13 ? 'TH' : ({ 1: 'ST', 2: 'ND', 3: 'RD' }[n % 10] || 'TH');
    return n + suffix;
  }

  /** lineup / server / stats from a board's match (version 4), with missing counts as 0. */
  function extrasFrom(match) {
    const x = { lineup: { home: [], away: [] }, server: null, stats: { home: null, away: null } };
    if (!match) return x;
    const lu = match.lineup || {};
    ['home', 'away'].forEach(side => { x.lineup[side] = (Array.isArray(lu[side]) ? lu[side] : []).map(v => String(v).trim()).filter(Boolean).slice(0, 12); });
    const sv = match.server;
    if (sv && (sv.side === 'home' || sv.side === 'away')) x.server = { side: sv.side, number: String(sv.number || '').slice(0, 4), name: String(sv.name || '').slice(0, 40) };
    const st = match.stats || {};
    ['home', 'away'].forEach(side => {
      const t = st[side];
      if (!t || typeof t !== 'object') return;
      const players = {};
      Object.keys(t.players || {}).forEach(num => {
        const p = t.players[num] || {};
        players[String(num).slice(0, 4)] = { name: String(p.name || '').slice(0, 40), kills: p.kills | 0, aces: p.aces | 0, blocks: p.blocks | 0, digs: p.digs | 0 };
      });
      x.stats[side] = { kills: t.kills | 0, aces: t.aces | 0, blocks: t.blocks | 0, digs: t.digs | 0, players };
    });
    return x;
  }
  const hasStats = x => !!(x.stats.home || x.stats.away);
  const player = (x, side, num) => (x.stats[side] && x.stats[side].players[num]) || null;

  function Director() {
    let last = null, lastExtras = extrasFrom(null);
    let queue = [], active = null, tags = [];
    let pops = {};
    let runSide = null, runLength = 0;
    let situationKey = null, situationSince = 0;
    let paused = false, pausedSince = 0, introUp = false, nextSponsor = 0, sponsorCount = 0;

    function moment(kind, f) { return Object.assign({ kind, side: null, number: '', name: '', word: '', detail: '', count: 0, out: '', outName: '',
      setNumber: 0, home: 0, away: 0, sponsor: -1, until: 0, stats: null, seconds: seconds(kind), queuedAt: 0, startedAt: 0, notBefore: 0 }, f || {}); }
    function enqueue(m, now) { m.queuedAt = now; queue.push(m); }
    function tag(m, now) { m.startedAt = now; tags = tags.filter(t => t.kind !== m.kind); tags.push(m); }
    function enqueueSponsor(now) {
      if (sponsorCount <= 0) return;
      enqueue(moment('SPONSOR', { sponsor: nextSponsor }), now);
      nextSponsor = (nextSponsor + 1) % sponsorCount;
    }

    function reset() { last = null; queue = []; active = null; tags = []; pops = {}; runSide = null; runLength = 0; situationKey = null; introUp = false; }

    function pointChanges(prev, s, x, now) {
      const dh = s.home - prev.home, da = s.away - prev.away;
      const scorer = dh === 1 && da === 0 ? 'home' : da === 1 && dh === 0 ? 'away' : null;
      if (scorer) {
        pops[scorer] = now;
        tags = tags.filter(t => t.kind !== 'CORRECTED');
        if (runSide === scorer) runLength++; else { runSide = scorer; runLength = 1; }
        if (active && (active.kind === 'TIMEOUT' || active.kind === 'SET_START')) active = null;   // play has begun
        queue = queue.filter(m => m.kind !== 'TIMEOUT' && m.kind !== 'SET_START' && m.kind !== 'SERVER');   // a new rally: old news
        if (runLength >= 4 && runLength % 2 === 0) {
          const srv = x.server && x.server.side === scorer && x.server.number ? x.server : null;
          tag(moment('RUN', { side: scorer, number: srv ? srv.number : '', name: srv ? srv.name : '', count: runLength }), now);
        }
        const target = M.targetFor(s.format, s.setNumber);
        if (s.home === s.away && s.home >= target - 5) tag(moment('TIED', { count: s.home }), now);
      } else if (dh < 0 || da < 0) {
        runSide = null; runLength = 0;
        tag(moment('CORRECTED'), now);
      } else if (dh !== 0 || da !== 0) {
        runSide = null; runLength = 0;     // a jump (caught up after a reconnect): no animation
      }
    }

    function setEnded(s, x, now) {
      runSide = null; runLength = 0; tags = [];
      const lastSet = s.completedSets[s.completedSets.length - 1];
      if (s.matchOver) {
        queue = queue.filter(m => m.kind !== 'SET_START');
        if (active && active.kind === 'SET_START') active = null;
        enqueue(moment('MATCH_WON', { side: M.matchWinner(s) }), now);
        if (hasStats(x)) enqueue(moment('SET_STATS', { word: 'MATCH STATS', stats: [x.stats.home, x.stats.away] }), now);
      } else if (lastSet) {
        const n = s.completedSets.length;
        enqueue(moment('SET_WON', { side: lastSet.home > lastSet.away ? 'home' : 'away', setNumber: n, home: lastSet.home, away: lastSet.away }), now);
        if (hasStats(x)) enqueue(moment('SET_STATS', { word: 'AFTER SET ' + n, stats: [x.stats.home, x.stats.away] }), now);
        if (sponsorCount > 0) enqueueSponsor(now);
        enqueue(moment('SET_START', { side: s.serving || null, setNumber: s.setNumber, count: M.targetFor(s.format, s.setNumber),
          name: s.serving ? M.name(s, s.serving) : '' }), now);
      }
    }

    function milestones(before, after, now) {
      ['home', 'away'].forEach(side => {
        const was = before.stats[side] && before.stats[side].players, is = after.stats[side] && after.stats[side].players;
        if (!was || !is) return;
        Object.keys(is).forEach(num => {
          const q = was[num], p = is[num];
          if (!q) return;
          STATS.forEach(([field, word]) => {
            if (p[field] === q[field] + 1 && isMilestone(field, p[field])) {
              enqueue(moment('MILESTONE', { side, number: num, name: p.name, word: p[field] + ' ' + word, count: p[field] }), now);
            }
          });
        });
      });
    }

    function observe(s, x, now) {
      const prev = last;
      last = s;
      const prevExtras = lastExtras;
      lastExtras = x || extrasFrom(null);
      if (!prev) return;
      const fresh = s.setNumber === 1 && s.home === 0 && s.away === 0 && !s.completedSets.length && !s.matchOver;
      if (fresh && (prev.home + prev.away > 0 || prev.completedSets.length)) {
        queue = []; active = null; tags = []; runSide = null; runLength = 0;
        return;
      }
      milestones(prevExtras, lastExtras, now);
      if (s.completedSets.length > prev.completedSets.length || (s.matchOver && !prev.matchOver)) setEnded(s, lastExtras, now);
      else if (s.setNumber === prev.setNumber) pointChanges(prev, s, lastExtras, now);
      if (s.serving && s.serving !== prev.serving && !s.matchOver && s.home + s.away > 0) {
        const srv = lastExtras.server;
        if (srv && srv.side === s.serving && srv.number) {
          const p = player(lastExtras, srv.side, srv.number);
          enqueue(moment('SERVER', { side: srv.side, number: srv.number, name: srv.name, word: 'SERVING', detail: p ? 'ACES TODAY  ' + p.aces : '',
            notBefore: now + SERVER_DELAY }), now);
        }
      }
      ['home', 'away'].forEach(side => {
        if (s.setNumber === prev.setNumber && s[side + 'Timeouts'] > prev[side + 'Timeouts']) enqueue(moment('TIMEOUT', { side, until: now + 30000 }), now);
      });
    }

    function event(p, now) {
      const kind = String(p.kind || '').toUpperCase();
      const side = p.side === 'away' ? 'away' : 'home';
      const stat = statForPlay(kind);
      if (stat) {
        const pl = player(lastExtras, side, p.number || '');
        enqueue(moment('PLAY', { side, number: p.number || '', name: p.name || '', word: kind, count: pl ? pl[stat[0]] : 0 }), now);
      } else if (kind === 'SUB') {
        enqueue(moment('SUB', { side, number: p.number || '', name: p.name || '', out: p.out || '', outName: p.outName || '', word: 'SUB' }), now);
      } else if (kind === 'POTM') {
        const pl = player(lastExtras, side, p.number || '');
        enqueue(moment('POTM', { side, number: p.number || '', name: p.name || '', detail: p.text || (pl ? statLine(pl) : '') }), now);
      } else if (kind === 'SPONSOR') {
        enqueueSponsor(now);
      }
    }

    function card(type, now) {
      const intro = type === 'intro';
      if (intro && !introUp) {
        queue = queue.filter(m => m.kind !== 'INTRO');
        active = moment('INTRO', { queuedAt: now, startedAt: now });
      }
      if (!intro && introUp && active && active.kind === 'INTRO') active = null;
      introUp = intro;
      const nowPaused = !!type && !intro;
      if (nowPaused && !paused) pausedSince = now;
      if (!nowPaused && paused) {
        // The break card held the queue: that time doesn't count against the plays waiting (unless it was a long break).
        const held = now - pausedSince;
        if (held >= 0 && held <= BREAK_KEEPS_PLAYS) queue.forEach(m => { m.queuedAt += held; if (m.notBefore) m.notBefore += held; });
      }
      paused = nowPaused;
    }

    function frame(now) {
      if (active) {
        const a = active;
        const end = a.kind === 'TIMEOUT' ? a.until : a.startedAt + a.seconds * 1000;
        if (now >= end && !(a.kind === 'INTRO' && introUp && now - a.startedAt < INTRO_MS)) active = null;
        if (a.kind === 'INTRO' && now - a.startedAt >= INTRO_MS) active = null;
      }
      // A play or sub that arrives during the timeout panel goes on now; the timeout comes back after it.
      if (active && active.kind === 'TIMEOUT' && !paused && active.until - now > 3000 &&
          queue.some(m => now >= m.notBefore && OVER_TIMEOUT.indexOf(m.kind) >= 0)) {
        queue.push(active);
        active = null;
      }
      if (!active && !paused) {
        queue = queue.filter(m => !(maxWait(m.kind) > 0 && now - m.queuedAt > maxWait(m.kind) * 1000));
        let next = null;
        queue.forEach(m => { if (now < m.notBefore) return; if (!next || priority(m.kind) < priority(next.kind) || (priority(m.kind) === priority(next.kind) && m.queuedAt < next.queuedAt)) next = m; });
        if (next) {
          queue = queue.filter(m => m !== next);
          next.startedAt = now;
          if (!(next.kind === 'TIMEOUT' && next.until - now < 3000)) active = next;   // too little time left to show
        }
      }
      tags = tags.filter(t => now - t.startedAt <= t.seconds * 1000);
      const a = active;
      const shown = a ? { moment: a, kind: a.kind, t: (now - a.startedAt) / 1000,
        length: a.kind === 'TIMEOUT' ? (a.until - a.startedAt) / 1000 : a.kind === 'INTRO' ? INTRO_MS / 1000 : a.seconds } : null;
      const s = last;
      const sit = s ? M.situation(s) : null;
      const key = sit ? s.setNumber + '-' + sit.side + '-' + sit.kind : null;
      if (key !== situationKey) { situationKey = key; situationSince = now; }
      const busy = !!shown;
      let t = null;
      if (!busy) tags.filter(m => !sit || m.kind !== 'RUN').forEach(m => { if (!t || m.startedAt > t.startedAt) t = m; });
      const popNow = {};
      Object.keys(pops).forEach(side => { const d = (now - pops[side]) / 1000; if (d < 0.7) popNow[side] = d; });
      return {
        pops: popNow,
        pointTag: busy || !sit ? null : { situation: sit, t: (now - situationSince) / 1000 },
        tag: t ? { moment: t, kind: t.kind, t: (now - t.startedAt) / 1000, length: t.seconds } : null,
        extension: shown && slot(shown.kind) === 'A' ? shown : null,
        panel: shown && slot(shown.kind) === 'C' ? shown : null,
        sponsorCount,
        busy,
      };
    }

    function animating(now) {
      return !!active || tags.length > 0 || Object.keys(pops).some(s => now - pops[s] < 700) ||
        (situationKey !== null && now - situationSince < 1000) || queue.length > 0;
    }

    return {
      observe, event, card, frame, animating, reset,
      get extras() { return lastExtras; },
      get sponsorCount() { return sponsorCount; },
      set sponsorCount(v) { sponsorCount = Math.max(0, v | 0); if (nextSponsor >= sponsorCount) nextSponsor = 0; },
    };
  }

  const api = { Director, KINDS, extrasFrom, isMilestone, statLine, ordinal, statForPlay };
  root.RobinsDirector = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
