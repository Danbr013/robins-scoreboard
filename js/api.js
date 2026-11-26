/*
 * Talks to the club's live-score service (a Google Apps Script web app; see apps-script/Code.gs).
 * GET  <backend>?court=1            -> { ok, now, board }
 * POST <backend>  {court,key,...}   -> { ok, now, board } or { ok:false, error }
 * Requests use text/plain bodies so browsers send them without a CORS preflight.
 */
(function (root) {
  'use strict';

  const cfg = root.ROBINS_CONFIG || {};
  // A ?backend= override is only honored on this computer (for testing).
  const local = /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
  /** What a Google Apps Script web app address looks like. Only those are taken from a link. */
  const APPS_SCRIPT = /^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]{20,}\/exec$/;

  /**
   * A team's own live-score service, from ?s= in the link (the team kit's Setup tab makes these links).
   * Without it the page uses the club's service from config.js.
   */
  function teamService() {
    const s = (new URLSearchParams(location.search).get('s') || '').trim();
    return APPS_SCRIPT.test(s) ? s : '';
  }
  const backend = () => ((local && new URLSearchParams(location.search).get('backend')) || teamService() || cfg.backend || '').trim();

  /**
   * '' for the club's own service, otherwise a short tag of the team's service. Saved scorer codes and court
   * state are kept per service, so a code saved for one team is never sent to another team's service.
   */
  function serviceTag() {
    const s = teamService();
    if (!s) return '';
    const id = s.split('/s/')[1].replace('/exec', '');
    return 't' + id.slice(-12) + '.';
  }

  /** A link to another page of this site that keeps this page's team service. */
  function link(path) {
    const u = new URL(path, location.href);
    const s = teamService();
    if (s) u.searchParams.set('s', s);
    return u.toString();
  }

  function court() {
    const c = (new URLSearchParams(location.search).get('court') || '1').trim();
    return /^[A-Za-z0-9-]{1,20}$/.test(c) ? c : '1';
  }

  async function getBoard(courtId, timeoutMs) {
    const url = backend();
    if (!url) throw new Error('not-configured');
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs || 8000);
    try {
      const sep = url.includes('?') ? '&' : '?';
      const r = await fetch(url + sep + 'court=' + encodeURIComponent(courtId) + '&t=' + Date.now(), { cache: 'no-store', signal: ctrl.signal });
      if (!r.ok) throw new Error('http-' + r.status);
      return await r.json();
    } finally { clearTimeout(timer); }
  }

  async function post(body, timeoutMs) {
    const url = backend();
    if (!url) throw new Error('not-configured');
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs || 10000);
    try {
      const r = await fetch(url, { method: 'POST', body: JSON.stringify(body), cache: 'no-store', signal: ctrl.signal,
        headers: { 'Content-Type': 'text/plain;charset=utf-8' } });
      if (!r.ok) throw new Error('http-' + r.status);
      return await r.json();
    } finally { clearTimeout(timer); }
  }

  function store(key, value) {
    try { if (value === undefined) return localStorage.getItem(key); if (value === null) localStorage.removeItem(key); else localStorage.setItem(key, value); }
    catch (e) { /* private mode or storage off: keep going without it */ }
    return null;
  }

  root.RobinsApi = { backend, court, getBoard, post, store, teamService, serviceTag, link, APPS_SCRIPT };
})(window);
