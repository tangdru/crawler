// Summary view: panels accumulate as lenses run. Hand-built SVG charts following one
// system: thin marks, single-hue magnitude, blue/red diverging tone, recessive axes,
// text in ink tokens, and a hover tooltip plus click-to-passage on every mark.

import { ENTITY_TYPES } from "./references.js";
import { EMOTION_KEYS } from "./tone.js";
import { combine } from "./tone.js";

const C = {
  surface: "#111119", grid: "#24253a", base: "#3a3b52",
  ink: "#ffffff", ink2: "#c3c2b7", muted: "#8c8a9a",
  blue: "#3987e5", orange: "#d95926", pos: "#3987e5", neg: "#e66767", mid: "#383835",
  seq: ["#162238", "#184f95", "#256abf", "#3987e5", "#6da7ec", "#9ec5f4"]
};
const NS = "http://www.w3.org/2000/svg";
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const fmt = (n) => (Math.abs(n) >= 1000 ? n.toLocaleString("en-US") : String(Math.round(n * 100) / 100));

function svg(w, h) {
  const s = document.createElementNS(NS, "svg");
  s.setAttribute("viewBox", `0 0 ${w} ${h}`);
  s.setAttribute("width", "100%");
  s.setAttribute("role", "img");
  s.style.maxWidth = w + "px";
  return s;
}
function el(parent, tag, attrs, text) {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs || {})) n.setAttribute(k, v);
  if (text != null) n.textContent = text;
  parent.appendChild(n);
  return n;
}
// Bar with a 4px rounded data end and a square baseline end.
function barPath(x0, y, len, h, r = 4) {
  if (len <= 0.5) return `M${x0},${y}h0.5v${h}h-0.5z`;
  const rr = Math.min(r, len, h / 2);
  return `M${x0},${y}h${len - rr}a${rr},${rr} 0 0 1 ${rr},${rr}v${h - 2 * rr}a${rr},${rr} 0 0 1 -${rr},${rr}h-${len - rr}z`;
}
function barPathLeft(x1, y, len, h, r = 4) {
  if (len <= 0.5) return `M${x1},${y}h-0.5v${h}h0.5z`;
  const rr = Math.min(r, len, h / 2);
  return `M${x1},${y}h-${len - rr}a${rr},${rr} 0 0 0 -${rr},${rr}v${h - 2 * rr}a${rr},${rr} 0 0 0 ${rr},${rr}h${len - rr}z`;
}

export class Summary {
  constructor(root, tip, { jump }) {
    this.root = root;
    this.tip = tip;
    this.jump = jump;
  }

  hover(node, html, onClick) {
    node.addEventListener("pointerenter", (e) => this.showTip(e, html));
    node.addEventListener("pointermove", (e) => this.moveTip(e));
    node.addEventListener("pointerleave", () => this.hideTip());
    if (onClick) { node.style.cursor = "pointer"; node.addEventListener("click", () => { this.hideTip(); onClick(); }); }
  }
  showTip(e, html) { this.tip.innerHTML = html; this.tip.hidden = false; this.moveTip(e); }
  moveTip(e) {
    const r = this.tip.getBoundingClientRect();
    let x = e.clientX + 14, y = e.clientY + 14;
    if (x + r.width > window.innerWidth - 8) x = e.clientX - r.width - 14;
    if (y + r.height > window.innerHeight - 8) y = e.clientY - r.height - 14;
    this.tip.style.left = Math.max(8, x) + "px"; this.tip.style.top = Math.max(8, y) + "px";
  }
  hideTip() { this.tip.hidden = true; }

  panel(title, sub, wide) {
    const sec = document.createElement("section");
    sec.className = "panel" + (wide ? " wide" : "");
    const h = document.createElement("h3"); h.textContent = title; sec.appendChild(h);
    if (sub) { const p = document.createElement("p"); p.className = "sub"; p.textContent = sub; sec.appendChild(p); }
    const body = document.createElement("div"); body.className = "chart"; sec.appendChild(body);
    this.grid.appendChild(sec);
    return body;
  }
  // Measure from the grid, not the panel: panels are drawn one by one, before the
  // grid has settled into its final column count.
  width(body) {
    const gw = this.grid ? this.grid.clientWidth : 0;
    if (!gw) return 520;
    const wide = body.closest(".panel").classList.contains("wide");
    const two = gw >= 440 * 2 + 14;
    const col = wide || !two ? gw : (gw - 14) / 2;
    return Math.max(240, Math.min(col - 34, 1100));
  }

