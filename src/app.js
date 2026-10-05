// App wiring: sources in, lenses run, summary out.

import { buildModel, renderModel } from "./model.js";
import { analyzeTrends } from "./trends.js";
import { analyzeTone } from "./tone.js";
import { Crawler } from "./crawler.js";
import { Summary } from "./summary.js";
import { loadFile, loadUrl, fromText } from "./loaders.js";
import { SAMPLES } from "./samples.js";
import { ENTITY_TYPES } from "./references.js";
import { entitiesCsv, sentencesCsv, termsCsv, zipAll, saveFile, slug } from "./export.js";

const $ = (id) => document.getElementById(id);
const LENS_TEXT = {
  references: "References: boxes identifiers, citations, quotes, dates and figures as the crawler reaches them.",
  trends: "Trends: glowing words are keywords (brighter = more distinctive), threads link repeat mentions, and paragraphs take their topic's color.",
  tone: "Tone: blue wash = positive wording, red = negative. Dimmed italics are hedges; underlined words sound certain; emotion words get a label."
};
const LENS_ACCENT = { references: "#ff3fd8", trends: "#33e1ff", tone: "#ffd84d" };

const state = { model: null, trends: null, tone: null, ran: {}, lens: "references", view: "doc" };

const crawler = new Crawler({
  canvas: $("fx"),
  onProgress: (p) => hud(p),
  onDone: (lens) => finished(lens)
});
const summary = new Summary($("summaryView"), $("tip"), { jump });

/* ---------- loading ---------- */
function openDoc(doc, { autoplay = true } = {}) {
  const model = buildModel(doc);
  if (!model.tokens.length) throw new Error("No readable text was found in that source.");
  state.model = model;
  state.trends = analyzeTrends(model);
  state.tone = analyzeTone(model, state.trends);
  state.ran = {};
  renderMeta(model);
  renderModel(model, $("doc"));
  setView("doc");
  crawler.load(model, { trends: state.trends, tone: state.tone });
  // fonts change line breaks; re-measure once they settle
  (document.fonts ? document.fonts.ready : Promise.resolve()).then(() => crawler.measure());
  startLens(state.lens, autoplay);
}

function renderMeta(model) {
  const m = model.meta, el = $("docMeta");
  el.textContent = "";
  const line = (html, cls) => { const d = document.createElement("div"); if (cls) d.className = cls; d.innerHTML = html; el.appendChild(d); };
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  if (m.note) line(esc(m.note));
  if (m.url) line(`Source: <a href="${esc(m.url)}" target="_blank" rel="noopener">${esc(m.url.replace(/^https?:\/\//, "").slice(0, 90))}</a>${m.via === "jina" ? " · read through a headless browser" : ""}`);
  if (m.file) line(`File: ${esc(m.file)}`);
  const by = [m.author && `By ${esc(m.author)}`, m.site && esc(m.site), m.published && esc(String(m.published).slice(0, 10))].filter(Boolean).join(" · ");
  if (by) line(by);
  line(`${model.wordCount.toLocaleString("en-US")} words · ${model.sentences.length.toLocaleString("en-US")} sentences · ${model.entities.length.toLocaleString("en-US")} references found`);
  if (model.truncated) line(`This document is long, so only the first ${model.wordCount.toLocaleString("en-US")} words are shown and analyzed.`, "warn");
}

async function withBusy(text, fn) {
  $("busyText").textContent = text;
  $("busy").hidden = false;
  try { return await fn(); }
  finally { $("busy").hidden = true; }
}

function sheetError(msg) { const e = $("sheetError"); e.textContent = msg || ""; e.hidden = !msg; }

async function openFrom(kind, value) {
  sheetError("");
  try {
    const doc = await withBusy(kind === "url" ? "Fetching the page…" : kind === "file" ? `Reading ${value.name}…` : "Reading…", async () => {
      if (kind === "url") return loadUrl(value);
      if (kind === "file") return loadFile(value);
      if (kind === "sample") return SAMPLES[value]();
      return fromText(value, "");
    });
    if (doc.blocks.length && !/^h1$/.test(doc.blocks[0].kind) && doc.title) doc.blocks.unshift({ kind: "h1", segs: [{ text: doc.title }] });
    openDoc(doc);
    $("sheet").hidden = true;
  } catch (err) {
    console.error(err);
    if ($("sheet").hidden) { $("sheet").hidden = false; }
    sheetError(err.message || String(err));
  }
}

/* ---------- lenses ---------- */
function startLens(lens, autoplay = true) {
  state.lens = lens;
  document.querySelectorAll("[data-lens]").forEach((b) => b.setAttribute("aria-checked", String(b.dataset.lens === lens)));
  document.documentElement.style.setProperty("--accent", LENS_ACCENT[lens]);
  setView("doc");
  crawler.start(lens);
  setPlaying(autoplay && !crawler.reduceMotion);
  $("hudLine").textContent = LENS_TEXT[lens];
}

