// App wiring: a project of sources in, lenses run per source, Claude's Insights and UXR
// across the project, summary and CSVs out.

import { buildModel, renderModel } from "./model.js";
import { analyzeTrends } from "./trends.js";
import { analyzeTone } from "./tone.js";
import { Crawler } from "./crawler.js";
import { Summary } from "./summary.js";
import { loadFile, loadUrl, fromText, sandboxed } from "./loaders.js";
import { SAMPLES, SAMPLE_PROJECTS } from "./samples.js";
import { ENTITY_TYPES } from "./references.js";
import { entitiesCsv, sentencesCsv, termsCsv, insightsCsv, uxrCsv, zipAll, saveFile, slug } from "./export.js";
import { request, verifyInsights, verifyUxr, verifyAsk, upgradeUxr, cardsFor, indexFor, pruneSource, estimate, money, checkReady, isAI, AI_LENSES, AI_NAME } from "./ai.js";
import { saveProject, loadProject } from "./project.js";
import { LENSES, LENS } from "./lenses.js";
import { combine } from "./combine.js";

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const LENS_TEXT = {
  references: "References: boxes identifiers, citations, quotes, dates and figures as the crawler reaches them.",
  trends: "Trends: glowing words are keywords (brighter = more distinctive), threads link repeat mentions, and paragraphs take their topic's color.",
  tone: "Tone: blue wash = positive wording, red = negative. Dimmed italics are hedges; underlined words sound certain; emotion words get a label.",
  insights: "Insights: the crawler stops on each quote Claude used. Key points pin to the wall; claims are tinted by how well they're backed (blue backed, amber hedged, red asserted).",
  uxr: "UXR: the crawler stops on each quote Claude used as evidence, pins it to its theme on the wall, and flags pain points.",
  scan: "Claude is reading every source. The crawler skims each one once while it works."
};
const LENS_ACCENT = { references: "#ff3fd8", trends: "#33e1ff", tone: "#ffd84d", insights: "#46f08a", uxr: "#b58cff", scan: "#46f08a" };

const project = { sources: [], active: 0, ai: { insights: null, uxr: null }, asks: [], questions: { insights: "", uxr: "" } };
const ui = { lens: "trends", view: "doc", aiRun: null };
const newKey = () => Math.random().toString(36).slice(2, 10);

const crawler = new Crawler({
  canvas: $("fx"),
  onProgress: (p) => hud(p),
  onDone: (lens) => finished(lens),
  onEvidence: (card) => wallPulse(card),
  getCardPos: (id) => cardPos(id)
});
const summary = new Summary($("summaryView"), $("tip"), { jump, ask, askCost, combine, runAI: (lens) => chooseLens(lens) });

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
    active: project.active, ai: project.ai, asks: project.asks, questions: project.questions
  });
}

function addSources(docs, { replace = false } = {}) {
  const made = docs.map((d) => makeSource(d));
  // Your first own source replaces a project that holds only samples.
  const onlySamples = project.sources.length && project.sources.every((s) => s.doc.meta && s.doc.meta.sample);
  if (onlySamples && made.some((m) => !(m.doc.meta && m.doc.meta.sample))) replace = true;
  if (replace) { project.sources = []; project.ai = { insights: null, uxr: null }; project.asks = []; }
  project.sources.push(...made);
  persist();
  const first = project.sources.length - made.length;
  crawlInTurn(ui.lens, made.map((_, k) => first + k));
}

function removeSource(i) {
  const [gone] = project.sources.splice(i, 1);
  for (const l of AI_LENSES) project.ai[l] = pruneSource(l, project.ai[l], gone.key);
  for (const a of project.asks) for (const pt of a.points) pt.evidence = pt.evidence.filter((e) => e.sourceKey !== gone.key);
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
  if (isAI(l) && !project.ai[l]) l = "trends";
  startLens(l, autoplay);
}

