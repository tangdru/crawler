// App wiring: a project of sources in, lenses run per source, themes across the
// project, summary and CSVs out.

import { buildModel, renderModel } from "./model.js";
import { analyzeTrends } from "./trends.js";
import { analyzeTone } from "./tone.js";
import { Crawler } from "./crawler.js";
import { Summary } from "./summary.js";
import { loadFile, loadUrl, fromText } from "./loaders.js";
import { SAMPLES, SAMPLE_PROJECTS } from "./samples.js";
import { ENTITY_TYPES } from "./references.js";
import { entitiesCsv, sentencesCsv, termsCsv, themesCsv, zipAll, saveFile, slug } from "./export.js";
import { requestThemes, verify, indexFor, estimate, checkReady } from "./themes.js";
import { saveProject, loadProject } from "./project.js";

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const LENS_TEXT = {
  references: "References: boxes identifiers, citations, quotes, dates and figures as the crawler reaches them.",
  trends: "Trends: glowing words are keywords (brighter = more distinctive), threads link repeat mentions, and paragraphs take their topic's color.",
  tone: "Tone: blue wash = positive wording, red = negative. Dimmed italics are hedges; underlined words sound certain; emotion words get a label.",
  themes: "Themes: the crawler stops on each quote Claude used as evidence and pins it to its theme on the wall.",
  scan: "Claude is reading every source. The crawler skims along while it works."
};
const LENS_ACCENT = { references: "#ff3fd8", trends: "#33e1ff", tone: "#ffd84d", themes: "#46f08a", scan: "#46f08a" };

const project = { sources: [], active: 0, themes: null, question: "" };
const ui = { lens: "references", view: "doc", themeRun: null };
const newKey = () => Math.random().toString(36).slice(2, 10);

const crawler = new Crawler({
  canvas: $("fx"),
  onProgress: (p) => hud(p),
  onDone: (lens) => finished(lens),
  onEvidence: (theme) => wallPulse(theme),
  getCardPos: (id) => cardPos(id)
});
const summary = new Summary($("summaryView"), $("tip"), { jump });

/* ---------- sources ---------- */
function makeSource(doc, key = newKey(), ran = {}) {
  if (doc.blocks.length && !/^h1$/.test(doc.blocks[0].kind) && doc.title) doc.blocks.unshift({ kind: "h1", segs: [{ text: doc.title }] });
  const model = buildModel(doc);
  if (!model.tokens.length) throw new Error("No readable text was found in that source.");
  const trends = analyzeTrends(model);
  const tone = analyzeTone(model, trends);
  return { key, doc, model, trends, tone, ran: { ...ran } };
}
const active = () => project.sources[project.active];

function persist() {
  saveProject({
    sources: project.sources.map((s) => ({ key: s.key, doc: s.doc, ran: s.ran })),
    active: project.active, themes: project.themes, question: project.question
  });
}

function addSources(docs, { replace = false } = {}) {
  const made = docs.map((d) => makeSource(d));
  if (replace) { project.sources = []; project.themes = null; }
  project.sources.push(...made);
  project.active = project.sources.length - made.length;
  persist();
  showSource(project.active);
}

function removeSource(i) {
  const [gone] = project.sources.splice(i, 1);
  if (project.themes) {
    for (const t of project.themes.themes) t.evidence = t.evidence.filter((e) => e.sourceKey !== gone.key);
    project.themes.themes = project.themes.themes.filter((t) => t.evidence.length);
    if (!project.themes.themes.length) project.themes = null;
  }
  if (!project.sources.length) { persist(); openSample("river"); return; }
  project.active = Math.min(project.active, project.sources.length - 1);
  persist();
  showSource(project.active);
}

function showSource(i, { autoplay = true, lens } = {}) {
  project.active = i;
  const src = active();
  renderSourceBar();
  renderMeta(src.model);
  renderModel(src.model, $("doc"));
  crawler.load(src.model, analysesFor(src));
  (document.fonts ? document.fonts.ready : Promise.resolve()).then(() => crawler.measure());
  let l = lens || ui.lens;
  if (l === "themes" && !project.themes) l = "references";
  startLens(l, autoplay);
}

function analysesFor(src) {
  return { trends: src.trends, tone: src.tone, themeIndex: indexFor(project.themes, src.key) };
}

