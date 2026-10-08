// The crawler: a spider-like walker that reads the rendered document token by token,
// with a different set of effects per lens. The reference pass runs under every lens;
// only the References lens shows it loudly.

import { ENTITY_TYPES } from "./references.js";

const MONO = '"IBM Plex Mono", ui-monospace, Menlo, monospace';
const LEG_ANGLES = [-160, -125, -60, -25, 25, 60, 125, 160].map((d) => (d * Math.PI) / 180);
const EMO_COLORS = { fear: "#b07cff", anger: "#ff6b5e", sadness: "#6da7ec", joy: "#ffd84d", trust: "#46f08a", surprise: "#33e1ff" };
const POS_RGB = "57,135,229", NEG_RGB = "230,103,103";

export class Crawler {
  constructor({ canvas, onProgress, onEntity, onDone, onEvidence, getCardPos }) {
    this.cv = canvas;
    this.ctx = canvas.getContext("2d");
    this.onProgress = onProgress || (() => {});
    this.onEntity = onEntity || (() => {});
    this.onDone = onDone || (() => {});
    this.onEvidence = onEvidence || (() => {});
    this.getCardPos = getCardPos || (() => null);
    this.wallLinks = [];
    this.reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    this.playing = false;
    this.speed = 2;
    this.model = null;
    this.lens = "references";
    this.effects = [];
    this.hits = [];
    this.threads = [];
    this.body = { x: 0, y: 0, vx: 0, vy: 0 };
    this.gaze = { x: 0, y: 0 };
    this.legs = [];
    this.idx = 0; this.dwell = 0;
    this.userScrollUntil = 0;
    this.lastT = performance.now();
    this.visible = true;
    for (const ev of ["wheel", "touchmove"]) window.addEventListener(ev, () => { this.userScrollUntil = performance.now() + 2500; }, { passive: true });
    window.addEventListener("resize", () => this.resize());
    this.resize();
    requestAnimationFrame((t) => this.frame(t));
  }

  resize() {
    this.DPR = Math.min(window.devicePixelRatio || 1, 2);
    this.W = window.innerWidth; this.H = window.innerHeight;
    this.cv.width = this.W * this.DPR; this.cv.height = this.H * this.DPR;
    this.ctx.setTransform(this.DPR, 0, 0, this.DPR, 0, 0);
    this.measure();
  }

  measure() {
    if (!this.model) return;
    const sy = window.scrollY, sx = window.scrollX;
    for (const t of this.model.tokens) {
      if (!t.el || !t.el.isConnected) { t.x = t.y = t.w = t.h = 0; continue; }
      const r = t.el.getClientRects()[0] || t.el.getBoundingClientRect();
      t.x = r.left + sx; t.y = r.top + sy; t.w = r.width; t.h = r.height;
      t.cx = t.x + t.w / 2; t.cy = t.y + t.h / 2;
    }
    this.byY = this.model.tokens.filter((t) => t.h).sort((a, b) => a.cy - b.cy);
  }