function analysesFor(src) {
  const lens = isAI(ui.lens) ? ui.lens : null;
  return { trends: src.trends, tone: src.tone, aiIndex: lens ? indexFor(cardsFor(lens, project.ai[lens]), src.key) : new Map() };
}

function renderSourceBar() {
  const bar = $("sourceBar");
  bar.textContent = "";
  project.sources.forEach((src, i) => {
    const chip = document.createElement("div");
    chip.className = "src-chip" + (i === project.active ? " on" : "");
    const lensDots = ["trends", "tone", "references"].filter((l) => src.ran[l]).map((l) => `<i class="ld ${l}" title="${l} has run"></i>`).join("");
    chip.innerHTML = `<button type="button" class="pick" title="${esc(src.model.title)}"><b>S${i + 1}</b> ${esc(src.model.title.length > 34 ? src.model.title.slice(0, 33) + "…" : src.model.title)} ${lensDots}</button><button type="button" class="rm" aria-label="Remove ${esc(src.model.title)}">×</button>`;
    chip.querySelector(".pick").addEventListener("click", () => { if (i !== project.active) { ui.queue = null; showSource(i); } });
    chip.querySelector(".rm").addEventListener("click", () => removeSource(i));
    bar.appendChild(chip);
  });
  const on = bar.querySelector(".src-chip.on");
  if (on) on.scrollIntoView({ block: "nearest", inline: "nearest" });
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
function renderProjList() {
  const ul = $("projList");
  ul.textContent = "";
  project.sources.forEach((src, i) => {
    const li = document.createElement("li");
    const sample = src.doc.meta && src.doc.meta.sample;
    li.innerHTML = `<span><b>S${i + 1}</b> ${esc(src.model.title)}${sample ? ' <span class="muted">(sample)</span>' : ""}</span><button type="button" class="ghost">Remove</button>`;
    li.querySelector("button").addEventListener("click", () => { removeSource(i); renderProjList(); });
    ul.appendChild(li);
  });
  const allSamples = project.sources.every((s) => s.doc.meta && s.doc.meta.sample);
  if (allSamples) {
    const li = document.createElement("li");
    li.className = "muted";
    li.textContent = "These are samples. The first source you add replaces them.";
    ul.appendChild(li);
  }
}

function openSheet() {
  pauseForAway(); sheetError(""); $("sheet").hidden = false;
  renderProjList();
  if (sandboxed()) {
    $("urlHint").innerHTML = 'Web addresses only load on the app\'s own site: <a href="https://tangdru.github.io/crawler/" target="_blank" rel="noopener">tangdru.github.io/crawler</a>. This copy runs inside claude.ai, which blocks requests to other websites. Here you can open files or paste text.';
    $("urlHint").classList.add("warn");
  }
  $("urlIn").focus();
}

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
    toast(project.sources.length === 1 ? `New project: ${active().model.title.slice(0, 50)}` : `Added S${project.sources.length}: ${active().model.title.slice(0, 50)}`);
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
  if (ui.queue && ui.queue.lens !== lens) ui.queue = null;   // another lens ends a crawl-in-turn
  ui.lens = lens;
  ui.resumeOnReturn = false;
  const shown = lens === "scan" ? (ui.aiRun ? ui.aiRun.lens : "insights") : lens;
  document.querySelectorAll("[data-lens]").forEach((b) => b.setAttribute("aria-checked", String(b.dataset.lens === shown)));
  document.documentElement.style.setProperty("--accent", LENS_ACCENT[shown]);
  setView("doc");
  crawler.load(active().model, analysesFor(active()));
  crawler.start(lens);
  setPlaying(autoplay && !crawler.reduceMotion);
  $("hudLine").textContent = LENS_TEXT[lens];
  setSkipLabel();
  renderWall();
}
// While Claude works, "Finish now" has nothing to finish; it cancels the run instead.
function setSkipLabel() {
  const waiting = ui.lens === "scan" && ui.aiRun;
  $("skip").textContent = waiting ? "Cancel" : "Finish now";
  $("skip").title = waiting ? "Stop waiting for Claude" : "Apply this lens to the whole document now";
}

