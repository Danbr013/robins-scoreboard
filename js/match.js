/*
 * Volleyball rally scoring for the Robins scoreboard.
 * Port of Robins Live's Match.kt / ScoreKeeper.kt so both apps score the same way.
 * Every action returns a new state object; nothing is changed in place.
 */
(function (root) {
  'use strict';

  const PRESETS = [
    { id: 'bo3', label: 'Best of 3 (25-25-15)', format: { maxSets: 3, playAllSets: false, pointsPerSet: 25, decidingSetPoints: 15, winBy: 2, pointCap: 0 } },
    { id: 'bo5', label: 'Best of 5 (25×4, 15)', format: { maxSets: 5, playAllSets: false, pointsPerSet: 25, decidingSetPoints: 15, winBy: 2, pointCap: 0 } },
    { id: 'pool2', label: '2 sets to 25 (pool play)', format: { maxSets: 2, playAllSets: true, pointsPerSet: 25, decidingSetPoints: 25, winBy: 2, pointCap: 0 } },
    { id: 'all3', label: '3 sets, all played (25-25-15)', format: { maxSets: 3, playAllSets: true, pointsPerSet: 25, decidingSetPoints: 15, winBy: 2, pointCap: 0 } },
    { id: 'one', label: '1 set to 25', format: { maxSets: 1, playAllSets: false, pointsPerSet: 25, decidingSetPoints: 25, winBy: 2, pointCap: 0 } },
  ];

  const DEFAULT_FORMAT = PRESETS[0].format;

  function other(side) { return side === 'home' ? 'away' : 'home'; }

  function setsToWin(f) { return f.playAllSets ? f.maxSets : Math.floor(f.maxSets / 2) + 1; }

  /** The last set of an odd-length match is played to the deciding-set target. */
  function targetFor(f, setNumber) {
    return f.maxSets > 1 && f.maxSets % 2 === 1 && setNumber === f.maxSets ? f.decidingSetPoints : f.pointsPerSet;
  }

  function isSetWon(f, score, opponent, setNumber) {
    if (f.pointCap > 0 && score >= f.pointCap && score > opponent) return true;
    return score >= targetFor(f, setNumber) && score - opponent >= f.winBy;
  }

  function formatLabel(f) {
    const preset = PRESETS.find(p => sameFormat(p.format, f));
    if (preset) return preset.label;
    let s = (f.playAllSets ? f.maxSets + ' sets' : 'Best of ' + f.maxSets) + ' to ' + f.pointsPerSet;
    if (f.maxSets > 1 && f.maxSets % 2 === 1 && f.decidingSetPoints !== f.pointsPerSet) s += ', last to ' + f.decidingSetPoints;
    if (f.pointCap > 0) s += ', cap ' + f.pointCap;
    return s;
  }

  function sameFormat(a, b) {
    return ['maxSets', 'playAllSets', 'pointsPerSet', 'decidingSetPoints', 'winBy', 'pointCap'].every(k => a[k] === b[k]);
  }

  function newMatch(homeName, awayName, format, firstServer) {
    return {
      homeName: (homeName || '').trim() || 'ROBINS',
      awayName: (awayName || '').trim() || 'OPPONENT',
      format: Object.assign({}, format || DEFAULT_FORMAT),
      setNumber: 1,
      home: 0,
      away: 0,
      serving: firstServer || null,
      firstServerThisSet: firstServer || null,
      completedSets: [],
      homeTimeouts: 0,
      awayTimeouts: 0,
      matchOver: false,
    };
  }

  function points(s, side) { return side === 'home' ? s.home : s.away; }
  function name(s, side) { return side === 'home' ? s.homeName : s.awayName; }
  function timeouts(s, side) { return side === 'home' ? s.homeTimeouts : s.awayTimeouts; }
  function setWinner(set) { return set.home > set.away ? 'home' : set.away > set.home ? 'away' : null; }
  function setsWon(s, side) { return s.completedSets.filter(x => setWinner(x) === side).length; }

  function copy(s, changes) { return Object.assign({}, s, changes); }

  /** Rally won by side. Returns { state, type } where type is POINT, SET_END, MATCH_END or null (ignored). */
  function point(s, side) {
    if (s.matchOver) return { state: s, type: null };
    const home = s.home + (side === 'home' ? 1 : 0);
    const away = s.away + (side === 'away' ? 1 : 0);
    const firstServer = s.firstServerThisSet || s.serving || side;
    let next = copy(s, { home, away, serving: side, firstServerThisSet: firstServer });
    if (!isSetWon(s.format, points(next, side), points(next, other(side)), s.setNumber)) {
      return { state: next, type: 'POINT' };
    }
    const sets = s.completedSets.concat([{ home, away }]);
    const won = sets.filter(x => setWinner(x) === side).length;
    const over = s.format.playAllSets ? sets.length >= s.format.maxSets
      : won >= setsToWin(s.format) || sets.length >= s.format.maxSets;
    if (over) {
      return { state: copy(next, { completedSets: sets, matchOver: true }), type: 'MATCH_END' };
    }
    // Next set: the team that did not serve first in this set serves first.
    const nextFirst = other(firstServer);
    next = copy(next, {
      completedSets: sets, setNumber: s.setNumber + 1, home: 0, away: 0,
      serving: nextFirst, firstServerThisSet: nextFirst, homeTimeouts: 0, awayTimeouts: 0,
    });
    return { state: next, type: 'SET_END' };
  }

  /** Take a point away without undoing later actions (scorer correction). */
  function removePoint(s, side) {
    if (points(s, side) === 0) return { state: s, type: null };
    return { state: copy(s, side === 'home' ? { home: s.home - 1 } : { away: s.away - 1 }), type: 'CORRECTION' };
  }

  function setServing(s, side) {
    if (s.serving === side) return { state: s, type: null };
    const first = s.home === 0 && s.away === 0 ? side : (s.firstServerThisSet || side);
    return { state: copy(s, { serving: side, firstServerThisSet: first }), type: 'SERVE' };
  }

  function timeout(s, side) {
    return { state: copy(s, side === 'home' ? { homeTimeouts: s.homeTimeouts + 1 } : { awayTimeouts: s.awayTimeouts + 1 }), type: 'TIMEOUT' };
  }

  function rename(s, homeName, awayName) {
    return {
      state: copy(s, { homeName: (homeName || '').trim() || s.homeName, awayName: (awayName || '').trim() || s.awayName }),
      type: 'NAMES',
    };
  }

  /** { side, kind: 'SET_POINT' | 'MATCH_POINT' } for the team one rally away, or null. */
  function situation(s) {
    if (s.matchOver) return null;
    for (const side of ['home', 'away']) {
      const mine = points(s, side) + 1;
      const theirs = points(s, other(side));
      if (isSetWon(s.format, mine, theirs, s.setNumber)) {
        const setsAfter = setsWon(s, side) + 1;
        const lastSet = s.completedSets.length + 1 >= s.format.maxSets;
        const matchPoint = s.format.playAllSets ? lastSet && setsAfter > setsWon(s, other(side))
          : setsAfter >= setsToWin(s.format);
        return { side, kind: matchPoint ? 'MATCH_POINT' : 'SET_POINT' };
      }
    }
    return null;
  }

  /** Winner once the match is over; null for a tie (pool play) or while playing. */
  function matchWinner(s) {
    if (!s.matchOver) return null;
    const h = setsWon(s, 'home');
    const a = setsWon(s, 'away');
    return h > a ? 'home' : a > h ? 'away' : null;
  }

  /** On-video banner for an event, matching Robins Live's wording and timing. */
  function bannerFor(type, side, s) {
    if (type === 'SET_END') {
      const last = s.completedSets[s.completedSets.length - 1];
      return {
        title: name(s, side) + ' win set ' + s.completedSets.length,
        subtitle: s.homeName + ' ' + last.home + ' – ' + last.away + ' ' + s.awayName,
        seconds: 10,
      };
    }
    if (type === 'MATCH_END') {
      const w = matchWinner(s);
      return {
        title: w ? 'Final · ' + name(s, w) + ' win' : 'Final · Match tied',
        subtitle: setsWon(s, 'home') + '–' + setsWon(s, 'away') + '  ·  ' + s.completedSets.map(x => x.home + '-' + x.away).join('  '),
        seconds: 20,
      };
    }
    if (type === 'TIMEOUT') return { title: 'Timeout · ' + name(s, side), subtitle: '', seconds: 30 };
    return undefined; // no change
  }

  /** Cream text on dark team colors, black on light ones (gold, yellow, cyan). */
  function textOn(hex) {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
    if (!m) return '#FAF6ED';
    const n = parseInt(m[1], 16);
    const lin = c => { const v = c / 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    const l = 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
    return l > 0.33 ? '#08080A' : '#FAF6ED';
  }

  /** True for a complete match state (guards against old or damaged saved boards). */
  function isValid(s) {
    if (!s || typeof s !== 'object' || !s.format || !Array.isArray(s.completedSets)) return false;
    const f = s.format;
    return ['maxSets', 'pointsPerSet', 'decidingSetPoints', 'winBy'].every(k => Number.isFinite(f[k]) && f[k] > 0) &&
      ['setNumber', 'home', 'away', 'homeTimeouts', 'awayTimeouts'].every(k => Number.isFinite(s[k]) && s[k] >= 0) &&
      typeof s.homeName === 'string' && typeof s.awayName === 'string';
  }

  const api = {
    PRESETS, isValid, DEFAULT_FORMAT, other, setsToWin, targetFor, isSetWon, formatLabel, sameFormat,
    newMatch, point, removePoint, setServing, timeout, rename,
    points, name, timeouts, setsWon, situation, matchWinner, bannerFor, textOn,
  };
  root.RobinsMatch = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
