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

  const api = { load, find, fullName, displayName, initials, regions, league, teamsIn, teamNames, regionName, withRegion, logoUrl,
    get all() { return data.teams; } };
  root.RobinsTeams = api;
})(window);
