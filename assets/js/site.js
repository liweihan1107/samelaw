(() => {
  'use strict';

  const UI = JSON.parse(document.getElementById('copy-ui').textContent);
  const REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const SVGNS = 'http://www.w3.org/2000/svg';
  const MASTER = [1280, 720];
  const ARM_COLOR = { base: '#FFFFFF', bump: 'var(--glacier-2)', dip: 'var(--rose-2)', null: 'var(--slate-2)' };
  let M = null;

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
  const fmt = (s, v) => String(s || '').replace(/\{(\w+)\}/g, (_, k) => (v[k] ?? ''));
  function el(tag, attrs = {}, ...kids) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === 'class') n.className = v;
      else if (k === 'text') n.textContent = v;
      else if (k === 'html') n.innerHTML = v;
      else if (k === 'style' && typeof v === 'object') {
        for (const [p, x] of Object.entries(v)) if (p.startsWith('--')) n.style.setProperty(p, x); else n.style[p] = x;
      } else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v === true ? '' : v);
    }
    for (const c of kids.flat()) if (c != null) n.append(c.nodeType ? c : document.createTextNode(c));
    return n;
  }
  function sv(tag, attrs = {}) {
    const n = document.createElementNS(SVGNS, tag);
    for (const [k, v] of Object.entries(attrs)) if (v != null) n.setAttribute(k, v);
    return n;
  }
  const clip = (id) => (M && id ? M.clips[id] : null);
  const modelOf = (id) => M.models.find((m) => m.id === id);
  const pct = (x) => `${Math.round(100 * x)}`;
  const signedPct = (x) => `${x > 0 ? '+' : x < 0 ? '−' : ''}${Math.abs(100 * x).toFixed(1)}`;
  const f2 = (x) => (x == null ? '' : Number(x).toFixed(2));
  const pts = (rows) => rows.map((r) => `${(r[1] * MASTER[0]).toFixed(1)},${(r[2] * MASTER[1]).toFixed(1)}`).join(' ');
  function at(rows, t) {
    if (!rows || !rows.length || t < rows[0][0] - 0.02) return null;
    let lo = 0, hi = rows.length - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (rows[mid][0] <= t) lo = mid; else hi = mid - 1; }
    return rows[lo];
  }
  function count(obj) { return Object.values(obj || {}).reduce((a, b) => a + (+b || 0), 0); }

  const SHAPE = {
    'o': 'M6 1.2a4.8 4.8 0 1 0 .001 0Z',
    's': 'M1.9 1.9H10.1V10.1H1.9Z',
    'D': 'M6 .6L11.4 6L6 11.4L.6 6Z',
    '^': 'M6 .9L11.3 10.6H.7Z',
    'v': 'M6 11.1L11.3 1.4H.7Z',
    '<': 'M.9 6L10.6 .7V11.3Z',
    '>': 'M11.1 6L1.4 .7V11.3Z',
    'p': 'M6 .8L11.2 4.6L9.2 10.8H2.8L.8 4.6Z',
    'h': 'M3.2 1.1H8.8L11.6 6L8.8 10.9H3.2L.4 6Z',
  };
  function marker(m) {
    const s = sv('svg', { class: 'mk-svg', viewBox: '0 0 12 12', 'aria-hidden': 'true' });
    s.append(sv('path', { d: SHAPE[m.marker] || SHAPE.o, fill: m.closed ? '#fff' : m.fill, stroke: m.color,
      'stroke-width': m.closed ? 1.5 : 1.1, 'stroke-linejoin': 'round' }));
    return s;
  }
  function sourceText(c) {
    if (!c) return '';
    if (c.source === 'rendered') return UI.rendered;
    if (c.source === 'rendered, extended') return UI.rendered_extended;
    return UI.composed;
  }
  const outcomeText = (o) => (o ? (UI.outcome[o] || o) : '');

  let BLOB_OK = true;
  const BLOBS = new Map();
  function blobURL(src) {
    if (!BLOB_OK) return Promise.resolve(src);
    if (!BLOBS.has(src)) {
      BLOBS.set(src, fetch(src).then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.blob(); })
        .then((b) => URL.createObjectURL(b)).catch(() => src));
    }
    return BLOBS.get(src);
  }

  class SyncGroup {
    constructor({ mode = 'absolute', ref = 5, hold = 0.9 } = {}) {
      this.mode = mode; this.ref = ref; this.hold = hold;
      this.videos = new Set(); this.listeners = new Set();
      this.t = 0; this.rate = 1; this.playing = false;
      this._raf = 0; this._last = null;
      this._tick = this._tick.bind(this);
    }
    add(v) {
      if (this.videos.has(v)) return;
      this.videos.add(v);
      v.muted = true; v.defaultMuted = true; v.playsInline = true; v.loop = false;
      if (!v._syncHooked) {
        v._syncHooked = true;
        const hard = () => { for (const g of v._groups || []) g.syncOne(v, true); };
        v.addEventListener('loadedmetadata', hard);
        v.addEventListener('loadeddata', hard);

        v.addEventListener('seeked', () => {
          const now = performance.now();
          if (v._seekAt) v._lat = 0.6 * (v._lat || 0.08) + 0.4 * Math.min(1.5, (now - v._seekAt) / 1000);
          v._seekedAt = now;

          for (const g of v._groups || []) if (!g.playing) { g.syncOne(v, true); g.emit(); }
        });
      }
      (v._groups = v._groups || new Set()).add(this);
      this.syncOne(v, true);
    }
    remove(v) { this.videos.delete(v); if (v._groups) v._groups.delete(this); if (!v.paused) v.pause(); }
    length() {
      if (this.mode === 'normalized') return this.ref;
      let L = 0;
      for (const v of this.videos) if (isFinite(v.duration) && v.duration > L) L = v.duration;
      return L || this.ref;
    }
    target(v) {
      const D = v.duration;
      if (!isFinite(D)) return 0;
      const L = this.length();
      const x = this.mode === 'normalized' ? (Math.min(this.t, L) / L) * D : this.t;
      return clamp(x, 0, Math.max(0, D - 0.04));
    }
    play() { if (!this.playing) { this.playing = true; this._last = null; } this._kick(); }
    pause() { this.playing = false; for (const v of this.videos) if (!v.paused) v.pause(); this.emit(); }
    seek(t) { this.t = Math.max(0, t); for (const v of this.videos) this.syncOne(v, true); this.emit(); this._kick(); }
    _kick() { if (!this._raf) this._raf = requestAnimationFrame(this._tick); }
    _tick(now) {
      this._raf = 0;
      if (this._last == null) this._last = now;
      const dt = Math.min(0.1, (now - this._last) / 1000);
      this._last = now;
      if (this.playing) {
        const L = this.length();
        this.t += dt * this.rate;
        if (this.t > L + this.hold) { this.t = 0; for (const v of this.videos) this.syncOne(v, true); }
        for (const v of this.videos) this.syncOne(v, false);
      }
      this.emit();
      if (this.playing) this._raf = requestAnimationFrame(this._tick);
    }
    syncOne(v, hard) {
      if (v.readyState < 1 || !isFinite(v.duration)) return;
      const D = v.duration, L = this.length();
      const tgt = this.target(v);
      const ended = this.mode === 'normalized' ? this.t >= L : this.t >= D - 0.04;
      if (!this.playing || ended) {
        if (!v.paused) v.pause();
        if (!v.seeking && Math.abs(v.currentTime - tgt) > 0.02) v.currentTime = tgt;
        return;
      }
      const base = this.rate * (this.mode === 'normalized' ? D / L : 1);
      if (v.seeking) return;
      const diff = v.currentTime - tgt;
      const now = performance.now();
      const calm = now - (v._seekedAt || 0) > 900;
      if (hard || (Math.abs(diff) > 0.45 && calm)) {
        const lead = hard ? 0 : Math.min(0.5, (v._lat || 0.08) * base);
        v._seekAt = now;
        v.currentTime = Math.min(tgt + lead, D - 0.04);
        v.playbackRate = base;
      } else {
        v.playbackRate = clamp(base * (1 - diff * 1.1), base * 0.6, base * 1.4);
      }
      if (v.paused && v.readyState >= 2 && !v._pending) {
        v._pending = true;
        const p = v.play();
        const done = () => { v._pending = false; };
        if (p && p.then) p.then(done, done); else done();
      }
    }
    on(fn) { this.listeners.add(fn); }
    emit() { const L = this.length(); for (const fn of this.listeners) fn(this.t, L); }
  }

  const PIECE = 5;
  function trail(parent, rows, { cls, colour, dash = null, a0 = 0.32, a1 = 1, k = 1, tmax = Infinity }) {
    const n = rows.length;
    const xy = rows.map((r) => [r[1] * MASTER[0], r[2] * MASTER[1]]);
    const cum = new Float64Array(n);
    for (let i = 1; i < n; i++) cum[i] = cum[i - 1] + Math.hypot(xy[i][0] - xy[i - 1][0], xy[i][1] - xy[i - 1][1]);

    let rest = n - 1;
    while (rest > 0 && Math.hypot(xy[rest - 1][0] - xy[n - 1][0], xy[rest - 1][1] - xy[n - 1][1]) < 6) rest--;
    const t0 = rows[0][0], span = Math.max(1e-6, Math.min(rows[rest][0], tmax || Infinity) - t0);
    const pieces = [];
    for (let i0 = 0; i0 < n - 1; i0 += PIECE) {
      const i1 = Math.min(n - 1, i0 + PIECE);
      const f = ((rows[i0][0] + rows[i1][0]) / 2 - t0) / span;
      const p = sv(dash ? 'path' : 'polyline', { class: `trail ${cls}` });
      p.style.stroke = colour;
      p.style.strokeOpacity = (a0 + (a1 - a0) * clamp(f, 0, 1)).toFixed(3);
      parent.append(p);
      pieces.push({ el: p, i0, i1, j: -1 });
    }

    const pat = dash && k > 0 ? [dash[0] / k, dash[1] / k] : null;
    return { rows, xy, cum, n, pieces, dash, pat, m: -1 };
  }

  function dashData(tr, i0, j) {
    const { xy, cum, pat } = tr;
    if (!pat || j <= i0) return '';
    const [on, off] = pat, P = on + off, s0 = cum[i0], s1 = cum[j];
    let seg = i0, d = '';
    const at = (s) => {
      while (seg < j - 1 && cum[seg + 1] < s) seg++;
      const L = cum[seg + 1] - cum[seg] || 1e-9, u = clamp((s - cum[seg]) / L, 0, 1);
      return `${(xy[seg][0] + u * (xy[seg + 1][0] - xy[seg][0])).toFixed(1)} ${(xy[seg][1] + u * (xy[seg + 1][1] - xy[seg][1])).toFixed(1)}`;
    };
    for (let q = Math.floor(s0 / P); q * P < s1; q++) {
      const a = Math.max(s0, q * P), b = Math.min(s1, q * P + on);
      if (b <= a) continue;
      d += `M${at(a)}`;
      for (let v = seg + 1; v <= j && cum[v] < b; v++) d += `L${xy[v][0].toFixed(1)} ${xy[v][1].toFixed(1)}`;
      d += `L${at(b)}`;
    }
    return d;
  }

  function drawTrail(tr, m) {
    if (m === tr.m) return;
    tr.m = m;
    for (const p of tr.pieces) {
      const j = clamp(m - 1, p.i0, p.i1);
      if (j === p.j) continue;
      p.j = j;
      if (j <= p.i0) { p.el.setAttribute(tr.dash ? 'd' : 'points', ''); continue; }
      if (tr.dash) p.el.setAttribute('d', dashData(tr, p.i0, j));
      else p.el.setAttribute('points', tr.xy.slice(p.i0, j + 1).map((q) => `${q[0].toFixed(1)},${q[1].toFixed(1)}`).join(' '));
    }
  }
  function countUpTo(rows, t) {
    let lo = 0, hi = rows.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (rows[mid][0] <= t + 1e-3) lo = mid + 1; else hi = mid; }
    return lo;
  }

  class Stage {
    constructor(root, { arms, group, overlay = {}, leftLabel, leftSource, modelLabel, onCaption }) {
      this.root = root; this.arms = arms; this.group = group; this.overlay = overlay;
      this.onCaption = onCaption || (() => ({}));
      this.active = arms[0].id; this.entry = null; this.model = null; this.loaded = false; this.paths = true;
      this.leftLabel = leftLabel || UI.physics;
      this.leftSource = leftSource || null;
      this.modelLabel = modelLabel || UI.generated;
      root.textContent = '';
      this.cells = {};
      for (const role of ['physics', 'model']) {
        const frame = el('div', { class: 'frame' });
        const layers = {};
        for (const a of arms) {
          const layer = el('div', { class: 'layer' + (a.id === this.active ? ' on' : ''), 'data-arm': a.id });
          frame.append(layer);
          layers[a.id] = layer;
        }
        const ov = sv('svg', { class: 'overlay', viewBox: `0 0 ${MASTER[0]} ${MASTER[1]}`, preserveAspectRatio: 'none', 'aria-hidden': 'true' });
        const g = { rel: sv('g'), ref: sv('g'), lab: sv('g'), dyn: sv('g'), tr: sv('g') };
        ov.append(g.rel, g.ref, g.lab, g.tr, g.dyn);
        frame.append(ov);
        const label = el('span', { class: 'cell-label' });
        const source = el('span', { class: 'cell-source' });
        const facts = el('span', { class: 'cell-facts' });
        const counts = el('span', { class: 'cell-counts' });
        const fig = el('figure', { class: 'cell', 'data-cell': role }, frame, el('figcaption', {}, label, source, facts, counts));
        root.append(fig);
        this.cells[role] = { fig, frame, layers, videos: {}, ov, g, label, source, facts, counts, k: 0 };
      }
      group.on(() => this.update());

      if (window.ResizeObserver) {
        this._ro = new ResizeObserver(() => {
          const k = this.scale();
          if (Math.abs(k - (this._k || 0)) > 0.02 * k) this.refresh();
        });
        this._ro.observe(this.cells.model.frame);
      }
    }

    scale() { const w = this.cells.model.ov.getBoundingClientRect().width; return w > 0 ? w / MASTER[0] : 0; }

    clipFor(role, armId) {
      if (!this.entry) return null;
      return role === 'physics' ? (this.entry.physics || {})[armId] : (this.entry.clips || {})[armId];
    }
    available(armId) { return !!this.clipFor('model', armId); }

    setClip(role, armId, cid) {
      const c = clip(cid);
      const cell = this.cells[role];
      const layer = cell.layers[armId];
      const old = cell.videos[armId];

      const release = (x) => { this.group.remove(x); x.remove(); x.removeAttribute('src'); try { x.load(); } catch (e) {   } };
      if (!c) {
        if (old) { release(old); delete cell.videos[armId]; }
        layer.replaceChildren(el('div', { class: 'loading', text: UI.not_run }));
        return;
      }
      if (old && old.dataset.cid === cid) return;
      const v = el('video', { muted: true, playsinline: true, preload: this.loaded ? 'auto' : 'none', poster: c.poster, 'data-cid': cid,
        'aria-label': role === 'physics' ? this.leftLabel : (this.model ? this.model.name : this.modelLabel) });
      v.muted = true;
      cell.videos[armId] = v;
      if (old) {
        v.style.opacity = '0';
        layer.querySelectorAll('.loading').forEach((n) => n.remove());
        layer.append(v);
        let finished = false;
        const done = () => {
          if (finished) return;
          finished = true;
          v.style.opacity = '';
          release(old);
        };
        v.addEventListener('loadeddata', () => {
          this.group.syncOne(v, true);
          if (v.seeking) v.addEventListener('seeked', done, { once: true }); else done();
        }, { once: true });
        setTimeout(done, 2500);
      } else {
        layer.replaceChildren(v);
      }
      v._load = () => blobURL(c.src).then((u) => {
        if (cell.videos[armId] !== v || !this.loaded) return;
        v.preload = 'auto';
        if (u.startsWith('blob:')) {
          v.addEventListener('error', () => { if (v.src.startsWith('blob:')) { BLOB_OK = false; v.src = c.src; } }, { once: true });
        }
        v.src = u;
      });
      v._needs = true;
      if (this.loaded) { v._needs = false; v._load(); }
      this.group.add(v);
    }

    load() {
      if (this.loaded) return;
      this.loaded = true;

      for (const role of ['physics', 'model']) {
        const vs = this.cells[role].videos;
        const order = [this.active, ...Object.keys(vs).filter((k) => k !== this.active)];
        for (const k of order) { const v = vs[k]; if (v && v._needs) { v._needs = false; v._load(); } }
      }
    }

    unload() {
      if (!this.loaded) return;
      this.loaded = false;
      for (const role of ['physics', 'model']) {
        for (const v of Object.values(this.cells[role].videos)) {
          if (!v || v._needs) continue;
          v._needs = true;
          v.pause();
          v.removeAttribute('src');
          v.preload = 'none';
          try { v.load(); } catch (e) {   }
        }
      }
    }

    setEntry(entry) {
      this.entry = entry;
      this.model = entry ? modelOf(entry.id) : null;
      for (const a of this.arms) {
        this.setClip('physics', a.id, this.clipFor('physics', a.id));
        this.setClip('model', a.id, this.clipFor('model', a.id));
      }
      this.refresh();
    }

    setArm(id) {
      this.active = id;
      for (const role of ['physics', 'model']) {
        for (const [aid, layer] of Object.entries(this.cells[role].layers)) layer.classList.toggle('on', aid === id);
      }
      this.refresh();
    }

    setPaths(on) { this.paths = on; this.root.classList.toggle('paths-off', !on); this.refresh(); }

    refresh() {
      const a = this.active;
      const pc = clip(this.clipFor('physics', a)), mc = clip(this.clipFor('model', a));
      const ov = this.overlay;
      const k = this.scale();
      this._k = k;
      for (const role of ['physics', 'model']) {
        const cell = this.cells[role];
        for (const g of Object.values(cell.g)) g.replaceChildren();
        cell.traces = [];
        cell.ghosts = [];
        cell.contacts = [];
        if (ov.release_line && pc && pc.release) {
          const y = pc.release.v * MASTER[1];
          cell.g.rel.append(sv('line', { class: 'ov-release', x1: pc.release.u0 * MASTER[0], x2: pc.release.u1 * MASTER[0], y1: y, y2: y }));
          const lab = sv('text', { class: 'ov-release-label', x: pc.release.u0 * MASTER[0] + 14, y: y - 10 });
          lab.textContent = UI.release;
          cell.g.rel.append(lab);
        }

        const own = role === 'physics' ? pc && pc.path : mc && mc.track;
        if (own && own.length > 1 && (ov.path || ov.layers)) {
          const kind = role === 'model' ? 'gen' : pc.kind === 'source' ? 'src' : 'phys';
          const spec = {
            gen: { cls: 'tr-gen', colour: this.model ? this.model.fill : '#fff' },
            phys: { cls: 'tr-phys', colour: '#fff', dash: [7, 5] },
            src: { cls: 'tr-src', colour: 'var(--peach-2)', dash: [9, 5] },
          }[kind];
          cell.traces.push(trail(cell.g.tr, own, { ...spec, k, tmax: (role === 'model' ? mc : pc).duration }));
        }

        if (role === 'model' && ov.path && pc && pc.path && pc.path.length > 1 && pc.kind !== 'source') {
          const ref = trail(cell.g.ref, pc.path, { cls: 'tr-ref', colour: '#fff', dash: [5, 5], a0: 0.18, a1: 0.7, k, tmax: pc.duration });
          drawTrail(ref, ref.n);
        }

        if (role === 'model' && ov.layers && this.entry && this.entry.layers) {
          for (const name of ov.layers) {
            const rows = this.entry.layers[name];
            if (rows) cell.g.ref.append(sv('polyline', { class: `ov-layer ${name}`, points: pts(rows) }));
          }
        }

        if (ov.ghosts && this.entry) {
          for (const other of this.arms) {
            if (other.id === a) continue;
            const oc = clip(this.clipFor(role, other.id));
            const rows = oc && (role === 'physics' ? oc.path : oc.track);
            if (!rows) continue;
            const ring = sv('circle', { class: 'ov-ghost', r: 17, style: `stroke:${ARM_COLOR[other.id] || '#fff'}`, cx: -99, cy: -99 });
            cell.g.dyn.append(ring);
            cell.ghosts.push({ ring, rows });
          }
        }

        if (ov.contacts && this.entry && this.entry.contacts && this.entry.contacts[a]) {
          const cs = this.entry.contacts[a];
          for (const l of cs.labels || []) {
            const t = sv('text', { class: 'ov-deflector-num', x: l.u * MASTER[0], y: l.v * MASTER[1] });
            t.textContent = String(l.k);
            cell.g.lab.append(t);
          }
          const order = cs.physical_order || [];
          const list = role === 'physics' ? cs.physics : cs.generated;
          const colour = role === 'physics' ? 'var(--ink)' : (this.model ? this.model.color : 'var(--ink)');
          for (const c of list || []) {
            const k = role === 'physics' ? c.k : order.indexOf(c.paddle) + 1;
            const grp = sv('g', { visibility: 'hidden' });
            grp.append(sv('circle', { class: 'ov-contact', cx: c.u * MASTER[0], cy: c.v * MASTER[1], r: 16, style: `stroke:${colour}` }));
            const num = sv('text', { class: 'ov-contact-num', x: c.u * MASTER[0], y: c.v * MASTER[1], style: `fill:${colour}` });
            num.textContent = k > 0 ? String(k) : '?';
            grp.append(num);
            cell.g.dyn.append(grp);
            cell.contacts.push({ grp, t: c.t });
          }
        }
      }
      this.caption();
      this.update();
    }

    caption() {
      const a = this.active;
      const pc = clip(this.clipFor('physics', a));
      const facts = this.onCaption(this.arms.find((x) => x.id === a), this.entry, this) || {};
      const P = this.cells.physics, G = this.cells.model;
      P.label.textContent = this.leftLabel;
      P.source.textContent = this.leftSource || (pc ? sourceText(pc) : '');
      P.facts.textContent = facts.physics || '';
      P.counts.textContent = facts.physicsRate || '';
      G.label.replaceChildren(...(this.model ? [marker(this.model), this.model.name] : [this.modelLabel]));
      const e = this.entry;
      G.source.textContent = e && e.seed != null ? `${e.closed ? UI.generation : UI.seed} ${e.seed}` : '';
      G.facts.textContent = this.clipFor('model', a) ? (facts.model || '') : UI.not_run;
      G.counts.textContent = facts.counts || '';
    }

    update() {
      for (const role of ['physics', 'model']) {
        const cell = this.cells[role];
        const v = cell.videos[this.active];
        const now = v && isFinite(v.currentTime) ? v.currentTime : 0;
        if (this.paths) {
          for (const tr of cell.traces || []) drawTrail(tr, countUpTo(tr.rows, now));
          for (const gh of cell.ghosts || []) {
            const r = at(gh.rows, now);
            if (r === gh._r) continue;
            gh._r = r;
            gh.ring.setAttribute('cx', r ? (r[1] * MASTER[0]).toFixed(1) : -99);
            gh.ring.setAttribute('cy', r ? (r[2] * MASTER[1]).toFixed(1) : -99);
          }
        }
        for (const c of cell.contacts || []) {
          const on = now + 1e-3 >= c.t;
          if (on === c._on) continue;
          c._on = on;
          c.grp.setAttribute('visibility', on ? 'visible' : 'hidden');
        }
      }
    }
  }

  function wireSwitch(root, onChange) {
    const btns = $$('button[role="radio"]', root);
    const set = (val, fire = true) => {
      for (const b of btns) {
        const on = b.dataset.value === val;
        b.setAttribute('aria-checked', on ? 'true' : 'false');
        b.tabIndex = on ? 0 : -1;
      }
      if (fire) onChange(val);
    };
    btns.forEach((b, i) => {
      b.addEventListener('click', () => { if (!b.disabled) set(b.dataset.value); });
      b.addEventListener('keydown', (e) => {
        const d = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
        if (!d) return;
        e.preventDefault();
        for (let j = 1; j <= btns.length; j++) {
          const nb = btns[(i + d * j + btns.length * 2) % btns.length];
          if (!nb.disabled) { nb.focus(); set(nb.dataset.value); break; }
        }
      });
    });

    const enable = (ok) => {
      for (const b of btns) {
        b.disabled = !ok(b.dataset.value);
        b.setAttribute('aria-disabled', b.disabled ? 'true' : 'false');
        if (b.disabled) { b.dataset.note = UI.not_run_short || UI.not_run; b.title = UI.not_run; }
        else { delete b.dataset.note; b.removeAttribute('title'); }
      }
    };
    const current = () => (btns.find((b) => b.getAttribute('aria-checked') === 'true') || btns[0]).dataset.value;
    return { set, enable, current, values: btns.map((b) => b.dataset.value) };
  }

  function modelPicker(root, entries, onPick) {
    root.replaceChildren();
    const order = M.models.map((m) => m.id);
    const list = entries.slice().sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
    const chips = [];
    let lastClosed = null;
    for (const e of list) {
      const m = modelOf(e.id);
      if (lastClosed === false && m.closed) root.append(el('span', { class: 'chip-sep', 'aria-hidden': 'true' }));
      lastClosed = m.closed;
      const b = el('button', { type: 'button', class: 'chip', 'aria-pressed': 'false', style: { '--chip-tint': m.tint }, onclick: () => pick(e.id) }, marker(m), m.name);
      b.dataset.id = e.id;
      chips.push(b);
      root.append(b);
    }
    function pick(id, fire = true) {
      for (const c of chips) c.setAttribute('aria-pressed', c.dataset.id === id ? 'true' : 'false');
      if (fire) onPick(list.find((x) => x.id === id));
    }
    return { pick, has: (id) => list.some((x) => x.id === id) };
  }

  const ICON = {
    play: '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M3.2 1.8l7 4.2-7 4.2z" fill="currentColor"/></svg>',
    pause: '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M3 2h2.2v8H3zM6.8 2H9v8H6.8z" fill="currentColor"/></svg>',
  };

  function scrubber(ctl, { normalized = false } = {}) {
    const { group, stage } = ctl;
    const play = el('button', { type: 'button', class: 'scrub-play' });
    const fill = el('span', { class: 'scrub-fill' });
    const knob = el('span', { class: 'scrub-knob' });
    const bar = el('div', { class: 'scrub-bar', role: 'slider', tabindex: '0', 'aria-label': UI.position, 'aria-valuemin': '0' },
      el('span', { class: 'scrub-track' }, fill), knob);
    const time = el('span', { class: 'scrub-time', 'aria-hidden': 'true' });
    const paths = el('button', { type: 'button', class: 'tbtn', 'aria-pressed': stage.paths ? 'true' : 'false', text: UI.paths });
    const slow = el('button', { type: 'button', class: 'tbtn', 'aria-pressed': 'false', text: UI.slow });
    const root = el('div', { class: 'scrub', role: 'group', 'aria-label': UI.playback }, play, bar, time, el('span', { class: 'scrub-opts' }, paths, slow));
    stage.root.append(root);
    const setPlay = () => {
      play.innerHTML = ctl.userPaused ? ICON.play : ICON.pause;
      play.setAttribute('aria-label', ctl.userPaused ? UI.play : UI.pause);
      play.setAttribute('aria-pressed', ctl.userPaused ? 'false' : 'true');
    };
    play.addEventListener('click', () => { ctl.userPaused = !ctl.userPaused; setPlay(); ctl.apply(); });
    paths.addEventListener('click', () => {
      const on = paths.getAttribute('aria-pressed') !== 'true';
      paths.setAttribute('aria-pressed', on ? 'true' : 'false');
      stage.setPaths(on);
    });
    slow.addEventListener('click', () => {
      const on = slow.getAttribute('aria-pressed') !== 'true';
      slow.setAttribute('aria-pressed', on ? 'true' : 'false');
      group.rate = on ? 0.5 : 1;
      for (const v of group.videos) group.syncOne(v, true);
    });

    let shown = -1;
    group.on((t, L) => {
      const f = clamp(t / L, 0, 1);
      if (Math.abs(f - shown) < 0.001) return;
      shown = f;
      fill.style.transform = `scaleX(${f.toFixed(4)})`;
      knob.style.left = `${(100 * f).toFixed(2)}%`;
      const tt = Math.min(t, L);
      bar.setAttribute('aria-valuemax', normalized ? '1' : L.toFixed(2));
      bar.setAttribute('aria-valuenow', normalized ? f.toFixed(2) : tt.toFixed(2));
      time.textContent = normalized ? fmt(UI.time_norm, { f: f.toFixed(2) }) : fmt(UI.time_abs, { t: tt.toFixed(1) });
      bar.setAttribute('aria-valuetext', time.textContent);
    });
    const pause = () => { if (!ctl.userPaused) { ctl.userPaused = true; setPlay(); ctl.apply(); } };
    const seekX = (x) => {
      const r = bar.getBoundingClientRect();
      group.seek(clamp((x - r.left) / Math.max(1, r.width), 0, 1) * group.length());
    };
    let dragging = null;
    bar.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      dragging = e.pointerId;
      try { bar.setPointerCapture(e.pointerId); } catch (err) {   }
      bar.classList.add('dragging');
      stage.load();
      pause();
      seekX(e.clientX);
    });
    bar.addEventListener('pointermove', (e) => { if (dragging === e.pointerId) seekX(e.clientX); });
    const end = (e) => {
      if (dragging !== e.pointerId) return;
      dragging = null;
      bar.classList.remove('dragging');
      try { bar.releasePointerCapture(e.pointerId); } catch (err) {   }
    };
    bar.addEventListener('pointerup', end);
    bar.addEventListener('pointercancel', end);
    bar.addEventListener('keydown', (e) => {
      const L = group.length(), step = (e.shiftKey ? 0.1 : 0.02) * L, base = Math.min(group.t, L);
      const to = { ArrowRight: base + step, ArrowUp: base + step, ArrowLeft: base - step, ArrowDown: base - step, Home: 0, End: L }[e.key];
      if (to == null) return;
      e.preventDefault();
      pause();
      group.seek(clamp(to, 0, L));
    });
    setPlay();
    return { setPlay, paths, root };
  }

  const controllers = [];
  const nearObs = new IntersectionObserver((es) => {
    for (const e of es) if (e.isIntersecting) { const c = e.target._ctl; if (c) c.stage.load(); }
  }, { rootMargin: '700px 0px' });
  const viewObs = new IntersectionObserver((es) => {
    for (const e of es) {
      const c = e.target._ctl;
      if (!c) continue;
      c.inView = e.isIntersecting && e.intersectionRatio >= 0.2;
      c.apply();
    }
  }, { threshold: [0, 0.2, 0.5] });
  const farObs = new IntersectionObserver((es) => {
    for (const e of es) if (!e.isIntersecting) { const c = e.target._ctl; if (c) { c.group.pause(); c.stage.unload(); } }
  }, { rootMargin: '2200px 0px' });
  document.addEventListener('visibilitychange', () => { for (const c of controllers) c.apply(); });
  function observe(root, ctl) { root._ctl = ctl; ctl.root = root; controllers.push(ctl); nearObs.observe(root); viewObs.observe(root); farObs.observe(root); }

  const armFact = (e, a) => (e && e.facts && e.facts.arms && e.facts.arms[a]) || null;
  const armCounts = (e, a) => (e && e.facts && e.facts.counts && e.facts.counts[a]) || null;
  const unread = (f) => f && f.trackable === false;

  const CAPTION = {
    barrier(arm, e, panel) {
      const pf = (panel.physics_facts || {})[arm.id] || {};
      const out = { physics: pf.passes ? UI.barrier.physics_pass : UI.barrier.physics_turn };
      const f = armFact(e, arm.id);
      if (f) {
        out.model = unread(f) ? UI.unread : outcomeText(f.outcome);
        if (f.outcome === 'passed' && f.crest_over_foot_speed != null) out.model += `; ${fmt(UI.barrier.crest, { r: f2(f.crest_over_foot_speed) })}`;
      }
      const hi = armCounts(e, 'high'), lo = armCounts(e, 'low');
      if (hi && lo) out.counts = fmt(UI.barrier.counts, { x: hi.passed || 0, n: count(hi), y: lo.passed || 0, m: count(lo) });
      return out;
    },
    ramp(arm, e, panel) {
      const pf = (panel.physics_facts || {})[arm.id] || {};
      const out = { physics: pf.height_ratio != null ? fmt(UI.ramp.physics, { r: f2(pf.height_ratio) }) : '' };
      const f = armFact(e, arm.id);
      if (f) {
        if (unread(f)) out.model = UI.unread;
        else {
          const parts = [];
          if (f.height_ratio != null) parts.push(fmt(UI.ramp.model, { r: f2(f.height_ratio) }));
          if (f.outcome) parts.push(outcomeText(f.outcome));
          out.model = parts.join('; ');
        }
      }
      return out;
    },
    locality(arm, e) {
      const f = armFact(e, arm.id) || {};
      const out = {};
      if (arm.id === 'base') {
        out.physics = UI.locality.physics_base;
        out.model = e && e.closed ? (UI.locality.model_base_closed || UI.locality.model_base) : UI.locality.model_base;
      }
      else if (arm.id === 'null') { out.physics = UI.locality.physics_null; out.model = UI.locality.model_null; }
      else {
        if (f.physics_dv != null) out.physics = fmt(UI.locality.physics_edit, { p: signedPct(f.physics_dv) });
        out.model = f.dv_vs_base != null ? fmt(UI.locality.model_edit, { p: signedPct(f.dv_vs_base) }) : outcomeText(f.outcome);
      }
      const s = e && e.series;
      if (s && s.t_in_model != null && s.t_in_physics != null) out.counts = fmt(UI.locality.reach, { t: f2(s.t_in_model), tp: f2(s.t_in_physics) });
      return out;
    },
    composition(arm, e) {
      const f = armFact(e, arm.id) || {};
      const order = f.physical_order || [];
      const num = (seq) => (seq || []).map((p) => order.indexOf(p) + 1).filter((k) => k > 0).join(' → ');
      const out = { physics: fmt(UI.composition.physics, { order: order.map((_, i) => i + 1).join(' → ') }) };
      const seq = num(f.sequence);
      out.model = seq ? `${fmt(UI.composition.model, { order: seq })}, ${f.exact ? UI.composition.exact : UI.composition.not_exact}` : UI.composition.none;
      const s = e && e.facts && e.facts.order_share;
      if (s) out.counts = fmt(UI.composition.counts, { x: s.exact, n: s.n });
      return out;
    },
    prompt(arm, e) {
      const f = armFact(e, arm.id);
      const out = { physics: UI.prompt.physics };
      if (f) out.model = unread(f) ? UI.unread : outcomeText(f.outcome);
      const n = armCounts(e, 'named'), ne = armCounts(e, 'neutral');
      if (n && ne) out.counts = fmt(UI.prompt.counts, { a: n.tray || 0, n: count(n), b: ne.tray || 0, m: count(ne) });
      return out;
    },
    length(arm, e) {
      const out = {};
      const pf = ((e && e.physics_facts) || {})[arm.id];
      if (pf && pf.t_end_stop != null) out.physics = fmt(UI.length.physics, { t: f2(pf.t_end_stop), p: pct(pf.t_end_stop / arm.duration) });
      const f = armFact(e, arm.id);
      if (f) out.model = f.arrival_fraction != null ? fmt(UI.length.model, { p: pct(f.arrival_fraction) }) : UI.length.not_reached;
      const rate = (arm.duration / 5).toFixed(1).replace(/\.0$/, '');
      if (rate !== '1') { out.physicsRate = fmt(UI.rate, { rate }); out.counts = fmt(UI.rate, { rate }); }
      return out;
    },
    photo(arm, e) {
      const f = armFact(e, arm.id) || {};
      const nominal = e && e.scenes && e.scenes.control && !String(e.scenes.control).endsWith('_twin') && arm.id === 'control';
      const out = { physics: nominal ? UI.photo.physics_nominal : UI.photo.physics };
      const parts = [];
      if (f.H_abs_f3 != null) parts.push(fmt(UI.photo.gain, { x: f2(f.H_abs_f3) }));
      if (f.first_contact_residual_deg != null) parts.push(fmt(UI.photo.residual, { x: Math.round(f.first_contact_residual_deg) }));
      if (f.outcome && UI.outcome[f.outcome]) parts.push(outcomeText(f.outcome));
      out.model = unread(f) ? UI.unread : parts.join('; ');
      return out;
    },
    regeneration(arm, e) {
      const f = armFact(e, arm.id) || {};
      const out = {};
      if (f.kappa_2d != null && f.lambda_2d != null) {
        out.model = f.outcome === 'follows source' ? outcomeText(f.outcome)
          : fmt(UI.regen.model, { k: f2(f.kappa_2d), l: f2(f.lambda_2d) });
      }
      const c = armCounts(e, arm.id);
      if (c) out.counts = fmt(UI.regen.counts, { own: c['own i2v version'] || 0, n: count(c) });
      return out;
    },
    undulation() { return {}; },
  };

  const DEFAULT_MODEL = ['minimax_h3', 'seedance20', 'ltx25_full', 'ltx25_distilled', 'wan22_i2v_a14b', 'wan30'];

  const PANEL_DEFAULT = { locality: ['minimax_h3', 'ltx25_full'], photo: ['ltx25_distilled'] };

  function buildPanel(root) {
    const pid = root.dataset.panel;
    const panel = M.panels[pid];
    const stageRoot = $('[data-stage]', root);
    if (!panel || !panel.models || !panel.models.length) { stageRoot.replaceChildren(el('p', { class: 'notice', text: UI.no_video })); return; }
    const group = new SyncGroup({ mode: panel.time === 'normalized' ? 'normalized' : 'absolute', ref: 5 });
    const stage = new Stage(stageRoot, {
      arms: panel.arms, group, overlay: panel.overlay,
      leftLabel: stageRoot.dataset.physicsLabel, leftSource: stageRoot.dataset.physicsSource,
      onCaption: (arm, e) => (CAPTION[pid] || CAPTION.undulation)(arm, e, panel, stage),
    });
    const ctl = { group, stage, userPaused: REDUCED, inView: false };
    ctl.apply = () => {
      const run = ctl.inView && !ctl.userPaused && document.visibilityState === 'visible';
      if (run) { stage.load(); group.play(); } else group.pause();
    };
    const promptText = $('[data-prompt-text]', root);
    const tl = $('[data-timeline]', root) ? buildTimeline($('[data-timeline]', root), panel, stage, group) : null;
    const ch = $('[data-chart]', root) ? buildChart($('[data-chart]', root), panel, stage, group) : null;
    const sw = wireSwitch($('[data-switch]', root), (val) => { stage.setArm(val); redraw(); });
    function redraw() {
      if (promptText && stage.entry && stage.entry.prompts) renderPrompt(promptText, stage.entry.prompts, stage.active);
      if (tl) tl.draw();
      if (ch) ch.draw();
    }
    function useEntry(e) {
      stage.setEntry(e);
      sw.enable((v) => stage.available(v));
      if (!stage.available(sw.current())) {
        const first = sw.values.find((v) => stage.available(v));
        sw.set(first);
      } else redraw();
    }

    const cfgRoot = $('[data-config]', root);
    let entries = panel.models;
    let picker = null;
    const prefs = (PANEL_DEFAULT[pid] || []).concat(DEFAULT_MODEL);
    const pickDefault = (list) => (prefs.find((id) => list.some((m) => m.id === id)) || list[0].id);
    function rebuildPicker(list, keep) {
      const id = keep && list.some((m) => m.id === keep) ? keep : pickDefault(list);
      picker = modelPicker($('[data-models]', root), list, (e) => useEntry(e));
      picker.pick(id, false);
      useEntry(list.find((m) => m.id === id));
    }
    if (cfgRoot && panel.configs) {
      const cfg = wireSwitch(cfgRoot, (val) => {
        entries = panel.models.filter((m) => m.config === val);
        rebuildPicker(entries, stage.entry && stage.entry.id);
      });
      cfg.set(panel.configs[0].id);
    } else {
      rebuildPicker(entries);
    }
    scrubber(ctl, { normalized: panel.time === 'normalized' });
    sw.set(sw.values.find((v) => stage.available(v)) || panel.arms[0].id);
    observe(root, ctl);
  }

  function renderPrompt(node, prompts, active) {
    const other = Object.keys(prompts).find((k) => k !== active);
    const tok = (s) => (s || '').match(/[A-Za-z0-9'-]+|[^A-Za-z0-9'\s-]+|\s+/g) || [];
    const a = tok(prompts[active]);
    const aw = a.filter((x) => !/^\s+$/.test(x));
    const bw = tok(prompts[other]).filter((x) => !/^\s+$/.test(x));
    const n = aw.length, m = bw.length;
    const L = Array.from({ length: n + 1 }, () => new Int16Array(m + 1));
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = aw[i] === bw[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
    const keep = new Array(n).fill(false);
    for (let i = 0, j = 0; i < n && j < m;) {
      if (aw[i] === bw[j]) { keep[i] = true; i++; j++; } else if (L[i + 1][j] >= L[i][j + 1]) i++; else j++;
    }
    node.replaceChildren();
    let k = 0, run = null;
    for (const t of a) {
      if (/^\s+$/.test(t)) { if (run) run.append(t); else node.append(t); continue; }
      const changed = !keep[k++] && /[A-Za-z0-9]/.test(t);
      if (changed) { if (!run) { run = el('mark'); node.append(run); } run.append(t); }
      else {
        if (run) { const last = run.lastChild; if (last && last.nodeType === 3 && /^\s+$/.test(last.textContent)) { run.removeChild(last); node.append(last); } }
        run = null;
        node.append(t);
      }
    }
  }

  function buildTimeline(root, panel, stage, group) {
    const W = 1000, H = 96, x0 = 150, x1 = 975, yP = 20, yG = 46, yA = 70;
    const X = (f) => x0 + clamp(f, 0, 1) * (x1 - x0);
    const s = sv('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': root.dataset.label || 't/T' });
    root.replaceChildren(s);
    const head = sv('line', { class: 'tl-head', x1: x0, x2: x0, y1: 6, y2: yA + 4 });
    function draw() {
      s.replaceChildren();
      s.append(sv('line', { class: 'tl-axis', x1: x0, x2: x1, y1: yA, y2: yA }));
      for (const f of [0, 0.25, 0.5, 0.75, 1]) {
        s.append(sv('line', { class: 'tl-tick', x1: X(f), x2: X(f), y1: yA - 3, y2: yA + 3 }));
        const t = sv('text', { class: 'tl-text', x: X(f), y: yA + 19, 'text-anchor': 'middle' });
        t.textContent = String(f);
        s.append(t);
      }
      const lab = (y, txt, cls = 'tl-label') => { const t = sv('text', { class: cls, x: 0, y: y + 4 }); t.textContent = txt; s.append(t); };
      lab(yP, UI.length.marker_physics);
      lab(yG, UI.length.marker_model);
      lab(yA + 15, root.dataset.label || 't/T', 'tl-text');
      for (const y of [yP, yG]) s.append(sv('line', { class: 'tl-row', x1: x0, x2: x1, y1: y, y2: y }));
      const e = stage.entry, m = stage.model;
      for (const a of panel.arms) {
        const on = a.id === stage.active;
        const name = `${a.duration} s`;
        const pf = ((e && e.physics_facts) || {})[a.id];
        if (pf && pf.arrival_frac != null) {
          const x = X(pf.arrival_frac);
          s.append(sv('path', { d: `M${x} ${yP - 6}L${x + 6} ${yP}L${x} ${yP + 6}L${x - 6} ${yP}Z`, class: on ? 'tl-phys' : 'tl-phys-other' }));
          const t = sv('text', { class: on ? 'tl-mark on' : 'tl-mark', x: x + 10, y: yP + 4 });
          t.textContent = name;
          s.append(t);
        }
        const f = armFact(e, a.id);
        if (f && f.arrival_fraction != null && m) {
          const x = X(f.arrival_fraction);
          s.append(sv('circle', { cx: x, cy: yG, r: on ? 6 : 5, fill: on ? m.fill : '#fff', stroke: m.color, 'stroke-width': on ? 1.5 : 1.2 }));
          if (on) { const t = sv('text', { class: 'tl-mark on', x: x - 10, y: yG + 4, 'text-anchor': 'end' }); t.textContent = name; s.append(t); }
        }
      }
      s.append(head);
    }
    let lastX = null;
    group.on((t, L) => {
      const x = Math.round(X(t / L) * 2) / 2;
      if (x === lastX) return;
      lastX = x;
      head.setAttribute('x1', x); head.setAttribute('x2', x);
    });
    draw();
    return { draw: () => { lastX = null; draw(); } };
  }

  function buildChart(root, panel, stage, group) {
    const W = 1000, H = 196, x0 = 60, x1 = 985, y0 = 22, y1 = 150;
    const s = sv('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': root.dataset.label || '' });
    root.replaceChildren(s);
    const head = sv('line', { class: 'ch-head', x1: x0, x2: x0, y1: y0, y2: y1 });
    let X = () => x0, Y = () => y0;
    function draw() {
      s.replaceChildren();
      const e = stage.entry, m = stage.model;
      const ser = e && e.series;
      if (!ser) return;

      const stopAt = (ser.s_end || Infinity) - 0.02;
      const trim = (rows) => (rows || []).filter((r) => r[0] < stopAt);
      const all = [];
      for (const grp of ['model', 'physics']) for (const rows of Object.values(ser[grp] || {})) for (const r of trim(rows)) all.push(r);
      const S = Math.max(ser.s_end || 1, ...all.map((r) => r[0]));
      const lim = Math.max(8, ...all.map((r) => Math.abs(r[1]))) * 1.1;
      X = (x) => x0 + clamp(x / S, 0, 1) * (x1 - x0);
      Y = (d) => (y0 + y1) / 2 - (d / lim) * (y1 - y0) / 2;
      if (ser.s_in != null && ser.s_out != null) {
        s.append(sv('rect', { x: X(ser.s_in), y: y0, width: Math.max(2, X(ser.s_out) - X(ser.s_in)), height: y1 - y0, fill: 'var(--periwinkle-1)' }));
        const tx = sv('text', { class: 'ch-text', x: X(ser.s_in) + 4, y: y0 - 7 }); tx.textContent = root.dataset.edit || ''; s.append(tx);
      }
      s.append(sv('line', { class: 'ch-zero', x1: x0, x2: x1, y1: Y(0), y2: Y(0) }));
      for (let x = 0; x <= S + 1e-6; x += 0.2) {
        s.append(sv('line', { class: 'ch-tick', x1: X(x), x2: X(x), y1: y1, y2: y1 + 4 }));
        const tx = sv('text', { class: 'ch-text', x: X(x), y: y1 + 17, 'text-anchor': 'middle' }); tx.textContent = `${x.toFixed(1)} m`; s.append(tx);
      }
      for (const d of [-lim * 0.8, 0, lim * 0.8]) {
        const v = Math.round(d);
        s.append(sv('line', { class: 'ch-tick', x1: x0 - 4, x2: x0, y1: Y(v), y2: Y(v) }));
        const ty = sv('text', { class: 'ch-text', x: x0 - 8, y: Y(v) + 4, 'text-anchor': 'end' }); ty.textContent = String(v); s.append(ty);
      }
      const lab = sv('text', { class: 'ch-label', x: x0, y: y1 + 38 }); lab.textContent = root.dataset.label || ''; s.append(lab);
      const line = (rows, cls, stroke, dim) => {
        if (!rows || rows.length < 2) return;
        const p = sv('polyline', { class: cls + (dim ? ' ch-dim' : ''), points: rows.map((r) => `${X(r[0]).toFixed(1)},${Y(r[1]).toFixed(1)}`).join(' ') });
        if (stroke) p.style.stroke = stroke;
        s.append(p);
      };
      for (const arm of ['bump', 'dip', 'null']) {
        const dim = stage.active !== arm && stage.active !== 'base';
        line(trim((ser.physics || {})[arm]), 'ch-phys', null, dim);
        const rows = trim((ser.model || {})[arm]);
        line(rows, `ch-model ${arm === 'null' ? 'null' : ''}`, arm === 'null' ? 'var(--slate-3)' : (m ? m.color : null), dim);
        if (rows && rows.length && !dim) {
          const r = rows[rows.length - 1];
          const t = sv('text', { class: 'ch-text', x: Math.min(X(r[0]) + 6, x1 - 70), y: Y(r[1]) + (arm === 'dip' ? 14 : -6) });
          t.textContent = (panel.optionNames || {})[arm] || arm;
          s.append(t);
        }
      }

      s.append(sv('rect', { class: 'ch-frame', x: x0, y: y0, width: x1 - x0, height: y1 - y0 }));
      s.append(head);
    }
    let lastX = null;
    group.on(() => {
      const ser = stage.entry && stage.entry.series;
      const v = stage.cells.model.videos[stage.active];
      const t = v && isFinite(v.currentTime) ? v.currentTime : 0;
      const r = ser && at(ser.base_track, t);
      const x = Math.round((r ? X(r[1]) : x0) * 2) / 2;
      if (x === lastX) return;
      lastX = x;
      head.setAttribute('x1', x); head.setAttribute('x2', x);
    });
    draw();
    return { draw: () => { lastX = null; draw(); } };
  }

  function buildExplainer(root) {
    const data = M.explainer;
    const stageRoot = $('[data-stage]', root);
    if (!data || !data.models || !data.models.length) { stageRoot.replaceChildren(el('p', { class: 'notice', text: UI.no_video })); return; }
    const group = new SyncGroup({ mode: 'absolute', ref: 5 });
    const stage = new Stage(stageRoot, {
      arms: data.arms, group, overlay: { release_line: true, path: true },
      leftLabel: stageRoot.dataset.physicsLabel, modelLabel: stageRoot.dataset.modelLabel,
      onCaption: (arm, e) => CAPTION.barrier(arm, e, data),
    });
    stage.setEntry(data.models[0]);
    const ctl = { group, stage, userPaused: REDUCED, inView: false, step: 0 };
    const steps = $$('[data-step]', root), dots = $$('[data-ex-dots] button', root);
    const sw = $('[data-switch]', root);
    const swc = wireSwitch(sw, (val) => stage.setArm(val));
    const prev = $('[data-ex-prev]', root), next = $('[data-ex-next]', root), count2 = $('[data-ex-count]', root);
    ctl.apply = () => {
      const run = ctl.inView && !ctl.userPaused && document.visibilityState === 'visible';
      if (run) { stage.load(); group.play(); } else group.pause();
    };
    const tr = scrubber(ctl);

    const CONF = [
      { arm: 'low', sw: false, paths: false, reset: true },
      { arm: 'low', sw: false, paths: false, reset: true },
      { arm: 'high', sw: true, paths: false, reset: true },
      { arm: null, sw: true, paths: false, reset: true },
      { arm: null, sw: true, paths: true, reset: true },
      { arm: null, sw: true, paths: true, reset: false },
    ];
    function go(i, fromUser = true) {
      ctl.step = clamp(i, 0, CONF.length - 1);
      const c = CONF[ctl.step];
      steps.forEach((s, k) => s.classList.toggle('on', k === ctl.step));
      dots.forEach((d, k) => { if (k === ctl.step) d.setAttribute('aria-current', 'step'); else d.removeAttribute('aria-current'); });
      count2.textContent = String(ctl.step + 1);
      prev.disabled = ctl.step === 0;
      const last = ctl.step === CONF.length - 1;
      next.innerHTML = last ? `${next.dataset.labelRestart}` : `${next.dataset.labelNext} &rsaquo;`;
      sw.hidden = !c.sw;
      if (c.arm) swc.set(c.arm);
      stage.setPaths(c.paths);
      tr.paths.setAttribute('aria-pressed', c.paths ? 'true' : 'false');
      if (c.reset) group.seek(0);
      if (fromUser && ctl.userPaused && !REDUCED) { ctl.userPaused = false; tr.setPlay(); }
      stage.load();
      ctl.apply();
      if (fromUser && window.matchMedia('(max-width: 760px)').matches) {
        const top = root.getBoundingClientRect().top;
        if (top < -8) root.scrollIntoView({ block: 'start', behavior: REDUCED ? 'auto' : 'smooth' });
      }
    }
    prev.addEventListener('click', () => go(ctl.step - 1));
    next.addEventListener('click', () => go(ctl.step === CONF.length - 1 ? 0 : ctl.step + 1));
    dots.forEach((d, k) => d.addEventListener('click', () => go(k)));
    root.addEventListener('keydown', (e) => {
      if (e.target.closest('[role="radio"]')) return;
      if (e.key === 'ArrowRight') { e.preventDefault(); go(ctl.step + 1); }
      if (e.key === 'ArrowLeft') { e.preventDefault(); go(ctl.step - 1); }
    });
    swc.set('low', false);
    stage.setArm('low');
    go(0, false);
    observe(root, ctl);
  }

  function buildGallery(section) {
    const items = M.gallery || [];
    const filters = $('[data-filters]', section), grid = $('[data-g-grid]', section);
    const more = $('[data-g-more]', section), countNode = $('[data-g-count]', section);
    const PAGE = 18;
    const state = { model: 'all', family: 'all', shown: PAGE };
    const fams = (M.gallery_families || []).filter((f) => items.some((g) => g.family === f.id));
    const famLabel = Object.fromEntries(fams.map((f) => [f.id, f.label]));

    function filterGroup(label, opts, key) {
      const box = el('div', { class: 'filter-group', role: 'group', 'aria-label': label }, el('p', { class: 'filter-title', text: label }));
      const w = opts.map((o) => o.label.length + (o.m ? 4.5 : 3));
      const total = w.reduce((a, b) => a + b, 0);
      let cut = 1, best = Infinity, acc = 0;
      for (let i = 1; i < opts.length; i++) { acc += w[i - 1]; const d = Math.abs(total - 2 * acc); if (d < best) { best = d; cut = i; } }
      const btns = [];
      for (const part of [opts.slice(0, cut), opts.slice(cut)]) {
        const line = el('div', { class: 'filter-line' });
        for (const o of part) {
          const b = el('button', { type: 'button', class: 'chip', 'aria-pressed': state[key] === o.id ? 'true' : 'false', style: o.tint ? { '--chip-tint': o.tint } : null }, o.m ? marker(o.m) : null, o.label);
          b.addEventListener('click', () => {
            state[key] = o.id; state.shown = PAGE;
            for (const x of btns) x.setAttribute('aria-pressed', x === b ? 'true' : 'false');
            render();
          });
          btns.push(b);
          line.append(b);
        }
        if (part.length) box.append(line);
      }
      return box;
    }
    const usedModels = M.models.filter((m) => items.some((g) => g.model === m.id));
    filters.replaceChildren(
      filterGroup(filters.dataset.labelModel, [{ id: 'all', label: filters.dataset.labelAll }, ...usedModels.map((m) => ({ id: m.id, label: m.name, m, tint: m.tint }))], 'model'),
      filterGroup(filters.dataset.labelFamily, [{ id: 'all', label: filters.dataset.labelAll }, ...fams.map((f) => ({ id: f.id, label: f.label }))], 'family'),
    );
    const cardObs = new IntersectionObserver((es) => {
      for (const e of es) {
        const c = e.target._card;
        if (!c) continue;
        c.visible = e.isIntersecting && e.intersectionRatio >= 0.35;
        c.apply();
      }
    }, { threshold: [0, 0.35, 0.7] });

    const cardFar = new IntersectionObserver((es) => {
      for (const e of es) if (!e.isIntersecting && e.target._card) e.target._card.unload();
    }, { rootMargin: '1800px 0px' });
    function card(g) {
      const m = modelOf(g.model), c = clip(g.clip), pc = clip(g.physics);
      const group = new SyncGroup({ mode: 'absolute', ref: 5, hold: 0.6 });
      const genLayer = el('div', { class: 'layer on' }), physLayer = el('div', { class: 'layer' });
      const v = el('video', { muted: true, playsinline: true, preload: 'none', poster: c.poster, 'aria-label': `${m.name}, ${g.level}` });
      v.muted = true;
      genLayer.append(v);
      const frame = el('div', { class: 'frame' }, genLayer, physLayer);
      let pv = null;
      const st = { loaded: false };
      const sw = el('div', { class: 'mini-switch on-frame', role: 'radiogroup', 'aria-label': `${m.name} ${g.scene}` });
      const bGen = el('button', { type: 'button', role: 'radio', 'aria-checked': 'true', text: grid.dataset.labelModel });
      const bPhys = el('button', { type: 'button', role: 'radio', 'aria-checked': 'false', text: grid.dataset.labelPhysics, title: pc ? sourceText(pc) : grid.dataset.labelNophys });
      if (!pc) bPhys.disabled = true;
      sw.append(bGen, bPhys);
      frame.append(sw);
      const setPhys = (on) => {
        st.phys = on;
        bGen.setAttribute('aria-checked', on ? 'false' : 'true');
        bPhys.setAttribute('aria-checked', on ? 'true' : 'false');
        if (on && !pv && pc) {
          pv = el('video', { muted: true, playsinline: true, preload: 'auto', poster: pc.poster, src: pc.src, 'aria-label': UI.physics });
          pv.muted = true;
          physLayer.append(pv);
          group.add(pv);
        }
        physLayer.classList.toggle('on', on);
        genLayer.classList.toggle('on', !on);
      };
      bGen.addEventListener('click', () => setPhys(false));
      bPhys.addEventListener('click', () => setPhys(true));
      const node = el('article', { class: 'g-card' }, frame,
        el('div', { class: 'g-meta' },
          el('div', { class: 'row' }, el('span', { class: 'g-model' }, marker(m), m.name)),
          el('div', { class: 'row' }, el('span', { class: 'tag tag-quiet', text: g.level }),
            el('span', { class: 'g-scene', text: `${g.scene} · ${m.closed ? UI.generation : UI.seed} ${g.seed}` }))));
      node._card = {
        visible: false,
        apply() {
          if (this.visible && !st.loaded) { st.loaded = true; v.preload = 'auto'; v.src = c.src; group.add(v); if (st.phys) setPhys(true); }
          if (this.visible && !REDUCED && document.visibilityState === 'visible') group.play(); else group.pause();
        },
        unload() {
          if (!st.loaded) return;
          st.loaded = false;
          group.pause();
          for (const x of [v, pv]) {
            if (!x) continue;
            group.remove(x);
            x.removeAttribute('src');
            try { x.load(); } catch (e) {   }
          }
          if (pv) { pv.remove(); pv = null; }
        },
      };
      cardObs.observe(node);
      cardFar.observe(node);
      return node;
    }
    function render() {
      const list = items.filter((g) => (state.model === 'all' || g.model === state.model) && (state.family === 'all' || g.family === state.family));
      for (const n of $$('.g-card', grid)) { cardObs.unobserve(n); cardFar.unobserve(n); for (const vv of $$('video', n)) { vv.pause(); vv.removeAttribute('src'); vv.load(); } }
      grid.replaceChildren(...list.slice(0, state.shown).map(card));
      countNode.textContent = `${list.length} ${grid.dataset.labelCount || ''}${famLabel[state.family] ? ' · ' + famLabel[state.family] : ''}`;
      more.parentElement.hidden = state.shown >= list.length;
    }
    more.addEventListener('click', () => { state.shown += PAGE; render(); });
    render();
  }

  function wireCitation() {
    const btn = $('[data-copy-bib]'), code = $('[data-bib]');
    if (!btn || !code) return;
    const label = btn.textContent;
    btn.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(code.textContent); } catch (e) {
        const r = document.createRange(); r.selectNodeContents(code);
        const s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
      }
      btn.textContent = btn.dataset.copied;
      setTimeout(() => { btn.textContent = label; }, 1600);
    });
  }

  function fail(err) {
    for (const s of $$('[data-stage], [data-g-grid]')) {
      s.replaceChildren(el('p', { class: 'notice', text: 'The clips could not be loaded. The page has to be opened from a web server, not from a file on disk.' }));
    }
    console.error(err);
  }

  async function start() {
    wireCitation();
    try {
      const r = await fetch('data/manifest.json', { cache: 'no-cache' });
      if (!r.ok) throw new Error(`manifest: HTTP ${r.status}`);
      M = await r.json();
    } catch (err) { fail(err); return; }
    const optNode = document.getElementById('copy-locality-options');
    if (optNode && M.panels.locality) M.panels.locality.optionNames = JSON.parse(optNode.textContent);
    const ex = $('[data-explainer]');
    if (ex) buildExplainer(ex);
    for (const p of $$('[data-panel]')) buildPanel(p);
    const gal = $('#gallery');
    if (gal) buildGallery(gal);
    window.__samelaw = { controllers };
    document.documentElement.classList.add('is-ready');
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