function chooseLens(lens) {
  if (!project.sources.length) return;
  if (isAI(lens)) {
    if (ui.aiRun) { if (ui.aiRun.lens === lens) startLens("scan"); else toast(`Claude is still working on ${AI_NAME[ui.aiRun.lens]}. One run at a time.`); return; }
    if (project.ai[lens] && aiCurrent(lens)) { startLens(lens); return; }
    openAiSheet(lens);
    return;
  }
  crawlInTurn(lens, project.sources.map((_, i) => i));
}

// Trends, Tone and References crawl every source in turn (S1, S2, …) and open the Summary
// once the last one is done. The Claude lenses already read the whole project at once.
function crawlInTurn(lens, list) {
  if (isAI(lens) && !project.ai[lens]) lens = "trends";
  if (isAI(lens) || list.length < 2) { ui.queue = null; showSource(list[0] ?? 0, { lens }); return; }
  ui.queue = { lens, list, pos: 0 };
  showSource(list[0], { lens });
}
function nextInTurn() {
  const q = ui.queue;
  if (!q) return;
  if (ui.view !== "doc") { q.waiting = true; return; }   // continue when the document is back in view
  q.waiting = false;
  q.pos++;
  showSource(q.list[q.pos], { lens: q.lens });
}

function setPlaying(v) {
  if (v && crawler.done) crawler.start(ui.lens);
  crawler.setPlaying(v);
  playLabel();
}
// One button: Pause while crawling, Resume part-way, Replay at the end, Play at the start.
function playLabel() {
  $("play").textContent = crawler.playing ? "Pause" : crawler.done ? "Replay" : crawler.idx > 0 ? "Resume" : "Play";
}
// Leaving the crawl (Summary, the Add dialog) pauses it; coming back picks up where it was.
function pauseForAway() {
  if (crawler.playing && ui.lens !== "scan") { ui.resumeOnReturn = true; setPlaying(false); }
}
function resumeIfAway() {
  if (ui.resumeOnReturn) { ui.resumeOnReturn = false; if (!crawler.done && ui.view === "doc") setPlaying(true); }
}

function finished(lens) {
  if (lens === "scan") {
    // Skim each source once, then wait at the end of the last one for Claude's answer.
    const r = ui.aiRun;
    if (!r) return;
    r.skimmed.add(project.active);
    const next = project.sources.findIndex((_, i) => !r.skimmed.has(i));
    if (next >= 0) showSource(next, { lens: "scan" });
    else $("hudLine").textContent = "Done skimming. Claude is still writing; results appear here as soon as they arrive.";
    return;
  }
  const src = active();
  const key = isAI(lens) ? null : lens;
  const first = key && !src.ran[key];
  if (key) { src.ran[key] = true; persist(); renderSourceBar(); }
  playLabel();
  const q = ui.queue;
  if (q && q.lens === lens) {
    if (q.skipAll) {
      // "Finish now" during a multi-source crawl applies the lens to every remaining source.
      for (const i of q.list.slice(q.pos)) if (project.sources[i]) project.sources[i].ran[lens] = true;
      persist(); renderSourceBar();
    } else if (q.pos < q.list.length - 1) {
      const nxt = project.sources[q.list[q.pos + 1]];
      toast(`S${q.list[q.pos] + 1} done · next: S${q.list[q.pos + 1] + 1} ${nxt.model.title.slice(0, 40)}`);
      setTimeout(() => { if (ui.queue === q && crawler.done) nextInTurn(); }, 1100);
      return;
    }
    ui.queue = null;
    hud(crawler.progress());
    if (ui.view === "summary") summary.render(project);
    toast(`${LENS[lens].name} done for all ${q.list.length} sources`);
    setTimeout(() => { if (crawler.done && ui.view === "doc" && crawler.lens === lens) setView("summary"); }, 1400);
    return;
  }
  if (ui.view === "summary") summary.render(project);
  toast(isAI(lens) ? `${AI_NAME[lens]} ${lens === "uxr" ? "is" : "are"} in the summary` : first ? `${lens[0].toUpperCase() + lens.slice(1)} added to the summary` : "Summary updated");
  setTimeout(() => { if (crawler.done && ui.view === "doc" && crawler.lens === lens) setView("summary"); }, 1400);
}