  render(state) {
    this.state = state;
    const { model, ran } = state;
    this.root.textContent = "";
    const head = document.createElement("header");
    head.className = "sum-head";
    const any = ran.references || ran.trends || ran.tone;
    const lensNames = ["references", "trends", "tone"].filter((l) => ran[l]).map((l) => l[0].toUpperCase() + l.slice(1));
    head.innerHTML = `<div class="eyebrow">Summary · ${esc(model.title)}</div>
      <h2>${any ? `What the crawler found` : `Run a crawl to build the summary`}</h2>
      <p class="sub">${any ? `Built from: ${lensNames.join(" + ")}. Every crawl also collects references, dates and quotes. ${!ran.trends || !ran.tone ? "Run the other lenses to add more panels." : "All lenses have run, so the combined panels are shown too."}` : "Pick a lens and press Play. Each lens you run adds its panels here, and nothing is lost when you switch."}</p>`;
    this.root.appendChild(head);
    if (!any) return;
    this.tiles(state);
    this.grid = document.createElement("div");
    this.grid.className = "panels";
    this.root.appendChild(this.grid);

    this.entityBars(state);
    this.yearColumns(state);
    if (ran.trends) { this.keywords(state); this.termTrends(state); this.topicStrip(state); this.cooc(state); }
    if (ran.tone) { this.moodLine(state); this.emotionHeat(state); this.hedgeLines(state); this.uncited(state); }
    if (ran.trends && ran.tone) this.moodByTopic(state);
    this.quotes(state);
    this.entityTable(state);
  }

  tiles(state) {
    const { model, ran, trends, tone } = state;
    const row = document.createElement("div");
    row.className = "tiles";
    const items = [
      ["Words", model.wordCount.toLocaleString("en-US")],
      ["Sentences", model.sentences.length.toLocaleString("en-US")],
      ["References found", model.entities.length.toLocaleString("en-US")],
      ["Reading time", `${Math.max(1, Math.round(model.wordCount / 238))} min`]
    ];
    if (ran.trends && trends.top[0]) items.push(["Top keyword", trends.top[0].term]);
    if (ran.tone) {
      const m = tone.totals.mean;
      items.push(["Overall tone", m > 0.05 ? "Positive" : m < -0.05 ? "Negative" : "Neutral", `mean ${m >= 0 ? "+" : ""}${m.toFixed(2)} on −1…+1`]);
    }
    for (const [label, value, note] of items) {
      const t = document.createElement("div");
      t.className = "tile";
      t.innerHTML = `<div class="label">${esc(label)}</div><div class="value">${esc(value)}</div>${note ? `<div class="note">${esc(note)}</div>` : ""}`;
      row.appendChild(t);
    }
    this.root.appendChild(row);
  }

  hbars(body, items, opts = {}) {
    const W = this.width(body);
    const labelW = Math.min(170, W * 0.36), valW = 52, bh = 14, gap = 10;
    const H = items.length * (bh + gap) + 6;
    const s = svg(W, H);
    const max = opts.max || Math.max(1, ...items.map((d) => d.value));
    const span = W - labelW - valW;
    items.forEach((d, i) => {
      const y = 3 + i * (bh + gap);
      el(s, "text", { x: labelW - 10, y: y + bh - 3, "text-anchor": "end", class: "t-label" }, d.label.length > 26 ? d.label.slice(0, 25) + "…" : d.label);
      if (d.swatch) el(s, "rect", { x: 0, y: y + 3, width: 8, height: 8, rx: 2, fill: d.swatch });
      const len = (d.value / max) * span;
      el(s, "path", { d: barPath(labelW, y, len, bh), fill: d.color || C.blue });
      el(s, "text", { x: labelW + len + 6, y: y + bh - 3, class: "t-value" }, opts.fmt ? opts.fmt(d.value) : fmt(d.value));
      const hit = el(s, "rect", { x: 0, y: y - gap / 2, width: W, height: bh + gap, fill: "transparent" });
      this.hover(hit, d.tip, d.onClick);
    });
    el(s, "line", { x1: labelW, x2: labelW, y1: 0, y2: H, stroke: C.base, "stroke-width": 1 });
    body.appendChild(s);
  }

