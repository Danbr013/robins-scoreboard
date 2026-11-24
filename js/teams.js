/* AVA teams, regions and logos (logos/logos.json), shared by the overlay and the scorer page. */
(function (root) {
  'use strict';

  let data = { teams: [], regions: [], regionOrder: [] };

  async function load() {
    try {
      const r = await fetch('logos/logos.json', { cache: 'no-cache' });
      if (r.ok) data = await r.json();
    } catch (e) { /* the overlay still works with plain names */ }
    return api;
  }

  function find(id) {
    if (!id) return null;
    return data.teams.find(t => t.id === id) || data.regions.find(t => t.id === id) || null;
  }

  function fullName(t) { return t.nickname ? t.name + ' ' + t.nickname : t.name; }
  function displayName(t) { return t.variant ? fullName(t) + ' · ' + t.variant : fullName(t); }

  /** Letters for the stand-in disc used until a team's logo is added. */
  function initials(t) {
    if (t.abbr) return t.abbr.toUpperCase();
    const words = t.name.split(/[\s.\-]+/).filter(Boolean);
    return (words.length >= 2 ? words.slice(0, 3).map(w => w[0]).join('') : t.name.slice(0, 3)).toUpperCase();
  }

  /** The five AVA regions, west to east, as on the league's region chart. */
  function regions() {
    const order = data.regionOrder || [];
    const rank = id => { const i = order.indexOf(id); return i < 0 ? 99 : i; };
    return data.regions.filter(r => r.id.startsWith('region-')).sort((a, b) => rank(a.id) - rank(b.id));
  }

  function league() { return data.regions.find(r => r.id.startsWith('league-')) || null; }

  function teamsIn(regionId) {
    return data.teams.filter(t => t.region === regionId)
      .sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()) || (a.variant || '').localeCompare(b.variant || ''));
  }

  function teamNames(regionId) { return Array.from(new Set(teamsIn(regionId).map(t => t.name))); }

  /** "Atlantic" for a team in the Atlantic Region. */
  function regionName(t) {
    const r = t && find(t.region);
    return r ? r.name.replace(/ Region$/, '') : null;
  }

  /** "Andrews Griffins (Atlantic)": a team with its region, so nobody has to guess. */
  function withRegion(t, label) {
    const r = regionName(t);
    label = label || displayName(t);
    return r ? label + ' (' + r + ')' : label;
  }

  function logoUrl(id) {
    const t = find(id);
    return t && t.logo ? 'logos/' + id + '.webp' : null;
  }

  function norm(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]/g, ''); }

  /** True when a roster's base name ("Wright-Patterson", "F.E. Warren") is this team. */
  function baseMatches(base, t) {
    if (!t) return false;
    const b = norm(base);
    return [t.name].concat(t.aliases || []).some(n => norm(n) === b);
  }

  /** "#1B3A6B", "navy", "Royal Blue" → "#rrggbb", or '' if it isn't a color. */
  function normColor(value) {
    const v = String(value || '').trim();
    if (/^#?[0-9a-f]{6}$/i.test(v)) return '#' + v.replace('#', '').toLowerCase();
    if (!v) return '';
    const ctx = document.createElement('canvas').getContext('2d');
    ctx.fillStyle = '#010203';
    ctx.fillStyle = v.replace(/\s+/g, '').toLowerCase();
    return ctx.fillStyle === '#010203' || ctx.fillStyle.charAt(0) !== '#' ? '' : ctx.fillStyle;
  }

  const api = { load, find, fullName, displayName, initials, regions, league, teamsIn, teamNames, regionName, withRegion, logoUrl,
    baseMatches, normColor,
    get all() { return data.teams; } };
  root.RobinsTeams = api;
})(window);