/* ---------- Claude: Insights and UXR ---------- */
const AI_COPY = {
  insights: {
    title: "Find insights with Claude",
    what: "A plain-language read: the gist and key points, the main claims and how well each is backed, who says what, where sources agree or clash, and what's missing.",
    returns: "the gist, claims and voices",
    qLabel: "What are you reading this for? (optional)",
    qHint: "e.g. Deciding whether to support the project; I want to know what's solid and what's spin.",
    run: "Find insights"
  },
  uxr: {
    title: "UX research synthesis with Claude",
    what: "What a UX researcher would pull out: themes with supporting quotes, pain points, the groups of people in your sources, jobs to be done, opportunities and open questions.",
    returns: "themes, pain points, personas, jobs and opportunities",
    qLabel: "Research question (optional)",
    qHint: "e.g. What worries residents about the project, and what would win their support?",
    run: "Run UXR synthesis"
  }
};
const aiCurrent = (lens) => { const r = project.ai[lens]; return r && project.sources.every((s) => r.sourceKeys.includes(s.key)); };

async function openAiSheet(lens) {
  setPlaying(false);
  ui.sheetLens = lens;
  const copy = AI_COPY[lens];
  const est = estimate(project.sources, lens);
  const n = project.sources.length;
  $("aiTitle").textContent = copy.title;
  $("aiWhat").textContent = copy.what;
  $("aiSources").innerHTML = project.sources.map((src, i) => `<li><b>S${i + 1}</b> ${esc(src.model.title)}${src.doc.meta && src.doc.meta.sample ? ' <span class="muted">(sample)</span>' : ""}</li>`).join("");
  $("aiInfo").innerHTML = `Claude will read <b>${n} source${n === 1 ? "" : "s"}</b> (about ${Math.round(est.inTok / 1000)}k tokens) and return ${copy.returns}, each backed by quotes. Estimated cost: <b>about ${money(est.dollars)}</b> on your Anthropic account. Usually 20 seconds to 2 minutes.`;
  $("aiQLabel").textContent = copy.qLabel;
  $("aiQuestion").placeholder = copy.qHint;
  $("aiQuestion").value = project.questions[lens] || "";
  $("aiRun").textContent = copy.run;
  $("aiError").hidden = true;
  $("aiRun").disabled = est.tooLong;
  if (est.tooLong) { $("aiError").textContent = "These sources are too long to analyse together. Remove a source or two first."; $("aiError").hidden = false; }
  $("aiStale").hidden = !(project.ai[lens] && !aiCurrent(lens));
  $("aiSheet").hidden = false;
  const ready = await checkReady();
  if (!ready.ready) aiUnavailable(ready.reason);
}
function aiUnavailable(reason) {
  $("aiError").textContent = reason === "no_key"
    ? "Claude isn't set up: the Supabase project has no Anthropic API key."
    : sandboxed()
      ? "Claude lenses need the app's own site, https://tangdru.github.io/crawler/. This copy runs inside claude.ai, which blocks requests to other websites."
      : "Can't reach Claude. Check your connection and try again.";
  $("aiError").hidden = false;
  $("aiRun").disabled = true;
}

