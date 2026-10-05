// Themes lens: Claude does the thematic analysis (supabase/functions/synthesize); this
// module sends the sources, streams the answer, and checks every quote against the
// real text before anything reaches the screen. Quotes that can't be found are dropped.

import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";

const FN = `${SUPABASE_URL}/functions/v1/synthesize`;
// Categorical slots in fixed order (validated for the dark surface); themes past eight share a neutral.
export const THEME_COLORS = ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#008300", "#9085e9", "#e66767"];
export const themeColor = (i) => THEME_COLORS[i] || "#8c8a9a";

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

// Rough cost from Opus 5.5 pricing ($4 in / $20 out per million tokens). Output is
// mostly the themes JSON plus some thinking, so it grows slowly with input.
export function estimate(sources) {
  const chars = payloadFor(sources).reduce((n, s) => n + s.sentences.reduce((m, x) => m + x.text.length + 10, 0), 0);
  const inTok = Math.round(chars / 3.6) + 1500;
  const outTok = 3000 + Math.min(9000, Math.round(inTok * 0.03));
  return { chars, inTok, outTok, dollars: (inTok * 4 + outTok * 20) / 1e6, tooLong: chars > 600000 };
}

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

export async function requestThemes(sources, question, onProgress) {
  let res;
  try {
    res = await fetch(FN, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ question, sources: payloadFor(sources) })
    });
  } catch {
    throw new Error("Couldn't reach the theme service. Themes work on the app's own site (tangdru.github.io/crawler); check your connection.");
  }
  if (!res.ok) {
    let msg = `Theme finding failed (error ${res.status}).`;
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
      onProgress && onProgress({ seconds, chars: text.length, partial: text });
    }
  }
  if (!done) throw new Error("The theme service stopped before finishing. With many long sources it can run out of time; try fewer sources.");
  if (done.stop === "refusal") throw new Error("Claude declined to analyse these sources.");
  if (done.stop === "max_tokens") throw new Error("The answer was cut off before it finished. Try fewer sources, or a narrower research question.");
  let parsed;
  try { parsed = JSON.parse(text); } catch { throw new Error("The answer came back in an unexpected format. Try again."); }
  return { ...parsed, model: done.model, usage: done.usage };
}

/* ---------- verification ---------- */
const norm = (s) => s.normalize("NFKC").toLowerCase()
  .replace(/[“”„«»]/g, '"').replace(/[‘’‚]/g, "'").replace(/[–—]/g, "-")
  .replace(/\s+/g, " ").trim();
const bare = (q) => norm(q).replace(/^["'\s]+|["'\s]+$/g, "").replace(/\s*(\.\.\.|…)\s*$/, "");

// Map Claude's answer onto the project. Every evidence item must be found verbatim in
// its cited sentence, or elsewhere in the same source (then it is relocated). Anything
// else is dropped and counted.
export function verify(raw, sources) {
  let dropped = 0, relocated = 0;
  const findIn = (src, q) => src.model.sentences.find((s) => norm(s.text).includes(q));
  const themes = [];
  for (const t of raw.themes || []) {
    const evidence = [];
    for (const ev of t.evidence || []) {
      const q = bare(ev.quote || "");
      const m = String(ev.sentence_id || "").match(/^S(\d+)\.(\d+)$/);
      if (!q || q.length < 3) { dropped++; continue; }
      let si = m ? +m[1] - 1 : -1, sent = null;
      if (si >= 0 && sources[si]) {
        const cand = sources[si].model.sentences[+m[2]];
        if (cand && norm(cand.text).includes(q)) sent = cand;
        else { sent = findIn(sources[si], q); if (sent) relocated++; }
      }
      if (!sent) {
        for (let k = 0; k < sources.length && !sent; k++) { sent = findIn(sources[k], q); if (sent) { si = k; relocated++; } }
      }
      if (!sent) { dropped++; continue; }
      if (evidence.some((e) => e.sourceKey === sources[si].key && e.sentence === sent.id)) continue;
      evidence.push({ sourceKey: sources[si].key, sentence: sent.id, quote: ev.quote.trim().replace(/^["“]|["”]$/g, ""), stance: ev.stance === "contradicts" ? "contradicts" : "supports" });
    }
    if (evidence.length) themes.push({ title: t.title, summary: t.summary, kind: t.kind === "tension" ? "tension" : "theme", prevalence: t.prevalence, evidence });
  }
  themes.forEach((t, i) => { t.id = i; t.color = themeColor(i); });
  return { overview: raw.overview || "", themes, dropped, relocated };
}

// Per-source index for the crawler: sentence id → [{ theme, evidence }]
export function indexFor(result, sourceKey) {
  const map = new Map();
  if (!result) return map;
  for (const t of result.themes) for (const ev of t.evidence) {
    if (ev.sourceKey !== sourceKey) continue;
    if (!map.has(ev.sentence)) map.set(ev.sentence, []);
    map.get(ev.sentence).push({ theme: t, ev });
  }
  return map;
}
