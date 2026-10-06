// CSV export across every source in the project. Columns from lenses that haven't run
// on a source stay empty, so the file layout never changes between runs.

import { LIBS } from "./config.js";
import { loadScript } from "./loaders.js";
import { EMOTION_KEYS } from "./tone.js";
import { KINDS, SUPPORT } from "./ai.js";

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
    "sentiment", "positive_words", "negative_words", ...EMOTION_KEYS, "hedges", "boosters", "cited_nearby", "uncited_confident", "insight_items", "uxr_items"];
  const rows = [];
  project.sources.forEach((src, i) => {
    const { model, ran, trends, tone } = src;
    const entCount = new Map();
    for (const e of model.entities) entCount.set(e.sentence, (entCount.get(e.sentence) || 0) + 1);
    // Which Claude findings quote each sentence, by the ids used in insights.csv and uxr.csv
    const tagged = (rows) => {
      const by = new Map();
      for (const r of rows) for (const ev of r.evidence) {
        if (ev.sourceKey !== src.key) continue;
        by.set(ev.sentence, [...new Set([...(by.get(ev.sentence) || []), r.id])]);
      }
      return by;
    };
    const insBy = tagged(insightRows(project.ai?.insights));
    const uxrBy = tagged(uxrRows(project.ai?.uxr));
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
      r.push((insBy.get(s.id) || []).join(";"), (uxrBy.get(s.id) || []).join(";"));
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

// Claude findings flattened to one list each, with short ids (K1, C3, T2, P1…) shared
// by the CSVs and the sentences.csv columns.
function insightRows(r) {
  if (!r) return [];
  return [
    ...r.keyPoints.map((k, i) => ({ id: `K${i + 1}`, section: "key point", title: k.text, label: "", detail: "", evidence: k.evidence })),
    ...r.claims.map((c, i) => ({ id: `C${i + 1}`, section: "claim", title: c.text, label: `${KINDS[c.kind].toLowerCase()} · ${SUPPORT[c.support].label.toLowerCase()}`, detail: c.note, evidence: c.evidence })),
    ...r.voices.map((v, i) => ({ id: `V${i + 1}`, section: "voice", title: v.name, label: v.role, detail: v.position, evidence: v.evidence })),
    ...r.agreement.map((a, i) => ({ id: `A${i + 1}`, section: "agreement", title: a.topic, label: a.status, detail: a.summary, evidence: a.evidence })),
    ...r.missing.map((m, i) => ({ id: `M${i + 1}`, section: "missing", title: m.gap, label: "", detail: m.why, evidence: [] }))
  ];
}
function uxrRows(r) {
  if (!r) return [];
  return [
    ...r.themes.map((t, i) => ({ id: `T${i + 1}`, section: t.kind, title: t.title, label: t.prevalence, detail: t.summary, evidence: t.evidence })),
    ...(r.painPoints || []).map((p, i) => ({ id: `P${i + 1}`, section: "pain point", title: p.title, label: p.severity, detail: p.summary, evidence: p.evidence })),
    ...(r.segments || []).map((g, i) => ({ id: `G${i + 1}`, section: "segment", title: g.name, label: g.description, detail: g.needs, evidence: g.evidence })),
    ...(r.jobs || []).map((j, i) => ({ id: `J${i + 1}`, section: "job to be done", title: j.job, label: "", detail: "", evidence: j.evidence })),
    ...(r.opportunities || []).map((o, i) => ({ id: `O${i + 1}`, section: "opportunity", title: o.title, label: "", detail: o.rationale, evidence: o.evidence })),
    ...(r.openQuestions || []).map((q, i) => ({ id: `Q${i + 1}`, section: "open question", title: q.question, label: "", detail: q.why, evidence: [] }))
  ];
}

// One row per finding–quote pair (findings without quotes get one row): the layout
// people paste into a synthesis board or a spreadsheet.
function findingsCsv(project, rows, extra = []) {
  const header = ["id", "section", "finding", "label", "detail", "source_id", "source_title", "sentence", "stance", "quote", "full_sentence"];
  const idx = new Map(project.sources.map((s, i) => [s.key, i]));
  const out = [];
  for (const r of [...rows, ...extra]) {
    const evs = r.evidence.filter((ev) => idx.has(ev.sourceKey));
    if (!evs.length) { out.push([r.id, r.section, r.title, r.label, r.detail, "", "", "", "", "", ""]); continue; }
    for (const ev of evs) {
      const i = idx.get(ev.sourceKey), src = project.sources[i];
      out.push([r.id, r.section, r.title, r.label, r.detail, `S${i + 1}`, src.model.title, ev.sentence, ev.stance, ev.quote, src.model.sentences[ev.sentence]?.text || ""]);
    }
  }
  return toCsv(header, out);
}
export function insightsCsv(project) {
  // Questions asked of the sources ride along, one row per answer point and quote.
  const asks = (project.asks || []).flatMap((a, i) => a.points.length
    ? a.points.map((p, j) => ({ id: `Q${i + 1}.${j + 1}`, section: "question", title: a.question, label: a.covered ? "answered" : "not covered", detail: `${a.answer} | ${p.text}`, evidence: p.evidence }))
    : [{ id: `Q${i + 1}`, section: "question", title: a.question, label: "not covered", detail: a.answer, evidence: [] }]);
  return findingsCsv(project, insightRows(project.ai?.insights), asks);
}
export function uxrCsv(project) {
  return findingsCsv(project, uxrRows(project.ai?.uxr));
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
  if (project.ai?.insights || project.asks?.length) zip.file(`${base}-insights.csv`, insightsCsv(project));
  if (project.ai?.uxr) zip.file(`${base}-uxr.csv`, uxrCsv(project));
  return zip.generateAsync({ type: "blob" });
}