  near(y, range) {
    const arr = this.byY || [];
    let lo = 0, hi = arr.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (arr[mid].cy < y - range) lo = mid + 1; else hi = mid; }
    const out = [];
    for (let i = lo; i < arr.length && arr[i].cy <= y + range; i++) out.push(arr[i]);
    return out;
  }

  load(model, analyses) {
    this.model = model;
    this.a = analyses;
    this.measure();
  }

  clearMarks() {
    const m = this.model;
    for (const t of m.tokens) {
      if (!t.el) continue;
      t.el.className = t.atomic ? `e t-${t.atomic}` : "w";
      if (t.href) t.el.classList.add("lnk");
      t.el.removeAttribute("style");
    }
    for (const b of m.blocks) if (b.el) { b.el.classList.remove("tp"); b.el.style.removeProperty("--tc"); }
  }

  start(lens) {
    this.lens = lens;
    this.clearMarks();
    this.idx = 0; this.dwell = 0;
    this.effects.length = 0; this.hits.length = 0; this.threads.length = 0; this.wallLinks.length = 0;
    this.seen = new Map();
    this.lastBlock = -1;
    this.mood = [];
    this.counts = {};
    window.scrollTo(0, 0);
    this.measure();
    const first = this.model.tokens.find((t) => t.h);
    if (first) { this.gaze = { x: first.cx, y: first.cy }; this.body.x = first.cx - 40; this.body.y = first.cy + 30; }
    this.legs = LEG_ANGLES.map((a, i) => ({ a, r: 62 + (i % 3) * 14, fx: this.body.x + Math.cos(a) * 60, fy: this.body.y + Math.sin(a) * 60, sx: 0, sy: 0, tx: 0, ty: 0, t: 1, grab: null }));
    this.done = false;
    this.onProgress(this.progress());
  }

  progress() {
    return { idx: this.idx, total: this.model ? this.model.tokens.length : 0, lens: this.lens, counts: this.counts, seen: this.seen, mood: this.mood };
  }

  setPlaying(v) { this.playing = v; }

  /* ---------- reading ---------- */
  dwellFor(t) {
    if (this.lens === "scan") return 0.012 + Math.min(t.text.length, 12) * 0.003;
    if (this.lens === "insights" || this.lens === "uxr") {
      const hit = this.a.aiIndex && this.a.aiIndex.get(t.sentence);
      if (hit && this.model.sentences[t.sentence].tokStart === t.i) return 0.7;
      return hit ? 0.05 : 0.014 + Math.min(t.text.length, 12) * 0.004;
    }
    const ents = this.model.entityAt.get(t.i);
    if (this.lens === "references") {
      if (ents) return ents.some((e) => ENTITY_TYPES[e.type].fx !== "tag") ? 0.6 : 0.22;
      return 0.02 + Math.min(t.text.length, 12) * 0.006;
    }
    if (this.lens === "trends") {
      const k = t.term && this.a.trends.topSet.get(this.model.lemma(t.term));
      if (k) return this.seen.get(k.term) ? 0.12 : 0.5;
      return 0.018 + Math.min(t.text.length, 12) * 0.005;
    }
    const mark = this.a.tone.tokTone.get(t.i);
    if (mark && (mark.emo || mark.hedge || mark.boost)) return 0.3;
    if (mark) return 0.12;
    return 0.02 + Math.min(t.text.length, 12) * 0.005;
  }

  read(t, loud) {
    const m = this.model;
    // quiet reference pass, every lens
    const ents = m.entityAt.get(t.i);
    if (ents) for (const e of ents) this.markEntity(e, loud && this.lens === "references");

    if (this.lens === "references" || this.lens === "scan") {
      if (!t.atomic) t.el.classList.add("read");
    } else if (this.lens === "insights" || this.lens === "uxr") {
      this.readFindings(t, loud);
    } else if (this.lens === "trends") {
      this.readTrends(t, loud);
    } else {
      this.readTone(t, loud);
    }
  }

  markEntity(e, loud) {
    const m = this.model;
    const quiet = !loud && this.lens !== "references";
    for (let k = e.tokStart; k <= e.tokEnd; k++) {
      const el = m.tokens[k].el;
      if (!el) continue;
      if (m.tokens[k].atomic) el.classList.add("hit"); else el.classList.add("rh", `t-${e.type}`);
      if (quiet) el.classList.add("quiet");
    }
    this.counts[e.type] = (this.counts[e.type] || 0) + 1;
    this.onEntity(e);
    if (!loud) return;
    const t = m.tokens[e.tokStart];
    const spec = ENTITY_TYPES[e.type];
    const now = performance.now();
    this.hits.push({ x: t.cx, y: t.cy, born: now, color: spec.color });
    if (this.hits.length > 40) this.hits.shift();
    if (this.effects.length < 40) {
      const text = spec.fx === "bar" ? e.text : e.type === "url" && e.source === "link" ? e.href : e.text;
      this.effects.push({ kind: spec.fx, t, text, label: spec.label, color: spec.color, born: now,
        life: spec.fx === "callout" ? 2600 : spec.fx === "bar" ? 1500 : 1100,
        angle: (Math.random() - 0.5) * (spec.fx === "bar" ? 0.9 : 0.12), dx: 14 + Math.random() * 30, dy: -34 - Math.random() * 30 });
    }
    this.grab(t);
  }

  readTrends(t, loud) {
    const tr = this.a.trends;
    const b = t.block;
    if (b !== this.lastBlock) {
      this.lastBlock = b;
      const tp = tr.blockTopic[b];
      const el = this.model.blocks[b].el;
      if (tp >= 0 && el) { el.classList.add("tp"); el.style.setProperty("--tc", tr.topics[tp].color); }
    }
    t.el.classList.add("read");
    if (!t.term) return;
    const k = tr.topSet.get(this.model.lemma(t.term));
    if (!k) return;
    t.el.classList.add("kw");
    t.el.style.setProperty("--k", (1 - (k.rank - 1) / tr.top.length).toFixed(2));
    const prev = this.seen.get(k.term);
    this.seen.set(k.term, { n: (prev ? prev.n : 0) + 1, x: t.cx, y: t.cy, entry: k });
    if (!loud) return;
    const now = performance.now();
    if (!prev) {
      if (this.effects.length < 40) this.effects.push({ kind: "callout", t, text: k.term, label: `keyword #${k.rank}`, color: "#33e1ff", born: now, life: 2200, angle: 0, dx: 16, dy: -40 });
      this.grab(t);
    } else {
      this.threads.push({ x1: prev.x, y1: prev.y, x2: t.cx, y2: t.cy, born: now, rank: k.rank });
      if (this.threads.length > 80) this.threads.shift();
      if (this.effects.length < 40) this.effects.push({ kind: "tag", t, text: "", label: `${k.term} ×${prev.n + 1}`, color: "#33e1ff", born: now, life: 900 });
    }
  }

  // Insights and UXR: tint each quoted sentence in its finding's color, call the finding
  // out, and pull a thread to its card on the wall.
  readFindings(t, loud) {
    t.el.classList.add("read");
    const hits = this.a.aiIndex && this.a.aiIndex.get(t.sentence);
    if (!hits) return;
    const card = hits[0].card;
    const sent = this.model.sentences[t.sentence];
    const col = hexA(card.color, 0.26);
    t.el.style.background = col;
    if (t.i + 1 < sent.tokEnd) t.el.style.boxShadow = `0.32em 0 0 ${col}`;
    if (sent.tokStart !== t.i) return;
    for (const h of hits) this.onEvidence(h.card, h.ev);
    if (!loud) return;
    const now = performance.now();
    for (const h of hits.slice(0, 2)) {
      const c = h.card;
      const label = c.tension ? `${c.tag} · ${h.ev.stance === "contradicts" ? "against" : "for"}` : c.tag;
      if (this.effects.length < 40) this.effects.push({ kind: "callout", t, text: c.title, label, color: c.color, born: now, life: 2600, angle: 0, dx: 14, dy: -38, small: true });
      if (c.wall) this.wallLinks.push({ x: t.cx, y: t.cy, card: c.key, color: c.color, born: now });
    }
    if (this.wallLinks.length > 30) this.wallLinks.splice(0, this.wallLinks.length - 30);
    this.grab(t);
  }

  readTone(t, loud) {
    const tone = this.a.tone;
    const s = tone.sentences[t.sentence];
    t.el.classList.add("read");
    if (s && Math.abs(s.score) > 0.08) {
      const a = Math.min(0.42, 0.08 + Math.abs(s.score) * 0.34);
      const col = `rgba(${s.score > 0 ? POS_RGB : NEG_RGB},${a.toFixed(2)})`;
      t.el.style.background = col;
      // extend the wash over the following space so a sentence reads as one band
      const sent = this.model.sentences[t.sentence];
      if (t.i + 1 < sent.tokEnd) t.el.style.boxShadow = `0.32em 0 0 ${col}`;
    }
    if (this.model.sentences[t.sentence].tokStart === t.i) this.mood.push(s ? s.score : 0);
    const mark = tone.tokTone.get(t.i);
    if (!mark) return;
    if (mark.hedge) t.el.classList.add("hedge");
    if (mark.boost) t.el.classList.add("boost");
    if (!loud || this.effects.length >= 40) return;
    const now = performance.now();
    if (mark.emo) {
      this.effects.push({ kind: "callout", t, text: mark.emo.toUpperCase(), label: "emotion", color: EMO_COLORS[mark.emo], born: now, life: 1800, angle: 0, dx: 12, dy: -36 });
      this.grab(t);
    } else if (mark.hedge) {
      this.effects.push({ kind: "tag", t, text: "", label: "hedge", color: "#9aa0b4", born: now, life: 1000 });
    } else if (mark.boost) {
      this.effects.push({ kind: "tag", t, text: "", label: "certain", color: "#ffffff", born: now, life: 1000 });
    } else if (mark.pol) {
      this.effects.push({ kind: "tag", t, text: "", label: mark.pol > 0 ? "+" : "−", color: mark.pol > 0 ? "#6da7ec" : "#e66767", born: now, life: 700 });
    }
  }

  advance(dt) {
    const m = this.model;
    if (!m || this.idx >= m.tokens.length) return;
    this.dwell -= dt * this.speed;
    let steps = 0;
    while (this.dwell <= 0 && this.idx < m.tokens.length) {
      const t = m.tokens[this.idx];
      this.idx++;
      if (!t.el || !t.h) continue;
      this.gaze.x = t.cx; this.gaze.y = t.cy;
      this.read(t, true);
      this.dwell += this.dwellFor(t);
      if (++steps > 400) break;
    }
    if (this.idx >= m.tokens.length && !this.done) this.finish();
  }

  // Apply every mark at once, without effects.
  skip() {
    const m = this.model;
    if (!m) return;
    while (this.idx < m.tokens.length) {
      const t = m.tokens[this.idx++];
      if (t.el) this.read(t, false);
    }
    this.effects.length = 0;
    this.finish();
  }

  finish() {
    this.done = true;
    this.playing = false;
    this.onProgress(this.progress());
    this.onDone(this.lens);
  }

  grab(t) {
    let best = null, bd = Infinity;
    for (const L of this.legs) { const d = Math.hypot(L.fx - t.cx, L.fy - t.cy); if (d < bd) { bd = d; best = L; } }
    if (best && bd < 260) this.stepLeg(best, t.cx, t.cy, t);
  }
  stepLeg(L, x, y, grab) { L.sx = L.fx; L.sy = L.fy; L.tx = x; L.ty = y; L.t = 0; L.grab = grab || null; }

  updateBody(dt) {
    const b = this.body;
    const tx = this.gaze.x - 18, ty = this.gaze.y + 26;
    // Critically damped spring in fixed substeps, so slow frames can't fling the body.
    const k = 60 * Math.min(this.speed, 3), c = 2 * Math.sqrt(k);
    if (!isFinite(b.x) || !isFinite(b.y)) { b.x = tx; b.y = ty; b.vx = b.vy = 0; }
    let left = dt;
    while (left > 0) {
      const h = Math.min(left, 1 / 120);
      b.vx += ((tx - b.x) * k - b.vx * c) * h;
      b.vy += ((ty - b.y) * k - b.vy * c) * h;
      b.x += b.vx * h; b.y += b.vy * h;
      left -= h;
    }
    const vfx = b.vx / 60, vfy = b.vy / 60; // per-frame velocity, for leg placement
    const moving = this.legs.filter((L) => L.t < 1).length;
    for (const L of this.legs) {
      if (L.t < 1) L.t = Math.min(1, L.t + dt * (5 + Math.min(this.speed, 6) * 2));
      const ix = b.x + Math.cos(L.a) * L.r + vfx * 6;
      const iy = b.y + Math.sin(L.a) * L.r * 0.8 + vfy * 6;
      if (L.t >= 1 && Math.hypot(L.fx - ix, L.fy - iy) > 46 && moving < 3) {
        let best = null, score = Infinity;
        for (const t of this.near(iy, 70)) {
          const d = Math.hypot(t.cx - ix, t.cy - iy);
          if (d > 80) continue;
          const s = d - (t.atomic ? 35 : 0) + Math.random() * 10;
          if (s < score) { score = s; best = t; }
        }
        if (best) this.stepLeg(L, best.x + Math.random() * best.w, best.cy, best.atomic ? best : null);
        else this.stepLeg(L, ix, iy, null);
      }
      if (L.t < 1) {
        const e = L.t < 0.5 ? 2 * L.t * L.t : 1 - Math.pow(-2 * L.t + 2, 2) / 2;
        L.fx = L.sx + (L.tx - L.sx) * e;
        L.fy = L.sy + (L.ty - L.sy) * e - Math.sin(L.t * Math.PI) * 14;
      }
    }
  }

  /* ---------- drawing ---------- */
  frame(now) {
    const dt = Math.min(0.05, (now - this.lastT) / 1000);
    this.lastT = now;
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.W, this.H);
    if (this.model && this.visible) {
      if (this.playing) this.advance(dt);
      this.updateBody(dt);
      if (this.playing && now > this.userScrollUntil) {
        const target = this.body.y - this.H * 0.5;
        const cur = window.scrollY;
        const next = cur + (target - cur) * Math.min(1, dt * 3);
        if (Math.abs(next - cur) > 0.5) window.scrollTo(0, Math.max(0, next));
      }
      this.drawThreads(now);
      this.drawHits(now);
      this.drawEffects(now);
      this.drawSpider(now);
      if (this.playing && (!this.lastHud || now - this.lastHud > 200)) { this.lastHud = now; this.onProgress(this.progress()); }
    }
    requestAnimationFrame((t) => this.frame(t));
  }

  sy(y) { return y - window.scrollY; }

  drawThreads(now) {
    const ctx = this.ctx;
    ctx.lineWidth = 1;
    for (const l of this.wallLinks) {
      const age = (now - l.born) / 3500;
      if (age > 1) continue;
      const card = this.getCardPos(l.card);
      if (!card) continue;
      ctx.strokeStyle = hexA(l.color, 0.75 * (1 - age));
      ctx.lineWidth = 1.2;
      const x1 = l.x, y1 = this.sy(l.y);
      ctx.beginPath(); ctx.moveTo(x1, y1);
      ctx.bezierCurveTo(x1 + (card.x - x1) * 0.6, y1, card.x - 60, card.y, card.x, card.y);
      ctx.stroke();
      ctx.fillStyle = hexA(l.color, 1 - age);
      ctx.beginPath(); ctx.arc(card.x, card.y, 3, 0, Math.PI * 2); ctx.fill();
    }
    ctx.lineWidth = 1;
    for (const th of this.threads) {
      const age = (now - th.born) / 6000;
      if (age > 1) continue;
      ctx.strokeStyle = `rgba(51,225,255,${0.55 * (1 - age)})`;
      const mx = (th.x1 + th.x2) / 2 + 40, my = (th.y1 + th.y2) / 2;
      ctx.beginPath(); ctx.moveTo(th.x1, this.sy(th.y1)); ctx.quadraticCurveTo(mx, this.sy(my), th.x2, this.sy(th.y2)); ctx.stroke();
    }
  }

  drawHits(now) {
    const ctx = this.ctx, b = this.body;
    ctx.lineWidth = 1;
    for (let i = 1; i < this.hits.length; i++) {
      const a = this.hits[i - 1], h = this.hits[i];
      const age = (now - h.born) / 5000;
      if (age > 1) continue;
      ctx.strokeStyle = `rgba(132,135,238,${0.45 * (1 - age)})`;
      ctx.beginPath(); ctx.moveTo(a.x, this.sy(a.y)); ctx.lineTo(h.x, this.sy(h.y)); ctx.stroke();
    }
    for (const h of this.hits) {
      const age = (now - h.born) / 4000;
      if (age > 1) continue;
      ctx.strokeStyle = h.color; ctx.globalAlpha = 0.5 * (1 - age);
      ctx.beginPath(); ctx.moveTo(b.x, this.sy(b.y)); ctx.lineTo(h.x, this.sy(h.y)); ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }

  drawSpider(now) {
    const ctx = this.ctx;
    const bx = this.body.x, by = this.sy(this.body.y);
    for (const L of this.legs) {
      const fx = L.fx, fy = this.sy(L.fy);
      const mx = (bx + fx) / 2, my = (by + fy) / 2;
      const dx = fx - bx, dy = fy - by, len = Math.hypot(dx, dy) || 1;
      const side = Math.cos(L.a) < 0 ? -1 : 1;
      const kx = mx + (-dy / len) * 22 * side, ky = my - Math.abs(dx / len) * 18 - 8;
      const gc = L.grab && L.grab.atomic ? ENTITY_TYPES[L.grab.atomic].color : null;
      ctx.strokeStyle = gc || "#ff5c8a";
      ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(kx, ky); ctx.lineTo(fx, fy); ctx.stroke();
      ctx.fillStyle = "#62ffd0";
      ctx.beginPath(); ctx.arc(kx, ky, 2.4, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = gc || "#33e1ff";
      ctx.beginPath(); ctx.arc(fx, fy, 2.8, 0, Math.PI * 2); ctx.fill();
    }
    const nodes = [];
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + now / 900;
      const r = 7 + Math.sin(now / 230 + i * 1.7) * 3;
      nodes.push([bx + Math.cos(a) * r * 1.3, by + Math.sin(a) * r]);
    }
    ctx.strokeStyle = "rgba(79,125,255,.9)"; ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j += 2) { ctx.moveTo(nodes[i][0], nodes[i][1]); ctx.lineTo(nodes[j][0], nodes[j][1]); }
    ctx.stroke();
    const core = { references: "#ffd84d", trends: "#33e1ff", tone: "#ff3fd8", insights: "#46f08a", uxr: "#b58cff", scan: "#46f08a" }[this.lens];
    ctx.fillStyle = core; ctx.fillRect(bx - 4, by - 4, 8, 8);
    ctx.strokeStyle = "#fff"; ctx.strokeRect(bx - 6.5, by - 6.5, 13, 13);
    ctx.fillStyle = "#62ffd0";
    for (const [x, y] of nodes) { ctx.beginPath(); ctx.arc(x, y, 1.8, 0, Math.PI * 2); ctx.fill(); }
    if (!this.done) { ctx.fillStyle = "rgba(255,255,255,.85)"; ctx.fillRect(this.gaze.x - 1, this.sy(this.gaze.y) - 9, 1.5, 18); }
  }

  drawEffects(now) {
    const ctx = this.ctx, W = this.W;
    const fit = (s, n) => (s.length > n ? s.slice(0, n - 1) + "…" : s);
    for (let i = this.effects.length - 1; i >= 0; i--) {
      const e = this.effects[i];
      const age = now - e.born;
      if (age < 0) continue;
      if (age > e.life) { this.effects.splice(i, 1); continue; }
      const p = age / e.life;
      const fade = p > 0.7 ? 1 - (p - 0.7) / 0.3 : 1;
      const x = e.t.x, y = this.sy(e.t.y);
      ctx.save();
      if (e.kind === "callout") {
        const big = e.small ? Math.min(19, Math.max(14, W / 48)) : Math.min(30, Math.max(20, W / 26));
        ctx.font = `600 ${big}px ${MONO}`;
        const text = fit(e.text.replace(/^(doi:|ISBN:?|PMID:?|Bibcode:)\s?/i, "").replace(/^https?:\/\/(www\.)?/, ""), e.small ? 44 : 28);
        const tw = ctx.measureText(text).width;
        let cx = Math.min(x + e.dx, W - tw - 16); cx = Math.max(12, cx);
        const cy = y + e.dy;
        ctx.globalAlpha = fade;
        ctx.strokeStyle = e.color; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(cx, cy + 6); ctx.stroke();
        ctx.fillStyle = "rgba(8,8,12,.82)";
        ctx.fillRect(cx - 6, cy - big + 2, tw + 12, big + 10);
        if (!this.reduceMotion && p < 0.4) {
          ctx.save(); ctx.globalAlpha = 0.25 * (1 - p / 0.4);
          ctx.translate(cx, cy); ctx.scale(1 + (1 - p / 0.4) * 2.2, 1);
          ctx.fillStyle = e.color; ctx.fillText(text, 0, 0);
          ctx.restore(); ctx.globalAlpha = fade;
        }
        ctx.fillStyle = e.color; ctx.fillText(text, cx, cy);
        ctx.font = `600 10px ${MONO}`;
        const lab = e.label.toUpperCase();
        const lw = ctx.measureText(lab).width + 8;
        ctx.fillStyle = e.color; ctx.fillRect(cx - 6, cy - big - 12, lw, 14);
        ctx.fillStyle = "#08080c"; ctx.fillText(lab, cx - 2, cy - big - 1);
      } else if (e.kind === "bar") {
        const flick = this.reduceMotion ? 0 : Math.random() < 0.15 ? (Math.random() - 0.5) * 12 : 0;
        ctx.translate(x + flick, y + e.t.h / 2);
        ctx.rotate(e.angle);
        ctx.font = `600 15px ${MONO}`;
        const text = fit(e.text, 46);
        const tw = ctx.measureText(text).width;
        const bw = Math.max(tw + 24, 160) * (this.reduceMotion ? 1 : Math.min(1, p * 6));
        ctx.globalAlpha = fade * 0.92;
        ctx.fillStyle = e.color;
        ctx.fillRect(-10, -13, bw, 26);
        ctx.save(); ctx.beginPath(); ctx.rect(-10, -13, bw, 26); ctx.clip();
        ctx.fillStyle = "#14001a"; ctx.fillText(text, 2, 5);
        ctx.restore();
        if (!this.reduceMotion && Math.random() < 0.3) {
          ctx.fillStyle = "rgba(51,225,255,.6)";
          ctx.fillRect(-10 + Math.random() * bw * 0.8, -13, 20 + Math.random() * 60, 3);
        }
      } else {
        ctx.globalAlpha = fade;
        ctx.strokeStyle = e.color; ctx.lineWidth = 1;
        const pad = 3 + (1 - p) * 5;
        ctx.strokeRect(x - pad, y - pad, e.t.w + pad * 2, e.t.h + pad * 2);
        ctx.font = `600 9px ${MONO}`;
        ctx.fillStyle = e.color;
        ctx.fillText(e.label.toUpperCase(), x - pad, y - pad - 3);
      }
      ctx.restore();
    }
  }
}

function hexA(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a.toFixed(3)})`;
}
