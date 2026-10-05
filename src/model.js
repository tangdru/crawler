// Document model: every source (paste, file, URL) becomes
//   { title, meta, blocks: [{ kind, segs: [{ text, href? }], ordered? }] }
// and buildModel turns that into tokens, sentences, sections and entities that the
// lenses, the crawler and the exports all share.

import { matchEntities, classifyHref, normalizeEntity, ENTITY_TYPES, speakerFor, yearOf } from "./references.js";
import { MAX_WORDS } from "./config.js";

const ABBREV = /^(?:[A-Z]|[A-Z]\.[A-Z]|Dr|Mr|Mrs|Ms|Prof|St|Sr|Jr|vs|etc|e\.g|i\.e|pp|p|vol|no|fig|al|Inc|Ltd|Co|Corp|Gen|Sen|Rep|Gov|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec|U\.S|U\.K|Mt|ed|eds|cf|ca|approx)$/i;

export function sentenceBounds(text) {
  const cuts = [0];
  const re = /[.!?…]+["”’')\]]*\s+/g;
  let m;
  while ((m = re.exec(text))) {
    const next = text[m.index + m[0].length];
    if (!next || !/[\p{Lu}\d"“‘(\[]/u.test(next)) continue;
    const before = text.slice(0, m.index).match(/(\S+)$/);
    const word = before ? before[1].replace(/^[("“'\[]+/, "") : "";
    if (text[m.index] === "." && ABBREV.test(word)) continue;
    cuts.push(m.index + m[0].length);
  }
  return cuts;
}

export function normTerm(s) {
  return s.toLowerCase()
    .replace(/[’']s$/u, "")
    .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
}

function cleanSegs(segs) {
  const out = [];
  for (const s of segs) {
    const text = (s.text || "").replace(/\s+/g, " ");
    if (!text) continue;
    const prev = out[out.length - 1];
    if (prev && prev.href === s.href) prev.text += text;
    else out.push({ text, href: s.href || null });
  }
  if (out.length) {
    out[0].text = out[0].text.replace(/^\s+/, "");
    out[out.length - 1].text = out[out.length - 1].text.replace(/\s+$/, "");
  }
  return out.filter((s) => s.text);
}

export function buildModel(doc) {
  const model = {
    title: doc.title || "Untitled",
    meta: doc.meta || {},
    blocks: [], sections: [], tokens: [], sentences: [], entities: [],
    wordCount: 0, truncated: false
  };
  let pageHost = "";
  try { pageHost = new URL(model.meta.url).hostname; } catch {}

  let section = -1;
  const startSection = (title, block) => { model.sections.push({ id: model.sections.length, title, block }); section = model.sections.length - 1; };

  for (const raw of doc.blocks) {
    if (model.wordCount >= MAX_WORDS) { model.truncated = true; break; }
    const segs = cleanSegs(raw.segs || [{ text: raw.text || "" }]);
    if (!segs.length) continue;
    const text = segs.map((s) => s.text).join("");
    const bi = model.blocks.length;
    const isHeading = /^h[1-3]$/.test(raw.kind);
    if (isHeading || section < 0) startSection(isHeading ? text : model.title, bi);
    const block = { id: bi, kind: raw.kind || "p", ordered: !!raw.ordered, text, segs, section, tokStart: model.tokens.length, sentStart: model.sentences.length };
    model.blocks.push(block);

    // segment offsets, for link targets
    const segRanges = [];
    let off = 0;
    for (const s of segs) { segRanges.push({ start: off, end: off + s.text.length, href: s.href }); off += s.text.length; }
    const hrefAt = (pos) => { for (const r of segRanges) if (pos >= r.start && pos < r.end) return r.href; return null; };

    // entities from the text itself
    const matches = matchEntities(text);
    const hasYear = /\b(1[5-9]|20)\d{2}\b/.test(text);
    for (const m of matches) if (m.type === "quote" && raw.kind === "li" && hasYear) m.type = "title";

    // tokens: atomic identifiers stay whole, everything else splits on whitespace
    const pushWords = (from, to) => {
      const re = /\S+/g; re.lastIndex = from;
      let w;
      const slice = text.slice(0, to);
      while ((w = re.exec(slice))) {
        model.tokens.push({ i: model.tokens.length, block: bi, start: w.index, end: w.index + w[0].length, text: w[0], term: normTerm(w[0]), href: hrefAt(w.index) });
      }
    };
    let pos = 0;
    for (const m of matches) {
      if (!ENTITY_TYPES[m.type].atomic) continue;
      pushWords(pos, m.start);
      m.tok = model.tokens.length;
      model.tokens.push({ i: model.tokens.length, block: bi, start: m.start, end: m.end, text: m.text, term: "", href: hrefAt(m.start), atomic: m.type });
      pos = m.end;
    }
    pushWords(pos, text.length);
    block.tokEnd = model.tokens.length;

    // sentences
    const cuts = sentenceBounds(text);
    for (let k = 0; k < cuts.length; k++) {
      const a = cuts[k], b = k + 1 < cuts.length ? cuts[k + 1] : text.length;
      const stext = text.slice(a, b).trim();
      if (!stext) continue;
      model.sentences.push({ id: model.sentences.length, block: bi, section, start: a, end: b, text: stext, tokStart: -1, tokEnd: -1 });
    }
    block.sentEnd = model.sentences.length;
    let si = block.sentStart;
    for (let t = block.tokStart; t < block.tokEnd; t++) {
      const tok = model.tokens[t];
      while (si + 1 < block.sentEnd && tok.start >= model.sentences[si + 1].start) si++;
      tok.sentence = si;
      const s = model.sentences[si];
      if (s.tokStart < 0) s.tokStart = t;
      s.tokEnd = t + 1;
    }

    const tokRange = (a, b) => {
      let ts = -1, te = -1;
      for (let t = block.tokStart; t < block.tokEnd; t++) {
        const tok = model.tokens[t];
        if (tok.end > a && tok.start < b) { if (ts < 0) ts = t; te = t; }
      }
      return [ts, te];
    };
    const addEntity = (type, start, end, etext, href, source) => {
      const [ts, te] = tokRange(start, end);
      if (ts < 0) return;
      const sent = model.tokens[ts].sentence;
      const e = {
        id: model.entities.length, type, text: etext.trim(), href: href || "",
        norm: normalizeEntity(type, etext, href), block: bi, section, sentence: sent,
        tokStart: ts, tokEnd: te, source, speaker: "", year: null
      };
      if (type === "quote") e.speaker = speakerFor(model.sentences[sent].text, etext);
      if (type === "date") e.year = yearOf(etext);
      model.entities.push(e);
    };
    for (const m of matches) addEntity(m.type, m.start, m.end, m.text, hrefAt(m.start), "text");

    // entities from link targets, when the visible text did not already carry them
    for (const r of segRanges) {
      if (!r.href) continue;
      const type = classifyHref(r.href, pageHost);
      if (!type) continue;
      const covered = matches.some((m) => ENTITY_TYPES[m.type].atomic && m.start < r.end && m.end > r.start);
      if (covered) continue;
      addEntity(type, r.start, r.end, text.slice(r.start, r.end), r.href, "link");
    }

    for (let t = block.tokStart; t < block.tokEnd; t++) if (model.tokens[t].term) model.wordCount++;
  }

  // entity lookups for the crawler
  model.entities.sort((a, b) => a.tokStart - b.tokStart || a.id - b.id);
  model.entities.forEach((e, k) => { e.id = k; });
  // a quote that continues a named speaker's earlier quote inherits the name
  let lastQuote = null;
  for (const e of model.entities) {
    if (e.type !== "quote") continue;
    if (!e.speaker && lastQuote && lastQuote.speaker && lastQuote.block === e.block && e.sentence - lastQuote.sentence <= 2) e.speaker = lastQuote.speaker;
    lastQuote = e;
  }
  model.entityAt = new Map();
  for (const e of model.entities) {
    if (!model.entityAt.has(e.tokStart)) model.entityAt.set(e.tokStart, []);
    model.entityAt.get(e.tokStart).push(e);
  }
  for (const s of model.sentences) {
    s.words = [];
    for (let t = s.tokStart; t >= 0 && t < s.tokEnd; t++) if (model.tokens[t].term) s.words.push(model.tokens[t].term);
    s.wordCount = s.words.length;
  }
  return model;
}

// Render the model into a container; each token becomes a span the crawler can find.
export function renderModel(model, container) {
  container.textContent = "";
  const frag = document.createDocumentFragment();
  let list = null;
  for (const b of model.blocks) {
    let el;
    if (b.kind === "li" || b.kind === "row") {
      const tag = b.kind === "li" && b.ordered ? "ol" : "ul";
      if (!list || list.tagName.toLowerCase() !== tag || list.dataset.kind !== b.kind) {
        list = document.createElement(tag);
        list.dataset.kind = b.kind;
        if (b.kind === "row") list.className = "rows";
        frag.appendChild(list);
      }
      el = document.createElement("li");
      list.appendChild(el);
    } else {
      list = null;
      const tag = { h1: "h1", h2: "h2", h3: "h3", quote: "blockquote", pre: "pre" }[b.kind] || "p";
      el = document.createElement(tag);
      frag.appendChild(el);
    }
    el.dataset.block = b.id;
    b.el = el;
    let prevEnd = 0;
    for (let t = b.tokStart; t < b.tokEnd; t++) {
      const tok = model.tokens[t];
      if (tok.start > prevEnd) el.appendChild(document.createTextNode(b.text.slice(prevEnd, tok.start)));
      const sp = document.createElement("span");
      sp.className = tok.atomic ? `e t-${tok.atomic}` : "w";
      if (tok.href) sp.classList.add("lnk");
      sp.textContent = tok.text;
      el.appendChild(sp);
      tok.el = sp;
      prevEnd = tok.end;
    }
  }
  container.appendChild(frag);
}