  entityBars(state) {
    const { model } = state;
    const counts = {};
    for (const e of model.entities) counts[e.type] = (counts[e.type] || 0) + 1;
    const items = Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([type, value]) => {
      const first = model.entities.find((e) => e.type === type);
      return { label: ENTITY_TYPES[type].label === "ID" ? "Database ID" : ENTITY_TYPES[type].label, value,
        tip: `<b>${value}</b> ${esc(ENTITY_TYPES[type].label)} item${value === 1 ? "" : "s"}<br><span class="muted">first: ${esc(first.text.slice(0, 80))}</span><br><span class="muted">Click to jump to it</span>`,
        onClick: () => this.jump({ token: first.tokStart }) };
    });
    const body = this.panel("References by type", "Identifiers, citations, quotes, dates and figures collected by the reference pass.");
    if (!items.length) { body.innerHTML = `<p class="empty">No references found in this text.</p>`; return; }
    this.hbars(body, items);
  }

  yearColumns(state) {
    const years = state.model.entities.filter((e) => e.type === "date" && e.year).map((e) => e.year);
    if (new Set(years).size < 3) return;
    const lo = Math.min(...years), hi = Math.max(...years);
    const bin = hi - lo > 60 ? 10 : hi - lo > 25 ? 5 : 1;
    const start = Math.floor(lo / bin) * bin;
    const bins = [];
    for (let y = start; y <= hi; y += bin) bins.push({ y, n: 0 });
    for (const y of years) bins[Math.floor((y - start) / bin)].n++;
    const body = this.panel("Years mentioned", `Every year the text mentions, in ${bin === 1 ? "single years" : bin + "-year bins"}. In a reference list this is the age of the sources.`);
    const W = this.width(body), H = 170, padL = 30, padB = 22, padT = 10;
    const s = svg(W, H);
    const max = Math.max(...bins.map((b) => b.n));
    const step = (W - padL - 8) / bins.length;
    const bw = Math.min(24, Math.max(2, step - 2));
    const ticks = niceTicks(max);
    for (const t of ticks) {
      const y = H - padB - (t / ticks[ticks.length - 1]) * (H - padB - padT);
      el(s, "line", { x1: padL, x2: W - 4, y1: y, y2: y, stroke: t ? C.grid : C.base, "stroke-width": 1 });
      el(s, "text", { x: padL - 6, y: y + 4, "text-anchor": "end", class: "t-axis" }, t);
    }
    const top = ticks[ticks.length - 1];
    bins.forEach((b, i) => {
      const x = padL + i * step + (step - bw) / 2;
      const h = (b.n / top) * (H - padB - padT);
      if (b.n) {
        const r = Math.min(4, bw / 2, h);
        el(s, "path", { d: `M${x},${H - padB}v-${h - r}a${r},${r} 0 0 1 ${r},-${r}h${bw - 2 * r}a${r},${r} 0 0 1 ${r},${r}v${h - r}z`, fill: C.blue });
      }
      const hit = el(s, "rect", { x: padL + i * step, y: padT, width: step, height: H - padB - padT, fill: "transparent" });
      this.hover(hit, `<b>${b.y}${bin > 1 ? "–" + (b.y + bin - 1) : ""}</b><br>${b.n} mention${b.n === 1 ? "" : "s"}`);
    });
    const labelEvery = Math.ceil(bins.length / Math.floor((W - padL) / 44));
    bins.forEach((b, i) => { if (i % labelEvery === 0) el(s, "text", { x: padL + i * step + step / 2, y: H - 6, "text-anchor": "middle", class: "t-axis" }, b.y); });
    body.appendChild(s);
  }

  keywords(state) {
    const { trends, model } = state;
    const items = trends.top.slice(0, 12).map((e) => ({
      label: e.term, value: e.count,
      tip: `<b>${esc(e.term)}</b><br>${e.count} mentions in ${e.df} paragraph${e.df === 1 ? "" : "s"}<br>importance (TF-IDF) ${e.tfidf.toFixed(1)}<br><span class="muted">Click to jump to the first mention</span>`,
      onClick: () => this.jump({ sentence: e.first })
    }));
    const body = this.panel("Top keywords", "Ranked by how distinctive each word is to its paragraphs (TF-IDF); bars show raw mentions.");
    if (!items.length) { body.innerHTML = `<p class="empty">Too little repeated vocabulary to rank keywords.</p>`; return; }
    this.hbars(body, items);
    if (trends.bigrams.length) {
      const p = document.createElement("p"); p.className = "chips";
      p.innerHTML = `<span class="muted">Common phrases:</span> ` + trends.bigrams.slice(0, 8).map((b) => `<span class="chip">${esc(b.phrase)} <b>${b.count}</b></span>`).join(" ");
      body.appendChild(p);
    }
  }

  termTrends(state) {
    const { trends } = state;
    const picks = [...trends.rising.slice(0, 3), ...trends.fading.slice(0, 3)];
    const pool = picks.length >= 3 ? picks : trends.top.slice(0, 6);
    const body = this.panel("How terms move through the text", `Mentions per 1,000 words across ${trends.segCount} equal slices, start to end. ${picks.length >= 3 ? "Rising terms first, then fading ones." : "Top keywords shown; none rise or fade sharply."}`, true);
    const wrap = document.createElement("div"); wrap.className = "multiples"; body.appendChild(wrap);
    for (const e of pool) {
      const cellEl = document.createElement("div"); cellEl.className = "mult";
      const dir = e.direction === "rising" ? "↗ rising" : e.direction === "fading" ? "↘ fading" : "steady";
      cellEl.innerHTML = `<div class="mlabel"><b>${esc(e.term)}</b> <span class="muted">${dir} · ${e.count}×</span></div>`;
      const W = 220, H = 64, pad = 6;
      const s = svg(W, H);
      const max = Math.max(...e.rate, 1e-6);
      const xs = (i) => pad + (i / (e.rate.length - 1)) * (W - pad * 2 - 6);
      const ys = (v) => H - pad - (v / max) * (H - pad * 2 - 4);
      el(s, "line", { x1: pad, x2: W - pad, y1: H - pad, y2: H - pad, stroke: C.base, "stroke-width": 1 });
      const pts = e.rate.map((v, i) => `${xs(i)},${ys(v)}`).join(" ");
      el(s, "polygon", { points: `${xs(0)},${H - pad} ${pts} ${xs(e.rate.length - 1)},${H - pad}`, fill: C.blue, "fill-opacity": 0.1 });
      el(s, "polyline", { points: pts, fill: "none", stroke: C.blue, "stroke-width": 2, "stroke-linejoin": "round", "stroke-linecap": "round" });
      const li = e.rate.length - 1;
      el(s, "circle", { cx: xs(li), cy: ys(e.rate[li]), r: 4, fill: C.blue, stroke: C.surface, "stroke-width": 2 });
      e.rate.forEach((v, i) => {
        const hit = el(s, "rect", { x: xs(i) - (W / e.rate.length) / 2, y: 0, width: W / e.rate.length, height: H, fill: "transparent" });
        this.hover(hit, `<b>${esc(e.term)}</b> · slice ${i + 1} of ${e.rate.length}<br>${v.toFixed(1)} per 1,000 words`);
      });
      cellEl.appendChild(s);
      wrap.appendChild(cellEl);
    }
  }

  topicStrip(state) {
    const { trends, model } = state;
    if (!trends.topics.length) return;
    const body = this.panel("Topics in reading order", "Paragraphs grouped by shared vocabulary (k-means over keyword weights), drawn start to end at their length. Hover a block to see its opening.", true);
    const W = this.width(body), H = 34;
    const s = svg(W, H);
    const blocks = model.blocks.map((b) => ({ b, words: model.sentences.slice(b.sentStart, b.sentEnd).reduce((n, x) => n + x.wordCount, 0) })).filter((x) => x.words);
    const total = blocks.reduce((n, x) => n + x.words, 0) || 1;
    const usable = W - Math.max(0, blocks.length - 1) * 0;
    let x = 0;
    for (const { b, words } of blocks) {
      const w = (words / total) * usable;
      const tp = trends.blockTopic[b.id];
      const r = el(s, "rect", { x: x + 1, y: 4, width: Math.max(0.6, w - 2), height: H - 8, rx: 2, fill: tp >= 0 ? trends.topics[tp].color : C.mid });
      this.hover(r, `<b>${tp >= 0 ? esc(trends.topics[tp].label) : "No dominant topic"}</b><br><span class="muted">${esc(b.text.slice(0, 110))}…</span><br><span class="muted">Click to jump here</span>`, () => this.jump({ token: b.tokStart }));
      x += w;
    }
    body.appendChild(s);
    const leg = document.createElement("div"); leg.className = "legend";
    leg.innerHTML = trends.topics.map((t) => `<span><i style="background:${t.color}"></i>${esc(t.label)} <span class="muted">${t.blocks} para.</span></span>`).join("");
    body.appendChild(leg);
  }

  cooc(state) {
    const { cooc } = state.trends;
    const n = cooc.terms.length;
    if (n < 4) return;
    const body = this.panel("Which keywords appear together", "Sentences where both words occur. Darker means more often together.");
    const W = this.width(body);
    const lab = 92, cellSz = Math.max(14, Math.min(26, (W - lab - 8) / n));
    const H = lab + n * cellSz + 4;
    const s = svg(lab + n * cellSz + 8, H);
    const max = Math.max(1, ...cooc.matrix.flat());
    cooc.terms.forEach((t, i) => {
      el(s, "text", { x: lab - 6, y: lab + i * cellSz + cellSz * 0.68, "text-anchor": "end", class: "t-axis" }, t.length > 12 ? t.slice(0, 11) + "…" : t);
      const tx = lab + i * cellSz + cellSz * 0.65;
      el(s, "text", { x: tx, y: lab - 6, transform: `rotate(-50 ${tx} ${lab - 6})`, class: "t-axis" }, t.length > 12 ? t.slice(0, 11) + "…" : t);
    });
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      const v = cooc.matrix[i][j];
      const idx = i === j ? -1 : v ? Math.min(C.seq.length - 1, 1 + Math.floor((v / max) * (C.seq.length - 1.01))) : 0;
      const r = el(s, "rect", { x: lab + j * cellSz + 1, y: lab + i * cellSz + 1, width: cellSz - 2, height: cellSz - 2, rx: 2, fill: idx < 0 ? "transparent" : C.seq[idx], stroke: idx < 0 ? C.grid : "none" });
      if (i !== j) this.hover(r, `<b>${esc(cooc.terms[i])}</b> + <b>${esc(cooc.terms[j])}</b><br>together in ${v} sentence${v === 1 ? "" : "s"}`);
    }
    body.appendChild(s);
  }

  moodLine(state) {
    const { tone, model } = state;
    const scores = tone.sentences.map((t) => t.score);
    if (scores.length < 3) return;
    const win = Math.max(1, Math.min(7, Math.round(scores.length / 25)));
    const sm = scores.map((_, i) => { let a = 0, n = 0; for (let k = i - win; k <= i + win; k++) if (k >= 0 && k < scores.length) { a += scores[k]; n++; } return a / n; });
    const body = this.panel("Mood from start to end", `Sentence tone on −1…+1, smoothed over ${win * 2 + 1} sentences. Blue is positive wording, red negative. Hover to read a sentence; click to jump to it.`, true);
    const W = this.width(body), H = 180, padL = 34, padR = 8, padT = 10, padB = 20;
    const s = svg(W, H);
    const lim = Math.max(0.25, ...sm.map(Math.abs));
    const xs = (i) => padL + (i / (sm.length - 1)) * (W - padL - padR);
    const ys = (v) => padT + (1 - (v + lim) / (2 * lim)) * (H - padT - padB);
    for (const v of [lim, lim / 2, 0, -lim / 2, -lim]) {
      el(s, "line", { x1: padL, x2: W - padR, y1: ys(v), y2: ys(v), stroke: v === 0 ? C.base : C.grid, "stroke-width": 1 });
      el(s, "text", { x: padL - 6, y: ys(v) + 4, "text-anchor": "end", class: "t-axis" }, v === 0 ? "0" : (v > 0 ? "+" : "") + v.toFixed(2));
    }
    const id = "c" + Math.random().toString(36).slice(2, 7);
    const defs = el(s, "defs");
    const up = el(defs, "clipPath", { id: id + "u" }); el(up, "rect", { x: 0, y: 0, width: W, height: ys(0) });
    const dn = el(defs, "clipPath", { id: id + "d" }); el(dn, "rect", { x: 0, y: ys(0), width: W, height: H });
    const pts = sm.map((v, i) => `${xs(i)},${ys(v)}`).join(" ");
    const area = `${xs(0)},${ys(0)} ${pts} ${xs(sm.length - 1)},${ys(0)}`;
    el(s, "polygon", { points: area, fill: C.pos, "fill-opacity": 0.22, "clip-path": `url(#${id}u)` });
    el(s, "polygon", { points: area, fill: C.neg, "fill-opacity": 0.22, "clip-path": `url(#${id}d)` });
    el(s, "polyline", { points: pts, fill: "none", stroke: C.pos, "stroke-width": 2, "stroke-linejoin": "round", "clip-path": `url(#${id}u)` });
    el(s, "polyline", { points: pts, fill: "none", stroke: C.neg, "stroke-width": 2, "stroke-linejoin": "round", "clip-path": `url(#${id}d)` });
    el(s, "text", { x: padL, y: H - 4, class: "t-axis" }, "start");
    el(s, "text", { x: W - padR, y: H - 4, "text-anchor": "end", class: "t-axis" }, "end");
    const cross = el(s, "line", { x1: 0, x2: 0, y1: padT, y2: H - padB, stroke: C.ink2, "stroke-width": 1, opacity: 0 });
    const dot = el(s, "circle", { r: 4, fill: C.ink, stroke: C.surface, "stroke-width": 2, opacity: 0 });
    const hit = el(s, "rect", { x: padL, y: 0, width: W - padL - padR, height: H, fill: "transparent" });
    const pick = (e) => {
      const r = s.getBoundingClientRect();
      const x = ((e.clientX - r.left) / r.width) * W;
      return Math.max(0, Math.min(sm.length - 1, Math.round(((x - padL) / (W - padL - padR)) * (sm.length - 1))));
    };
    hit.addEventListener("pointermove", (e) => {
      const i = pick(e);
      cross.setAttribute("x1", xs(i)); cross.setAttribute("x2", xs(i)); cross.setAttribute("opacity", 1);
      dot.setAttribute("cx", xs(i)); dot.setAttribute("cy", ys(sm[i])); dot.setAttribute("opacity", 1);
      const t = tone.sentences[i];
      this.showTip(e, `<b>Sentence ${i + 1}</b> · tone ${t.score >= 0 ? "+" : ""}${t.score.toFixed(2)} (smoothed ${sm[i] >= 0 ? "+" : ""}${sm[i].toFixed(2)})<br><span class="muted">${esc(model.sentences[i].text.slice(0, 180))}</span>`);
    });
    hit.addEventListener("pointerleave", () => { cross.setAttribute("opacity", 0); dot.setAttribute("opacity", 0); this.hideTip(); });
    hit.style.cursor = "pointer";
    hit.addEventListener("click", (e) => { this.hideTip(); this.jump({ sentence: pick(e) }); });
    body.appendChild(s);
  }

  emotionHeat(state) {
    const { tone } = state;
    const segs = tone.seg;
    const body = this.panel("Emotion words by slice", "Emotion-word rate per 100 words in each slice of the text. Darker means more.");
    const W = this.width(body);
    const lab = 70, cw = Math.max(14, (W - lab - 8) / segs.length), ch = 22;
    const H = EMOTION_KEYS.length * ch + 22;
    const s = svg(lab + segs.length * cw + 8, H);
    const max = Math.max(1e-6, ...segs.flatMap((g) => EMOTION_KEYS.map((k) => g.emoRate[k])));
    EMOTION_KEYS.forEach((k, i) => {
      el(s, "text", { x: lab - 6, y: i * ch + ch * 0.68, "text-anchor": "end", class: "t-axis" }, k);
      segs.forEach((g, j) => {
        const v = g.emoRate[k];
        const idx = v ? Math.min(C.seq.length - 1, 1 + Math.floor((v / max) * (C.seq.length - 1.01))) : 0;
        const r = el(s, "rect", { x: lab + j * cw + 1, y: i * ch + 1, width: cw - 2, height: ch - 2, rx: 2, fill: C.seq[idx] });
        this.hover(r, `<b>${k}</b> · slice ${j + 1}<br>${g.emo[k]} word${g.emo[k] === 1 ? "" : "s"} (${v.toFixed(2)} per 100)`);
      });
    });
    el(s, "text", { x: lab, y: H - 4, class: "t-axis" }, "start");
    el(s, "text", { x: lab + segs.length * cw, y: H - 4, "text-anchor": "end", class: "t-axis" }, "end");
    body.appendChild(s);
  }

  hedgeLines(state) {
    const { tone } = state;
    const segs = tone.seg;
    const body = this.panel("Hedging vs. certainty", "Hedges (may, suggests, likely) and certainty words (clearly, proven, must) per 100 words, by slice.");
    const W = this.width(body), H = 170, padL = 30, padR = 74, padT = 10, padB = 20;
    const s = svg(W, H);
    const max = Math.max(0.5, ...segs.map((g) => Math.max(g.hedgeRate, g.boostRate)));
    const ticks = niceTicks(max, true);
    const top = ticks[ticks.length - 1];
    const xs = (i) => padL + (i / Math.max(1, segs.length - 1)) * (W - padL - padR);
    const ys = (v) => H - padB - (v / top) * (H - padT - padB);
    for (const t of ticks) {
      el(s, "line", { x1: padL, x2: W - padR, y1: ys(t), y2: ys(t), stroke: t ? C.grid : C.base, "stroke-width": 1 });
      el(s, "text", { x: padL - 6, y: ys(t) + 4, "text-anchor": "end", class: "t-axis" }, t);
    }
    const series = [["Hedging", "hedgeRate", C.blue], ["Certainty", "boostRate", C.orange]];
    for (const [name, key, color] of series) {
      const pts = segs.map((g, i) => `${xs(i)},${ys(g[key])}`).join(" ");
      el(s, "polyline", { points: pts, fill: "none", stroke: color, "stroke-width": 2, "stroke-linejoin": "round", "stroke-linecap": "round" });
      const li = segs.length - 1;
      el(s, "circle", { cx: xs(li), cy: ys(segs[li][key]), r: 4, fill: color, stroke: C.surface, "stroke-width": 2 });
    }
    // end labels, nudged apart only when they would collide
    let yH = ys(segs[segs.length - 1].hedgeRate), yB = ys(segs[segs.length - 1].boostRate);
    if (Math.abs(yH - yB) < 13) { const m = (yH + yB) / 2; yH = m + (yH >= yB ? 7 : -7); yB = m + (yB > yH ? 7 : -7); }
    el(s, "text", { x: W - padR + 10, y: yH + 4, class: "t-value" }, "Hedging");
    el(s, "text", { x: W - padR + 10, y: yB + 4, class: "t-value" }, "Certainty");
    segs.forEach((g, i) => {
      const hit = el(s, "rect", { x: xs(i) - (W - padL - padR) / segs.length / 2, y: 0, width: (W - padL - padR) / segs.length, height: H, fill: "transparent" });
      this.hover(hit, `<b>Slice ${i + 1}</b><br><i class="sw" style="background:${C.blue}"></i>hedging ${g.hedgeRate.toFixed(2)} per 100 (${g.hedges})<br><i class="sw" style="background:${C.orange}"></i>certainty ${g.boostRate.toFixed(2)} per 100 (${g.boosters})`);
    });
    body.appendChild(s);
    const leg = document.createElement("div"); leg.className = "legend";
    leg.innerHTML = series.map(([n, , c]) => `<span><i style="background:${c}"></i>${n}</span>`).join("");
    body.appendChild(leg);
  }

  uncited(state) {
    const { tone, model } = state;
    const list = tone.sentences.filter((t) => t.uncitedConfident);
    const body = this.panel("Confident claims with no citation nearby", "Sentences that use certainty words, no hedges, and have no citation, link, reference or attributed quote within one sentence.");
    if (!list.length) { body.innerHTML = `<p class="empty">None found. Every confident claim has a source nearby, or there are no confident claims.</p>`; return; }
    const ul = document.createElement("ul"); ul.className = "claims";
    for (const t of list.slice(0, 12)) {
      const li = document.createElement("li");
      li.textContent = model.sentences[t.id].text;
      li.tabIndex = 0;
      li.addEventListener("click", () => this.jump({ sentence: t.id }));
      li.addEventListener("keydown", (e) => { if (e.key === "Enter") this.jump({ sentence: t.id }); });
      ul.appendChild(li);
    }
    body.appendChild(ul);
    if (list.length > 12) { const p = document.createElement("p"); p.className = "muted"; p.textContent = `${list.length - 12} more in sentences.csv (uncited_confident = 1).`; body.appendChild(p); }
  }

  moodByTopic(state) {
    const { model, trends, tone } = state;
    if (!trends.topics.length) return;
    const { byTopic } = combine(model, trends, tone);
    const body = this.panel("Mood by topic", "Combined lenses: the average sentence tone inside each topic. Bars grow right for positive, left for negative.");
    const W = this.width(body), labelW = Math.min(180, W * 0.38), bh = 14, gap = 12;
    const H = byTopic.length * (bh + gap) + 24;
    const s = svg(W, H);
    const lim = Math.max(0.1, ...byTopic.map((d) => Math.abs(d.mean)));
    const zero = labelW + (W - labelW - 50) / 2, half = (W - labelW - 50) / 2;
    el(s, "line", { x1: zero, x2: zero, y1: 0, y2: H - 18, stroke: C.base, "stroke-width": 1 });
    el(s, "text", { x: zero - half, y: H - 4, class: "t-axis" }, "negative");
    el(s, "text", { x: zero + half, y: H - 4, "text-anchor": "end", class: "t-axis" }, "positive");
    byTopic.forEach((d, i) => {
      const y = 2 + i * (bh + gap);
      el(s, "rect", { x: 0, y: y + 3, width: 8, height: 8, rx: 2, fill: d.topic.color });
      el(s, "text", { x: 14, y: y + bh - 3, class: "t-label" }, d.topic.label.length > 24 ? d.topic.label.slice(0, 23) + "…" : d.topic.label);
      const len = (Math.abs(d.mean) / lim) * half;
      el(s, "path", { d: d.mean >= 0 ? barPath(zero, y, len, bh) : barPathLeft(zero, y, len, bh), fill: d.mean >= 0 ? C.pos : C.neg });
      el(s, "text", { x: d.mean >= 0 ? zero + len + 6 : zero - len - 6, y: y + bh - 3, "text-anchor": d.mean >= 0 ? "start" : "end", class: "t-value" }, (d.mean >= 0 ? "+" : "") + d.mean.toFixed(2));
      const hit = el(s, "rect", { x: 0, y: y - gap / 2, width: W, height: bh + gap, fill: "transparent" });
      this.hover(hit, `<b>${esc(d.topic.label)}</b><br>mean tone ${(d.mean >= 0 ? "+" : "") + d.mean.toFixed(2)} over ${d.n} sentences<br>${d.hedges} hedge word${d.hedges === 1 ? "" : "s"}`);
    });
    body.appendChild(s);
  }

  quotes(state) {
    const { model, ran, tone } = state;
    const qs = model.entities.filter((e) => e.type === "quote");
    if (!qs.length) return;
    const body = this.panel("Quotes and who said them", ran.tone ? "Quoted passages with the speaker found nearby, and the tone of the sentence around each." : "Quoted passages with the speaker found nearby. Run Tone to add the tone of each.");
    const ul = document.createElement("ul"); ul.className = "quotes";
    for (const q of qs.slice(0, 14)) {
      const li = document.createElement("li");
      const t = ran.tone ? tone.sentences[q.sentence].score : null;
      li.innerHTML = `<q>${esc(q.norm.slice(0, 220))}</q><div class="by">${q.speaker ? "— " + esc(q.speaker) : '<span class="muted">speaker not found</span>'}${t != null ? ` <span class="tone ${t > 0.05 ? "p" : t < -0.05 ? "n" : ""}">${t > 0.05 ? "positive" : t < -0.05 ? "negative" : "neutral"} ${(t >= 0 ? "+" : "") + t.toFixed(2)}</span>` : ""}</div>`;
      li.tabIndex = 0;
      li.addEventListener("click", () => this.jump({ token: q.tokStart }));
      ul.appendChild(li);
    }
    body.appendChild(ul);
  }

  entityTable(state) {
    const { model } = state;
    if (!model.entities.length) return;
    const body = this.panel("Everything found", "The full reference list as a table. Filter by type; click a row to jump to it. The same data is in entities.csv.", true);
    const types = [...new Set(model.entities.map((e) => e.type))];
    const bar = document.createElement("div"); bar.className = "tbar";
    bar.innerHTML = `<label for="entFilter" class="muted">Type</label> <select id="entFilter"><option value="">All (${model.entities.length})</option>${types.map((t) => `<option value="${t}">${esc(ENTITY_TYPES[t].label)} (${model.entities.filter((e) => e.type === t).length})</option>`).join("")}</select>`;
    body.appendChild(bar);
    const wrap = document.createElement("div"); wrap.className = "twrap";
    body.appendChild(wrap);
    const draw = (type) => {
      const rows = model.entities.filter((e) => !type || e.type === type).slice(0, 400);
      wrap.innerHTML = `<table><thead><tr><th>Type</th><th>Value</th><th>Section</th></tr></thead><tbody>${rows.map((e) => `<tr data-tok="${e.tokStart}"><td>${esc(ENTITY_TYPES[e.type].label)}</td><td>${esc(e.norm.slice(0, 140))}</td><td>${esc((model.sections[e.section]?.title || "").slice(0, 40))}</td></tr>`).join("")}</tbody></table>`;
      wrap.querySelectorAll("tr[data-tok]").forEach((tr) => tr.addEventListener("click", () => this.jump({ token: +tr.dataset.tok })));
    };
    bar.querySelector("select").addEventListener("change", (e) => draw(e.target.value));
    draw("");
  }
}

function niceTicks(max, decimals) {
  if (max <= 0) return [0, 1];
  const raw = max / 4;
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * p).find((s) => s >= raw) || p * 10;
  const out = [];
  for (let v = 0; v <= max + step * 0.999; v += step) out.push(decimals ? +v.toFixed(2) : Math.round(v));
  return [...new Set(out)];
}
