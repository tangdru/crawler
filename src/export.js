// CSV export. Columns from lenses that haven't run stay empty, so the file layout
// never changes between runs.

import { LIBS } from "./config.js";
import { loadScript } from "./loaders.js";
import { EMOTION_KEYS } from "./tone.js";

const cell = (v) => {
  if (v == null) return "";
  const s = typeof v === "number" ? (Number.isInteger(v) ? String(v) : v.toFixed(4)) : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const toCsv = (header, rows) => [header, ...rows].map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n";

export function entitiesCsv(state) {
  const { model } = state;
  const n = model.tokens.length || 1;
  const header = ["id", "type", "text", "normalized", "href", "found_in", "speaker", "year", "section", "block", "sentence", "position_pct"];
  const rows = model.entities.map((e) => [
    e.id, e.type, e.text, e.norm, e.href, e.source, e.speaker, e.year,
    model.sections[e.section]?.title || "", e.block, e.sentence, +((e.tokStart / n) * 100).toFixed(2)
  ]);
  return toCsv(header, rows);
}

export function sentencesCsv(state) {
  const { model, ran, trends, tone } = state;
  const header = ["id", "section", "block", "segment", "text", "words", "entities", "topic", "topic_label", "top_terms",
    "sentiment", "positive_words", "negative_words", ...EMOTION_KEYS, "hedges", "boosters", "cited_nearby", "uncited_confident"];
  const entCount = new Map();
  for (const e of model.entities) entCount.set(e.sentence, (entCount.get(e.sentence) || 0) + 1);
  const rows = model.sentences.map((s) => {
    const r = [s.id, model.sections[s.section]?.title || "", s.block, trends ? trends.sentSeg[s.id] + 1 : "", s.text, s.wordCount, entCount.get(s.id) || 0];
    if (ran.trends) {
      const tp = trends.blockTopic[s.block];
      const tops = [...new Set(s.words.map(model.lemma).filter((w) => trends.topSet.has(w)))].join(" ");
      r.push(tp >= 0 ? tp + 1 : "", tp >= 0 ? trends.topics[tp].label : "", tops);
    } else r.push("", "", "");
    if (ran.tone) {
      const t = tone.sentences[s.id];
      r.push(t.score, t.pos, t.neg, ...EMOTION_KEYS.map((k) => t.emo[k]), t.hedges, t.boosters, t.cited ? 1 : 0, t.uncitedConfident ? 1 : 0);
    } else r.push("", "", "", ...EMOTION_KEYS.map(() => ""), "", "", "", "");
    return r;
  });
  return toCsv(header, rows);
}

export function termsCsv(state) {
  const { trends } = state;
  const segs = Array.from({ length: trends.segCount }, (_, i) => `segment_${i + 1}_per_1000_words`);
  const header = ["rank", "term", "count", "tfidf", "paragraphs", "first_sentence", "direction", "trend_slope", ...segs];
  const rows = trends.ranked.map((e) => [e.rank, e.term, e.count, e.tfidf, e.df, e.first, e.direction || "", e.slope, ...e.rate]);
  return toCsv(header, rows);
}

export function slug(s) {
  return (s || "document").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "").slice(0, 48) || "document";
}

// Saves through the artifact viewer's download capability when present, else a normal link.
export async function saveFile(filename, data, mime) {
  if (window.claude && typeof window.claude.use === "function") {
    try {
      const dl = await window.claude.use("downloads");
      if (dl) { await dl.save({ filename, data }); return; }
    } catch (e) { if (e && e.code === "declined") return; }
  }
  const blob = data instanceof Blob ? data : new Blob([data], { type: mime || "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

export async function zipAll(state) {
  await loadScript(LIBS.jszip);
  const zip = new window.JSZip();
  const base = slug(state.model.title);
  zip.file(`${base}-entities.csv`, entitiesCsv(state));
  zip.file(`${base}-sentences.csv`, sentencesCsv(state));
  if (state.ran.trends) zip.file(`${base}-terms.csv`, termsCsv(state));
  return zip.generateAsync({ type: "blob" });
}
