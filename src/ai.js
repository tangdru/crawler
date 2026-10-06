// Claude lenses. Insights (for any reader) and UXR (research synthesis) run in
// supabase/functions/synthesize; so does Ask, one question at a time. This module sends
// the sources, streams the answer, and checks every quote against the real text before
// anything reaches the screen. Quotes that can't be found word for word are dropped.

import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";

const FN = `${SUPABASE_URL}/functions/v1/synthesize`;
export const AI_LENSES = ["insights", "uxr"];
export const isAI = (lens) => AI_LENSES.includes(lens);
export const AI_NAME = { insights: "Insights", uxr: "UXR" };

// Categorical slots in fixed order (validated for the dark surface); items past eight share a neutral.
export const THEME_COLORS = ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#008300", "#9085e9", "#e66767"];
export const themeColor = (i) => THEME_COLORS[i] || "#8c8a9a";
// How well a claim is backed: blue = backed, amber = hedged, red = asserted with nothing behind it.
export const SUPPORT = {
  backed: { label: "Backed", color: "#3987e5", help: "cites data, a source or an example" },
  hedged: { label: "Hedged", color: "#c98500", help: "qualified: may, could, some say" },
  asserted: { label: "Asserted", color: "#e66767", help: "stated confidently with nothing behind it" }
};
export const KINDS = { fact: "Fact", opinion: "Opinion", prediction: "Prediction" };
const SEVERITY_COLOR = { high: "#e66767", medium: "#c98500", low: "#8c8a9a" };

const headers = { Authorization: `Bearer ${SUPABASE_ANON_KEY}`, apikey: SUPABASE_ANON_KEY };

// What gets sent: every sentence of three or more words, outside headings.
export function payloadFor(sources) {
  return sources.map((src, i) => ({
    id: `S${i + 1}`,
    title: src.model.title,
    sentences: src.model.sentences
      .filter((s) => s.wordCount >= 3 && !/^h[1-3]$/.test(src.model.blocks[s.block].kind))
      .map((s) => ({ id: `S${i + 1}.${s.id}`, text: s.text }))
  }));
}

// Rough cost from Opus 5.5 pricing ($4 in / $20 out per million tokens; the sources are
// written to the prompt cache at 1.25x input). Output is mostly the JSON answer plus some
// thinking, so it grows slowly with input. Measured on the three-source sample: Insights
// about 8.8k output tokens, UXR 8.3k, a question 0.8k.
export function estimate(sources, mode) {
  const chars = payloadFor(sources).reduce((n, s) => n + s.sentences.reduce((m, x) => m + x.text.length + 10, 0), 0);
  const inTok = Math.round(chars / 3.6) + 1500;
  const base = { insights: 8000, uxr: 8000, ask: 900 }[mode] || 8000;
  const outTok = base + Math.min(9000, Math.round(inTok * (mode === "ask" ? 0.005 : 0.03)));
  const dollars = (inTok * 5 + outTok * 20) / 1e6;
  return { chars, inTok, outTok, dollars, tooLong: chars > 600000 };
}
export const money = (d) => `$${d < 0.01 ? "0.01" : d.toFixed(2)}`;

export async function checkReady() {
  try {
    const r = await fetch(FN, { headers });
    if (!r.ok) return { ready: false, reason: "unreachable" };
    const j = await r.json();
    return { ready: !!j.ready, reason: j.ready ? "" : "no_key" };
  } catch {
    return { ready: false, reason: "unreachable" };
  }
}