async function runAI() {
  const lens = ui.sheetLens;
  const question = $("aiQuestion").value.trim();
  project.questions[lens] = question;
  $("aiSheet").hidden = true;
  const sources = project.sources.slice();
  const ctl = new AbortController();
  const from = project.active;
  ui.aiRun = { lens, started: performance.now(), chars: 0, seconds: 0, skimmed: new Set(), ctl };
  // The HUD otherwise updates only as the crawler moves; keep the clock running while it waits.
  const tick = setInterval(() => { if (ui.lens === "scan") hud(crawler.progress()); }, 1000);
  const limit = setTimeout(() => ctl.abort("timeout"), 240000);
  startLens("scan");
  try {
    const raw = await request(lens, sources, question, (p) => { if (ui.aiRun) { ui.aiRun.chars = p.chars; ui.aiRun.seconds = p.seconds; } }, ctl.signal);
    const checked = lens === "uxr" ? verifyUxr(raw, sources) : verifyInsights(raw, sources);
    const main = lens === "uxr" ? checked.themes : checked.keyPoints;
    if (!main.length) throw new Error("Claude's answer had no quotes that could be found in the text, so nothing is shown. Try again.");
    project.ai[lens] = { ...checked, question, sourceKeys: sources.map((s) => s.key), model: raw.model, usage: raw.usage, at: new Date().toISOString() };
    ui.aiRun = null;
    persist();
    const u = raw.usage || {};
    const found = lens === "uxr" ? `${checked.themes.length} themes, ${checked.painPoints.length} pain points` : `${checked.keyPoints.length} key points, ${checked.claims.length} claims`;
    if (project.active !== from && project.sources[from]) showSource(from, { autoplay: false, lens: "trends" });
    toast(`${found}${checked.dropped ? `; ${checked.dropped} unverifiable quote${checked.dropped === 1 ? "" : "s"} removed` : ""} · ${(u.input_tokens || 0).toLocaleString("en-US")} in / ${(u.output_tokens || 0).toLocaleString("en-US")} out tokens`);
    startLens(lens);
  } catch (err) {
    const cancelled = ctl.signal.aborted && ctl.signal.reason !== "timeout";
    ui.aiRun = null;
    console.error(err);
    if (project.active !== from && project.sources[from]) showSource(from, { autoplay: false, lens: "trends" });
    startLens("trends", false);
    if (cancelled) { toast(`${AI_NAME[lens]} cancelled.`); return; }
    ui.sheetLens = lens;
    $("aiError").textContent = err.message || String(err);
    $("aiError").hidden = false;
    $("aiSheet").hidden = false;
  } finally {
    clearInterval(tick);
    clearTimeout(limit);
    setSkipLabel();
  }
}

// Ask your sources: one question, answered only from verified quotes. Called from the summary.
async function ask(question) {
  const sources = project.sources.slice();
  const raw = await request("ask", sources, question);
  const checked = verifyAsk(raw, sources);
  project.asks.unshift({ question, ...checked, sourceKeys: sources.map((s) => s.key), usage: raw.usage, at: new Date().toISOString() });
  project.asks = project.asks.slice(0, 30);
  persist();
  return checked;
}
function askCost() { return estimate(project.sources, "ask"); }