function setPlaying(v) {
  if (v && crawler.done) { crawler.start(state.lens); }
  crawler.setPlaying(v);
  $("play").textContent = v ? "Pause" : crawler.done ? "Replay" : "Play";
}

function finished(lens) {
  const first = !state.ran[lens];
  state.ran[lens] = true;
  $("play").textContent = "Replay";
  if (state.view === "summary") summary.render(state);
  toast(first ? `${lens[0].toUpperCase() + lens.slice(1)} added to the summary` : "Summary updated");
  setTimeout(() => { if (crawler.done && state.view === "doc" && crawler.lens === lens) setView("summary"); }, 1400);
}

/* ---------- views ---------- */
function setView(v) {
  state.view = v;
  document.querySelectorAll("[data-view]").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.view === v)));
  $("docView").hidden = v !== "doc";
  $("fx").hidden = v !== "doc";
  $("summaryView").hidden = v !== "summary";
  document.body.classList.toggle("summary-mode", v === "summary");
  crawler.visible = v === "doc";
  if (v === "summary") {
    if (state.model) summary.render(state);
    window.scrollTo(0, 0);
  } else {
    requestAnimationFrame(() => crawler.measure());
  }
}

function jump({ token, sentence }) {
  const m = state.model;
  if (!m) return;
  if (token == null && sentence != null) token = m.sentences[sentence]?.tokStart;
  const t = m.tokens[token];
  if (!t || !t.el) return;
  setPlaying(false);
  setView("doc");
  requestAnimationFrame(() => {
    crawler.measure();
    const target = t.el.closest("[data-block]") || t.el;
    t.el.scrollIntoView({ block: "center", behavior: crawler.reduceMotion ? "auto" : "smooth" });
    crawler.userScrollUntil = performance.now() + 4000;
    target.classList.remove("flash"); void target.offsetWidth; target.classList.add("flash");
    crawler.gaze = { x: t.cx, y: t.cy };
  });
}

/* ---------- hud ---------- */
let sparkCanvas = null;
function hud(p) {
  $("progBar").style.width = (p.total ? (p.idx / p.total) * 100 : 0) + "%";
  const stats = $("hudStats");
  stats.textContent = "";
  const add = (html, cls, color) => { const s = document.createElement("span"); s.className = cls; if (color) s.style.setProperty("--c", color); s.innerHTML = html; stats.appendChild(s); };
  add(`read <b>${p.idx.toLocaleString("en-US")}</b>/${p.total.toLocaleString("en-US")}`, "stat");
  if (p.lens === "references") {
    const n = Object.values(p.counts).reduce((a, b) => a + b, 0);
    add(`found <b>${n}</b>`, "stat");
    for (const [k, v] of Object.entries(p.counts).sort((a, b) => b[1] - a[1]).slice(0, 7)) add(`${ENTITY_TYPES[k].label} <b>${v}</b>`, "hchip", ENTITY_TYPES[k].color);
  } else if (p.lens === "trends") {
    const top = [...p.seen.values()].sort((a, b) => b.n - a.n || a.entry.rank - b.entry.rank).slice(0, 6);
    add(`keywords <b>${p.seen.size}</b>`, "stat");
    for (const s of top) add(`${s.entry.term} <b>×${s.n}</b>`, "hchip", "#33e1ff");
  } else {
    add(`mood`, "stat");
    if (!sparkCanvas) { sparkCanvas = document.createElement("canvas"); sparkCanvas.id = "moodSpark"; sparkCanvas.width = 240; sparkCanvas.height = 40; }
    sparkCanvas.style.width = "120px"; sparkCanvas.style.height = "20px";
    stats.appendChild(sparkCanvas);
    drawSpark(sparkCanvas, p.mood);
    const tn = state.tone;
    let h = 0, b = 0;
    for (let i = 0; i < p.idx; i++) { const mk = tn.tokTone.get(i); if (mk) { if (mk.hedge) h++; if (mk.boost) b++; } }
    add(`hedges <b>${h}</b>`, "hchip", "#9aa0b4");
    add(`certain <b>${b}</b>`, "hchip", "#ffffff");
  }
}
function drawSpark(cv, mood) {
  const c = cv.getContext("2d"), W = cv.width, H = cv.height;
  c.clearRect(0, 0, W, H);
  c.strokeStyle = "#3a3b52"; c.lineWidth = 2;
  c.beginPath(); c.moveTo(0, H / 2); c.lineTo(W, H / 2); c.stroke();
  const pts = mood.slice(-60);
  if (pts.length < 2) return;
  for (let i = 1; i < pts.length; i++) {
    const v = (pts[i] + pts[i - 1]) / 2;
    c.strokeStyle = v >= 0 ? "#3987e5" : "#e66767"; c.lineWidth = 3;
    c.beginPath();
    c.moveTo(((i - 1) / 59) * W, H / 2 - pts[i - 1] * (H / 2 - 3));
    c.lineTo((i / 59) * W, H / 2 - pts[i] * (H / 2 - 3));
    c.stroke();
  }
}

