/*
 * The 0.8 broadcast look (docs/GRAPHICS.md) for the web overlay: a VNL-style score bar along the bottom
 * and every animation the director decides on. A port of Robins Live's BroadcastRenderer.kt, drawn on a
 * 1280×720 canvas with the same sizes, so the iPhone (Tubeist) and Android streams look the same.
 *
 *   const r = RobinsBroadcast.Renderer({ logo: id => Image|null, sponsor: i => { name, image } | null });
 *   r.draw(ctx, match, style, frame, extras, layout)
 */
(function (root) {
  'use strict';
  const M = root.RobinsMatch;
  const D = root.RobinsDirector;

  const W = 1280, H = 720;
  const BAR_H = 50, BAR_Y = 690 - BAR_H, CENTER_X = W / 2;
  const LOGO_W = 60, NAME_W = 162, SETS_W = 44, PTS_W = 62, CENTER_W = 84;
  const BAR_W = 2 * (LOGO_W + NAME_W + SETS_W + PTS_W) + CENTER_W;
  const BAR_X = (W - BAR_W) / 2;
  const EXT_W = 280, PANEL_W = 560, PANEL_H = 170, BOX_BOTTOM = 690;
  const BLACK = '#08080A', RED = '#BE121C', GOLD = '#ECA030', CREAM = '#FAF6ED', PANEL = '#1C1C22';
  const STAT_ROWS = [['kills', 'KILLS'], ['aces', 'ACES'], ['blocks', 'BLOCKS']];
  const ICE = '#BFE9FF', ICE_DEEP = '#0E3A5C';
  // Team logos sit on a dark plate (their own colours show true; a light plate washed some of them out).
  const PLATE = '#131317', PLATE_EDGE = 'rgba(250,246,237,.18)';
  const FACES = { d: '"Bebas Neue", "Oswald", "Arial Narrow", sans-serif', c: '600 X "Barlow Condensed", "Arial Narrow", sans-serif' };

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const easeOut = x => { const c = clamp(x, 0, 1); return 1 - (1 - c) * (1 - c) * (1 - c); };
  const easeInOut = x => { const c = clamp(x, 0, 1); return c < 0.5 ? 4 * c * c * c : 1 - Math.pow(-2 * c + 2, 3) / 2; };
  const easeIn = x => { const c = clamp(x, 0, 1); return c * c * c; };
  const easeOutBack = x => { const c = clamp(x, 0, 1) - 1; return 1 + 2.70158 * c * c * c + 1.70158 * c * c; };
  /** mulberry32: the same frost, flakes and streaks every time (and in the app's port). */
  function rng(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = Math.imul(a ^ (a >>> 15), a | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function rgb(hex) {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
    const n = m ? parseInt(m[1], 16) : 0x3A5A8C;
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const rgba = (hex, a) => { const c = rgb(hex); return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + a + ')'; };
  const darker = (hex, f) => { const c = rgb(hex).map(v => Math.floor(v * f)); return 'rgb(' + c.join(',') + ')'; };
  const textOn = hex => M.textOn(hex);
  const lum = hex => M.luminance(hex);

  function Renderer(opts) {
    const logo = opts.logo || (() => null);
    const sponsor = opts.sponsor || (() => null);
    let c = null;            // the 2D context while drawing
    let lastExtras = null;
    let sponsorCountHint = 0;
    let drawn = [];          // the words drawn in the last frame (for tests and the page's status line)

    // ---------------------------------------------------------------- drawing helpers
    function font(face, size) { c.font = face === 'c' ? FACES.c.replace('X', size + 'px') : size + 'px ' + FACES.d; }
    function spacing(em, size) { if ('letterSpacing' in c) c.letterSpacing = em ? (em * size).toFixed(2) + 'px' : '0px'; }
    function measure(text) { return c.measureText(text).width; }
    function fitText(text, preferred, maxWidth, face) {
      let size = preferred;
      font(face, size);
      while (size > 9 && measure(text) > maxWidth) { size -= 1; font(face, size); }
      return size;
    }
    /** The baseline that centres the font's line box (ascent + descent) in [top, top + height]. */
    function baseline(top, height) {
      const m = c.measureText('Hg');
      const a = m.fontBoundingBoxAscent != null ? m.fontBoundingBoxAscent : m.actualBoundingBoxAscent;
      const d = m.fontBoundingBoxDescent != null ? m.fontBoundingBoxDescent : m.actualBoundingBoxDescent;
      return top + height / 2 + (a - d) / 2;
    }
    function rr(x, y, w, h, r) {
      r = Math.min(r, w / 2, h / 2);
      c.beginPath();
      c.moveTo(x + r, y); c.lineTo(x + w - r, y); c.quadraticCurveTo(x + w, y, x + w, y + r);
      c.lineTo(x + w, y + h - r); c.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
      c.lineTo(x + r, y + h); c.quadraticCurveTo(x, y + h, x, y + h - r);
      c.lineTo(x, y + r); c.quadraticCurveTo(x, y, x + r, y); c.closePath();
    }
    function fillRR(x, y, w, h, r, style) { c.fillStyle = style; rr(x, y, w, h, r); c.fill(); }
    function fillRect(x, y, w, h, style) { c.fillStyle = style; c.fillRect(x, y, w, h); }
    function circle(x, y, r, style) { c.fillStyle = style; c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fill(); }
    function clip(x, y, w, h) { c.beginPath(); c.rect(x, y, w, h); c.clip(); }
    function hgrad(x0, x1, colors) {
      const g = c.createLinearGradient(x0, 0, x1, 0);
      colors.forEach((col, i) => g.addColorStop(colors.length === 1 ? 0 : i / (colors.length - 1), col));
      return g;
    }
    function grad(x0, y0, x1, y1, colors) {
      const g = c.createLinearGradient(x0, y0, x1, y1);
      colors.forEach((col, i) => g.addColorStop(i / (colors.length - 1), col));
      return g;
    }
    function text(value, x, y, face, size, color, align, alpha) {
      if (value) drawn.push(String(value));
      font(face, size);
      c.textAlign = align || 'left';
      c.fillStyle = color;
      const a = c.globalAlpha;
      if (alpha != null) c.globalAlpha = a * alpha;
      c.fillText(value, x, y);
      c.globalAlpha = a;
    }
    function centered(value, face, size, color, cx, top, height, maxW) {
      const s = fitText(value, size, maxW, face);
      font(face, s);
      text(value, cx, baseline(top, height) + 1, face, s, color, 'center');
    }
    /** Draws an image inside the box keeping its shape, centred (or left-aligned). */
    function fit(img, x, y, w, h, left, alpha) {
      const iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
      if (!iw || !ih) return;
      const k = Math.min(w / iw, h / ih);
      const dw = iw * k, dh = ih * k;
      const a = c.globalAlpha;
      if (alpha != null) c.globalAlpha = a * alpha;
      c.drawImage(img, left ? x : x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
      c.globalAlpha = a;
    }
    const teamColor = (st, side) => st[side + 'Color'] || (side === 'home' ? RED : '#3A5A8C');
    const teamLogo = (st, side) => logo(side === 'home' ? st.homeLogo : st.awayLogo);
    const numberInk = color => { const l = lum(color); return l > 0.55 || l < 0.02 ? BLACK : color; };
    function darkPanel(x, y, w, h) { c.globalAlpha = 240 / 255; fillRR(x, y, w, h, 12, BLACK); c.globalAlpha = 1; }
    /** The dark plate a team logo sits on, with a faint edge so its shape reads on any background. */
    function logoPlate(x, y, w, h, r) {
      fillRR(x, y, w, h, r, PLATE);
      c.lineWidth = 1.5; c.strokeStyle = PLATE_EDGE; rr(x + 0.75, y + 0.75, w - 1.5, h - 1.5, r); c.stroke();
    }

    // ---------------------------------------------------------------- the bar
    const extOpen = (t, len) => Math.min(easeOut(t / 0.35), easeOut((len - t) / 0.3));
    /** How far the bar has slid so bar + extension stay centred: right for the home team's (it grows out of the left
     *  end), left for the away team's. */
    function barShift(f) {
      if (!f || !f.extension) return 0;
      const d = EXT_W / 2 * extOpen(f.extension.t, f.extension.length);
      return f.extension.moment.side === 'home' ? d : -d;
    }

    function drawBar(s, st, f) {
      c.save();
      c.translate(barShift(f), 0);
      const y = BAR_Y, h = BAR_H;
      c.globalAlpha = 238 / 255; fillRR(BAR_X, y, BAR_W, h, 6, BLACK); c.globalAlpha = 1;
      drawHalf(s, st, f, 'home');
      drawHalf(s, st, f, 'away');
      const cx = BAR_X + LOGO_W + NAME_W + SETS_W + PTS_W;
      fillRect(cx, y, CENTER_W, h, BLACK);
      fillRect(cx, y, CENTER_W, 3, GOLD);
      const badge = logo(st.badge);
      if (s.matchOver) centered('FINAL', 'd', 30, GOLD, cx + CENTER_W / 2, y + 3, h - 3, CENTER_W - 8);
      else if (badge) fit(badge, cx + 4, y + 5, CENTER_W - 8, h - 7);
      else centered('SET ' + s.setNumber, 'd', 26, GOLD, cx + CENTER_W / 2, y + 3, h - 3, CENTER_W - 8);
      if (!f.busy) drawInfoTab(s, st);
      c.restore();
    }

    function drawHalf(s, st, f, side) {
      const y = BAR_Y, h = BAR_H, home = side === 'home';
      const color = teamColor(st, side);
      const logoL = home ? BAR_X : BAR_X + BAR_W - LOGO_W;
      const nameL = home ? logoL + LOGO_W : logoL - NAME_W;
      const setsL = home ? nameL + NAME_W : nameL - SETS_W;
      const ptsL = home ? setsL + SETS_W : setsL - PTS_W;
      // Logo plate (dark), rounded on the outside.
      c.save(); clip(logoL, y, LOGO_W, h);
      fillRR(home ? logoL : logoL - 8, y, LOGO_W + 8, h, 6, PLATE);
      c.restore();
      const img = teamLogo(st, side);
      if (img) fit(img, logoL + 5, y + 4, LOGO_W - 10, h - 8);
      else centered(M.name(s, side).slice(0, 1).toUpperCase(), 'd', 38, lum(color) < 0.08 ? CREAM : color, logoL + LOGO_W / 2, y, h, LOGO_W - 8);
      // Name in the team color, a touch darker toward the centre.
      c.fillStyle = hgrad(nameL, nameL + NAME_W, home ? [color, darker(color, 0.72)] : [darker(color, 0.72), color]);
      c.fillRect(nameL, y, NAME_W, h);
      const dotSpace = 18;
      const nameX = home ? nameL + 10 : nameL + dotSpace + 6;
      const nameW = NAME_W - dotSpace - 16;
      const name = M.name(s, side).toUpperCase();
      const size = fitText(name, 38, nameW, 'd');
      font('d', size);
      text(name, nameX + nameW / 2, baseline(y, h) + 1, 'd', size, textOn(color), 'center');
      if (s.serving === side && !s.matchOver) {
        const dx = home ? nameL + NAME_W - 11 : nameL + 11;
        circle(dx, y + h / 2, 7.5, 'rgba(8,8,10,.47)');
        circle(dx, y + h / 2, 6, GOLD);
      }
      // Sets won.
      fillRect(setsL, y, SETS_W, h, PANEL);
      spacing(0, 11);
      text('SETS', setsL + SETS_W / 2, y + 14, 'c', 11, CREAM, 'center', 170 / 255);
      text(String(M.setsWon(s, side)), setsL + SETS_W / 2, y + h - 7, 'd', 29, GOLD, 'center');
      // Points, with the pop when they go up.
      const pop = f.pops[side];
      fillRect(ptsL, y, PTS_W, h, '#101014');
      if (pop != null) { c.globalAlpha = clamp(1 - pop / 0.7, 0, 1); fillRect(ptsL, y, PTS_W, h, color); c.globalAlpha = 1; }
      const k = pop != null ? 1 + 0.25 * Math.sin(Math.PI * clamp(pop / 0.7, 0, 1)) : 1;
      c.save();
      c.translate(ptsL + PTS_W / 2, y + h / 2); c.scale(k, k); c.translate(-(ptsL + PTS_W / 2), -(y + h / 2));
      font('d', 46);
      text(String(M.points(s, side)), ptsL + PTS_W / 2, baseline(y, h) + 1, 'd', 46, pop != null && pop < 0.35 ? textOn(color) : CREAM, 'center');
      c.restore();
    }

    /** SET 2 · 25-21 · 19-25 (or the event before the first point; FINAL · 2–0 at the end). */
    function drawInfoTab(s, st) {
      const sets = s.completedSets.map(x => x.home + '-' + x.away).join('  ·  ');
      const value = s.matchOver ? 'FINAL  ·  ' + M.setsWon(s, 'home') + '–' + M.setsWon(s, 'away') + (sets ? '  ·  ' + sets : '')
        : !s.completedSets.length && s.home + s.away === 0 && (st.eventTitle || '').trim() ? st.eventTitle.toUpperCase()
        : sets ? 'SET ' + s.setNumber + '  ·  ' + sets : 'SET ' + s.setNumber;
      font('c', 16); spacing(0.04, 16);
      const w = Math.min(measure(value) + 28, BAR_W - 40);
      c.globalAlpha = 218 / 255; fillRR(CENTER_X - w / 2, BAR_Y - 24, w, 26, 6, BLACK); c.globalAlpha = 1;
      const size = fitText(value, 16, w - 20, 'c');
      text(value, CENTER_X, BAR_Y - 6, 'c', size, CREAM, 'center');
      spacing(0, 16);
    }

    // ---------------------------------------------------------------- tags (slot B)
    function drawTags(s, st, f, layout) {
      const baseY = layout === 'bar' ? BAR_Y - 26 : BOX_BOTTOM;
      if (f.pointTag) {
        const sit = f.pointTag.situation;
        sideTag(layout, sit.side, sit.kind === 'MATCH_POINT' ? 'MATCH POINT' : 'SET POINT', M.name(s, sit.side).toUpperCase(), GOLD, BLACK, f.pointTag.t, 99, baseY);
      }
      const tag = f.tag;
      if (!tag) return;
      const m = tag.moment;
      if (m.kind === 'RUN' && m.side) {
        const run = M.name(s, m.side).toUpperCase() + ' ' + m.count + '–0 RUN';
        // A server who has held serve 5+ points in a row gets the streak: #10 HARGROVE · 6 STRAIGHT ON SERVE.
        const who = m.number ? ('#' + m.number + ' ' + (m.name || '').toUpperCase() + (m.detail ? '  \u00b7  ' + m.detail + ' STRAIGHT ON SERVE' : ' SERVING'))
          .replace(/ +/g, ' ').trim() : '';
        const col = teamColor(st, m.side);
        sideTag(layout, m.side, run, who, col, textOn(col), tag.t, tag.length, baseY);
      } else if (m.kind === 'TIED') {
        centerTag('TIED ' + m.count + '–' + m.count, CREAM, BLACK, tag.t, tag.length, baseY - 30);
      } else if (m.kind === 'CORRECTED') {
        centerTag('SCORE CORRECTED', GOLD, BLACK, tag.t, tag.length, baseY - 30);
      } else if (m.kind === 'RUN_STOPPED' && m.side) {
        const col = teamColor(st, m.side);
        const sub = m.detail ? ('#' + m.number + ' ' + (m.name || '').toUpperCase() + ' SERVED ' + m.detail + ' STRAIGHT').replace(/ +/g, ' ')
          : 'ENDS A ' + m.count + '\u20130 RUN';
        sideTag(layout, m.side, 'RUN STOPPED', sub, col, textOn(col), tag.t, tag.length, baseY);
      } else if (m.kind === 'COMEBACK' && m.side) {
        const col = teamColor(st, m.side);
        sideTag(layout, m.side, 'COMEBACK', m.word, col, textOn(col), tag.t, tag.length, baseY);
      } else if (m.kind === 'SAVED') {
        centerTag(m.word, GOLD, BLACK, tag.t, tag.length, baseY - 30);
      }
    }

    function sideTag(layout, side, word, sub, bg, ink, t, length, bottom) {
      font('d', 24); const wordW = measure(word);
      font('c', 15); let subW = sub ? measure(sub) + 14 : 0;
      const w = Math.min(wordW + subW + 28, 440), h = 28;
      let subSize = 15;
      if (sub && wordW + subW + 28 > w) { subSize = fitText(sub, 15, w - 42 - wordW, 'c'); font('c', subSize); subW = measure(sub) + 14; }
      const left = layout !== 'bar' ? CENTER_X - w / 2 : side === 'home' ? CENTER_X - 120 - w : CENTER_X + 120;
      const p = Math.min(clamp(t / 0.3, 0, 1), clamp((length - t) / 0.3, 0, 1));
      if (p <= 0) return;
      const shown = h * easeOut(p);
      c.save();
      clip(left - 2, bottom - shown, w + 4, shown + 1);
      const top = bottom - h;
      fillRR(left, top, w, h + 6, 6, bg);
      const size = fitText(word, 24, w - 20 - subW, 'd');
      font('d', size);
      text(word, left + 12, baseline(top, h) + 1, 'd', size, ink);
      if (sub) { font('c', subSize); text(sub, left + 12 + wordW + 14, baseline(top, h), 'c', subSize, ink, 'left', 210 / 255); }
      c.restore();
    }

    function centerTag(word, bg, ink, t, length, bottom) {
      font('d', 26);
      const w = measure(word) + 36, h = 30;
      const p = Math.min(clamp(t / 0.25, 0, 1), clamp((length - t) / 0.3, 0, 1));
      if (p <= 0) return;
      const left = CENTER_X - w / 2, top = bottom - h;
      const k = 0.8 + 0.2 * easeOut(p);
      c.save();
      c.translate(CENTER_X, top + h / 2); c.scale(k, k); c.translate(-CENTER_X, -(top + h / 2));
      c.globalAlpha = p;
      fillRR(left, top, w, h, 6, bg);
      font('d', 26);
      text(word, CENTER_X, baseline(top, h) + 1, 'd', 26, ink, 'center');
      c.restore();
    }

    // ---------------------------------------------------------------- the bar extension (slot A)
    function drawExtension(s, st, shown, layout) {
      const m = shown.moment;
      if (!m.side) return;
      const t = shown.t, len = shown.length;
      const color = teamColor(st, m.side), ink = textOn(color);
      const open = extOpen(t, len);
      const panelOpen = Math.min(easeOut((t - 0.3) / 0.35), easeOut((len - 0.25 - t) / 0.3));
      const bar = layout === 'bar';
      const home = m.side === 'home';     // the home team's grows out of the bar's left end, the away team's the right
      const extLeft = bar ? (home ? BAR_X + 2 + EXT_W / 2 * open - EXT_W : BAR_X + BAR_W - 2 - EXT_W / 2 * open) : (home ? 40 : W - 40 - EXT_W);
      const extTop = bar ? BAR_Y : BOX_BOTTOM - BAR_H;
      const extRight = extLeft + EXT_W;
      if (open > 0) {
        c.save();
        if (home) clip(extRight - EXT_W * open, extTop - 1, EXT_W * open, BAR_H + 2);
        else clip(extLeft, extTop - 1, EXT_W * open, BAR_H + 2);
        c.fillStyle = hgrad(extLeft, extRight, home ? [color, darker(color, 0.8)] : [darker(color, 0.8), color]);
        if (home) rr(extLeft, extTop, EXT_W + 8, BAR_H, 6); else rr(extLeft - 8, extTop, EXT_W + 8, BAR_H, 6);
        c.fill();
        fillRect(home ? extRight - 4 : extLeft, extTop, 4, BAR_H, GOLD);
        let x = extLeft + 12;
        if (m.number) {
          fillRR(x, extTop + 6, 50, BAR_H - 12, 5, CREAM);
          centered(m.number, 'd', 34, numberInk(color), x + 25, extTop + 6, BAR_H - 12, 46);
          x += 60;
        }
        const label = m.kind === 'SERVER' ? 'SERVING' : m.kind === 'SUB' ? 'SUBSTITUTION' : m.kind === 'MILESTONE' ? 'MILESTONE'
          : m.kind === 'PLAY' ? playLabel(m) : m.word;
        spacing(0.08, 13);
        const ls = fitText(label, 13, extRight - 14 - x, 'c');
        text(label, x, extTop + 17, 'c', ls, ink, 'left', 210 / 255);
        spacing(0, 13);
        // The scorer page sends the name as it goes on the video (the whole surname: Del Toro, García Lorca); never cut it again.
        const who = (String(m.name || '').trim() || M.name(s, m.side)).toUpperCase();
        const size = fitText(who, 30, extRight - (home ? 16 : 12) - x, 'd');
        text(who, x, extTop + BAR_H - 9, 'd', size, ink);
        // A play's tag gets a gold glint across it as it lands.
        if (m.kind === 'PLAY' && t >= 0.3 && t <= 0.95) {
          const q = easeInOut((t - 0.3) / 0.65);
          const gx = extLeft - 80 + q * (EXT_W + 160), skew = 18;
          c.globalAlpha = 0.55;
          c.fillStyle = hgrad(gx - 30, gx + 30, ['rgba(236,160,48,0)', GOLD, 'rgba(236,160,48,0)']);
          c.beginPath(); c.moveTo(gx - 30 + skew, extTop); c.lineTo(gx + 30 + skew, extTop);
          c.lineTo(gx + 30 - skew, extTop + BAR_H); c.lineTo(gx - 30 - skew, extTop + BAR_H); c.closePath(); c.fill();
          c.globalAlpha = 1;
        }
        c.restore();
      }
      // A play has no panel: a statement play already had the whole screen, a point play is only the tag.
      const panelH = m.kind === 'SERVER' ? (m.detail ? 84 : 0) : m.kind === 'SUB' ? 124 : m.kind === 'PLAY' ? 0 : PANEL_H;
      if (panelOpen <= 0 || panelH <= 0) return;
      const left = home ? extLeft : extRight - PANEL_W, right = left + PANEL_W, bottom = extTop - 8, top = bottom - panelH;
      c.save();
      clip(left, bottom - panelH * panelOpen, PANEL_W, panelH * panelOpen);
      if (m.kind === 'MILESTONE') drawMilestonePanel(left, top, PANEL_W, panelH, m, color);
      else if (m.kind === 'SERVER') {
        darkPanel(left, top, PANEL_W, panelH);
        fillRect(left, top + 10, 8, panelH - 20, color);
        const parts = m.detail.trim().split(/\s{2,}/);
        font('c', 24);
        text(parts[0], left + 28, baseline(top, panelH), 'c', 24, CREAM);
        font('d', 64);
        text(parts[1] || '', right - 28, baseline(top, panelH) + 2, 'd', 64, GOLD, 'right');
      } else if (m.kind === 'SUB') drawSubPanel(left, top, PANEL_W, panelH, m);
      c.restore();
    }

    /** The small line on a play's tag: 3RD KILL THIS MATCH after a statement play, ROLL SHOT · 4TH KILL for a point play. */
    function playLabel(m) {
      const play = M.playOf(m.word);
      if (!play) return m.word;
      const one = (D.statForPlay(m.word) || [])[2] || play.label;
      const flush = m.word === 'ACE' && m.aces >= D.ROYAL_FLUSH ? 'ROYAL FLUSH  \u00b7  ' : '';
      if (m.statement) return flush + (m.count > 0 ? D.ordinal(m.count) + ' ' + one + ' THIS MATCH' : play.label);
      return play.label + (m.count > 0 ? '  \u00b7  ' + D.ordinal(m.count) + ' ' + one : '');
    }

    function drawMilestonePanel(x, y, w, h, m, color) {
      darkPanel(x, y, w, h);
      fillRect(x, y + 10, 8, h - 20, color);
      const sp = m.word.indexOf(' ');
      const num = sp > 0 ? m.word.slice(0, sp) : m.word, rest = sp > 0 ? m.word.slice(sp + 1) : '';
      font('d', 128);
      const numW = measure(num);
      text(num, x + 30, y + h - 28, 'd', 128, GOLD);
      text(rest, x + 46 + numW, y + h - 66, 'd', 64, CREAM);
      text('THIS MATCH', x + 48 + numW, y + h - 32, 'c', 26, CREAM, 'left', 200 / 255);
    }

    function drawSubPanel(x, y, w, h, m) {
      darkPanel(x, y, w, h);
      const rowH = (h - 20) / 2;
      const row = (i, word, number, name, chip) => {
        const top = y + 10 + i * rowH;
        fillRR(x + 16, top + 8, 76, rowH - 16, 5, chip);
        centered(word, 'd', 24, CREAM, x + 54, top + 8, rowH - 16, 70);
        font('d', 32);
        const num = number ? '#' + number : '';
        text(num, x + 108, baseline(top, rowH) + 1, 'd', 32, GOLD);
        font('d', 32);
        const nw = num ? measure(num) + 14 : 0;
        const nm = (name || '').toUpperCase();
        const size = fitText(nm, 32, x + w - 20 - (x + 108 + nw), 'd');
        font('d', size);
        text(nm, x + 108 + nw, baseline(top, rowH) + 1, 'd', size, CREAM);
      };
      row(0, 'IN', m.number, m.name, '#1E8E4E');
      row(1, 'OUT', m.out, m.outName, RED);
    }

    // ---------------------------------------------------------------- takeovers: statement plays and ICED
    function drawTakeover(s, st, shown) {
      if (!shown.moment.side) return;
      if (shown.kind === 'ICED') iced(s, st, shown);
      else statement(s, st, shown);
    }

    /** Text with no entry in texts() (trails and shadows of a word that is drawn once for real). */
    function ghost(value, x, y, color, alpha) {
      const a = c.globalAlpha;
      c.globalAlpha = a * alpha;
      c.fillStyle = color;
      c.fillText(value, x, y);
      c.globalAlpha = a;
    }
    /** Baseline that centres the current font's capitals on y = 0. */
    function midline(word) {
      const mm = c.measureText(word);
      const a = mm.actualBoundingBoxAscent != null ? mm.actualBoundingBoxAscent : 0.7 * parseFloat(c.font);
      const d = mm.actualBoundingBoxDescent != null ? mm.actualBoundingBoxDescent : 0;
      return (a - d) / 2;
    }
    function diamond(x, y, r, color) {
      c.fillStyle = color;
      c.beginPath(); c.moveTo(x, y - r); c.lineTo(x + r * 0.72, y); c.lineTo(x, y + r); c.lineTo(x - r * 0.72, y); c.closePath(); c.fill();
    }

    // KILL! / ACE! / MONSTER BLOCK!: a slanted band in the team's color across the screen for TAKEOVER_S.
    const BAND_Y = 316, BAND_H = 226, BAND_TILT = -4 * Math.PI / 180;
    function statement(s, st, shown) {
      const m = shown.moment, t = shown.t, L = m.hold || D.TAKEOVER_S;   // an ace holds a little longer
      const play = M.playOf(m.word) || { word: m.word + '!' };
      const color = teamColor(st, m.side), ink = textOn(color);
      const home = m.side === 'home', dir = home ? 1 : -1;
      const monster = m.word === 'MONSTER' || m.word === 'KONG', ace = m.word === 'ACE';
      // The kill and ace bands fly in from the team's own side; the monster block comes down like a roof.
      const inP = monster ? easeIn(t / 0.22) : easeOut(t / 0.28);
      const outP = easeIn((t - (L - 0.34)) / 0.34);
      const hit = monster ? 0.22 : 0.3;
      const since = t - hit;
      const decay = since > 0 ? Math.max(0, 1 - since / (monster ? 0.55 : 0.32)) : 0;
      const amp = monster ? 17 : 7;
      const shakeX = decay * amp * Math.sin(since * 95), shakeY = decay * amp * 0.6 * Math.cos(since * 120);
      const bw = 2100, bh = BAND_H;

      c.save();
      const dim = 0.34 * Math.min(easeOut(t / 0.2), 1 - outP);
      if (dim > 0) { c.fillStyle = grad(0, 0, 0, BAR_Y - 16, ['rgba(0,0,0,' + dim + ')', 'rgba(0,0,0,' + dim * 0.8 + ')', 'rgba(0,0,0,0)']); c.fillRect(0, 0, W, BAR_Y - 16); }
      c.translate(CENTER_X + shakeX, BAND_Y + shakeY);
      c.rotate(BAND_TILT);
      if (monster) c.translate(0, -(1 - inP) * 640 - outP * 640);
      else c.translate(-dir * (1 - inP) * 1900 + dir * outP * 1900, 0);

      // The band: team color, faint stripes, the logo as a watermark, gold edges.
      c.fillStyle = hgrad(-bw / 2, bw / 2, home ? [color, darker(color, 0.55)] : [darker(color, 0.55), color]);
      c.globalAlpha = 0.97; c.fillRect(-bw / 2, -bh / 2, bw, bh); c.globalAlpha = 1;
      c.save();
      clip(-bw / 2, -bh / 2, bw, bh);
      c.fillStyle = 'rgba(255,255,255,0.055)';
      for (let x = -bw / 2; x < bw / 2; x += 46) {
        c.beginPath(); c.moveTo(x, -bh / 2); c.lineTo(x + 22, -bh / 2); c.lineTo(x + 22 - bh * 0.45, bh / 2); c.lineTo(x - bh * 0.45, bh / 2); c.closePath(); c.fill();
      }
      const img = teamLogo(st, m.side);
      if (img) fit(img, home ? 360 : -360 - 280, -bh / 2 - 24, 280, bh + 48, false, 0.13);
      if (!ace && !monster) streaks(t, dir, bh);
      c.restore();
      fillRect(-bw / 2, -bh / 2 - 7, bw, 7, GOLD);
      fillRect(-bw / 2, bh / 2, bw, 7, GOLD);
      c.globalAlpha = 0.75;
      fillRect(-bw / 2, -bh / 2 - 18, bw, 2, CREAM);
      fillRect(-bw / 2, bh / 2 + 16, bw, 2, CREAM);
      c.globalAlpha = 1;

      // An ace: a card for every ace in a row (ROYAL FLUSH! at four, then the jokers).
      const lay = ace ? aceLayout(Math.max(1, Math.min(D.MAX_CARDS, m.aces || 1))) : null;
      if (ace) aceCards(t, m, st, color, lay, Math.max(1, m.aces || 1));
      // The word slams in (with a speed trail for a kill), then shakes on impact.
      const wordX = ace ? lay.wordX : 0, wordY = -34;
      const slam = easeOut((t - (monster ? 0.2 : 0.16)) / 0.18);
      if (slam > 0) {
        const word = ace ? lay.word : play.word;
        const k = 1 + (monster ? 1.1 : 1.35) * (1 - slam);
        const size = fitText(word, 184, ace ? lay.wordW : 1150, 'd');
        c.save();
        c.translate(wordX, wordY); c.scale(k, k); c.transform(1, 0, -0.14, 1, 0, 0);
        font('d', size); c.textAlign = 'center';
        const by = midline(word);
        if (!monster && slam < 1) for (let i = 3; i >= 1; i--) ghost(word, -dir * i * 40 * (1 - slam), by, ink, 0.2 * slam);
        ghost(word, 7, by + 7, 'rgba(0,0,0,0.38)', slam);
        text(word, 0, by, 'd', size, ink, 'center', slam);
        c.restore();
      }
      // Who did it (a cream strip: it reads on any team color), with what the point meant (5–0 RUN, SAVES SET POINT…).
      const nameP = easeOut((t - 0.5) / 0.24);
      if (nameP > 0) {
        const who = (String(m.name || '').trim() || M.name(s, m.side)).toUpperCase();
        const num = m.number ? String(m.number) : '';
        const h = 56, top = 44;
        font('d', 44); const chipW = num ? Math.max(h - 12, measure(num) + 18) : 0;
        const nameSize = fitText(who, 46, 560, 'd'); font('d', nameSize); const whoW = measure(who);
        const more = m.context || '';
        font('c', 26); spacing(0.06, 26); const moreW = more ? measure(more) + 34 : 0; spacing(0, 26);
        const stripW = (num ? chipW + 14 : 0) + whoW + 36, total = stripW + (more ? moreW + 12 : 0);
        const left = wordX - total / 2;
        c.save();
        c.translate(dir * (1 - nameP) * 120, 0);
        c.globalAlpha = nameP;
        fillRR(left + 5, top + 6, stripW, h, 8, 'rgba(0,0,0,0.35)');
        fillRR(left, top, stripW, h, 8, CREAM);
        let x = left + 8;
        if (num) {
          fillRR(x, top + 6, chipW, h - 12, 6, GOLD);
          centered(num, 'd', 44, BLACK, x + chipW / 2, top + 6, h - 12, chipW - 8);
          x += chipW + 14;
        } else x += 10;
        font('d', nameSize);
        text(who, x, baseline(top, h) + 1, 'd', nameSize, BLACK);
        if (more) {
          const mx = left + stripW + 12;
          fillRR(mx, top + 7, moreW, h - 14, 6, GOLD);
          font('c', 26); spacing(0.06, 26);
          text(more, mx + moreW / 2, baseline(top + 7, h - 14) + 1, 'c', 26, BLACK, 'center');
          spacing(0, 26);
        }
        c.restore();
      }
      if (monster) impact(t, bh);
      c.restore();
      // Block party: confetti over it all.
      if (m.party) confetti(t - 0.2, 31, [GOLD, CREAM, color], 70, L - 0.2);
      // A flash on impact (above the bar only).
      const fp = (t - hit) / 0.16;
      if (fp >= 0 && fp <= 1) { c.globalAlpha = (monster ? 0.36 : 0.28) * (1 - fp); fillRect(0, 0, W, BAR_Y - 16, '#FFFFFF'); c.globalAlpha = 1; }
    }

    /** Confetti falling from the top (seeded, so it falls the same way every time), fading out by [until]. */
    function confetti(t, seed, colors, count, until) {
      if (t < 0) return;
      const r = rng(seed), fade = clamp((until - t) / 0.8, 0, 1);
      if (fade <= 0) return;
      for (let i = 0; i < count; i++) {
        const x0 = r() * W, delay = r() * 0.7, vy = 170 + r() * 260, amp = 18 + r() * 40, freq = 3 + r() * 4, phase = r() * 6.28;
        const pw = 7 + r() * 7, ph = 3 + r() * 4, spin = (r() - 0.5) * 9, flip = 5 + r() * 7;
        const q = t - delay;
        if (q < 0) continue;
        const y = -20 + vy * q;
        if (y > BAR_Y - 10) continue;
        c.save();
        c.translate(x0 + Math.sin(q * freq + phase) * amp, y);
        c.rotate(spin * q);
        c.scale(1, Math.max(0.15, Math.abs(Math.cos(q * flip + phase))));
        c.globalAlpha = fade;
        fillRect(-pw / 2, -ph / 2, pw, ph, colors[i % colors.length]);
        c.restore();
      }
    }

    /** The final: confetti in the winner's colors, and for a sweep a broom across the panel and a SWEEP tab. */
    function celebrate(s, st, shown, layout) {
      const m = shown.moment, t = shown.t;
      if (!m.side) return;
      const color = teamColor(st, m.side);
      confetti(t - 0.4, 77, [GOLD, CREAM, color, darker(color, 0.7)], 110, 6);
      if (m.detail !== 'SWEEP') return;
      const w = PANEL_SIZES.MATCH_WON[0], h = PANEL_SIZES.MATCH_WON[1];
      const bottom = layout === 'bar' ? BAR_Y - 12 : H - 60, x = CENTER_X - w / 2, y = bottom - h;
      const q = (t - 0.7) / 1.2;
      if (q >= 0 && q <= 1) {
        const bx = x - 120 + (w + 240) * easeInOut(q), by = y + 23;
        // Dust kicked up behind the broom.
        const r = rng(5);
        for (let i = 0; i < 26; i++) {
          const back = r() * 160, rise = r() * 34, size = 2 + r() * 4;
          c.globalAlpha = 0.55 * (1 - back / 160);
          circle(bx - 30 - back, by + 18 - rise * (back / 160), size, CREAM);
        }
        c.globalAlpha = 1;
        c.save();
        c.translate(bx, by);
        c.rotate(-0.5 + 0.12 * Math.sin(q * 26));     // the broom swishes as it goes
        fillRect(-4, -96, 8, 92, '#8B5A2B');            // handle
        fillRect(-14, -10, 28, 10, '#5C3A1A');          // binding
        c.fillStyle = '#D9A441';
        c.beginPath(); c.moveTo(-14, 0); c.lineTo(14, 0); c.lineTo(30, 46); c.lineTo(-30, 46); c.closePath(); c.fill();
        c.strokeStyle = 'rgba(92,58,26,0.7)'; c.lineWidth = 1.5;
        for (let k = -3; k <= 3; k++) { c.beginPath(); c.moveTo(k * 4, 2); c.lineTo(k * 8.5, 45); c.stroke(); }
        c.restore();
      }
      const pop = easeOutBack((t - 1.8) / 0.3);
      if (pop > 0) {
        const tw = 170, th = 40, tx = x + w - tw - 20, ty = y - th + 4;
        c.save();
        c.translate(tx + tw / 2, ty + th / 2); c.scale(pop, pop); c.translate(-(tx + tw / 2), -(ty + th / 2));
        fillRR(tx, ty, tw, th + 8, 8, GOLD);
        centered('SWEEP', 'd', 34, BLACK, tx + tw / 2, ty, th, tw - 20);
        c.restore();
      }
    }

    /** A kill: speed streaks across the band, the way the ball went. */
    function streaks(t, dir, bh) {
      const r = rng(7);
      for (let i = 0; i < 14; i++) {
        const y = (r() - 0.5) * bh * 0.92, len = 220 + r() * 420, speed = 2600 + r() * 1700, start = r() * 0.25, th = 2 + r() * 4;
        const q = t - start;
        if (q < 0 || q > 0.9) continue;
        const head = -dir * 1150 + dir * speed * q;
        const tail = head - dir * len;
        c.fillStyle = hgrad(Math.min(head, tail), Math.max(head, tail), dir > 0 ? ['rgba(250,246,237,0)', 'rgba(250,246,237,0.6)'] : ['rgba(250,246,237,0.6)', 'rgba(250,246,237,0)']);
        c.fillRect(Math.min(head, tail), y - th / 2, len, th);
      }
    }

    // ---------------------------------------------------------------- the ace cards
    // One card for every ace in a row by the same server: A♠ A♥ A♣ A♦ (four is a royal flush), the Little Joker
    // (silver, the serving team's logo in a small badge), then the Big Joker (team color, gold trim, holographic,
    // the full logo and a 6x counter). The earlier cards are already fanned on the first frame; only the newest
    // flips over. From the 7th ace the Big Joker stays in front: its counter pulses (7x, 8x…) and a light sweeps it.
    // No jersey numbers on the cards: the name strip has the server.
    const SUIT_RED = '#C8102E', SUIT_BLACK = '#141416', CARD_WHITE = '#FBFAF6', SILVER_INK = '#3B4048';
    const HAND = ['S', 'H', 'C', 'D', 'LJ', 'BJ'];
    const CARD_W = 140, CARD_H = 196;
    function suitInk(card) { return card === 'H' || card === 'D' ? SUIT_RED : card === 'LJ' ? SILVER_INK : SUIT_BLACK; }
    /** The fan (its centre and card spacing) and the word beside it, in band coordinates (the screen is -640…640 wide).
     *  A royal flush packs the cards closer and starts them at the left edge, for the longer word. */
    function aceLayout(n) {
      if (n >= D.ROYAL_FLUSH) { const step = 40; return { step, fanX: -580 + (CARD_W + (n - 1) * step) / 2, wordX: 200, wordW: 740, word: 'ROYAL FLUSH!' }; }
      return { step: 52, fanX: -330 - (n - 1) * 26, wordX: 104, wordW: 840, word: 'ACE!' };
    }
    /** Where card i of n sits in the fan: x, y and its tilt (radians). */
    function fanSlot(lay, i, n) {
      const off = i - (n - 1) / 2;
      return { x: lay.fanX + off * lay.step, y: -4 + off * off * 4, rot: (-8 + off * 6) * Math.PI / 180 };
    }
    function disc(x, y, r) { c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fill(); }
    function tri(a, b, d) { c.beginPath(); c.moveTo(a[0], a[1]); c.lineTo(b[0], b[1]); c.lineTo(d[0], d[1]); c.closePath(); c.fill(); }
    /** A suit pip r tall each way from (x, y): S spade, H heart, D diamond, C club. */
    function pip(kind, x, y, r, color) {
      if (kind === 'D') return diamond(x, y, r, color);
      c.fillStyle = color;
      if (kind === 'H') {
        disc(x - r * 0.48, y - r * 0.3, r * 0.52); disc(x + r * 0.48, y - r * 0.3, r * 0.52);
        tri([x - r * 0.98, y - r * 0.16], [x + r * 0.98, y - r * 0.16], [x, y + r]);
      } else if (kind === 'S') {
        disc(x - r * 0.48, y + r * 0.18, r * 0.5); disc(x + r * 0.48, y + r * 0.18, r * 0.5);
        tri([x - r * 0.97, y + r * 0.3], [x + r * 0.97, y + r * 0.3], [x, y - r]);
        tri([x, y + r * 0.25], [x - r * 0.36, y + r], [x + r * 0.36, y + r]);
      } else {
        disc(x, y - r * 0.5, r * 0.38); disc(x - r * 0.48, y + r * 0.1, r * 0.38); disc(x + r * 0.48, y + r * 0.1, r * 0.38);
        disc(x, y - r * 0.02, r * 0.28);
        tri([x, y + r * 0.1], [x - r * 0.34, y + r], [x + r * 0.34, y + r]);
      }
    }
    function star(x, y, r, color) {
      c.fillStyle = color;
      c.beginPath();
      for (let i = 0; i < 10; i++) {
        const a = -Math.PI / 2 + i * Math.PI / 5, d = i % 2 ? r * 0.42 : r;
        if (i) c.lineTo(x + d * Math.cos(a), y + d * Math.sin(a)); else c.moveTo(x + d * Math.cos(a), y + d * Math.sin(a));
      }
      c.closePath(); c.fill();
    }
    /** The back: the serving team's color with a gold lattice. */
    function cardBack(color) {
      const cw = CARD_W, ch = CARD_H;
      fillRR(-cw / 2, -ch / 2, cw, ch, 14, darker(color, 0.7));
      c.save();
      rr(-cw / 2 + 9, -ch / 2 + 9, cw - 18, ch - 18, 9); c.clip();
      c.strokeStyle = 'rgba(236,160,48,0.4)'; c.lineWidth = 2;
      for (let i = -14; i <= 14; i++) {
        c.beginPath(); c.moveTo(i * 18 - 200, -200); c.lineTo(i * 18 + 200, 200); c.stroke();
        c.beginPath(); c.moveTo(i * 18 + 200, -200); c.lineTo(i * 18 - 200, 200); c.stroke();
      }
      c.restore();
      c.lineWidth = 4; c.strokeStyle = GOLD; rr(-cw / 2 + 9, -ch / 2 + 9, cw - 18, ch - 18, 9); c.stroke();
    }
    /** "JOKER" down the top-left corner (and upside down in the bottom-right one). */
    function jokerCorners(ink) {
      const cw = CARD_W, ch = CARD_H;
      const corner = () => 'JOKER'.split('').forEach((l, i) => text(l, -cw / 2 + 20, -ch / 2 + 32 + i * 14, 'c', 15, ink, 'center'));
      corner();
      c.save(); c.rotate(Math.PI); corner(); c.restore();
    }
    /** A diagonal band of light across the card (clipped to it), p from 0 to 1. */
    function sheen(p, colors, width) {
      const cw = CARD_W, ch = CARD_H;
      if (p <= 0 || p >= 1) return;
      c.save();
      rr(-cw / 2, -ch / 2, cw, ch, 14); c.clip();
      const x = -cw - width + p * (2 * cw + 2 * width);
      c.translate(x, 0); c.rotate(0.42);
      c.fillStyle = hgrad(-width / 2, width / 2, colors);
      c.fillRect(-width / 2, -ch, width, ch * 2);
      c.restore();
    }
    /** An ace face up: A and the suit in two corners, a big pip in the middle. A royal flush gets gold edges. */
    function aceFace(card, royal) {
      const cw = CARD_W, ch = CARD_H, ink = suitInk(card);
      fillRR(-cw / 2, -ch / 2, cw, ch, 14, CARD_WHITE);
      c.lineWidth = 2.5; c.strokeStyle = ink; rr(-cw / 2 + 7, -ch / 2 + 7, cw - 14, ch - 14, 9); c.stroke();
      if (royal) { c.lineWidth = 4; c.strokeStyle = GOLD; rr(-cw / 2 + 2, -ch / 2 + 2, cw - 4, ch - 4, 12); c.stroke(); }
      const corner = () => { text('A', -cw / 2 + 21, -ch / 2 + 38, 'd', 28, ink, 'center'); pip(card, -cw / 2 + 21, -ch / 2 + 53, 7.5, ink); };
      corner();
      c.save(); c.rotate(Math.PI); corner(); c.restore();
      pip(card, 0, 0, 36, ink);
    }
    /** The Little Joker: silver foil, the serving team's logo in a small dark badge, in grey. */
    function littleJoker(img, t) {
      const cw = CARD_W, ch = CARD_H;
      c.fillStyle = grad(-cw / 2, -ch / 2, cw / 2, ch / 2, ['#EEF0F3', '#B9BFC7', '#E2E5E9', '#A9AFB8']);
      rr(-cw / 2, -ch / 2, cw, ch, 14); c.fill();
      c.lineWidth = 2.5; c.strokeStyle = SILVER_INK; rr(-cw / 2 + 7, -ch / 2 + 7, cw - 14, ch - 14, 9); c.stroke();
      jokerCorners(SILVER_INK);
      c.fillStyle = '#15171B'; disc(0, 0, 38);
      c.lineWidth = 3; c.strokeStyle = '#D5D9DF'; c.beginPath(); c.arc(0, 0, 38, 0, Math.PI * 2); c.stroke();
      if (img) {
        c.save();
        if ('filter' in c) c.filter = 'grayscale(1) brightness(1.15)';
        fit(img, -27, -27, 54, 54, false);
        c.restore();
      } else star(0, 0, 24, '#D5D9DF');
      sheen(((t * 0.55) % 1.4) / 1.4, ['rgba(255,255,255,0)', 'rgba(255,255,255,0.55)', 'rgba(255,255,255,0)'], 46);
    }
    /** The Big Joker: the serving team's color (dark when the color is light, so the logo reads), gold trim,
     *  a holographic sheen, the full logo and the streak counter (6x, 7x…). pulse: 0…1 for the counter's beat. */
    function bigJoker(img, color, t, count, pulse) {
      const cw = CARD_W, ch = CARD_H;
      const base = lum(color) > 0.45 ? '#17191D' : color;
      c.fillStyle = grad(-cw / 2, -ch / 2, cw / 2, ch / 2, [base, darker(base, 0.55)]);
      rr(-cw / 2, -ch / 2, cw, ch, 14); c.fill();
      sheen(((t * 0.45) % 1.3) / 1.3, ['rgba(255,0,128,0)', 'rgba(255,80,160,0.22)', 'rgba(255,220,0,0.26)', 'rgba(0,230,160,0.24)',
        'rgba(0,140,255,0.22)', 'rgba(140,0,255,0)'], 90);
      c.lineWidth = 5; c.strokeStyle = GOLD; rr(-cw / 2 + 2.5, -ch / 2 + 2.5, cw - 5, ch - 5, 12); c.stroke();
      c.lineWidth = 1.5; c.strokeStyle = GOLD; rr(-cw / 2 + 10, -ch / 2 + 10, cw - 20, ch - 20, 8); c.stroke();
      jokerCorners(GOLD);
      if (img) fit(img, -44, -58, 88, 88, false); else star(0, -14, 34, GOLD);
      const label = count + 'x', k = 1 + 0.35 * pulse;
      c.save();
      c.translate(0, 58); c.scale(k, k);
      font('d', 26); const w = Math.max(48, measure(label) + 22);
      fillRR(-w / 2, -15, w, 30, 15, GOLD);
      text(label, 0, 9, 'd', 26, BLACK, 'center');
      c.restore();
    }
    /** The hand: the earlier cards already fanned, the newest on top flipping over (on the 6th ace the Little Joker
     *  slides back into the fan as the Big Joker flips). From the 7th the Big Joker is already up and its counter beats. */
    function aceCards(t, m, st, color, lay, aces) {
      const n = Math.min(aces, D.MAX_CARDS), royal = n >= D.ROYAL_FLUSH, newest = n - 1, locked = aces > D.MAX_CARDS;
      const img = teamLogo(st, m.side);
      for (let i = 0; i < n; i++) {
        const slot = fanSlot(lay, i, n);
        let x = slot.x, y = slot.y, rot = slot.rot, sx = 1, k = 1, front = true;
        if (i === newest && !locked) {
          const start = n === D.MAX_CARDS ? 0.3 : 0.24;    // the Big Joker waits for the Little Joker to make room
          const appear = easeOut((t - (start - 0.14)) / 0.16);
          if (appear <= 0) continue;
          const flip = Math.PI * easeInOut((t - start) / 0.42);
          sx = Math.max(0.03, Math.abs(Math.cos(flip))) * appear;
          k = appear;
          front = flip > Math.PI / 2;
          if (HAND[i] === 'BJ') k *= 1 + 0.12 * Math.max(0, 1 - Math.abs(t - start - 0.5) / 0.12);   // it lands with a thump
        } else if (n === D.MAX_CARDS && i === newest - 1 && !locked) {
          // The Little Joker starts in the front slot and slides back into the fan.
          const from = fanSlot(lay, newest, n), p = easeInOut((t - 0.05) / 0.28);
          x = from.x + (x - from.x) * p; y = from.y + (y - from.y) * p; rot = from.rot + (rot - from.rot) * p;
        }
        c.save();
        c.translate(x, y); c.rotate(rot); c.scale(sx * k, k);
        fillRR(-CARD_W / 2 + 8, -CARD_H / 2 + 10, CARD_W, CARD_H, 14, 'rgba(0,0,0,0.35)');
        if (!front) cardBack(color);
        else if (HAND[i] === 'LJ') littleJoker(img, t);
        else if (HAND[i] === 'BJ') {
          const beat = locked ? Math.max(0, Math.sin(4 * Math.PI * Math.min(1, Math.max(0, (t - 0.3) / 0.9)))) : 0;   // two beats
          bigJoker(img, color, t, aces, beat);
          if (locked) sheen((t - 0.35) / 0.6, ['rgba(255,255,255,0)', 'rgba(255,255,255,0.7)', 'rgba(255,255,255,0)'], 60);
        } else aceFace(HAND[i], royal);
        c.restore();
      }
    }

    /** A monster block: a shock line and debris where the band lands. */
    function impact(t, bh) {
      const q = t - 0.2;
      if (q < 0 || q > 0.5) return;
      const p = q / 0.5, y = bh / 2 + 7;
      const w = 1900 * easeOut(p);
      c.globalAlpha = 1 - p;
      fillRect(-w / 2, y - 2, w, 5, CREAM);
      const r = rng(11);
      for (let i = 0; i < 28; i++) {
        const x0 = (r() - 0.5) * 1400, vx = (r() - 0.5) * 560, vy = 160 + r() * 360, size = 3 + r() * 7;
        fillRect(x0 + vx * q, y + 6 + vy * q + 700 * q * q, size, size, i % 3 ? CREAM : GOLD);
      }
      c.globalAlpha = 1;
    }

    // ICED: the team called a timeout and the other team's server missed the next serve. Frost creeps in from the
    // edges, icicles drop from the top, snow blows across, and ICED cracks in.
    let frostShapes = null;
    function frost() {
      if (frostShapes) return frostShapes;
      const r = rng(1127);
      const seeds = [];
      for (let i = 0; i < 16; i++) seeds.push([r() * W, 0, Math.PI / 2]);
      for (let i = 0; i < 9; i++) seeds.push([0, r() * H, 0]);
      for (let i = 0; i < 9; i++) seeds.push([W, r() * H, Math.PI]);
      for (let i = 0; i < 8; i++) seeds.push([r() * W, H, -Math.PI / 2]);
      const ferns = seeds.map(([x, y, a]) => {
        const dir = a + (r() - 0.5) * 0.9, len = 70 + r() * 130, delay = r() * 0.45, n = 8, step = len / n;
        const segs = [];
        let px = x, py = y;
        for (let k = 0; k < n; k++) {
          const nx = px + Math.cos(dir) * step, ny = py + Math.sin(dir) * step;
          segs.push([px, py, nx, ny, k / n, (k + 1) / n]);
          if (k > 0 && k < n - 1) {
            const bl = (len - k * step) * (0.35 + r() * 0.25);
            [1, -1].forEach(sg => {
              const ba = dir + sg * Math.PI / 3;
              segs.push([px, py, px + Math.cos(ba) * bl, py + Math.sin(ba) * bl, k / n, Math.min(1, k / n + 0.35)]);
            });
          }
          px = nx; py = ny;
        }
        return { segs, delay };
      });
      const icicles = [];
      for (let x = -10; x < W + 10;) { const w = 16 + r() * 28; icicles.push({ x, w, len: 34 + r() * 82, delay: r() * 0.35, lean: (r() - 0.5) * 6 }); x += w * (0.75 + r() * 0.4); }
      const flakes = [];
      for (let i = 0; i < 84; i++) flakes.push({ x: r() * (W + 400) - 400, y: r() * (H + 100) - 100, vx: 160 + r() * 260, vy: 40 + r() * 90, size: 1.5 + r() * 4.5, phase: r() * 6.28 });
      const gusts = [];
      for (let i = 0; i < 6; i++) gusts.push({ y: 90 + r() * 480, h: 14 + r() * 22, w: 380 + r() * 380, start: r() * 0.5, speed: 1700 + r() * 900 });
      frostShapes = { ferns, icicles, flakes, gusts };
      return frostShapes;
    }

    function iced(s, st, shown) {
      const m = shown.moment, t = shown.t, L = shown.length;
      const life = 1 - easeInOut((t - (L - 0.7)) / 0.7);
      const grow = easeOut(t / 1.1) * life;
      const shapes = frost();
      c.save();
      // An icy tint and frost at the edges.
      c.fillStyle = 'rgba(150,205,245,' + (0.16 * grow).toFixed(3) + ')'; c.fillRect(0, 0, W, H);
      const v = c.createRadialGradient(CENTER_X, H / 2, 240, CENTER_X, H / 2, 820);
      v.addColorStop(0, 'rgba(215,240,255,0)'); v.addColorStop(1, 'rgba(215,240,255,' + (0.55 * grow).toFixed(3) + ')');
      c.fillStyle = v; c.fillRect(0, 0, W, H);
      const edge = (x0, y0, x1, y1, rx, ry, rw, rh) => { c.fillStyle = grad(x0, y0, x1, y1, ['rgba(230,247,255,' + (0.7 * grow).toFixed(3) + ')', 'rgba(200,235,255,' + (0.22 * grow).toFixed(3) + ')', 'rgba(200,235,255,0)']); c.fillRect(rx, ry, rw, rh); };
      const d = 150 * grow;
      edge(0, 0, 0, d, 0, 0, W, d);
      edge(0, H, 0, H - d * 0.7, 0, H - d * 0.7, W, d * 0.7);
      edge(0, 0, d * 0.9, 0, 0, 0, d * 0.9, H);
      edge(W, 0, W - d * 0.9, 0, W - d * 0.9, 0, d * 0.9, H);
      // Frost ferns growing in from the edges.
      c.beginPath();
      shapes.ferns.forEach(fern => {
        const g = easeOut((t - fern.delay) / 1.0) * life;
        if (g <= 0) return;
        fern.segs.forEach(([x0, y0, x1, y1, a0, a1]) => {
          if (g <= a0) return;
          const f = clamp((g - a0) / (a1 - a0), 0, 1);
          c.moveTo(x0, y0); c.lineTo(x0 + (x1 - x0) * f, y0 + (y1 - y0) * f);
        });
      });
      c.lineWidth = 1.6; c.lineCap = 'round';
      c.strokeStyle = 'rgba(245,252,255,' + (0.85 * life).toFixed(3) + ')';
      c.shadowColor = 'rgba(170,225,255,0.9)'; c.shadowBlur = 6;
      c.stroke();
      c.shadowBlur = 0;
      // A snow ledge along the top, with icicles dropping from it.
      fillRect(0, 0, W, 12 * grow, 'rgba(245,252,255,' + (0.9 * life).toFixed(3) + ')');
      shapes.icicles.forEach(ic => {
        const p = easeOutBack((t - 0.25 - ic.delay) / 0.45) * life;
        if (p <= 0) return;
        const len = ic.len * p;
        c.fillStyle = grad(0, 0, 0, len + 12, ['rgba(255,255,255,0.95)', 'rgba(195,232,255,0.85)', 'rgba(160,215,250,0.2)']);
        c.beginPath(); c.moveTo(ic.x, 0); c.lineTo(ic.x + ic.w, 0); c.lineTo(ic.x + ic.w / 2 + ic.lean, len + 12); c.closePath(); c.fill();
        c.strokeStyle = 'rgba(255,255,255,0.8)'; c.lineWidth = 1.5;
        c.beginPath(); c.moveTo(ic.x + ic.w * 0.32, 3); c.lineTo(ic.x + ic.w / 2 + ic.lean * 0.6 - 2, len * 0.75); c.stroke();
      });
      // Wind gusts, then snow blowing across.
      shapes.gusts.forEach(g => {
        const q = t - g.start;
        if (q < 0 || q > 1.4) return;
        const x = -g.w + g.speed * q;
        const a = 0.22 * Math.sin(Math.PI * clamp(q / 1.4, 0, 1)) * life;
        c.fillStyle = hgrad(x, x + g.w, ['rgba(255,255,255,0)', 'rgba(255,255,255,' + a.toFixed(3) + ')', 'rgba(255,255,255,0)']);
        c.beginPath(); c.ellipse(x + g.w / 2, g.y, g.w / 2, g.h / 2, -0.06, 0, Math.PI * 2); c.fill();
      });
      const fa = clamp(t / 0.4, 0, 1) * life;
      const drift = t <= 1.6 ? t - 0.75 * t * t / 3.2 : 1.6 - 0.375 * 1.6 + 0.25 * (t - 1.6);   // a strong gust first, then gentle
      c.strokeStyle = 'rgba(255,255,255,' + (0.9 * fa).toFixed(3) + ')'; c.lineWidth = 1.3;
      c.fillStyle = 'rgba(255,255,255,' + (0.85 * fa).toFixed(3) + ')';
      shapes.flakes.forEach(fl => {
        const x = ((fl.x + fl.vx * drift + Math.sin(t * 1.7 + fl.phase) * 14 + 400) % (W + 400) + (W + 400)) % (W + 400) - 200;
        const y = ((fl.y + fl.vy * t + 100) % (H + 100) + (H + 100)) % (H + 100) - 50;
        if (fl.size > 3.6) {
          c.beginPath();
          for (let k = 0; k < 3; k++) { const a = fl.phase + t * 0.8 + k * Math.PI / 3; c.moveTo(x - Math.cos(a) * fl.size, y - Math.sin(a) * fl.size); c.lineTo(x + Math.cos(a) * fl.size, y + Math.sin(a) * fl.size); }
          c.stroke();
        } else { c.beginPath(); c.arc(x, y, fl.size / 2, 0, Math.PI * 2); c.fill(); }
      });
      // The team that called the timeout, ICED, and what happened.
      const color = teamColor(st, m.side);
      const chipP = easeOut((t - 0.3) / 0.3) * life;
      if (chipP > 0) {
        const chip = M.name(s, m.side).toUpperCase() + ' TIMEOUT';
        font('c', 26); spacing(0.08, 26);
        const cw = measure(chip) + 40, top = 150;
        c.globalAlpha = chipP;
        fillRR(CENTER_X - cw / 2, top, cw, 40, 8, color);
        text(chip, CENTER_X, baseline(top, 40) + 1, 'c', 26, textOn(color), 'center');
        spacing(0, 26);
        c.globalAlpha = 1;
      }
      const wp = easeOut((t - 0.4) / 0.35) * life;
      if (wp > 0) {
        const k = 1.3 - 0.3 * easeOut((t - 0.4) / 0.35);
        const shiver = (1 - clamp((t - 0.4) / 0.9, 0, 1)) * 5 * Math.sin(t * 70);
        c.save();
        c.translate(CENTER_X + shiver, 300); c.scale(k, k);
        font('d', 236); c.textAlign = 'center';
        const by = midline('ICED');
        c.globalAlpha = wp;
        c.lineJoin = 'round'; c.lineWidth = 12; c.strokeStyle = ICE_DEEP; c.strokeText('ICED', 0, by);
        const g = c.createLinearGradient(0, by - 170, 0, by);
        g.addColorStop(0, '#FFFFFF'); g.addColorStop(0.45, '#DDF4FF'); g.addColorStop(1, '#7CC8F2');
        text('ICED', 0, by, 'd', 236, g, 'center');
        const sp = (t - 1.1) / 0.6;   // a shine across the ice
        if (sp >= 0 && sp <= 1) {
          const sh = c.createLinearGradient(-300, -160, 300, 60);
          sh.addColorStop(clamp(sp - 0.1, 0, 1), 'rgba(255,255,255,0)'); sh.addColorStop(sp, 'rgba(255,255,255,0.9)'); sh.addColorStop(clamp(sp + 0.1, 0, 1), 'rgba(255,255,255,0)');
          ghost('ICED', 0, by, sh, 1);
        }
        c.restore();
      }
      const subP = easeOut((t - 0.85) / 0.3) * life;
      if (subP > 0) {
        const line = 'THE TIMEOUT ICED THE SERVER';
        font('c', 30); spacing(0.06, 30);
        const w = measure(line) + 48, top = 418 + (1 - subP) * 20;
        c.globalAlpha = subP;
        fillRR(CENTER_X - w / 2, top, w, 48, 8, 'rgba(14,58,92,0.88)');
        fillRect(CENTER_X - w / 2, top + 44, w, 4, ICE);
        text(line, CENTER_X, baseline(top, 44) + 1, 'c', 30, CREAM, 'center');
        spacing(0, 30);
        c.globalAlpha = 1;
      }
      c.restore();
    }

    // ---------------------------------------------------------------- lower-third panels (slot C)
    const PANEL_SIZES = { SET_WON: [960, 132], MATCH_WON: [960, 252], SET_STATS: [880, 262], SET_START: [660, 80],
      TIMEOUT: [700, 0], INTRO: [1060, 330], POTM: [840, 240], SPONSOR: [660, 200] };

    function drawPanel(s, st, shown, layout, countdown) {
      const m = shown.moment;
      if (m.kind === 'INTRO') { introSequence(s, st, shown, layout); return; }
      const open = Math.min(easeOut(shown.t / 0.4), easeOut((shown.length - shown.t) / 0.45));
      if (open <= 0 || !PANEL_SIZES[m.kind]) return;
      const w = PANEL_SIZES[m.kind][0];
      const h = m.kind === 'TIMEOUT' ? (sponsorCountHint > 0 ? 200 : 144) : PANEL_SIZES[m.kind][1];
      const bottom = layout === 'bar' ? BAR_Y - 12 : H - 60;
      const x = CENTER_X - w / 2, y = bottom - h;
      c.save();
      clip(x - 4, bottom - (h + 8) * open, w + 8, (h + 8) * open + 4);
      if (m.kind === 'SET_WON') setWon(s, st, x, y, w, h, m);
      else if (m.kind === 'MATCH_WON') matchWon(s, st, x, y, w, h, m, shown.t);
      else if (m.kind === 'SET_STATS') setStats(s, st, x, y, w, h, m);
      else if (m.kind === 'SET_START') setStart(x, y, w, h, m);
      else if (m.kind === 'TIMEOUT') timeout(s, st, x, y, w, h, m, countdown, shown.t);
      else if (m.kind === 'POTM') potm(s, st, x, y, w, h, m);
      else if (m.kind === 'SPONSOR') sponsorPanel(x, y, w, h, m);
      c.restore();
    }

    function plateLogo(st, side, s, color, px, py, pw, ph, inset, letterSize) {
      const img = teamLogo(st, side);
      if (img) fit(img, px + inset, py + inset, pw - inset * 2, ph - inset * 2);
      else centered(M.name(s, side).slice(0, 1), 'd', letterSize, lum(color) < 0.08 ? CREAM : color, px + pw / 2, py, ph, pw);
    }

    function setWon(s, st, x, y, w, h, m) {
      const side = m.side || 'home', color = teamColor(st, side), ink = textOn(color);
      c.fillStyle = hgrad(x, x + w, [darker(color, 0.65), color, darker(color, 0.8)]);
      rr(x, y, w, h, 12); c.fill();
      fillRect(x, y + h - 6, w, 6, GOLD);
      const pl = { x: x + 18, y: y + 14, w: 102, h: h - 34 };
      logoPlate(pl.x, pl.y, pl.w, pl.h, 10);
      plateLogo(st, side, s, color, pl.x, pl.y, pl.w, pl.h, 6, 70);
      const score = side === 'home' ? m.home + '–' + m.away : m.away + '–' + m.home;
      font('d', 84);
      const scoreW = measure(score);
      text(score, x + w - 26, baseline(y, h - 6) + 2, 'd', 84, GOLD, 'right');
      const title = M.name(s, side).toUpperCase() + ' TAKE SET ' + m.setNumber;
      const size = fitText(title, 64, x + w - 60 - scoreW - (pl.x + pl.w + 24), 'd');
      font('d', size);
      if (!m.detail) { text(title, pl.x + pl.w + 24, baseline(y, h - 6) + 2, 'd', size, ink); return; }
      // LED WIRE TO WIRE: the title moves up for a gold line under it.
      text(title, pl.x + pl.w + 24, baseline(y - 14, h - 6) + 2, 'd', size, ink);
      font('c', 24); spacing(0.1, 24);
      const dw = measure(m.detail) + 26;
      fillRR(pl.x + pl.w + 24, y + h - 46, dw, 30, 6, GOLD);
      text(m.detail, pl.x + pl.w + 37, baseline(y + h - 46, 30) + 1, 'c', 24, BLACK);
      spacing(0, 24);
    }

    function matchWon(s, st, x, y, w, h, m, t) {
      darkPanel(x, y, w, h);
      const winner = m.side;
      const color = winner ? teamColor(st, winner) : GOLD;
      fillRect(x, y, w, 46, color);
      fillRect(x, y + 46, w, 4, GOLD);
      centered(winner ? 'FINAL  ·  ' + M.name(s, winner).toUpperCase() + ' WIN' : 'FINAL  ·  MATCH TIED', 'd', 38, textOn(color), x + w / 2, y, 46, w - 40);
      const sets = s.completedSets;
      const rowTop = y + 64, rowH = 70, nameW = 320;
      const colW = Math.min(90, (w - nameW - 160) / Math.max(1, sets.length));
      ['home', 'away'].forEach((side, i) => {
        const ry = rowTop + i * rowH;
        fillRect(x + 24, ry + 10, 8, rowH - 20, teamColor(st, side));
        const img = teamLogo(st, side);
        if (img) fit(img, x + 42, ry + 8, 54, rowH - 16);
        const nm = M.name(s, side).toUpperCase();
        const size = fitText(nm, 46, nameW - 120, 'd');
        font('d', size);
        text(nm, x + 108, baseline(ry, rowH) + 2, 'd', size, CREAM);
        sets.forEach((set, j) => {
          const mine = side === 'home' ? set.home : set.away;
          const won = (set.home > set.away ? 'home' : 'away') === side;
          font('d', 44);
          text(String(mine), x + nameW + 30 + colW * (j + 0.5), baseline(ry, rowH) + 2, 'd', 44, won ? CREAM : 'rgba(250,246,237,.59)', 'center');
        });
        const bx = x + w - 110, by = ry + 8, bw = 80, bh = rowH - 16;
        fillRR(bx, by, bw, bh, 8, winner === side ? GOLD : PANEL);
        centered(String(M.setsWon(s, side)), 'd', 50, winner === side ? BLACK : CREAM, bx + bw / 2, by, bh, bw);
      });
    }

    function setStats(s, st, x, y, w, h, m) {
      darkPanel(x, y, w, h);
      const [home, away] = m.stats || [null, null];
      fillRect(x, y, w, 6, RED);
      centered(m.word || 'SET STATS', 'd', 36, GOLD, x + w / 2, y + 10, 44, 400);
      const headY = y + 12;
      ['home', 'away'].forEach(side => {
        const lx = side === 'home' ? x + 26 : x + w - 26 - 56;
        const img = teamLogo(st, side);
        if (img) fit(img, lx, headY, 56, 56);
        const nm = M.name(s, side).toUpperCase();
        const size = fitText(nm, 34, 220, 'd');
        font('d', size);
        text(nm, side === 'home' ? lx + 66 : lx - 10, headY + 38, 'd', size, CREAM, side === 'home' ? 'left' : 'right');
      });
      const top = y + 80, rowH = (y + h - 50 - top) / STAT_ROWS.length;
      STAT_ROWS.forEach(([field, word], i) => {
        const ry = top + i * rowH;
        if (i % 2 === 0) fillRect(x + 16, ry, w - 32, rowH, 'rgba(250,246,237,.157)');
        centered(word, 'c', 24, 'rgba(250,246,237,.86)', x + w / 2, ry, rowH, 200);
        const hv = home ? home[field] || 0 : 0, av = away ? away[field] || 0 : 0;
        font('d', 36);
        text(String(hv), x + w / 2 - 200, baseline(ry, rowH) + 1, 'd', 36, hv > av ? GOLD : CREAM, 'center');
        text(String(av), x + w / 2 + 200, baseline(ry, rowH) + 1, 'd', 36, av > hv ? GOLD : CREAM, 'center');
      });
      // Top player: most kills + aces + blocks on either team.
      let best = null;
      [['home', home], ['away', away]].forEach(([side, t]) => {
        if (!t) return;
        Object.keys(t.players || {}).forEach(num => {
          const p = t.players[num], score = (p.kills || 0) + (p.aces || 0) + (p.blocks || 0);
          if (!best || score > best.score) best = { side, num, p, score };
        });
      });
      if (best && best.score > 0) {
        const line = 'TOP  ·  #' + best.num + ' ' + String(best.p.name || '').toUpperCase() + ' (' + M.name(s, best.side).toUpperCase() + ')  ·  ' + D.statLine(best.p);
        centered(line, 'c', 23, GOLD, x + w / 2, y + h - 46, 40, w - 40);
      }
    }

    function setStart(x, y, w, h, m) {
      darkPanel(x, y, w, h);
      fillRect(x, y, w, 4, GOLD);
      const left = 'SET ' + m.setNumber;
      const right = 'TO ' + m.count + (m.name ? '  ·  ' + m.name.toUpperCase() + ' SERVE' : '');
      font('d', 54);
      const lw = measure(left);
      const rs = fitText(right, 42, w - lw - 80, 'd');
      font('d', rs);
      const rw = measure(right);
      const start = x + w / 2 - (lw + 24 + rw) / 2;
      font('d', 54);
      text(left, start, baseline(y + 4, h - 4) + 2, 'd', 54, GOLD);
      font('d', rs);
      text(right, start + lw + 24, baseline(y + 4, h - 4) + 2, 'd', rs, CREAM);
    }

    function timeout(s, st, x, y, w, h, m, countdown, t) {
      const side = m.side || 'home', color = teamColor(st, side);
      darkPanel(x, y, w, h);
      const mh = 144;
      fillRect(x, y, 10, mh, color);
      const pl = { x: x + 26, y: y + 18, w: 94, h: mh - 36 };
      logoPlate(pl.x, pl.y, pl.w, pl.h, 10);
      const img = teamLogo(st, side);
      if (img) fit(img, pl.x + 6, pl.y + 6, pl.w - 12, pl.h - 12);
      text('TIMEOUT', pl.x + pl.w + 22, y + 66, 'd', 60, CREAM);
      const nm = M.name(s, side).toUpperCase();
      const size = fitText(nm, 38, 280, 'd');
      text(nm, pl.x + pl.w + 22, y + 104, 'd', size, GOLD);
      const per = M.timeoutLimit(s.format);
      if (per > 0) {
        const left = Math.max(0, per - (s[side + 'Timeouts'] || 0));
        const lx = pl.x + pl.w + 22;
        font('c', 18);
        text('TIMEOUTS LEFT', lx, y + 132, 'c', 18, 'rgba(250,246,237,.78)');
        font('c', 18);
        const dx = lx + measure('TIMEOUTS LEFT') + 16;
        for (let i = 0; i < per; i++) circle(dx + i * 22, y + 126, 7.5, i < left ? GOLD : 'rgba(250,246,237,.27)');
      }
      if (countdown != null) {
        font('d', 92);
        text(Math.floor(countdown / 60) + ':' + String(countdown % 60).padStart(2, '0'), x + w - 30, baseline(y, mh) + 4, 'd', 92, GOLD, 'right');
      }
      if (sponsorCountHint > 0 && h > 150) sponsorStrip(x, y + mh, w, h - mh, Math.floor(t / 6) % sponsorCountHint);
    }

    function sponsorStrip(x, y, w, h, i) {
      fillRect(x + 10, y, w - 20, h - 6, CREAM);
      const sp = sponsor(i);
      if (!sp) return;
      font('c', 18); spacing(0.08, 18);
      text('BROUGHT TO YOU BY', x + 28, baseline(y, h - 6), 'c', 18, RED);
      font('c', 18);
      const lx = x + 28 + measure('BROUGHT TO YOU BY') + 22;
      spacing(0, 18);
      if (sp.image) fit(sp.image, lx, y + 5, x + w - 30 - lx, h - 16, true);
      else { const nm = sp.name.toUpperCase(); const size = fitText(nm, 32, x + w - 30 - lx, 'd'); font('d', size); text(nm, lx, baseline(y, h - 6) + 1, 'd', size, BLACK); }
    }

    // ---------------------------------------------------------------- the match open (More → Match intro)
    /*
     * Up to 45 s, or until the first point: the tournament (its logo or the badge, name, dates and place), the
     * matchup (logos, names, seeds, starting six, the venue), the season so far and storylines (when the scorer
     * page has them), the format, then the matchup again until play starts. style.intro comes from the scorer
     * page; without it the open is the matchup with the event title, as before.
     */
    const DIVS = { men: "MEN'S", women: "WOMEN'S", coed: 'CO-ED' };
    const backOut = x => { const k = clamp(x, 0, 1) - 1, c1 = 1.70158; return 1 + (c1 + 1) * k * k * k + c1 * k * k; };
    const upper = v => String(v || '').trim().toUpperCase();

    function introOf(st) {
      const it = st.intro && typeof st.intro === 'object' ? st.intro : {};
      const side = v => (v && typeof v === 'object' ? v : {});
      return { event: upper(it.event || st.eventTitle), sub: upper(it.sub), round: upper(it.round), place: upper(it.place),
        dates: upper(it.dates), eventId: String(it.eventId || ''), home: side(it.home), away: side(it.away),
        notes: (Array.isArray(it.notes) ? it.notes : []).map(n => String(n || '').trim()).filter(Boolean).slice(0, 3) };
    }
    const seasonRows = it => ['home', 'away'].map(side => [it[side].last, it[side].rank].map(upper).filter(Boolean));
    function introStages(it) {
      const stages = [];
      if (it.event) stages.push(['reveal', 5.6]);
      stages.push(['matchup', 10]);
      if (it.notes.length || seasonRows(it).some(r => r.length)) stages.push(['season', 8.5]);
      stages.push(['format', 6.5]);
      stages.push(['matchup', 999]);
      return stages;
    }

    function introSequence(s, st, shown, layout) {
      const it = introOf(st);
      const stages = introStages(it);
      let from = 0;
      for (let i = 0; i < stages.length; i++) {
        const end = i === stages.length - 1 ? shown.length : Math.min(from + stages[i][1], shown.length);
        if (shown.t < end || i === stages.length - 1) {
          const t = shown.t - from, len = end - from;
          if (stages[i][0] === 'reveal') reveal(st, it, t, len);
          else introPanel(stages[i][0], s, st, it, t, len, layout);
          return;
        }
        from = end;
      }
    }

    function introPanel(kind, s, st, it, t, len, layout) {
      const open = Math.min(easeOut(t / 0.45), easeOut((len - t) / 0.4));
      if (open <= 0) return;
      const rows = seasonRows(it), cols = rows.some(r => r.length);
      const size = kind === 'matchup' ? [1060, it.place ? 346 : 312]
        : kind === 'season' ? [940, 44 + (cols ? 112 : 0) + (it.notes.length ? 14 + 32 * it.notes.length : 0) + 14]
        : [960, 100];
      const w = size[0], h = size[1];
      const bottom = layout === 'bar' ? BAR_Y - 12 : H - 60;
      const x = CENTER_X - w / 2, y = bottom - h;
      c.save();
      clip(x - 4, bottom - (h + 8) * open, w + 8, (h + 8) * open + 4);
      if (kind === 'matchup') matchup(s, st, it, x, y, w, h, t);
      else if (kind === 'season') season(s, st, it, rows, cols, x, y, w, h, t);
      else formatCard(s, x, y, w, h, t);
      c.restore();
    }

    /** A line of differently coloured parts, centred and shrunk to fit. */
    function twoTone(parts, face, size, cx, top, height, maxW) {
      parts = parts.filter(p => p[0]);
      if (!parts.length) return;
      const sep = '  ·  ';
      const all = parts.map(p => p[0]).join(sep);
      const sz = fitText(all, size, maxW, face);
      font(face, sz);
      let x = cx - measure(all) / 2;
      const y = baseline(top, height) + 1;
      parts.forEach((p, i) => {
        if (i) { text(sep, x, y, face, sz, 'rgba(250,246,237,.55)'); x += measure(sep); }
        text(p[0], x, y, face, sz, p[1]);
        x += measure(p[0]);
      });
    }

    function reveal(st, it, t, len) {
      const vis = Math.min(easeOut(t / 0.5), easeOut((len - t) / 0.7));
      if (vis <= 0) return;
      const leaving = 1 - easeOut((len - t) / 0.7);
      const cx = CENTER_X, cy = 252, R = 116;
      c.save();
      // Dim the picture behind the emblem, fading out above the score bar so the bar stays as bright as ever.
      c.globalAlpha = vis;
      fillRect(0, 0, W, BAR_Y, grad(0, 0, 0, BAR_Y, ['rgba(8,8,10,.5)', 'rgba(8,8,10,.5)', 'rgba(8,8,10,.42)', 'rgba(8,8,10,0)']));
      const glow = c.createRadialGradient(cx, cy, 10, cx, cy, 300);
      glow.addColorStop(0, rgba(RED, 0.6)); glow.addColorStop(1, rgba(RED, 0));
      c.fillStyle = glow; c.fillRect(cx - 300, cy - 300, 600, 600);

      // The emblem: the tournament's logo, or the badge (AVA or the region) in a gold ring.
      const k = (0.5 + 0.5 * backOut((t - 0.05) / 0.75)) * (1 + 0.08 * leaving);
      c.save();
      c.translate(cx, cy); c.scale(k, k);
      c.globalAlpha = vis * clamp(t / 0.3, 0, 1);
      const eventImg = it.eventId ? logo('event:' + it.eventId) : null;
      const badge = logo(st.badge) || logo(st.homeLogo);
      if (eventImg) fit(eventImg, -170, -120, 340, 240);
      else {
        circle(0, 0, R, PANEL);
        c.lineWidth = 7; c.strokeStyle = GOLD; c.lineCap = 'round';
        c.beginPath(); c.arc(0, 0, R - 4, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * easeInOut((t - 0.1) / 0.9)); c.stroke();
        if (badge) fit(badge, -78, -78, 156, 156);
        else centered('AVA', 'd', 80, CREAM, 0, -50, 100, 180);
      }
      // A light sweep across the emblem.
      const sweep = (t - 1.1) / 0.8;
      if (sweep > 0 && sweep < 1) {
        c.beginPath(); c.arc(0, 0, eventImg ? 170 : R, 0, Math.PI * 2); c.clip();
        const sx = -260 + 520 * sweep;
        const g = c.createLinearGradient(sx - 60, 0, sx + 60, 0);
        g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(0.5, 'rgba(255,255,255,.38)'); g.addColorStop(1, 'rgba(255,255,255,0)');
        c.fillStyle = g; c.transform(1, 0, -0.35, 1, 0, 0); c.fillRect(sx - 60, -260, 120, 520);
      }
      c.restore();

      // The name, a red rule, the subtitle, dates and place.
      const rise = v => (1 - easeOut(v)) * 24;
      const a1 = clamp((t - 0.45) / 0.4, 0, 1);
      const nameSize = fitText(it.event, 78, 1100, 'd');
      spacing(0.02, nameSize);
      text(it.event, cx, 436 + rise((t - 0.45) / 0.5), 'd', nameSize, CREAM, 'center', a1);
      spacing(0, nameSize);
      const ruleW = 600 * easeInOut((t - 0.75) / 0.6);
      if (ruleW > 0) fillRect(cx - ruleW / 2, 452, ruleW, 4, RED);
      if (it.sub) {
        const size = fitText(it.sub, 30, 1000, 'c');
        spacing(0.06, size);
        text(it.sub, cx, 492 + rise((t - 0.9) / 0.5), 'c', size, GOLD, 'center', clamp((t - 0.9) / 0.4, 0, 1));
      }
      const line = [it.dates, it.place].filter(Boolean).join('  ·  ');
      if (line) {
        const size = fitText(line, 21, 1000, 'c');
        spacing(0.08, size);
        text(line, cx, (it.sub ? 528 : 496) + rise((t - 1.1) / 0.5), 'c', size, 'rgba(250,246,237,.9)', 'center', clamp((t - 1.1) / 0.4, 0, 1));
      }
      spacing(0, 20);
      c.restore();
    }

    function matchup(s, st, it, x, y, w, h, t) {
      c.save();
      rr(x, y, w, h, 12); c.clip();
      darkPanel(x, y, w, h);
      fillRect(x, y, w, 44, hgrad(x, x + w, [darker(RED, 0.62), RED, darker(RED, 0.62)]));
      twoTone([[it.event || "TODAY'S MATCH", CREAM], [it.round, GOLD]], 'd', 31, x + w / 2, y + 1, 43, w - 60);
      const ex = lastExtras || D.extrasFrom(null);
      const vsA = clamp((t - 0.2) / 0.4, 0, 1);
      centered('VS', 'd', 64, rgba(CREAM, vsA), x + w / 2, y + 96, 90, 120);
      const div = DIVS[st.division];
      if (div) { c.globalAlpha = vsA; centered(div, 'c', 18, GOLD, x + w / 2, y + 176, 24, 160); c.globalAlpha = 1; }
      ['home', 'away'].forEach(side => {
        const slide = (1 - easeOut((t - 0.1) / 0.55)) * (side === 'home' ? -60 : 60);
        const cx = (side === 'home' ? x + w * 0.26 : x + w * 0.74) + slide;
        const color = teamColor(st, side);
        c.globalAlpha = clamp((t - 0.05) / 0.4, 0, 1);
        const px = cx - 70, py = y + 60, pw = 140, ph = 140;
        logoPlate(px, py, pw, ph, 14);
        fillRect(px + 1, py + ph - 8, pw - 2, 8, color);
        const img = teamLogo(st, side);
        if (img) fit(img, px + 10, py + 10, pw - 20, ph - 26);
        else centered(M.name(s, side).slice(0, 1), 'd', 90, color, cx, py, ph - 8, pw);
        centered(M.name(s, side).toUpperCase(), 'd', 44, CREAM, cx, py + ph + 4, 46, w * 0.40);
        c.globalAlpha = clamp((t - 0.5) / 0.4, 0, 1);
        const seed = upper(it[side].seed);
        if (seed) { spacing(0.05, 19); centered(seed, 'c', 19, GOLD, cx, py + ph + 50, 24, w * 0.42); spacing(0, 19); }
        const lu = ex.lineup[side] || [];
        if (lu.length) centered('STARTING  ' + lu.join('  ·  '), 'c', 18, 'rgba(250,246,237,.86)', cx, py + ph + (seed ? 76 : 52), 24, w * 0.44);
        c.globalAlpha = 1;
      });
      if (it.place) {
        fillRect(x, y + h - 34, w, 34, CREAM);
        spacing(0.06, 19);
        centered(it.place, 'c', 19, BLACK, x + w / 2, y + h - 34, 34, w - 40);
        spacing(0, 19);
      }
      c.restore();
    }

    function season(s, st, it, rows, cols, x, y, w, h, t) {
      c.save();
      rr(x, y, w, h, 12); c.clip();
      darkPanel(x, y, w, h);
      fillRect(x, y, w, 44, hgrad(x, x + w, [darker(RED, 0.62), RED, darker(RED, 0.62)]));
      spacing(0.04, 30);
      centered(cols ? 'SEASON SO FAR' : 'STORYLINE', 'd', 30, CREAM, x + w / 2, y + 1, 43, w - 60);
      spacing(0, 30);
      let top = y + 44;
      if (cols) {
        fillRect(x + w / 2 - 1, top + 16, 2, 80, 'rgba(250,246,237,.18)');
        ['home', 'away'].forEach((side, i) => {
          c.globalAlpha = clamp((t - 0.2 - i * 0.15) / 0.4, 0, 1);
          const cx0 = x + 24 + i * (w / 2);
          const color = teamColor(st, side);
          logoPlate(cx0, top + 18, 64, 64, 10);
          fillRect(cx0 + 1, top + 78, 62, 4, color);
          const img = teamLogo(st, side);
          if (img) fit(img, cx0 + 6, top + 22, 52, 52);
          else centered(M.name(s, side).slice(0, 1), 'd', 44, color, cx0 + 32, top + 18, 60, 60);
          const tx = cx0 + 82, maxW = w / 2 - 120;
          const ns = fitText(M.name(s, side).toUpperCase(), 32, maxW, 'd');
          text(M.name(s, side).toUpperCase(), tx, top + 46, 'd', ns, CREAM);
          rows[i].forEach((line, j) => {
            const ls = fitText(line, 19, maxW, 'c');
            text(line, tx, top + 72 + j * 24, 'c', ls, j ? 'rgba(250,246,237,.86)' : GOLD);
          });
          c.globalAlpha = 1;
        });
        top += 112;
      }
      it.notes.forEach((note, i) => {
        c.globalAlpha = clamp((t - 0.5 - i * 0.25) / 0.4, 0, 1);
        fillRect(x + 26, top + 14 + i * 32 + 9, 8, 8, GOLD);
        const ls = fitText(note, 22, w - 80, 'c');
        text(note, x + 46, top + 14 + i * 32 + 20, 'c', ls, CREAM);
        c.globalAlpha = 1;
      });
      c.restore();
    }

    function formatCard(s, x, y, w, h, t) {
      const words = M.formatWords(s.format);
      c.save();
      rr(x, y, w, h, 12); c.clip();
      darkPanel(x, y, w, h);
      fillRect(x, y, 180, h, GOLD);
      centered('FORMAT', 'd', 40, BLACK, x + 90, y, h, 160);
      c.globalAlpha = clamp((t - 0.2) / 0.4, 0, 1);
      const main = words.main.join('  ·  ').toUpperCase();
      const ms = fitText(main, 40, w - 230, 'd');
      text(main, x + 206, y + 50, 'd', ms, CREAM);
      c.globalAlpha = clamp((t - 0.45) / 0.4, 0, 1);
      const rules = words.rules.join('  ·  ').toUpperCase();
      spacing(0.05, 20);
      const rs = fitText(rules, 20, w - 230, 'c');
      text(rules, x + 206, y + 80, 'c', rs, GOLD);
      spacing(0, 20);
      c.globalAlpha = 1;
      c.restore();
    }

    function potm(s, st, x, y, w, h, m) {
      const side = m.side || 'home', color = teamColor(st, side);
      darkPanel(x, y, w, h);
      fillRect(x, y, w, 44, GOLD);
      centered('PLAYER OF THE MATCH', 'd', 34, BLACK, x + w / 2, y, 44, w - 40);
      const ch = { x: x + 28, y: y + 62, w: 130, h: h - 84 };
      fillRR(ch.x, ch.y, ch.w, ch.h, 12, color);
      centered(m.number || '★', 'd', 96, textOn(color), ch.x + ch.w / 2, ch.y, ch.h, ch.w - 10);
      const tx = ch.x + ch.w + 26;
      const img = teamLogo(st, side);
      if (img) fit(img, x + w - 170, y + 54, 150, h - 64, false, 60 / 255);
      const nm = (m.name || '').toUpperCase();
      const size = fitText(nm, 74, x + w - 40 - tx, 'd');
      text(nm, tx, y + 132, 'd', size, CREAM);
      const line = [M.name(s, side).toUpperCase(), m.detail].filter(v => v && v.trim()).join('  ·  ');
      const ls = fitText(line, 24, x + w - 40 - tx, 'c');
      text(line, tx, y + 172, 'c', ls, GOLD);
    }

    function sponsorPanel(x, y, w, h, m) {
      darkPanel(x, y, w, h);
      centered('BROUGHT TO YOU BY', 'c', 22, GOLD, x + w / 2, y + 8, 34, w - 40);
      const px = x + 24, py = y + 46, pw = w - 48, ph = h - 66;
      fillRR(px, py, pw, ph, 10, CREAM);
      const sp = sponsor(m.sponsor);
      if (!sp) return;
      if (sp.image) fit(sp.image, px + 16, py + 8, pw - 32, ph - 16);
      else centered(sp.name.toUpperCase(), 'd', 62, BLACK, px + pw / 2, py, ph, pw - 30);
    }

    // ---------------------------------------------------------------- one frame
    /**
     * Draws the bar (layout 'bar') or just the moments (layout 'box', where the page's own corner box
     * and stat play stay), like ScoreboardRenderer.render in the app.
     */
    function draw(ctx, s, st, f, extras, layout, showScoreboard) {
      c = ctx;
      drawn = [];
      c.clearRect(0, 0, W, H);
      lastExtras = extras;
      sponsorCountHint = f.sponsorCount || 0;
      c.textBaseline = 'alphabetic';
      const countdown = f.panel && f.panel.kind === 'TIMEOUT' ? Math.floor(Math.max(0, f.panel.length - f.panel.t) + 0.99) : null;
      // Takeovers go under the bar: the score stays readable through them. The corner box (legacy) keeps its own
      // stat play for every play, so only ICED takes its screen.
      if (f.takeover && showScoreboard !== false && (layout === 'bar' || f.takeover.kind === 'ICED')) drawTakeover(s, st, f.takeover);
      if (layout === 'bar') {
        if (showScoreboard) {
          drawBar(s, st, f);
          drawTags(s, st, f, 'bar');
          if (f.extension) drawExtension(s, st, f.extension, 'bar');
        }
        if (f.panel) drawPanel(s, st, f.panel, 'bar', countdown);
        if (f.panel && f.panel.kind === 'MATCH_WON') celebrate(s, st, f.panel, 'bar');
      } else {
        drawTags(s, st, f, 'box');
        if (f.extension && f.extension.kind !== 'PLAY') drawExtension(s, st, f.extension, 'box');
        if (f.panel) drawPanel(s, st, f.panel, 'box', countdown);
        if (f.panel && f.panel.kind === 'MATCH_WON') celebrate(s, st, f.panel, 'box');
      }
      c = null;
    }

    return { draw, barShift, texts: () => drawn.slice() };
  }

  const api = { Renderer, W, H, BAR_X, BAR_Y, BAR_W, BAR_H, EXT_W };
  root.RobinsBroadcast = api;
})(typeof window !== 'undefined' ? window : globalThis);