export async function request(mode, sources, question, onProgress) {
  let res;
  try {
    res = await fetch(FN, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ mode, question, sources: payloadFor(sources) })
    });
  } catch {
    throw new Error("Couldn't reach Claude. This works on the app's own site (tangdru.github.io/crawler); check your connection.");
  }
  if (!res.ok) {
    let msg = `Claude couldn't run (error ${res.status}).`;
    try { const j = await res.json(); if (j.error) msg = j.error; } catch {}
    throw new Error(msg);
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "", text = "", done = null, seconds = 0;
  while (true) {
    const { value, done: end } = await reader.read();
    if (end) break;
    buf += dec.decode(value, { stream: true });
    let nl;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      let ev;
      try { ev = JSON.parse(line); } catch { continue; }
      if (ev.t === "ping") seconds = ev.s;
      else if (ev.t === "delta") text += ev.d;
      else if (ev.t === "error") throw new Error(ev.error);
      else if (ev.t === "done") done = ev;
      onProgress && onProgress({ seconds, chars: text.length });
    }
  }
  if (!done) throw new Error("Claude stopped before finishing. With many long sources it can run out of time; try fewer sources.");
  if (done.stop === "refusal") throw new Error("Claude declined to analyse these sources.");
  if (done.stop === "max_tokens") throw new Error("The answer was cut off before it finished. Try fewer sources, or a narrower question.");
  let parsed;
  try { parsed = JSON.parse(text); } catch { throw new Error("The answer came back in an unexpected format. Try again."); }
  return { ...parsed, model: done.model, usage: done.usage };
}

/* ---------- verification ---------- */
const norm = (s) => s.normalize("NFKC").toLowerCase()
  .replace(/[“”„«»]/g, '"').replace(/[‘’‚]/g, "'").replace(/[–—]/g, "-")
  .replace(/\s+/g, " ").trim();