function renderSourceBar() {
  const bar = $("sourceBar");
  bar.textContent = "";
  project.sources.forEach((src, i) => {
    const chip = document.createElement("div");
    chip.className = "src-chip" + (i === project.active ? " on" : "");
    const lensDots = ["references", "trends", "tone"].filter((l) => src.ran[l]).map((l) => `<i class="ld ${l}" title="${l} has run"></i>`).join("");
    chip.innerHTML = `<button type="button" class="pick" title="${esc(src.model.title)}"><b>S${i + 1}</b> ${esc(src.model.title.length > 34 ? src.model.title.slice(0, 33) + "…" : src.model.title)} ${lensDots}</button><button type="button" class="rm" aria-label="Remove ${esc(src.model.title)}">×</button>`;
    chip.querySelector(".pick").addEventListener("click", () => { if (i !== project.active) showSource(i); });
    chip.querySelector(".rm").addEventListener("click", () => removeSource(i));
    bar.appendChild(chip);
  });
  const add = document.createElement("button");
  add.type = "button"; add.className = "src-add"; add.textContent = "+ Add source";
  add.addEventListener("click", openSheet);
  bar.appendChild(add);
}

function renderMeta(model) {
  const m = model.meta, el = $("docMeta");
  el.textContent = "";
  const line = (html, cls) => { const d = document.createElement("div"); if (cls) d.className = cls; d.innerHTML = html; el.appendChild(d); };
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
function openSheet() { setPlaying(false); sheetError(""); $("sheet").hidden = false; $("urlIn").focus(); }

async function openFrom(kind, value) {
  sheetError("");
  try {
    const doc = await withBusy(kind === "url" ? "Fetching the page…" : kind === "file" ? `Reading ${value.name}…` : "Reading…", async () => {
      if (kind === "url") return loadUrl(value);
      if (kind === "file") return loadFile(value);
      return fromText(value, "");
    });
    addSources([doc], { replace: $("replaceProject").checked });
    $("replaceProject").checked = false;
    $("sheet").hidden = true;
    toast(`Added S${project.sources.length}: ${active().model.title.slice(0, 50)}`);
  } catch (err) {
    console.error(err);
    $("sheet").hidden = false;
    sheetError(err.message || String(err));
  }
}

async function openFiles(files) {
  for (const f of files) await openFrom("file", f);
}

function openSample(name) {
  const p = SAMPLE_PROJECTS[name];
  addSources(p.sources.map((k) => SAMPLES[k]()), { replace: true });
  $("sheet").hidden = true;
}

/* ---------- lenses ---------- */
function startLens(lens, autoplay = true) {
  ui.lens = lens;
  document.querySelectorAll("[data-lens]").forEach((b) => b.setAttribute("aria-checked", String(b.dataset.lens === (lens === "scan" ? "themes" : lens))));
  document.documentElement.style.setProperty("--accent", LENS_ACCENT[lens]);
  setView("doc");
  crawler.load(active().model, analysesFor(active()));
  crawler.start(lens);
  setPlaying(autoplay && !crawler.reduceMotion);
  $("hudLine").textContent = LENS_TEXT[lens];
  renderWall();
}

function chooseLens(lens) {
  if (!project.sources.length) return;
  if (lens === "themes") {
    if (ui.themeRun) { startLens("scan"); return; }
    if (project.themes && themesCurrent()) { startLens("themes"); return; }
    openThemesSheet();
    return;
  }
  startLens(lens);
}

function setPlaying(v) {
  if (v && crawler.done) crawler.start(ui.lens);
  crawler.setPlaying(v);
  $("play").textContent = v ? "Pause" : crawler.done ? "Replay" : "Play";
}

function finished(lens) {
  if (lens === "scan") {
    // keep skimming until Claude answers
    if (ui.themeRun) { crawler.start("scan"); crawler.setPlaying(true); }
    return;
  }
  const src = active();
  const key = lens === "themes" ? null : lens;
  const first = key && !src.ran[key];
  if (key) { src.ran[key] = true; persist(); renderSourceBar(); }
  $("play").textContent = "Replay";
  if (ui.view === "summary") summary.render(project);
  toast(lens === "themes" ? "Themes are in the summary" : first ? `${lens[0].toUpperCase() + lens.slice(1)} added to the summary` : "Summary updated");
  setTimeout(() => { if (crawler.done && ui.view === "doc" && crawler.lens === lens) setView("summary"); }, 1400);
}

/* ---------- themes ---------- */
const themesCurrent = () => project.themes && project.sources.every((s) => project.themes.sourceKeys.includes(s.key));

async function openThemesSheet() {
  setPlaying(false);
  const est = estimate(project.sources);
  const n = project.sources.length;
  $("themesInfo").innerHTML = `Claude will read <b>${n} source${n === 1 ? "" : "s"}</b> (about ${Math.round(est.inTok / 1000)}k tokens) and return themes with supporting quotes. Estimated cost: <b>about $${est.dollars < 0.1 ? est.dollars.toFixed(2) : est.dollars.toFixed(2)}</b> on your Anthropic account. Usually 20 seconds to 2 minutes.`;
  $("themesQuestion").value = project.question || "";
  $("themesError").hidden = true;
  $("themesRun").disabled = est.tooLong;
  if (est.tooLong) { $("themesError").textContent = "These sources are too long to analyse together. Remove a source or two first."; $("themesError").hidden = false; }
  $("themesStale").hidden = !(project.themes && !themesCurrent());
  $("themesSheet").hidden = false;
  const ready = await checkReady();
  if (!ready.ready) {
    $("themesError").textContent = ready.reason === "no_key"
      ? "Theme finding isn't set up: the Supabase project has no Anthropic API key."
      : "Can't reach the theme service from here. Themes work on the app's own site, tangdru.github.io/crawler.";
    $("themesError").hidden = false;
    $("themesRun").disabled = true;
  }
}

async function runThemes() {
  const question = $("themesQuestion").value.trim();
  project.question = question;
  $("themesSheet").hidden = true;
  const sources = project.sources.slice();
  ui.themeRun = { started: performance.now(), chars: 0, seconds: 0 };
  startLens("scan");
  try {
    const raw = await requestThemes(sources, question, (p) => { if (ui.themeRun) { ui.themeRun.chars = p.chars; ui.themeRun.seconds = p.seconds; } });
    const checked = verify(raw, sources);
    if (!checked.themes.length) throw new Error("Claude's answer had no quotes that could be found in the text, so nothing is shown. Try again.");
    project.themes = { ...checked, question, sourceKeys: sources.map((s) => s.key), model: raw.model, usage: raw.usage, at: new Date().toISOString() };
    ui.themeRun = null;
    persist();
    const u = raw.usage || {};
    toast(`Found ${checked.themes.length} themes${checked.dropped ? `; ${checked.dropped} unverifiable quote${checked.dropped === 1 ? "" : "s"} removed` : ""} · ${(u.input_tokens || 0).toLocaleString("en-US")} in / ${(u.output_tokens || 0).toLocaleString("en-US")} out tokens`);
    startLens("themes");
  } catch (err) {
    ui.themeRun = null;
    console.error(err);
    startLens("references", false);
    $("themesError").textContent = err.message || String(err);
    $("themesError").hidden = false;
    $("themesSheet").hidden = false;
  }
}

/* ---------- theme wall ---------- */
function renderWall() {
  const wall = $("wall");
  const show = ui.lens === "themes" && project.themes && ui.view === "doc";
  wall.hidden = !show;
  if (!show) return;
  const here = indexFor(project.themes, active().key);
  const countHere = new Map();
  for (const hits of here.values()) for (const h of hits) countHere.set(h.theme.id, (countHere.get(h.theme.id) || 0) + 1);
  $("wallSub").textContent = `· pinned as the crawler reads S${project.active + 1}`;
  const cards = $("wallCards");
  cards.textContent = "";
  for (const t of project.themes.themes) {
    const card = document.createElement("div");
    card.className = "wcard";
    card.dataset.theme = t.id;
    card.style.setProperty("--tc", t.color);
    const total = t.evidence.length;
    card.innerHTML = `<div class="wt"><span class="num">${t.id + 1}</span>${esc(t.title)}</div><div class="wn"><b data-n>0</b>/${countHere.get(t.id) || 0} here · ${total} in project${t.kind === "tension" ? " · tension" : ""}</div><div class="wq" data-q></div>`;
    card.addEventListener("click", () => { setView("summary"); });
    cards.appendChild(card);
  }
}
function wallPulse(theme) {
  const card = $("wall").querySelector(`[data-theme="${theme.id}"]`);
  if (!card) return;
  const n = card.querySelector("[data-n]");
  n.textContent = +n.textContent + 1;
  card.classList.remove("pulse"); void card.offsetWidth; card.classList.add("pulse");
}
function cardPos(id) {
  const wall = $("wall");
  if (wall.hidden) return null;
  const card = wall.querySelector(`[data-theme="${id}"]`);
  if (!card) return null;
  const r = card.getBoundingClientRect();
  if (r.bottom < 0 || r.top > window.innerHeight) return null;
  return { x: r.left, y: r.top + 14 };
}

/* ---------- views ---------- */
function setView(v) {
  ui.view = v;
  document.querySelectorAll("[data-view]").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.view === v)));
  $("docView").hidden = v !== "doc";
  $("fx").hidden = v !== "doc";
  $("summaryView").hidden = v !== "summary";
  document.body.classList.toggle("summary-mode", v === "summary");
  crawler.visible = v === "doc";
  if (v === "summary") {
    if (project.sources.length) summary.render(project);
    window.scrollTo(0, 0);
  } else {
    requestAnimationFrame(() => crawler.measure());
  }
  renderWall();
}

