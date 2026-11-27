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
  // A statement play (kill, ace, monster block) takes the whole screen for TAKEOVER_S, then the tag on the bar
  // has the rest; a point play (tip, roll, dump, tool, block) is only the tag, and is dropped after a short wait.
  const TAKEOVER_S = 2.1, STATEMENT_S = 5.6, POINT_S = 3.6, POINT_WAIT_S = 12;
  const KINDS = {
    RUN: ['B', 4, 0, 9], TIED: ['B', 3, 0, 9], CORRECTED: ['B', 3, 0, 9], RUN_STOPPED: ['B', 4, 0, 9], SAVED: ['B', 4, 0, 9],
    PLAY: ['A', STATEMENT_S, 30, 1], ICED: ['A', 4.6, 20, 1], MILESTONE: ['A', 5, 35, 1], SERVER: ['A', 4.5, 9, 5], SUB: ['A', 4.5, 20, 2],
    SET_WON: ['C', 7, 30, 0], MATCH_WON: ['C', 20, 60, 0], SET_STATS: ['C', 12, 60, 4], SET_START: ['C', 6, 180, 7],
    TIMEOUT: ['C', 30, 0, 3], INTRO: ['C', 45, 0, 0], POTM: ['C', 15, 60, 4], SPONSOR: ['C', 7, 45, 6],
  };
  const OVER_TIMEOUT = ['PLAY', 'MILESTONE', 'SUB', 'ICED'];
  /** Moments drawn across the whole screen (for their first TAKEOVER_S, or all of ICED). */
  const TAKEOVERS = ['PLAY', 'ICED'];
  /** Plays still go on after a break card up to this long; after a longer break they're old news. */
  const BREAK_KEEPS_PLAYS = 90000;
  const slot = k => KINDS[k][0];
  const seconds = k => KINDS[k][1];
  const maxWait = k => KINDS[k][2];
  const priority = k => KINDS[k][3];
  /** Who's serving waits a moment, so a kill or ace entered right after the point is shown first. */
  const SERVER_DELAY = 2500;

  // Points only: a dig wins nothing, so it isn't a play on the video (an old board's DIG is ignored).
  // [field, plural, one]; which play counts in which column is RobinsMatch.PLAYS.
  const STATS = [['kills', 'KILLS', 'KILL'], ['aces', 'ACES', 'ACE'], ['blocks', 'BLOCKS', 'BLOCK']];
  const statForPlay = kind => { const p = M.playOf(kind); return p ? STATS.find(s => s[0] === p.stat) : null; };
  /** How long after a point its play can still use what the point did (saved a set point, a run…). */
  const CONTEXT_MS = 40000;

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
    let timeoutBy = null;      // the team whose timeout came last, until the next point
    let lastPoint = null;      // what the latest point did, for its play: { side, set, home, away, at, run, saved, tie, wonSet, wonMatch, iced }

    function moment(kind, f) { return Object.assign({ kind, side: null, number: '', name: '', word: '', detail: '', count: 0, out: '', outName: '',
      setNumber: 0, home: 0, away: 0, sponsor: -1, until: 0, stats: null, seconds: seconds(kind), wait: maxWait(kind), statement: false, context: '',
      queuedAt: 0, startedAt: 0, notBefore: 0 }, f || {}); }
    function enqueue(m, now) { m.queuedAt = now; queue.push(m); }
    function tag(m, now) { m.startedAt = now; tags = tags.filter(t => t.kind !== m.kind); tags.push(m); }
    function enqueueSponsor(now) {
      if (sponsorCount <= 0) return;
      enqueue(moment('SPONSOR', { sponsor: nextSponsor }), now);
      nextSponsor = (nextSponsor + 1) % sponsorCount;
    }

    function reset() { last = null; queue = []; active = null; tags = []; pops = {}; runSide = null; runLength = 0; situationKey = null; introUp = false;
      timeoutBy = null; lastPoint = null; }

    function pointChanges(prev, s, x, now) {
      const dh = s.home - prev.home, da = s.away - prev.away;
      const scorer = dh === 1 && da === 0 ? 'home' : da === 1 && dh === 0 ? 'away' : null;
      if (scorer) {
        pops[scorer] = now;
        tags = tags.filter(t => t.kind !== 'CORRECTED');
        const ended = runSide && runSide !== scorer ? runLength : 0;
        if (runSide === scorer) runLength++; else { runSide = scorer; runLength = 1; }
        if (active && (active.kind === 'TIMEOUT' || active.kind === 'SET_START')) active = null;   // play has begun
        queue = queue.filter(m => m.kind !== 'TIMEOUT' && m.kind !== 'SET_START' && m.kind !== 'SERVER');   // a new rally: old news
        const point = scored(prev, scorer, s.setNumber, s.home, s.away, now);
        if (ended) tags = tags.filter(t => t.kind !== 'RUN');
        // Set point saved, then a run stopped, then a run, then tied: the first one made shows (tags of the same moment).
        if (point.saved) tag(moment('SAVED', { side: scorer, word: point.saved + ' SAVED' }), now);
        if (ended >= 5) tag(moment('RUN_STOPPED', { side: scorer, count: ended }), now);
        if (runLength >= 3) {
          const srv = x.server && x.server.side === scorer && x.server.number ? x.server : null;
          tag(moment('RUN', { side: scorer, number: srv ? srv.number : '', name: srv ? srv.name : '', count: runLength }), now);
        }
        const target = M.targetFor(s.format, s.setNumber);
        if (s.home === s.away && s.home >= target - 5) { point.tie = s.home; tag(moment('TIED', { count: s.home }), now); }
      } else if (dh < 0 || da < 0) {
        runSide = null; runLength = 0; lastPoint = null; timeoutBy = null;
        tag(moment('CORRECTED'), now);
      } else if (dh !== 0 || da !== 0) {
        runSide = null; runLength = 0; lastPoint = null; timeoutBy = null;     // a jump (caught up after a reconnect): no animation
      }
    }

    /** Notes what a point by [side] did (from the board before it), for the play the scorer enters next. */
    function scored(prev, side, set, home, away, now) {
      const before = M.situation(prev);
      lastPoint = { side, set, home, away, at: now, run: runSide === side ? runLength : 1,
        saved: before && before.side !== side ? (before.kind === 'MATCH_POINT' ? 'MATCH POINT' : 'SET POINT') : '',
        tie: 0, wonSet: 0, wonMatch: false,
        // Iced: the team that called the last timeout wins the very next point (on a missed serve, says the scorer).
        iced: timeoutBy === side };
      timeoutBy = null;
      return lastPoint;
    }

    /** The line a statement play adds about its point: SAVES SET POINT, 5–0 RUN, TIES IT 22–22… */
    function contextFor(side, p, now) {
      const lp = lastPoint;
      if (!lp || lp.side !== side || now - lp.at > CONTEXT_MS || !samePoint(lp, p)) return '';
      if (lp.wonMatch) return 'WINS THE MATCH';
      if (lp.wonSet) return 'WINS SET ' + lp.wonSet;
      if (lp.saved) return 'SAVES ' + lp.saved;
      if (lp.tie) return 'TIES IT ' + lp.tie + '\u2013' + lp.tie;
      if (lp.run >= 3) return lp.run + '\u20130 RUN';
      return '';
    }
    /** A play from the scorer page names its rally (set and score after the point); older ones don't. */
    const samePoint = (lp, p) => !p || !(p.set > 0) || (p.set === lp.set && p.home === lp.home && p.away === lp.away);

    function setEnded(prev, s, x, now) {
      const lastSet = s.completedSets[s.completedSets.length - 1];
      if (lastSet) {
        const winner = lastSet.home > lastSet.away ? 'home' : 'away';
        const n = s.completedSets.length;
        const pv = prev.completedSets.length === n - 1 ? prev : null;   // the set's last point, not a jump
        if (pv && runSide !== winner) { runSide = winner; runLength = 0; }
        if (pv) runLength++;
        const point = scored(pv || s, winner, n, lastSet.home, lastSet.away, now);
        if (!pv) { point.saved = ''; point.iced = false; }
        point.wonSet = n;
        point.wonMatch = !!s.matchOver;
      }
      runSide = null; runLength = 0; tags = []; timeoutBy = null;
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
      if (s.completedSets.length > prev.completedSets.length || (s.matchOver && !prev.matchOver)) setEnded(prev, s, lastExtras, now);
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
        if (s.setNumber === prev.setNumber && s[side + 'Timeouts'] > prev[side + 'Timeouts']) {
          enqueue(moment('TIMEOUT', { side, until: now + 30000 }), now);
          timeoutBy = side;
        }
      });
    }

    function event(p, now) {
      const kind = String(p.kind || '').toUpperCase();
      const side = p.side === 'away' ? 'away' : 'home';
      const play = M.playOf(kind);
      if (play) {
        const pl = player(lastExtras, side, p.number || '');
        const statement = play.tier === 'statement';
        enqueue(moment('PLAY', { side, number: p.number || '', name: p.name || '', word: kind, count: pl ? pl[play.stat] : 0, statement,
          context: statement ? contextFor(side, p, now) : '', seconds: statement ? STATEMENT_S : POINT_S, wait: statement ? 30 : POINT_WAIT_S }), now);
      } else if (kind === 'SERVE_ERROR') {
        // The other team missed its serve. After this team's own timeout, that's the timeout icing the server.
        const lp = lastPoint;
        if (lp && lp.iced && lp.side === side && now - lp.at <= CONTEXT_MS && samePoint(lp, p)) {
          lp.iced = false;
          enqueue(moment('ICED', { side, home: lp.home, away: lp.away, setNumber: lp.set }), now);
        }
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
        queue = queue.filter(m => !(m.wait > 0 && now - m.queuedAt > m.wait * 1000));
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
      let shown = a ? { moment: a, kind: a.kind, t: (now - a.startedAt) / 1000,
        length: a.kind === 'TIMEOUT' ? (a.until - a.startedAt) / 1000 : a.kind === 'INTRO' ? INTRO_MS / 1000 : a.seconds } : null;
      // A statement play is the takeover first, then the tag on the bar (which gets the rest of its time).
      let takeover = null;
      if (shown && shown.kind === 'ICED') { takeover = shown; shown = null; }
      else if (shown && shown.kind === 'PLAY' && a.statement) {
        if (shown.t < TAKEOVER_S) { takeover = shown; shown = null; }
        else shown = Object.assign({}, shown, { t: shown.t - TAKEOVER_S, length: shown.length - TAKEOVER_S });
      }
      const s = last;
      const sit = s ? M.situation(s) : null;
      const key = sit ? s.setNumber + '-' + sit.side + '-' + sit.kind : null;
      if (key !== situationKey) { situationKey = key; situationSince = now; }
      const busy = !!shown || !!takeover;
      let t = null;
      // A set point tag sits where a run's would: the run waits.
      if (!busy) tags.filter(m => !sit || (m.kind !== 'RUN' && m.kind !== 'RUN_STOPPED')).forEach(m => { if (!t || m.startedAt > t.startedAt) t = m; });
      const popNow = {};
      Object.keys(pops).forEach(side => { const d = (now - pops[side]) / 1000; if (d < 0.7) popNow[side] = d; });
      return {
        pops: popNow,
        pointTag: busy || !sit ? null : { situation: sit, t: (now - situationSince) / 1000 },
        tag: t ? { moment: t, kind: t.kind, t: (now - t.startedAt) / 1000, length: t.seconds } : null,
        takeover,
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

  const api = { Director, KINDS, TAKEOVER_S, STATEMENT_S, POINT_S, extrasFrom, isMilestone, statLine, ordinal, statForPlay };
  root.RobinsDirector = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
