/*
 * Volleyball rally scoring for the Robins scoreboard.
 * Port of Robins Live's Match.kt / ScoreKeeper.kt so both apps score the same way.
 * Every action returns a new state object; nothing is changed in place.
 */
(function (root) {
  'use strict';

  const PRESETS = [
    { id: 'bo3', label: 'Best of 3 (25-25-15)', format: { maxSets: 3, playAllSets: false, pointsPerSet: 25, decidingSetPoints: 15, winBy: 2, pointCap: 0, capOver: 0, timeoutsPerSet: 2 } },
    { id: 'bo5', label: 'Best of 5 (25×4, 15)', format: { maxSets: 5, playAllSets: false, pointsPerSet: 25, decidingSetPoints: 15, winBy: 2, pointCap: 0, capOver: 0, timeoutsPerSet: 2 } },
    { id: 'pool2', label: '2 sets to 25 (pool play)', format: { maxSets: 2, playAllSets: true, pointsPerSet: 25, decidingSetPoints: 25, winBy: 2, pointCap: 0, capOver: 0, timeoutsPerSet: 2 } },
    { id: 'all3', label: '3 sets, all played (25-25-15)', format: { maxSets: 3, playAllSets: true, pointsPerSet: 25, decidingSetPoints: 15, winBy: 2, pointCap: 0, capOver: 0, timeoutsPerSet: 2 } },
    { id: 'one', label: '1 set to 25', format: { maxSets: 1, playAllSets: false, pointsPerSet: 25, decidingSetPoints: 25, winBy: 2, pointCap: 0, capOver: 0, timeoutsPerSet: 2 } },
    { id: 'one21', label: '1 set to 21', format: { maxSets: 1, playAllSets: false, pointsPerSet: 21, decidingSetPoints: 21, winBy: 2, pointCap: 0, capOver: 0, timeoutsPerSet: 2 } },
    { id: 'one15', label: '1 set to 15', format: { maxSets: 1, playAllSets: false, pointsPerSet: 15, decidingSetPoints: 15, winBy: 2, pointCap: 0, capOver: 0, timeoutsPerSet: 2 } },
  ];

  const DEFAULT_FORMAT = PRESETS[0].format;

  /** Point-cap choices, as points over the set's target (25 → 27 with +2). 0 = no cap. */
  const CAP_CHOICES = [0, 2, 3, 5, 7];
  /** Timeouts each team gets per set. 0 = unlimited. */
  const TIMEOUT_CHOICES = [1, 2, 3, 0];

  /** A format with every field filled in (older boards don't have capOver or timeoutsPerSet). */
  function normFormat(f) {
    const x = Object.assign({}, DEFAULT_FORMAT, f || {});
    x.capOver = Number.isFinite(x.capOver) && x.capOver > 0 ? Math.floor(x.capOver) : 0;
    x.timeoutsPerSet = Number.isFinite(x.timeoutsPerSet) && x.timeoutsPerSet >= 0 ? Math.floor(x.timeoutsPerSet) : 2;
    x.pointCap = Number.isFinite(x.pointCap) && x.pointCap > 0 ? x.pointCap : 0;
    return x;
  }

  function other(side) { return side === 'home' ? 'away' : 'home'; }

  function setsToWin(f) { return f.playAllSets ? f.maxSets : Math.floor(f.maxSets / 2) + 1; }

  /** The last set of an odd-length match is played to the deciding-set target. */
  function targetFor(f, setNumber) {
    return f.maxSets > 1 && f.maxSets % 2 === 1 && setNumber === f.maxSets ? f.decidingSetPoints : f.pointsPerSet;
  }

  /** The score that ends a set no matter the margin: target + capOver (or a fixed pointCap); 0 = none. */
  function capFor(f, setNumber) {
    if (f.capOver > 0) return targetFor(f, setNumber) + f.capOver;
    return f.pointCap > 0 ? f.pointCap : 0;
  }

  function timeoutLimit(f) { return Number.isFinite(f.timeoutsPerSet) ? f.timeoutsPerSet : 2; }

  function isSetWon(f, score, opponent, setNumber) {
    const cap = capFor(f, setNumber);
    if (cap > 0 && score >= cap && score > opponent) return true;
    return score >= targetFor(f, setNumber) && score - opponent >= f.winBy;
  }

  const CORE_KEYS = ['maxSets', 'playAllSets', 'pointsPerSet', 'decidingSetPoints', 'winBy', 'pointCap'];

  /** The preset these sets and targets match, ignoring the cap and timeouts. */
  function presetFor(f) { return PRESETS.find(p => CORE_KEYS.every(k => p.format[k] === f[k])) || null; }

  function formatLabel(f) {
    const preset = presetFor(f);
    let s;
    if (preset) s = preset.label;
    else {
      s = (f.playAllSets ? f.maxSets + ' sets' : 'Best of ' + f.maxSets) + ' to ' + f.pointsPerSet;
      if (f.maxSets > 1 && f.maxSets % 2 === 1 && f.decidingSetPoints !== f.pointsPerSet) s += ', last to ' + f.decidingSetPoints;
      if (f.pointCap > 0 && !(f.capOver > 0)) s += ', cap ' + f.pointCap;
    }
    if (f.capOver > 0) s += ', cap +' + f.capOver;
    return s;
  }

  function sameFormat(a, b) {
    const x = normFormat(a), y = normFormat(b);
    return CORE_KEYS.concat(['capOver', 'timeoutsPerSet']).every(k => x[k] === y[k]);
  }

  function newMatch(homeName, awayName, format, firstServer) {
    return {
      homeName: (homeName || '').trim() || 'ROBINS',
      awayName: (awayName || '').trim() || 'OPPONENT',
      format: normFormat(format),
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

  /** Timeouts a team has left this set; Infinity when unlimited. */
  function timeoutsLeft(s, side) {
    const limit = timeoutLimit(s.format);
    return limit > 0 ? Math.max(0, limit - timeouts(s, side)) : Infinity;
  }

  /** A called timeout. Refused (type null) once the team has used its timeouts for the set, or after the match. */
  function timeout(s, side) {
    if (s.matchOver || timeoutsLeft(s, side) <= 0) return { state: s, type: null };
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

  /** Relative luminance 0 (black) … 1 (white) of a #RRGGBB color; -1 if it isn't one. */
  function luminance(hex) {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
    if (!m) return -1;
    const n = parseInt(m[1], 16);
    const lin = c => { const v = c / 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
  }

  /** Cream text on dark team colors, black on light ones (gold, yellow, cyan). */
  function textOn(hex) {
    return luminance(hex) > 0.33 ? '#08080A' : '#FAF6ED';
  }

  /** Words that belong with the surname after them: Del Sordo, De La Cruz, Van Asch, San Nicolas, Della Pia. */
  const PARTICLES = ['de', 'del', 'della', 'dela', 'delos', 'la', 'las', 'los', 'le', 'van', 'von', 'der', 'den', 'ter', 'ten',
    'da', 'das', 'do', 'dos', 'di', 'du', 'san', 'santa', 'st', 'st.', 'ste', 'saint', 'al', 'el', 'bin', 'ibn'];

  /**
   * The surname for the video: "Julius “Buck” Tolliver" → "Tolliver", "Giovanna “G” Del Sordo" → "Del Sordo",
   * "Sheila De La Cruz" → "De La Cruz", "Roberto Manuel Guillen Jr" → "Guillen". Double surnames with no particle
   * ("Criado Marrero") can't be told from a middle name, so rosters can give the surname outright (Last name on stream).
   * Film Room uses the same rule (scoring.stream_last). The app and the overlay show names as the scorer page sends them.
   */
  function lastName(full) {
    let text = String(full || '').replace(/[“"][^”"]*[”"]/g, ' ').replace(/\([^)]*\)/g, ' ').replace(/\s+-\s+/g, '-');
    const comma = text.indexOf(',');
    if (comma >= 0) {
      const before = text.slice(0, comma).trim(), after = text.slice(comma + 1).trim();
      // "Faapaia, Ioane": surname first. ("Smith, Jr." is just a suffix.)
      if (before && after && !/^(jr\.?|sr\.?|ii|iii|iv)$/i.test(after)) return before.split(/\s+/).join(' ');
      text = before || after;
    }
    const words = text.trim().split(/\s+/).filter(Boolean);
    while (words.length > 1 && /^(jr\.?|sr\.?|ii|iii|iv)$/i.test(words[words.length - 1])) words.pop();
    if (!words.length) return '';
    let i = words.length - 1;
    while (i > 0 && PARTICLES.indexOf(words[i - 1].toLowerCase()) >= 0) i--;
    return words.slice(i).join(' ');
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
    PRESETS, CAP_CHOICES, TIMEOUT_CHOICES, isValid, DEFAULT_FORMAT, normFormat, presetFor, capFor, timeoutLimit, timeoutsLeft,
    other, setsToWin, targetFor, isSetWon, formatLabel, sameFormat,
    newMatch, point, removePoint, setServing, timeout, rename,
    points, name, timeouts, setsWon, situation, matchWinner, bannerFor, textOn, luminance, lastName,
  };
  root.RobinsMatch = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