function jump({ token, sentence, sourceKey, sourceIndex }) {
  let i = project.active;
  if (sourceKey) i = project.sources.findIndex((s) => s.key === sourceKey);
  if (sourceIndex != null) i = sourceIndex;
  if (i < 0) return;
  if (i !== project.active) showSource(i, { autoplay: false });
  const m = active().model;
  if (token == null && sentence != null) token = m.sentences[sentence]?.tokStart;
  if (token == null) { setView("doc"); return; }
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
  if (p.lens === "scan") {
    const r = ui.themeRun;
    const secs = r ? Math.round((performance.now() - r.started) / 1000) : 0;
    add(`Claude is reading ${project.sources.length} source${project.sources.length === 1 ? "" : "s"}`, "stat");
    add(`<b>${secs}s</b>`, "stat");
    if (r && r.chars) add(`writing themes <b>${(r.chars / 1000).toFixed(1)}k</b> chars`, "hchip", "#46f08a");
    else add("thinking…", "hchip", "#46f08a");
    return;
  }
  add(`S${project.active + 1} read <b>${p.idx.toLocaleString("en-US")}</b>/${p.total.toLocaleString("en-US")}`, "stat");
  if (p.lens === "references") {
    const n = Object.values(p.counts).reduce((a, b) => a + b, 0);
    add(`found <b>${n}</b>`, "stat");
    for (const [k, v] of Object.entries(p.counts).sort((a, b) => b[1] - a[1]).slice(0, 7)) add(`${ENTITY_TYPES[k].label} <b>${v}</b>`, "hchip", ENTITY_TYPES[k].color);
  } else if (p.lens === "trends") {
    const top = [...p.seen.values()].sort((a, b) => b.n - a.n || a.entry.rank - b.entry.rank).slice(0, 6);
    add(`keywords <b>${p.seen.size}</b>`, "stat");
    for (const s of top) add(`${esc(s.entry.term)} <b>×${s.n}</b>`, "hchip", "#33e1ff");
  } else if (p.lens === "themes") {
    add(`${project.themes.themes.length} themes`, "stat");
    const wall = $("wall");
    for (const c of [...wall.querySelectorAll(".wcard")].slice(0, 5)) {
      const id = +c.dataset.theme, t = project.themes.themes[id];
      add(`${id + 1} <b>${c.querySelector("[data-n]").textContent}</b>`, "hchip", t.color);
    }
  } else {
    add(`mood`, "stat");
    if (!sparkCanvas) { sparkCanvas = document.createElement("canvas"); sparkCanvas.id = "moodSpark"; sparkCanvas.width = 240; sparkCanvas.height = 40; }
    sparkCanvas.style.width = "120px"; sparkCanvas.style.height = "20px";
    stats.appendChild(sparkCanvas);
    drawSpark(sparkCanvas, p.mood);
    const tn = active().tone;
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
  toastTimer = setTimeout(() => { t.hidden = true; }, 3200);
}

/* ---------- export ---------- */
async function doExport(kind) {
  if (!project.sources.length) return;
  const base = slug(project.sources.length > 1 ? `project-${project.sources.length}-sources` : project.sources[0].model.title);
  try {
    if (kind === "entities") await saveFile(`${base}-entities.csv`, entitiesCsv(project));
    else if (kind === "sentences") await saveFile(`${base}-sentences.csv`, sentencesCsv(project));
    else if (kind === "terms") {
      if (!project.sources.some((s) => s.ran.trends)) { toast("Run the Trends lens first; terms.csv comes from it."); return; }
      await saveFile(`${base}-terms.csv`, termsCsv(project));
    } else if (kind === "themes") {
      if (!project.themes) { toast("Run the Themes lens first; themes.csv comes from it."); return; }
      await saveFile(`${base}-themes.csv`, themesCsv(project));
    } else await saveFile(`${base}-csv.zip`, await zipAll(project, base), "application/zip");
  } catch (e) {
    toast(e && e.message ? `Export failed: ${e.message}` : "Export failed");
  }
}

/* ---------- controls ---------- */
document.querySelectorAll("[data-lens]").forEach((b) => b.addEventListener("click", () => chooseLens(b.dataset.lens)));
document.querySelectorAll("[data-view]").forEach((b) => b.addEventListener("click", () => { if (b.dataset.view === "summary" && ui.lens !== "scan") setPlaying(false); setView(b.dataset.view); }));
$("play").addEventListener("click", () => { setView("doc"); setPlaying(!crawler.playing); });
$("speed").addEventListener("change", (e) => { crawler.speed = parseFloat(e.target.value); });
$("skip").addEventListener("click", () => { if (project.sources.length && !crawler.done && ui.lens !== "scan") { setView("doc"); crawler.skip(); } });
$("openBtn").addEventListener("click", openSheet);
$("closeSheet").addEventListener("click", () => { $("sheet").hidden = true; });
$("sheet").addEventListener("click", (e) => { if (e.target === $("sheet")) $("sheet").hidden = true; });
$("urlForm").addEventListener("submit", (e) => { e.preventDefault(); const v = $("urlIn").value.trim(); if (v) openFrom("url", v); else sheetError("Type or paste a web address first."); });
$("pasteForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const v = $("pasteIn").value.trim();
  if (!v) { sheetError("Paste some text first, then press Add this text."); return; }
  if (/^https?:\/\/\S+$/i.test(v)) openFrom("url", v); else openFrom("text", v);
});
$("fileIn").addEventListener("change", (e) => { const fs = [...e.target.files]; if (fs.length) openFiles(fs); e.target.value = ""; });
document.querySelectorAll("[data-sample]").forEach((b) => b.addEventListener("click", () => openSample(b.dataset.sample)));
$("themesRun").addEventListener("click", runThemes);
$("themesCancel").addEventListener("click", () => { $("themesSheet").hidden = true; if (project.themes) startLens("themes"); });
$("themesSheet").addEventListener("click", (e) => { if (e.target === $("themesSheet")) $("themesSheet").hidden = true; });
$("themesShowOld").addEventListener("click", () => { $("themesSheet").hidden = true; startLens("themes"); });
$("rerunThemes").addEventListener("click", openThemesSheet);