/* ---------- findings wall ---------- */
function wallCards() {
  return isAI(ui.lens) ? cardsFor(ui.lens, project.ai[ui.lens]).filter((c) => c.wall) : [];
}
function renderWall() {
  const wall = $("wall");
  const show = isAI(ui.lens) && project.ai[ui.lens] && ui.view === "doc";
  wall.hidden = !show;
  if (!show) return;
  const all = cardsFor(ui.lens, project.ai[ui.lens]);
  const here = indexFor(all, active().key);
  const countHere = new Map();
  for (const hits of here.values()) for (const h of hits) countHere.set(h.card.key, (countHere.get(h.card.key) || 0) + 1);
  $("wallTitle").textContent = ui.lens === "uxr" ? "Theme wall" : "Key points";
  $("wallSub").textContent = `· pinned as the crawler reads S${project.active + 1}`;
  const cards = $("wallCards");
  cards.textContent = "";
  for (const c of all.filter((x) => x.wall)) {
    const card = document.createElement("div");
    card.className = "wcard";
    card.dataset.card = c.key;
    card.style.setProperty("--tc", c.color);
    card.innerHTML = `<div class="wt"><span class="num">${c.num}</span>${esc(c.title)}</div><div class="wn"><b data-n>0</b>/${countHere.get(c.key) || 0} here · ${c.evidence.length} in project${c.note ? " · " + c.note : ""}</div>`;
    card.addEventListener("click", () => { setView("summary"); });
    cards.appendChild(card);
  }
}
function wallPulse(c) {
  const card = $("wall").querySelector(`[data-card="${c.key}"]`);
  if (!card) return;
  const n = card.querySelector("[data-n]");
  n.textContent = +n.textContent + 1;
  card.classList.remove("pulse"); void card.offsetWidth; card.classList.add("pulse");
}
function cardPos(key) {
  const wall = $("wall");
  if (wall.hidden) return null;
  const card = wall.querySelector(`[data-card="${key}"]`);
  if (!card) return null;
  const r = card.getBoundingClientRect();
  if (r.bottom < 0 || r.top > window.innerHeight) return null;
  return { x: r.left, y: r.top + 14 };
}

/* ---------- lens guide ---------- */
function renderGuide() {
  $("lensCompare").innerHTML = `<div><b>Trends · Tone · References</b>Count and match words in your browser. Free and instant, one source at a time. They see patterns in the wording but don't understand it.</div>
    <div><b>Insights · UXR</b>Claude reads the whole project and explains it, with quotes checked against your text. A few cents per run, 20 seconds to 2 minutes. Insights is for anyone making sense of what they read; UXR is for research about people.</div>`;
  const g = $("lensGuide");
  g.textContent = "";
  for (const l of LENSES) {
    const c = document.createElement("article");
    c.className = "lens-card";
    c.style.setProperty("--lc", l.accent);
    c.innerHTML = `<header><h4>${l.name}</h4><span class="tag">${l.claude ? "Claude" : "in your browser"}</span></header>
      <p class="q">${esc(l.question)}</p>
      <ul>${l.finds.map((f) => `<li>${esc(f)}</li>`).join("")}</ul>
      <dl><dt>Best for</dt><dd>${esc(l.best)}</dd><dt>How</dt><dd>${esc(l.how)}</dd><dt>Cost</dt><dd>${esc(l.cost)}</dd><dt>Covers</dt><dd>${esc(l.scope)}</dd></dl>
      <p class="limit">${esc(l.limit)}</p>`;
    const b = document.createElement("button");
    b.type = "button"; b.className = "try"; b.textContent = `Run ${l.name}`;
    b.addEventListener("click", () => { closeHelp(); chooseLens(l.id); });
    c.appendChild(b);
    g.appendChild(c);
  }
}
function openHelp() { pauseForAway(); renderGuide(); $("helpSheet").hidden = false; }
function closeHelp() { $("helpSheet").hidden = true; resumeIfAway(); }

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
    const r = ui.aiRun;
    const secs = r ? Math.round((performance.now() - r.started) / 1000) : 0;
    add(`Claude is reading ${project.sources.length} source${project.sources.length === 1 ? "" : "s"}`, "stat");
    add(`<b>${secs}s</b>`, "stat");
    const col = r ? LENS_ACCENT[r.lens] : "#46f08a";
    if (r) add(AI_NAME[r.lens], "hchip", col);
    if (r && r.chars) add(`writing <b>${(r.chars / 1000).toFixed(1)}k</b> chars`, "hchip", col);
    else add("thinking…", "hchip", col);
    return;
  }
  if (ui.queue) add(`source <b>${ui.queue.pos + 1}</b> of ${ui.queue.list.length}`, "stat");
  add(`S${project.active + 1} read <b>${p.idx.toLocaleString("en-US")}</b>/${p.total.toLocaleString("en-US")}`, "stat");
  if (p.lens === "references") {
    const n = Object.values(p.counts).reduce((a, b) => a + b, 0);
    add(`found <b>${n}</b>`, "stat");
    for (const [k, v] of Object.entries(p.counts).sort((a, b) => b[1] - a[1]).slice(0, 7)) add(`${ENTITY_TYPES[k].label} <b>${v}</b>`, "hchip", ENTITY_TYPES[k].color);
  } else if (p.lens === "trends") {
    const top = [...p.seen.values()].sort((a, b) => b.n - a.n || a.entry.rank - b.entry.rank).slice(0, 6);
    add(`keywords <b>${p.seen.size}</b>`, "stat");
    for (const s of top) add(`${esc(s.entry.term)} <b>×${s.n}</b>`, "hchip", "#33e1ff");
  } else if (isAI(p.lens)) {
    const r = project.ai[p.lens];
    add(p.lens === "uxr" ? `${r.themes.length} themes` : `${r.keyPoints.length} key points · ${r.claims.length} claims`, "stat");
    const wall = $("wall");
    const byKey = new Map(wallCards().map((c) => [c.key, c]));
    for (const el of [...wall.querySelectorAll(".wcard")].slice(0, 5)) {
      const c = byKey.get(el.dataset.card);
      if (c) add(`${c.num} <b>${el.querySelector("[data-n]").textContent}</b>`, "hchip", c.color);
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
    } else if (kind === "insights") {
      if (!project.ai.insights && !project.asks.length) { toast("Run the Insights lens first; insights.csv comes from it."); return; }
      await saveFile(`${base}-insights.csv`, insightsCsv(project));
    } else if (kind === "uxr") {
      if (!project.ai.uxr) { toast("Run the UXR lens first; uxr.csv comes from it."); return; }
      await saveFile(`${base}-uxr.csv`, uxrCsv(project));
    } else await saveFile(`${base}-csv.zip`, await zipAll(project, base), "application/zip");
  } catch (e) {
    toast(e && e.message ? `Export failed: ${e.message}` : "Export failed");
  }
}

