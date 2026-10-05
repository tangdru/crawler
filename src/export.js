// CSV export across every source in the project. Columns from lenses that haven't run
// on a source stay empty, so the file layout never changes between runs.

import { LIBS } from "./config.js";
import { loadScript } from "./loaders.js";
import { EMOTION_KEYS } from "./tone.js";

const cell = (v) => {
  if (v == null) return "";
  const s = typeof v === "number" ? (Number.isInteger(v) ? String(v) : v.toFixed(4)) : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const toCsv = (header, rows) => [header, ...rows].map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n";
const srcCols = (src, i) => [`S${i + 1}`, src.model.title];

export function entitiesCsv(project) {
  const header = ["source_id", "source_title", "id", "type", "text", "normalized", "href", "found_in", "speaker", "year", "section", "block", "sentence", "position_pct"];
  const rows = [];
  project.sources.forEach((src, i) => {
    const m = src.model, n = m.tokens.length || 1;
    for (const e of m.entities) rows.push([...srcCols(src, i), e.id, e.type, e.text, e.norm, e.href, e.source, e.speaker, e.year,
      m.sections[e.section]?.title || "", e.block, e.sentence, +((e.tokStart / n) * 100).toFixed(2)]);
  });
  return toCsv(header, rows);
}

export function sentencesCsv(project) {
  const header = ["source_id", "source_title", "id", "section", "block", "segment", "text", "words", "entities", "topic", "topic_label", "top_terms",
    "sentiment", "positive_words", "negative_words", ...EMOTION_KEYS, "hedges", "boosters", "cited_nearby", "uncited_confident", "themes"];
  const rows = [];
  project.sources.forEach((src, i) => {
    const { model, ran, trends, tone } = src;
    const entCount = new Map();
    for (const e of model.entities) entCount.set(e.sentence, (entCount.get(e.sentence) || 0) + 1);
    const themeBy = new Map();
    for (const t of project.themes?.themes || []) for (const ev of t.evidence) {
      if (ev.sourceKey !== src.key) continue;
      themeBy.set(ev.sentence, [...(themeBy.get(ev.sentence) || []), t.id + 1]);
    }
    for (const s of model.sentences) {
      const r = [...srcCols(src, i), s.id, model.sections[s.section]?.title || "", s.block, trends ? trends.sentSeg[s.id] + 1 : "", s.text, s.wordCount, entCount.get(s.id) || 0];
      if (ran.trends) {
        const tp = trends.blockTopic[s.block];
        const tops = [...new Set(s.words.map(model.lemma).filter((w) => trends.topSet.has(w)))].join(" ");
        r.push(tp >= 0 ? tp + 1 : "", tp >= 0 ? trends.topics[tp].label : "", tops);
      } else r.push("", "", "");
      if (ran.tone) {
        const t = tone.sentences[s.id];
        r.push(t.score, t.pos, t.neg, ...EMOTION_KEYS.map((k) => t.emo[k]), t.hedges, t.boosters, t.cited ? 1 : 0, t.uncitedConfident ? 1 : 0);
      } else r.push("", "", "", ...EMOTION_KEYS.map(() => ""), "", "", "", "");
      r.push((themeBy.get(s.id) || []).join(";"));
      rows.push(r);
    }
  });
  return toCsv(header, rows);
}

export function termsCsv(project) {
  const max = Math.max(2, ...project.sources.map((s) => s.trends.segCount));
  const segs = Array.from({ length: max }, (_, i) => `segment_${i + 1}_per_1000_words`);
  const header = ["source_id", "source_title", "rank", "term", "count", "tfidf", "paragraphs", "first_sentence", "direction", "trend_slope", ...segs];
  const rows = [];
  project.sources.forEach((src, i) => {
    if (!src.ran.trends) return;
    for (const e of src.trends.ranked) rows.push([...srcCols(src, i), e.rank, e.term, e.count, e.tfidf, e.df, e.first, e.direction || "", e.slope, ...segs.map((_, k) => e.rate[k] ?? "")]);
  });
  return toCsv(header, rows);
}

// One row per theme–quote pair: the layout researchers paste into a synthesis board.
export function themesCsv(project) {
  const header = ["theme_id", "theme", "kind", "prevalence", "summary", "source_id", "source_title", "sentence", "stance", "quote", "full_sentence"];
  const rows = [];
  const idx = new Map(project.sources.map((s, i) => [s.key, i]));
  for (const t of project.themes?.themes || []) for (const ev of t.evidence) {
    const i = idx.get(ev.sourceKey);
    if (i == null) continue;
    const src = project.sources[i];
    rows.push([t.id + 1, t.title, t.kind, t.prevalence, t.summary, `S${i + 1}`, src.model.title, ev.sentence, ev.stance, ev.quote, src.model.sentences[ev.sentence]?.text || ""]);
  }
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

export async function zipAll(project, base) {
  await loadScript(LIBS.jszip);
  const zip = new window.JSZip();
  zip.file(`${base}-entities.csv`, entitiesCsv(project));
  zip.file(`${base}-sentences.csv`, sentencesCsv(project));
  if (project.sources.some((s) => s.ran.trends)) zip.file(`${base}-terms.csv`, termsCsv(project));
  if (project.themes) zip.file(`${base}-themes.csv`, themesCsv(project));
  return zip.generateAsync({ type: "blob" });
}