let toastTimer = 0;
function toast(msg) {
  const t = $("toast");
  t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 2600);
}

/* ---------- export ---------- */
async function doExport(kind) {
  if (!state.model) return;
  const base = slug(state.model.title);
  try {
    if (kind === "entities") await saveFile(`${base}-entities.csv`, entitiesCsv(state));
    else if (kind === "sentences") await saveFile(`${base}-sentences.csv`, sentencesCsv(state));
    else if (kind === "terms") {
      if (!state.ran.trends) { toast("Run the Trends lens first; terms.csv comes from it."); return; }
      await saveFile(`${base}-terms.csv`, termsCsv(state));
    } else await saveFile(`${base}-csv.zip`, await zipAll(state), "application/zip");
  } catch (e) {
    toast(e && e.message ? `Export failed: ${e.message}` : "Export failed");
  }
}

/* ---------- controls ---------- */
document.querySelectorAll("[data-lens]").forEach((b) => b.addEventListener("click", () => { if (state.model) startLens(b.dataset.lens); }));
document.querySelectorAll("[data-view]").forEach((b) => b.addEventListener("click", () => { if (b.dataset.view === "summary") setPlaying(false); setView(b.dataset.view); }));
$("play").addEventListener("click", () => { setView("doc"); setPlaying(!crawler.playing); });
$("speed").addEventListener("change", (e) => { crawler.speed = parseFloat(e.target.value); });
$("skip").addEventListener("click", () => { if (state.model && !crawler.done) { setView("doc"); crawler.skip(); } });
$("openBtn").addEventListener("click", () => { setPlaying(false); sheetError(""); $("sheet").hidden = false; $("urlIn").focus(); });
$("closeSheet").addEventListener("click", () => { $("sheet").hidden = true; });
$("sheet").addEventListener("click", (e) => { if (e.target === $("sheet")) $("sheet").hidden = true; });
$("urlForm").addEventListener("submit", (e) => { e.preventDefault(); const v = $("urlIn").value.trim(); if (v) openFrom("url", v); else sheetError("Type or paste a web address first."); });
$("pasteForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const v = $("pasteIn").value.trim();
  if (!v) { sheetError("Paste some text first, then press Crawl this text."); return; }
  if (/^https?:\/\/\S+$/i.test(v)) openFrom("url", v); else openFrom("text", v);
});
$("fileIn").addEventListener("change", (e) => { const f = e.target.files[0]; if (f) openFrom("file", f); e.target.value = ""; });
document.querySelectorAll("[data-sample]").forEach((b) => b.addEventListener("click", () => openFrom("sample", b.dataset.sample)));

const drop = $("drop");
["dragenter", "dragover"].forEach((ev) => window.addEventListener(ev, (e) => { if (e.dataTransfer && [...e.dataTransfer.types].includes("Files")) { e.preventDefault(); drop.classList.add("over"); } }));
["dragleave", "drop"].forEach((ev) => window.addEventListener(ev, () => drop.classList.remove("over")));
window.addEventListener("drop", (e) => {
  const f = e.dataTransfer && e.dataTransfer.files[0];
  if (!f) return;
  e.preventDefault();
  openFrom("file", f);
});

const exportBtn = $("exportBtn"), exportMenu = $("exportMenu");
exportBtn.addEventListener("click", () => { const open = exportMenu.hidden; exportMenu.hidden = !open; exportBtn.setAttribute("aria-expanded", String(open)); });
document.addEventListener("click", (e) => { if (!e.target.closest(".menu")) { exportMenu.hidden = true; exportBtn.setAttribute("aria-expanded", "false"); } });
exportMenu.querySelectorAll("[data-export]").forEach((b) => b.addEventListener("click", () => { exportMenu.hidden = true; doExport(b.dataset.export); }));

window.addEventListener("keydown", (e) => {
  if (e.target.closest("input, textarea, select, [contenteditable]")) return;
  if (e.key === "Escape") { $("sheet").hidden = true; exportMenu.hidden = true; return; }
  if (!$("sheet").hidden) return;
  if (e.code === "Space") { e.preventDefault(); setView("doc"); setPlaying(!crawler.playing); }
  else if (e.key === "1") startLens("references");
  else if (e.key === "2") startLens("trends");
  else if (e.key === "3") startLens("tone");
});
let resizeTimer = 0;
window.addEventListener("resize", () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(() => { if (state.view === "summary" && state.model) summary.render(state); }, 200); });

/* ---------- boot ---------- */
const params = new URLSearchParams(location.search);
if (params.get("url")) openFrom("url", params.get("url"));
else openFrom("sample", "references");
