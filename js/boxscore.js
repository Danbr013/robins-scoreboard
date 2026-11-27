/*
 * Match stats from the scorer page's log: a box score per team (kills, aces, blocks, points; serves and missed serves
 * when the lineups were in), points on the other team's errors, errors made, the sets, and the play-by-play.
 * The scorer page downloads it as an Excel file (RobinsXlsx) and a box-score CSV.
 *
 *   RobinsBox.matchEvents(log)            → the current match's part of the log (a rename or a fresh 1–0 starts over)
 *   RobinsBox.compute(events, match, opts) → { title, teams: { home, away }, sets, plays, numbers }
 *   RobinsBox.sheets(box) / RobinsBox.csv(box)
 *
 * opts: { court, division, nameOf(side, number) → roster name, lineups: { "1": { home: [...], away: [...] } },
 *         numbers: [{ side, name, number }] (numbers typed in for players the roster has none for) }.
 */
(function (root) {
  'use strict';
  const M = root.RobinsMatch || (typeof require === 'function' ? require('./match.js') : null);

  const SCORED = /^(POINT|SET_END|MATCH_END)$/;
  const OTHER = { home: 'away', away: 'home' };
  const LABEL = { SERVE_ERROR: 'Missed serve', OPP_ERROR: 'Their error', GHOST: 'Ghost serve' };

  /** "ROLL SHOT" → "Roll shot". */
  function sentence(s) { s = String(s || '').toLowerCase(); return s.charAt(0).toUpperCase() + s.slice(1); }
  /** How a point ended, in words: Kill, Roll shot, Missed serve (the other team's), Their error, or Point. */
  function howLabel(kind) {
    if (!kind) return 'Point';
    if (LABEL[kind]) return LABEL[kind];
    const p = M.playOf(kind);
    return p ? sentence(p.label) : sentence(kind);
  }
  const scored = e => SCORED.test(e.type) && (e.side === 'home' || e.side === 'away');

  /**
   * The current match's events: from the last New match, and from where the teams were renamed or the score
   * started over at 1–0 in set 1 without a New match (a test before the real match, say).
   */
  function matchEvents(log) {
    const all = Array.isArray(log) ? log : [];
    let start = 0;
    for (let i = all.length - 1; i >= 0; i--) if (all[i].type === 'NEW_MATCH') { start = i; break; }
    const last = all[all.length - 1];
    if (!last) return [];
    for (let i = all.length - 1; i > start; i--) {
      const e = all[i];
      if (e.homeName !== last.homeName || e.awayName !== last.awayName) { start = i + 1; break; }
    }
    let total = 0;
    for (let i = start; i < all.length; i++) {
      const e = all[i];
      if (!scored(e) || e.undone) continue;
      const n = (e.home | 0) + (e.away | 0), sets = (e.setsHome | 0) + (e.setsAway | 0);
      if (n === 1 && sets === 0 && (e.set | 0) === 1 && total > 1) start = i;
      total = sets ? 99 : n;
    }
    return all.slice(start);
  }

  function blankPlayer(num, name) { return { num: String(num || ''), name: name || '', kills: 0, aces: 0, blocks: 0, points: 0, serves: 0, serveErrors: 0 }; }

  function compute(events, match, opts) {
    opts = opts || {};
    const name = side => (match ? M.name(match, side) : side === 'home' ? 'Home' : 'Away');
    const nameOf = opts.nameOf || (() => '');
    const teams = {};
    ['home', 'away'].forEach(side => {
      teams[side] = { side, name: name(side), players: {}, kills: 0, aces: 0, blocks: 0, points: 0, total: 0,
        onTheirErrors: 0, unlabeled: 0, serveErrors: 0, otherErrors: 0, serves: 0, timeouts: 0, serveInfo: false };
    });
    const playerOf = (side, num, nm) => {
      const key = String(num || '') || '?' + (nm || '');
      const t = teams[side];
      if (!t.players[key]) t.players[key] = blankPlayer(num, nm || nameOf(side, String(num || '')) || '');
      else if (nm && !t.players[key].name) t.players[key].name = nm;
      return t.players[key];
    };
    // Everyone in a lineup gets a row, even with nothing in it.
    Object.keys(opts.lineups || {}).forEach(set => ['home', 'away'].forEach(side => {
      const lu = opts.lineups[set] || {};
      (lu[side] || []).filter(n => n && n !== 'GHOST').forEach(n => playerOf(side, n));
      if (lu[side + 'Libero']) playerOf(side, lu[side + 'Libero']);
    }));

    const plays = [], runs = { home: 0, away: 0 }, longest = {}, setTimeouts = {};
    let lastSide = null, run = 0;
    (events || []).forEach(e => {
      if (e.type === 'TIMEOUT' && !e.undone && teams[e.side]) {
        teams[e.side].timeouts++;
        const k = e.set + ':' + e.side; setTimeouts[k] = (setTimeouts[k] || 0) + 1;
        plays.push({ set: e.set, score: (e.home | 0) + '–' + (e.away | 0), to: '', how: 'Timeout ' + teams[e.side].name, player: '', server: '', time: e.time });
        return;
      }
      if (e.type === 'SUB' && teams[e.side]) {
        plays.push({ set: e.set, score: (e.home | 0) + '–' + (e.away | 0), to: '', how: 'Sub ' + teams[e.side].name,
          player: '#' + (e.number || '?') + ' ' + (e.player || '') + ' in for #' + (e.out || '?') + (e.outName ? ' ' + e.outName : ''), server: '', time: e.time });
        return;
      }
      if (!scored(e) || e.undone) return;
      const side = e.side, t = teams[side], o = teams[OTHER[side]];
      t.total++;
      const kind = String(e.kind || '').toUpperCase(), play = M.playOf(kind);
      if (play) {
        t[play.stat]++; t.points++;
        if (e.number || e.player) { const p = playerOf(side, e.number, e.player); p[play.stat]++; p.points++; }
      } else if (kind === 'SERVE_ERROR') { t.onTheirErrors++; o.serveErrors++; }
      else if (kind === 'OPP_ERROR' || kind === 'GHOST') { t.onTheirErrors++; o.otherErrors++; }
      else t.unlabeled++;
      // Who served the rally: the scorer page keeps it with the point when the lineups were in.
      let server = '';
      if (e.serverSide === 'home' || e.serverSide === 'away') {
        const st = teams[e.serverSide];
        st.serves++;
        st.serveInfo = true;
        if (e.server) {
          const sp = playerOf(e.serverSide, e.server, e.serverName);
          sp.serves++;
          if (kind === 'SERVE_ERROR' && e.serverSide !== side) sp.serveErrors++;
        }
        server = e.ghost ? 'Ghost (' + st.name + ')' : e.server ? '#' + e.server + (e.serverName ? ' ' + e.serverName : '') : st.name;
      }
      run = side === lastSide ? run + 1 : 1;
      lastSide = side;
      const lk = e.set + ':' + side;
      longest[lk] = Math.max(longest[lk] || 0, run);
      plays.push({ set: e.set, score: (e.home | 0) + '–' + (e.away | 0), to: t.name, how: howLabel(kind),
        player: e.number || e.player ? (e.number ? '#' + e.number + ' ' : '') + (e.player || '') : '', server, time: e.time,
        end: e.type === 'SET_END' ? 'Set ' + e.set + ' to ' + t.name : e.type === 'MATCH_END' ? 'Match to ' + t.name : '' });
      if (e.type === 'SET_END' || e.type === 'MATCH_END') { lastSide = null; run = 0; }
    });

    const sets = [];
    const done = (match && match.completedSets) || [];
    done.forEach((x, i) => { const w = x.home > x.away ? 'home' : 'away'; sets.push({ set: i + 1, home: x.home, away: x.away, win: w, winner: teams[w].name }); });
    if (match && !match.matchOver && (match.home || match.away)) sets.push({ set: match.setNumber, home: match.home, away: match.away, win: '', winner: '(in progress)' });
    sets.forEach(s => {
      s.runHome = longest[s.set + ':home'] || 0; s.runAway = longest[s.set + ':away'] || 0;
      s.toHome = setTimeouts[s.set + ':home'] || 0; s.toAway = setTimeouts[s.set + ':away'] || 0;
    });
    const setsWon = side => sets.filter(s => s.win === side).length;
    const first = (events || []).find(e => e.time);
    const when = first ? new Date(first.time) : new Date();
    const title = teams.home.name + ' vs ' + teams.away.name;
    const final = sets.length ? teams.home.name + ' ' + setsWon('home') + '–' + setsWon('away') + ' ' + teams.away.name +
      ' (' + sets.filter(s => s.win).map(s => s.home + '–' + s.away).join(', ') + ')' + (match && match.matchOver ? '' : ', in progress') : 'No points yet';
    ['home', 'away'].forEach(side => {
      const t = teams[side];
      t.list = Object.keys(t.players).map(k => t.players[k]).sort((a, b) =>
        b.points - a.points || (Number(a.num) || 999) - (Number(b.num) || 999) || a.name.localeCompare(b.name));
      t.errorsMade = t.serveErrors + t.otherErrors;
    });
    return { title, final, when, court: opts.court || '', division: opts.division || '', teams, sets, plays, numbers: opts.numbers || [],
      serveInfo: teams.home.serveInfo || teams.away.serveInfo };
  }

  const local = d => { try { return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }); } catch (e) { return d.toDateString(); } };
  const clock = t => { if (!t) return ''; try { return new Date(t).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', second: '2-digit' }); } catch (e) { return ''; } };

  /** The workbook: Box score, Sets, Play by play (and Numbers to add when any were typed in). */
  function sheets(box) {
    const serve = box.serveInfo;
    const head = ['#', 'Player', 'Kills', 'Aces', 'Blocks', 'Points'].concat(serve ? ['Serves', 'Missed serves'] : []).map(v => ({ v, s: 'head' }));
    const rows = [
      [{ v: box.title, s: 'title' }],
      [box.final],
      [[local(box.when), box.court ? 'Court ' + box.court : '', box.division].filter(Boolean).join(' · ')],
      [],
    ];
    ['home', 'away'].forEach(side => {
      const t = box.teams[side];
      rows.push([{ v: t.name.toUpperCase(), s: 'bold' }, null, null, null, null, { v: t.total, s: 'bold' }]);
      rows.push(head);
      t.list.forEach(p => rows.push([p.num ? Number(p.num) || p.num : '', p.name, p.kills, p.aces, p.blocks, p.points].concat(serve ? [p.serves, p.serveErrors] : [])));
      rows.push(['', 'TEAM', t.kills, t.aces, t.blocks, t.points].concat(serve ? [t.serves, t.serveErrors] : []).map(v => ({ v, s: 'total' })));
      rows.push(['', 'Points on ' + box.teams[OTHER[side]].name + ' errors', null, null, null, t.onTheirErrors]);
      if (t.unlabeled) rows.push(['', 'Points with no play entered', null, null, null, t.unlabeled]);
      rows.push(['', 'Errors made: ' + t.serveErrors + ' missed serve' + (t.serveErrors === 1 ? '' : 's') + ' · ' + t.otherErrors + ' other', null, null, null, t.errorsMade]);
      rows.push(['', 'Timeouts', null, null, null, t.timeouts]);
      rows.push([]);
    });
    rows.push([{ v: 'Kills include tips, roll shots, setter dumps, tools, overpasses and jousts; blocks include monster blocks. ' +
      (serve ? 'Serves count the rallies each player served (from the lineups).' : 'Enter the lineups (More → Starting lineups) to see who served and who missed.'), s: 'note' }]);
    const out = [{ name: 'Box score', cols: [6, 34, 8, 8, 8, 8, 8, 13], rows }];

    const sh = box.teams.home.name, sa = box.teams.away.name;
    out.push({ name: 'Sets', cols: [6, 10, 10, 18, 14, 14, 12, 12], freeze: 1, rows: [
      ['Set', sh, sa, 'Won by', 'Longest run ' + sh, 'Longest run ' + sa, 'Timeouts ' + sh, 'Timeouts ' + sa].map(v => ({ v, s: 'head' })),
    ].concat(box.sets.map(s => [s.set, s.home, s.away, s.winner, s.runHome, s.runAway, s.toHome, s.toAway])) });

    out.push({ name: 'Play by play', cols: [5, 9, 16, 16, 30, 30, 12], freeze: 1, rows: [
      ['Set', 'Score', 'Point to', 'How', 'Player', 'Served by', 'Time'].map(v => ({ v, s: 'head' })),
    ].concat(box.plays.map(p => [p.set, p.score, p.to || '', p.end ? p.how + ' · ' + p.end : p.how, p.player, p.server, clock(p.time)])) });

    if (box.numbers.length) {
      out.push({ name: 'Numbers to add', cols: [18, 30, 8], freeze: 1, rows: [
        ['Team', 'Player', '#'].map(v => ({ v, s: 'head' })),
      ].concat(box.numbers.map(n => [box.teams[n.side] ? box.teams[n.side].name : n.side, n.name, Number(n.number) || n.number])).concat([[],
        [{ v: 'Typed in at the scorer page for players with no number on the roster. Add them to the Team Hub (League Rosters or Robins Rosters).', s: 'note' }]]) });
    }
    return out;
  }

  /** The box score as CSV: one row per player and a TEAM row per team. */
  function csv(box) {
    const q = v => { const s = String(v == null ? '' : v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    const lines = [['Match', 'Date', 'Team', 'Number', 'Player', 'Kills', 'Aces', 'Blocks', 'Points', 'Serves', 'Missed serves', 'Points on their errors', 'Errors made']];
    const date = box.when.toISOString().slice(0, 10);
    ['home', 'away'].forEach(side => {
      const t = box.teams[side];
      t.list.forEach(p => lines.push([box.title, date, t.name, p.num, p.name, p.kills, p.aces, p.blocks, p.points,
        box.serveInfo ? p.serves : '', box.serveInfo ? p.serveErrors : '', '', '']));
      lines.push([box.title, date, t.name, '', 'TEAM', t.kills, t.aces, t.blocks, t.points, box.serveInfo ? t.serves : '', box.serveInfo ? t.serveErrors : '',
        t.onTheirErrors, t.errorsMade]);
    });
    return lines.map(r => r.map(q).join(',')).join('\n');
  }

  const api = { matchEvents, compute, sheets, csv, howLabel };
  root.RobinsBox = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