const drop = $("drop");
["dragenter", "dragover"].forEach((ev) => window.addEventListener(ev, (e) => { if (e.dataTransfer && [...e.dataTransfer.types].includes("Files")) { e.preventDefault(); drop.classList.add("over"); } }));
["dragleave", "drop"].forEach((ev) => window.addEventListener(ev, () => drop.classList.remove("over")));
window.addEventListener("drop", (e) => {
  const fs = e.dataTransfer ? [...e.dataTransfer.files] : [];
  if (!fs.length) return;
  e.preventDefault();
  openFiles(fs);
});

const exportBtn = $("exportBtn"), exportMenu = $("exportMenu");
exportBtn.addEventListener("click", () => { const open = exportMenu.hidden; exportMenu.hidden = !open; exportBtn.setAttribute("aria-expanded", String(open)); });
document.addEventListener("click", (e) => { if (!e.target.closest(".menu")) { exportMenu.hidden = true; exportBtn.setAttribute("aria-expanded", "false"); } });
exportMenu.querySelectorAll("[data-export]").forEach((b) => b.addEventListener("click", () => { exportMenu.hidden = true; doExport(b.dataset.export); }));

window.addEventListener("keydown", (e) => {
  if (e.target.closest("input, textarea, select, [contenteditable]")) return;
  if (e.key === "Escape") { $("sheet").hidden = true; $("themesSheet").hidden = true; exportMenu.hidden = true; return; }
  if (!$("sheet").hidden || !$("themesSheet").hidden) return;
  if (e.code === "Space") { e.preventDefault(); setView("doc"); setPlaying(!crawler.playing); }
  else if (e.key === "1") chooseLens("references");
  else if (e.key === "2") chooseLens("trends");
  else if (e.key === "3") chooseLens("tone");
  else if (e.key === "4") chooseLens("themes");
});
let resizeTimer = 0;
window.addEventListener("resize", () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(() => { if (ui.view === "summary" && project.sources.length) summary.render(project); }, 200); });

/* ---------- boot ---------- */
(async () => {
  const params = new URLSearchParams(location.search);
  const saved = await loadProject();
  if (saved && saved.sources && saved.sources.length) {
    try {
      project.sources = saved.sources.map((s) => makeSource(s.doc, s.key, s.ran));
      project.themes = saved.themes || null;
      project.question = saved.question || "";
      project.active = Math.min(saved.active || 0, project.sources.length - 1);
    } catch (e) { console.error(e); project.sources = []; }
  }
  if (params.get("url")) {
    if (!project.sources.length) addSources([SAMPLES.article()], { replace: true });
    openFrom("url", params.get("url"));
  } else if (project.sources.length) {
    showSource(project.active);
  } else {
    openSample("river");
  }
})();
