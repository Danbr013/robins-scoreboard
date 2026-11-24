/*
 * Talks to the club's live-score service (a Google Apps Script web app; see apps-script/Code.gs).
 * GET  <backend>?court=1            -> { ok, now, board }
 * POST <backend>  {court,key,...}   -> { ok, now, board } or { ok:false, error }
 * Requests use text/plain bodies so browsers send them without a CORS preflight.
 */
(function (root) {
  'use strict';

  const cfg = root.ROBINS_CONFIG || {};
  // A ?backend= override is only honored on this computer (for testing), so a doctored link
  // can't send a scorer's code to someone else's server.
  const local = /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
  const backend = () => ((local && new URLSearchParams(location.search).get('backend')) || cfg.backend || '').trim();

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

  root.RobinsApi = { backend, court, getBoard, post, store };
})(window);