/* ---------- controls ---------- */
document.querySelectorAll("[data-lens]").forEach((b) => b.addEventListener("click", () => chooseLens(b.dataset.lens)));
document.querySelectorAll("[data-view]").forEach((b) => b.addEventListener("click", () => {
  if (b.dataset.view === "summary") pauseForAway();
  setView(b.dataset.view);
  if (b.dataset.view === "doc") { if (ui.queue && ui.queue.waiting) nextInTurn(); else resumeIfAway(); }
}));
$("play").addEventListener("click", () => { setView("doc"); setPlaying(!crawler.playing); });
$("speed").addEventListener("change", (e) => { crawler.speed = parseFloat(e.target.value); });
$("skip").addEventListener("click", () => {
  if (ui.lens === "scan" && ui.aiRun) { ui.aiRun.ctl.abort("cancel"); return; }
  if (ui.queue) ui.queue.skipAll = true;
  if (project.sources.length && !crawler.done) { setView("doc"); crawler.skip(); }
  else if (ui.queue) finished(ui.lens);
});
$("addSource").addEventListener("click", openSheet);
$("helpBtn").addEventListener("click", openHelp);
$("closeHelp").addEventListener("click", closeHelp);
$("helpSheet").addEventListener("click", (e) => { if (e.target === $("helpSheet")) closeHelp(); });
document.querySelectorAll("[data-lens]").forEach((b) => { const l = LENS[b.dataset.lens]; if (l) b.title = `${l.name}: ${l.question}`; });
const closeSheet = () => { $("sheet").hidden = true; resumeIfAway(); };
$("closeSheet").addEventListener("click", closeSheet);
$("sheet").addEventListener("click", (e) => { if (e.target === $("sheet")) closeSheet(); });
$("urlForm").addEventListener("submit", (e) => { e.preventDefault(); const v = $("urlIn").value.trim(); if (v) openFrom("url", v); else sheetError("Type or paste a web address first."); });
$("pasteForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const v = $("pasteIn").value.trim();
  if (!v) { sheetError("Paste some text first, then press Add this text."); return; }
  if (/^https?:\/\/\S+$/i.test(v)) openFrom("url", v); else openFrom("text", v);
});
$("fileIn").addEventListener("change", (e) => { const fs = [...e.target.files]; if (fs.length) openFiles(fs); e.target.value = ""; });
document.querySelectorAll("[data-sample]").forEach((b) => b.addEventListener("click", () => openSample(b.dataset.sample)));
$("aiRun").addEventListener("click", runAI);
$("aiCancel").addEventListener("click", () => { $("aiSheet").hidden = true; });
$("aiSheet").addEventListener("click", (e) => { if (e.target === $("aiSheet")) $("aiSheet").hidden = true; });
$("aiShowOld").addEventListener("click", () => { $("aiSheet").hidden = true; startLens(ui.sheetLens); });
$("rerunAi").addEventListener("click", () => openAiSheet(ui.lens));

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
  if (e.key === "Escape") { if (!$("sheet").hidden) closeSheet(); if (!$("helpSheet").hidden) closeHelp(); $("aiSheet").hidden = true; exportMenu.hidden = true; return; }
  if (!$("sheet").hidden || !$("aiSheet").hidden || !$("helpSheet").hidden) return;
  if (e.key === "?") { openHelp(); return; }
  if (e.code === "Space") { e.preventDefault(); setView("doc"); setPlaying(!crawler.playing); }
  else if (e.key === "1") chooseLens("trends");
  else if (e.key === "2") chooseLens("tone");
  else if (e.key === "3") chooseLens("insights");
  else if (e.key === "4") chooseLens("uxr");
  else if (e.key === "5") chooseLens("references");
});
let resizeTimer = 0;
// Redraw the summary only when the width changes. On phones, scrolling shows and hides
// the browser's address bar, which changes only the height; redrawing then would jump
// the page back up.
let lastWidth = window.innerWidth;
window.addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    if (window.innerWidth === lastWidth) return;
    lastWidth = window.innerWidth;
    if (ui.view === "summary" && project.sources.length) {
      const y = window.scrollY;
      summary.render(project);
      window.scrollTo(0, y);
    }
  }, 200);
});