const bare = (q) => norm(q).replace(/^["'\s]+|["'\s]+$/g, "").replace(/\s*(\.\.\.|…)\s*$/, "");

// Every evidence item must be found verbatim in its cited sentence, or elsewhere in the
// same source, or in another source (then it is relocated). Anything else is dropped.
function checker(sources) {
  const stats = { dropped: 0, relocated: 0 };
  const findIn = (src, q) => src.model.sentences.find((s) => norm(s.text).includes(q));
  const check = (list) => {
    const out = [];
    for (const ev of list || []) {
      const q = bare(ev.quote || "");
      const m = String(ev.sentence_id || "").match(/^S(\d+)\.(\d+)$/);
      if (!q || q.length < 3) { stats.dropped++; continue; }
      let si = m ? +m[1] - 1 : -1, sent = null;
      if (si >= 0 && sources[si]) {
        const cand = sources[si].model.sentences[+m[2]];
        if (cand && norm(cand.text).includes(q)) sent = cand;
        else { sent = findIn(sources[si], q); if (sent) stats.relocated++; }
      }
      if (!sent) {
        for (let k = 0; k < sources.length && !sent; k++) { sent = findIn(sources[k], q); if (sent) { si = k; stats.relocated++; } }
      }
      if (!sent) { stats.dropped++; continue; }
      if (out.some((e) => e.sourceKey === sources[si].key && e.sentence === sent.id)) continue;
      out.push({ sourceKey: sources[si].key, sentence: sent.id, quote: ev.quote.trim().replace(/^["“]|["”]$/g, ""), stance: ev.stance === "contradicts" ? "contradicts" : "supports" });
    }
    return out;
  };
  return { stats, check };
}
const keep = (items) => items.filter((x) => x.evidence.length);
const pick = (v, allowed, dflt) => (allowed.includes(v) ? v : dflt);

export function verifyInsights(raw, sources) {
  const { stats, check } = checker(sources);
  const keyPoints = keep((raw.key_points || []).map((k) => ({ text: k.point, evidence: check(k.evidence) })));
  keyPoints.forEach((k, i) => { k.id = i; k.color = themeColor(i); });
  const claims = keep((raw.claims || []).map((c) => ({
    text: c.claim, kind: pick(c.kind, Object.keys(KINDS), "fact"), support: pick(c.support, Object.keys(SUPPORT), "asserted"),
    note: c.note || "", evidence: check(c.evidence)
  })));
  claims.forEach((c, i) => { c.id = i; });
  const voices = keep((raw.voices || []).map((v) => ({ name: v.name, role: v.role || "", position: v.position || "", evidence: check(v.evidence) })));
  const agreement = sources.length > 1
    ? keep((raw.agreement || []).map((a) => ({ topic: a.topic, status: pick(a.status, ["agree", "disagree", "mixed"], "mixed"), summary: a.summary || "", evidence: check(a.evidence) })))
    : [];
  const missing = (raw.missing || []).filter((m) => m.gap).map((m) => ({ gap: m.gap, why: m.why || "" }));
  return { gist: raw.gist || "", keyPoints, claims, voices, agreement, missing, ...stats };
}

export function verifyUxr(raw, sources) {
  const { stats, check } = checker(sources);
  const themes = keep((raw.themes || []).map((t) => ({ title: t.title, summary: t.summary, kind: t.kind === "tension" ? "tension" : "theme", prevalence: t.prevalence, evidence: check(t.evidence) })));
  themes.forEach((t, i) => { t.id = i; t.color = themeColor(i); });
  const painPoints = keep((raw.pain_points || []).map((p) => ({ title: p.title, summary: p.summary || "", severity: pick(p.severity, ["high", "medium", "low"], "medium"), evidence: check(p.evidence) })));
  const segments = keep((raw.segments || []).map((s) => ({ name: s.name, description: s.description || "", needs: s.needs || "", evidence: check(s.evidence) })));
  const jobs = keep((raw.jobs || []).map((j) => ({ job: j.job, evidence: check(j.evidence) })));
  const opportunities = keep((raw.opportunities || []).map((o) => ({ title: o.title, rationale: o.rationale || "", evidence: check(o.evidence) })));
  const openQuestions = (raw.open_questions || []).filter((q) => q.question).map((q) => ({ question: q.question, why: q.why || "" }));
  return { overview: raw.overview || "", themes, painPoints, segments, jobs, opportunities, openQuestions, ...stats };
}

export function verifyAsk(raw, sources) {
  const { stats, check } = checker(sources);
  const points = keep((raw.points || []).map((p) => ({ text: p.point, evidence: check(p.evidence) })));
  return { answer: raw.answer || "", covered: raw.covered !== false && points.length > 0, points, ...stats };
}

// An older project saved UXR themes under project.themes; read it as a UXR result.
export function upgradeUxr(r) {
  if (!r) return null;
  return { painPoints: [], segments: [], jobs: [], opportunities: [], openQuestions: [], ...r };
}

/* ---------- what the crawler stops on ---------- */
// Cards: one per finding that has quotes. `wall` cards are pinned on the side wall; the
// rest are called out in the text only.
export function cardsFor(lens, r) {
  if (!r) return [];
  if (lens === "uxr") {
    return [
      ...r.themes.map((t) => ({ key: `t${t.id}`, wall: true, num: t.id + 1, title: t.title, color: t.color, tag: `${t.kind} ${t.id + 1}`, tension: t.kind === "tension", evidence: t.evidence, note: t.kind === "tension" ? "tension" : "" })),
      ...(r.painPoints || []).map((p, i) => ({ key: `p${i}`, wall: false, title: p.title, color: SEVERITY_COLOR[p.severity], tag: `pain point · ${p.severity}`, evidence: p.evidence }))
    ];
  }
  return [
    ...r.keyPoints.map((k) => ({ key: `k${k.id}`, wall: true, num: k.id + 1, title: k.text, color: k.color, tag: `key point ${k.id + 1}`, evidence: k.evidence })),
    ...r.claims.map((c) => ({ key: `c${c.id}`, wall: false, title: c.text, color: SUPPORT[c.support].color, tag: `${KINDS[c.kind].toLowerCase()} · ${c.support}`, evidence: c.evidence.slice(0, 1) }))
  ];
}

// Per-source index for the crawler: sentence id → [{ card, ev }]
export function indexFor(cards, sourceKey) {
  const map = new Map();
  for (const c of cards) for (const ev of c.evidence) {
    if (ev.sourceKey !== sourceKey) continue;
    if (!map.has(ev.sentence)) map.set(ev.sentence, []);
    map.get(ev.sentence).push({ card: c, ev });
  }
  return map;
}

// Drop a removed source's quotes from a stored result; items left with none go.
export function pruneSource(lens, r, key) {
  if (!r) return r;
  const lists = lens === "uxr" ? ["themes", "painPoints", "segments", "jobs", "opportunities"] : ["keyPoints", "claims", "voices", "agreement"];
  for (const l of lists) {
    if (!r[l]) continue;
    for (const x of r[l]) x.evidence = x.evidence.filter((e) => e.sourceKey !== key);
    r[l] = r[l].filter((x) => x.evidence.length);
  }
  const main = lens === "uxr" ? r.themes : r.keyPoints;
  return main.length ? r : null;
}
