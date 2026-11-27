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
  const PLAY_WORDS = { KILL: 'KILL!', ACE: 'ACE!', BLOCK: 'BLOCK!', DIG: 'DIG!' };
  const STAT_ROWS = [['kills', 'KILLS'], ['aces', 'ACES'], ['blocks', 'BLOCKS'], ['digs', 'DIGS']];
  const ONE = { KILL: 'KILL', ACE: 'ACE', BLOCK: 'BLOCK', DIG: 'DIG' };
  const FACES = { d: '"Bebas Neue", "Oswald", "Arial Narrow", sans-serif', c: '600 X "Barlow Condensed", "Arial Narrow", sans-serif' };

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const easeOut = x => { const c = clamp(x, 0, 1); return 1 - (1 - c) * (1 - c) * (1 - c); };
  const easeInOut = x => { const c = clamp(x, 0, 1); return c < 0.5 ? 4 * c * c * c : 1 - Math.pow(-2 * c + 2, 3) / 2; };

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
      // Logo plate (cream), rounded on the outside.
      c.save(); clip(logoL, y, LOGO_W, h);
      fillRR(home ? logoL : logoL - 8, y, LOGO_W + 8, h, 6, CREAM);
      c.restore();
      const img = teamLogo(st, side);
      if (img) fit(img, logoL + 5, y + 4, LOGO_W - 10, h - 8);
      else centered(M.name(s, side).slice(0, 1).toUpperCase(), 'd', 38, color, logoL + LOGO_W / 2, y, h, LOGO_W - 8);
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
        const who = m.number ? ('#' + m.number + ' ' + (m.name || '').toUpperCase() + ' SERVING').replace(/\s+/g, ' ').trim() : '';
        const col = teamColor(st, m.side);
        sideTag(layout, m.side, run, who, col, textOn(col), tag.t, tag.length, baseY);
      } else if (m.kind === 'TIED') {
        centerTag('TIED ' + m.count + '–' + m.count, CREAM, BLACK, tag.t, tag.length, baseY - 30);
      } else if (m.kind === 'CORRECTED') {
        centerTag('SCORE CORRECTED', GOLD, BLACK, tag.t, tag.length, baseY - 30);
      }
    }

    function sideTag(layout, side, word, sub, bg, ink, t, length, bottom) {
      font('d', 24); const wordW = measure(word);
      font('c', 15); const subW = sub ? measure(sub) + 14 : 0;
      const w = Math.min(wordW + subW + 28, 300), h = 28;
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
      if (sub) { font('c', 15); text(sub, left + 12 + wordW + 14, baseline(top, h), 'c', 15, ink, 'left', 210 / 255); }
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
        const label = m.kind === 'SERVER' ? 'SERVING' : m.kind === 'SUB' ? 'SUBSTITUTION' : m.kind === 'MILESTONE' ? 'MILESTONE' : (ONE[m.word] || m.word);
        font('c', 13); spacing(0.08, 13);
        text(label, x, extTop + 17, 'c', 13, ink, 'left', 210 / 255);
        spacing(0, 13);
        // The scorer page sends the name as it goes on the video (the surname: Del Sordo, Criado Marrero); never cut it again.
        const who = (String(m.name || '').trim() || M.name(s, m.side)).toUpperCase();
        const size = fitText(who, 30, extRight - (home ? 16 : 12) - x, 'd');
        text(who, x, extTop + BAR_H - 9, 'd', size, ink);
        c.restore();
      }
      const panelH = m.kind === 'SERVER' ? (m.detail ? 84 : 0) : m.kind === 'SUB' ? 124 : PANEL_H;
      if (panelOpen <= 0 || panelH <= 0) return;
      const left = home ? extLeft : extRight - PANEL_W, right = left + PANEL_W, bottom = extTop - 8, top = bottom - panelH;
      c.save();
      clip(left, bottom - panelH * panelOpen, PANEL_W, panelH * panelOpen);
      if (m.kind === 'PLAY') drawPlayPanel(left, top, PANEL_W, panelH, m, color, ink, t, st);
      else if (m.kind === 'MILESTONE') drawMilestonePanel(left, top, PANEL_W, panelH, m, color);
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

    function drawPlayPanel(x, y, w, h, m, color, ink, t, st) {
      c.fillStyle = grad(x, y, x + w, y + h, [color, darker(color, 0.7)]);
      rr(x, y, w, h, 10); c.fill();
      c.save();
      rr(x, y, w, h, 10); c.clip();
      const img = teamLogo(st, m.side);
      if (img) fit(img, x + w - h * 1.15, y - 10, h * 1.15 + 10, h + 20, false, 46 / 255);
      // Gold slash sweeping across (0.35–1.25 s).
      if (t >= 0.35 && t <= 1.25) {
        const q = easeInOut((t - 0.35) / 0.9);
        const sx = x - 0.5 * w + q * 1.8 * w, sw = 0.3 * w, skew = Math.tan(18 * Math.PI / 180) * h;
        c.globalAlpha = 240 / 255;
        c.fillStyle = GOLD;
        c.beginPath();
        c.moveTo(sx + skew / 2, y - 2); c.lineTo(sx + sw + skew / 2, y - 2);
        c.lineTo(sx + sw - skew / 2, y + h + 2); c.lineTo(sx - skew / 2, y + h + 2); c.closePath(); c.fill();
        c.globalAlpha = 1;
      }
      const word = PLAY_WORDS[m.word] || m.word + '!';
      // 0.35–1.4 s: the word, big and centred. Then it settles top left over the count.
      const settle = easeInOut((t - 1.4) / 0.45);
      const size = 132 + (80 - 132) * settle;
      const cx = x + w / 2 + ((x + 24) - (x + w / 2)) * settle;
      const inA = easeOut((t - 0.3) / 0.25);
      const s2 = Math.min(size, fitText(word, size, w - 40, 'd'));
      const wordY = y + h / 2 + (y + 74 - (y + h / 2)) * settle;
      c.save();
      c.translate(settle > 0.5 ? x + 24 : cx, wordY);
      c.transform(1, 0, -0.14, 1, 0, 0);
      font('d', s2);
      const mm = c.measureText(word);
      const a = mm.fontBoundingBoxAscent != null ? mm.fontBoundingBoxAscent : s2 * 0.9;
      const d = mm.fontBoundingBoxDescent != null ? mm.fontBoundingBoxDescent : s2 * 0.25;
      text(word, 0, (a - d) / 2, 'd', s2, ink, settle > 0.5 ? 'left' : 'center', inA);
      c.restore();
      if (settle > 0 && m.count > 0) {
        const line = D.ordinal(m.count) + ' ' + (ONE[m.word] || m.word) + ' THIS MATCH';
        text(line, x + 28, y + h - 30, 'c', 30, ink, 'left', settle * 0.92);
      }
      c.restore();
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

    // ---------------------------------------------------------------- lower-third panels (slot C)
    const PANEL_SIZES = { SET_WON: [960, 132], MATCH_WON: [960, 252], SET_STATS: [880, 300], SET_START: [660, 80],
      TIMEOUT: [700, 0], INTRO: [1060, 330], POTM: [840, 240], SPONSOR: [660, 200] };

    function drawPanel(s, st, shown, layout, countdown) {
      const m = shown.moment;
      const open = Math.min(easeOut(shown.t / 0.4), easeOut((shown.length - shown.t) / 0.45));
      if (open <= 0 || !PANEL_SIZES[m.kind]) return;
      const w = PANEL_SIZES[m.kind][0];
      const h = m.kind === 'TIMEOUT' ? (sponsorCountHint > 0 ? 200 : 144) : PANEL_SIZES[m.kind][1];
      const bottom = layout === 'bar' ? BAR_Y - 12 : H - 60;
      const x = CENTER_X - w / 2, y = bottom - h;
      c.save();
      clip(x - 4, bottom - (h + 8) * open, w + 8, (h + 8) * open + 4);
      if (m.kind === 'SET_WON') setWon(s, st, x, y, w, h, m);
      else if (m.kind === 'MATCH_WON') matchWon(s, st, x, y, w, h, m);
      else if (m.kind === 'SET_STATS') setStats(s, st, x, y, w, h, m);
      else if (m.kind === 'SET_START') setStart(x, y, w, h, m);
      else if (m.kind === 'TIMEOUT') timeout(s, st, x, y, w, h, m, countdown, shown.t);
      else if (m.kind === 'INTRO') intro(s, st, x, y, w, h);
      else if (m.kind === 'POTM') potm(s, st, x, y, w, h, m);
      else if (m.kind === 'SPONSOR') sponsorPanel(x, y, w, h, m);
      c.restore();
    }

    function plateLogo(st, side, s, color, px, py, pw, ph, inset, letterSize) {
      const img = teamLogo(st, side);
      if (img) fit(img, px + inset, py + inset, pw - inset * 2, ph - inset * 2);
      else centered(M.name(s, side).slice(0, 1), 'd', letterSize, color, px + pw / 2, py, ph, pw);
    }

    function setWon(s, st, x, y, w, h, m) {
      const side = m.side || 'home', color = teamColor(st, side), ink = textOn(color);
      c.fillStyle = hgrad(x, x + w, [darker(color, 0.65), color, darker(color, 0.8)]);
      rr(x, y, w, h, 12); c.fill();
      fillRect(x, y + h - 6, w, 6, GOLD);
      const pl = { x: x + 18, y: y + 14, w: 102, h: h - 34 };
      fillRR(pl.x, pl.y, pl.w, pl.h, 10, CREAM);
      plateLogo(st, side, s, color, pl.x, pl.y, pl.w, pl.h, 6, 70);
      const score = side === 'home' ? m.home + '–' + m.away : m.away + '–' + m.home;
      font('d', 84);
      const scoreW = measure(score);
      text(score, x + w - 26, baseline(y, h - 6) + 2, 'd', 84, GOLD, 'right');
      const title = M.name(s, side).toUpperCase() + ' TAKE SET ' + m.setNumber;
      const size = fitText(title, 64, x + w - 60 - scoreW - (pl.x + pl.w + 24), 'd');
      font('d', size);
      text(title, pl.x + pl.w + 24, baseline(y, h - 6) + 2, 'd', size, ink);
    }

    function matchWon(s, st, x, y, w, h, m) {
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
      fillRR(pl.x, pl.y, pl.w, pl.h, 10, CREAM);
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

    function intro(s, st, x, y, w, h) {
      darkPanel(x, y, w, h);
      fillRect(x, y, w, 6, RED);
      const div = { men: "MEN'S", women: "WOMEN'S", coed: 'CO-ED' }[st.division] || '';
      const head = [(st.eventTitle || '').toUpperCase(), div].filter(v => v.trim()).join('  ·  ') || "TODAY'S MATCH";
      centered(head, 'd', 32, GOLD, x + w / 2, y + 12, 40, w - 60);
      centered('VS', 'd', 64, CREAM, x + w / 2, y + 70, 150, 120);
      const ex = lastExtras || D.extrasFrom(null);
      ['home', 'away'].forEach(side => {
        const cx = side === 'home' ? x + w * 0.26 : x + w * 0.74;
        const color = teamColor(st, side);
        const px = cx - 70, py = y + 62, pw = 140, ph = 140;
        fillRR(px, py, pw, ph, 14, CREAM);
        fillRect(px, py + ph - 8, pw, 8, color);
        const img = teamLogo(st, side);
        if (img) fit(img, px + 10, py + 10, pw - 20, ph - 26);
        else centered(M.name(s, side).slice(0, 1), 'd', 90, color, cx, py, ph - 8, pw);
        centered(M.name(s, side).toUpperCase(), 'd', 44, CREAM, cx, py + ph + 4, 46, w * 0.42);
        const lu = ex.lineup[side] || [];
        if (lu.length) centered('STARTING  ' + lu.join('  ·  '), 'c', 19, 'rgba(250,246,237,.86)', cx, py + ph + 48, 26, w * 0.44);
      });
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
      if (layout === 'bar') {
        if (showScoreboard) {
          drawBar(s, st, f);
          drawTags(s, st, f, 'bar');
          if (f.extension) drawExtension(s, st, f.extension, 'bar');
        }
        if (f.panel) drawPanel(s, st, f.panel, 'bar', countdown);
      } else {
        drawTags(s, st, f, 'box');
        if (f.extension && f.extension.kind !== 'PLAY') drawExtension(s, st, f.extension, 'box');
        if (f.panel) drawPanel(s, st, f.panel, 'box', countdown);
      }
      c = null;
    }

    return { draw, barShift, texts: () => drawn.slice() };
  }

  const api = { Renderer, W, H, BAR_X, BAR_Y, BAR_W, BAR_H, EXT_W };
  root.RobinsBroadcast = api;
})(typeof window !== 'undefined' ? window : globalThis);