// The fixed header wraps differently at each width; keep the page clear of it.
const headEl = document.querySelector(".bar");
const setHead = () => document.documentElement.style.setProperty("--head-h", headEl.offsetHeight + "px");
new ResizeObserver(setHead).observe(headEl);
setHead();

/* ---------- boot ---------- */
(async () => {
  const params = new URLSearchParams(location.search);
  const saved = await loadProject();
  if (!saved) setTimeout(() => toast("New here? Tap the ? next to the lenses to see what each one does."), 2500);
  if (saved && saved.sources && saved.sources.length) {
    try {
      project.sources = saved.sources.map((s) => makeSource(s.doc, s.key, s.ran));
      project.ai = { insights: saved.ai?.insights || null, uxr: upgradeUxr(saved.ai?.uxr || saved.themes) };
      project.asks = saved.asks || [];
      project.questions = saved.questions || { insights: "", uxr: saved.question || "" };
      project.active = Math.min(saved.active || 0, project.sources.length - 1);
    } catch (e) { console.error(e); project.sources = []; }
  }
  if (params.get("url")) {
    if (!project.sources.length) addSources([SAMPLES.article()], { replace: true });
    openFrom("url", params.get("url"));
  } else if (project.sources.length) {
    crawlInTurn(ui.lens, project.sources.map((_, i) => i));
  } else {
    openSample("river");
  }
})();
