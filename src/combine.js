// Combined view: several sources read as one text, so every Trends, Tone and References
// chart can show a chosen set of sources together. The blocks are concatenated in source
// order and analysed again; `parts` maps each range back to its source, so a click on a
// combined chart opens the right passage in the right source.

import { buildModel } from "./model.js";
import { analyzeTrends } from "./trends.js";
import { analyzeTone } from "./tone.js";

const cache = new Map();

export function combine(sources) {
  const id = sources.map((s) => s.key).join("|");
  if (cache.has(id)) return cache.get(id);
  const blocks = [], parts = [];
  for (const src of sources) {
    let host = "";
    try { host = new URL(src.model.meta.url).hostname; } catch {}
    parts.push({ key: src.key, blockStart: blocks.length });
    for (const b of src.model.blocks) blocks.push({ kind: b.kind, ordered: b.ordered, segs: b.segs, host });
  }
  const model = buildModel({ title: `${sources.length} sources`, meta: {}, blocks }, { maxWords: Infinity });
  // Offsets from block starts: each source's blocks are tokenised exactly as on their own.
  for (const p of parts) {
    const b = model.blocks[p.blockStart];
    p.tokOffset = b.tokStart;
    p.sentOffset = b.sentStart;
  }
  const trends = analyzeTrends(model);
  const tone = analyzeTone(model, trends);
  const view = { combined: true, keys: sources.map((s) => s.key), model, trends, tone, parts };
  if (cache.size > 12) cache.delete(cache.keys().next().value);
  cache.set(id, view);
  return view;
}

// A token or sentence number in the combined model, as a place in its own source.
export function locate(view, { token, sentence }) {
  const m = view.model;
  const block = token != null ? m.tokens[token]?.block : m.sentences[sentence]?.block;
  if (block == null) return null;
  let part = null;
  for (const p of view.parts) if (p.blockStart <= block) part = p;
  if (!part) return null;
  return token != null ? { sourceKey: part.key, token: token - part.tokOffset } : { sourceKey: part.key, sentence: sentence - part.sentOffset };
}
