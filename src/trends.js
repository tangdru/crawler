// Trends lens: word statistics only. Keywords by TF-IDF across paragraphs, term
// frequency across equal slices of the document, k-means topics over paragraphs,
// and sentence-level co-occurrence.

export const TOPIC_COLORS = ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181"];

const STOP = new Set(`a about above after again against all almost also although always am among an and another any anyone anything are around as at be became because become becomes been before being below between both but by can cannot could did do does doing done down during each either else enough even ever every few for from further get gets got had has have having he her here hers herself him himself his how however i if in into is it its itself just least less let like made make makes many may me might more most much must my myself near need neither never no nor not now of off often on once one only onto or other others our ours ourselves out over own per perhaps put quite rather really said same say says see seem seemed seems several she should since so some something such than that the their theirs them themselves then there these they this those though through thus to too toward towards under until up upon us use used using very via was way we well were what whatever when where whether which while who whom whose why will with within without would yet you your yours yourself also first second new two three four five six seven eight nine ten one many much part year years including include includes included based according however among within`.split(/\s+/));
// Citation boilerplate that would otherwise top every reference list.
const BOILER = new Set(`retrieved archived original accessed journal press pp vol isbn doi pmid pmc issn bibcode jstor hdl oclc edition publishing publisher publishers et al ed eds www http https com org html pdf page pages`.split(/\s+/));

function keep(term) {
  return term.length >= 3 && /\p{L}/u.test(term) && !STOP.has(term) && !BOILER.has(term) && !/^\d/.test(term);
}

export function analyzeTrends(model) {
  const sents = model.sentences;
  const totalWords = Math.max(1, sents.reduce((n, s) => n + s.wordCount, 0));
  const segCount = Math.max(2, Math.min(10, Math.floor(sents.length / 3)));

  // plural folding: "spiders" counts as "spider" when both appear
  const raw = new Map();
  for (const s of sents) for (const w of s.words) raw.set(w, (raw.get(w) || 0) + 1);
  const lemma = (w) => {
    if (w.length > 4 && w.endsWith("ies") && raw.has(w.slice(0, -3) + "y")) return w.slice(0, -3) + "y";
    if (w.length > 3 && w.endsWith("s") && !w.endsWith("ss") && raw.has(w.slice(0, -1))) return w.slice(0, -1);
    return w;
  };
  model.lemma = lemma;

  // per-sentence lemmas, segments
  let cum = 0;
  const sentLemmas = [];
  const sentSeg = new Int16Array(sents.length);
  for (const s of sents) {
    sentSeg[s.id] = Math.min(segCount - 1, Math.floor((cum / totalWords) * segCount));
    cum += s.wordCount;
    sentLemmas.push(s.words.map(lemma).filter(keep));
  }
  const segWords = new Array(segCount).fill(0);
  sents.forEach((s) => { segWords[sentSeg[s.id]] += s.wordCount; });

  // counts, document frequency over blocks, per-segment counts
  const terms = new Map();
  const blockSets = new Map();
  sents.forEach((s, k) => {
    for (const t of sentLemmas[k]) {
      let e = terms.get(t);
      if (!e) { e = { term: t, count: 0, df: 0, first: s.id, seg: new Array(segCount).fill(0) }; terms.set(t, e); }
      e.count++; e.seg[sentSeg[s.id]]++;
      if (!blockSets.has(s.block)) blockSets.set(s.block, new Set());
      blockSets.get(s.block).add(t);
    }
  });
  const nBlocks = Math.max(1, blockSets.size);
  for (const set of blockSets.values()) for (const t of set) terms.get(t).df++;
  for (const e of terms.values()) {
    e.tfidf = e.count * Math.log(1 + nBlocks / e.df);
    // trend: least-squares slope of the per-1,000-words rate across segments
    const ys = e.seg.map((c, i) => (segWords[i] ? (c / segWords[i]) * 1000 : 0));
    const n = ys.length, mx = (n - 1) / 2, my = ys.reduce((a, b) => a + b, 0) / n;
    let num = 0, den = 0;
    ys.forEach((y, i) => { num += (i - mx) * (y - my); den += (i - mx) ** 2; });
    e.rate = ys;
    e.slope = den ? num / den : 0;
    e.rel = my ? e.slope / my : 0;
  }
  const ranked = [...terms.values()].filter((e) => e.count >= 2).sort((a, b) => b.tfidf - a.tfidf);
  ranked.forEach((e, i) => { e.rank = i + 1; });
  const top = ranked.slice(0, 25);
  const topSet = new Map(top.map((e) => [e.term, e]));
  const pool = ranked.slice(0, 40).filter((e) => e.count >= 3);
  for (const e of pool) e.direction = e.rel > 0.12 ? "rising" : e.rel < -0.12 ? "fading" : "steady";
  const rising = pool.filter((e) => e.direction === "rising").sort((a, b) => b.rel - a.rel).slice(0, 5);
  const fading = pool.filter((e) => e.direction === "fading").sort((a, b) => a.rel - b.rel).slice(0, 5);

  // bigrams
  const bi = new Map();
  for (const s of sents) {
    const ws = s.words.map(lemma);
    for (let i = 0; i + 1 < ws.length; i++) {
      if (!keep(ws[i]) || !keep(ws[i + 1])) continue;
      const p = ws[i] + " " + ws[i + 1];
      bi.set(p, (bi.get(p) || 0) + 1);
    }
  }
  const bigrams = [...bi.entries()].filter(([, c]) => c >= 2).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([phrase, count]) => ({ phrase, count }));

  const topics = clusterTopics(model, sentLemmas, ranked.slice(0, 80), nBlocks);

  // co-occurrence among the top 12 keywords, counted per sentence
  const coTerms = top.slice(0, 12).map((e) => e.term);
  const idx = new Map(coTerms.map((t, i) => [t, i]));
  const matrix = coTerms.map(() => new Array(coTerms.length).fill(0));
  for (const ls of sentLemmas) {
    const present = [...new Set(ls.filter((t) => idx.has(t)))].map((t) => idx.get(t));
    for (let a = 0; a < present.length; a++) for (let b = a + 1; b < present.length; b++) {
      matrix[present[a]][present[b]]++; matrix[present[b]][present[a]]++;
    }
  }

  return { segCount, sentSeg, segWords, terms, ranked, top, topSet, rising, fading, bigrams, topics: topics.list, blockTopic: topics.blockTopic, cooc: { terms: coTerms, matrix } };
}

function clusterTopics(model, sentLemmas, vocabEntries, nBlocks) {
  const blockTopic = new Int16Array(model.blocks.length).fill(-1);
  const vocab = new Map(vocabEntries.map((e, i) => [e.term, i]));
  const idf = vocabEntries.map((e) => Math.log(1 + nBlocks / e.df));
  const V = vocabEntries.length;
  const vecs = new Map();
  model.sentences.forEach((s, k) => {
    for (const t of sentLemmas[k]) {
      if (!vocab.has(t)) continue;
      if (!vecs.has(s.block)) vecs.set(s.block, new Float32Array(V));
      vecs.get(s.block)[vocab.get(t)] += idf[vocab.get(t)];
    }
  });
  const ids = [...vecs.keys()];
  for (const id of ids) {
    const v = vecs.get(id); let n = 0;
    for (let i = 0; i < V; i++) n += v[i] * v[i];
    n = Math.sqrt(n) || 1;
    for (let i = 0; i < V; i++) v[i] /= n;
  }
  if (ids.length < 4 || V < 4) return { list: [], blockTopic };
  const k = Math.max(2, Math.min(5, Math.round(Math.sqrt(ids.length / 1.5))));
  const dot = (a, b) => { let s = 0; for (let i = 0; i < V; i++) s += a[i] * b[i]; return s; };

  // k-means++ with a seeded generator: same document, same topics. Best of 8 restarts.
  let seed = 7;
  const rand = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const run = (kk) => {
    const cents = [Float32Array.from(vecs.get(ids[Math.floor(rand() * ids.length)]))];
    while (cents.length < kk) {
      const d = ids.map((id) => 1 - Math.max(...cents.map((c) => dot(c, vecs.get(id)) / (Math.sqrt(dot(c, c)) || 1))));
      const sum = d.reduce((a, b) => a + b * b, 0) || 1;
      let r = rand() * sum, pick = ids[ids.length - 1];
      for (let i = 0; i < ids.length; i++) { r -= d[i] * d[i]; if (r <= 0) { pick = ids[i]; break; } }
      cents.push(Float32Array.from(vecs.get(pick)));
    }
    const assign = new Map();
    let cost = 0;
    for (let iter = 0; iter < 20; iter++) {
      cost = 0;
      for (const id of ids) {
        let bi = 0, bs = -Infinity;
        cents.forEach((c, i) => { const s = dot(c, vecs.get(id)) / (Math.sqrt(dot(c, c)) || 1); if (s > bs) { bs = s; bi = i; } });
        assign.set(id, bi);
        cost += 1 - bs;
      }
      cents.forEach((c, i) => {
        c.fill(0);
        for (const id of ids) if (assign.get(id) === i) { const v = vecs.get(id); for (let j = 0; j < V; j++) c[j] += v[j]; }
      });
    }
    return { cents, assign, cost };
  };
  let best = null;
  for (let r = 0; r < 8; r++) { const res = run(k); if (!best || res.cost < best.cost) best = res; }
  const { cents, assign } = best;
  // fold one-paragraph topics into their nearest neighbour; they are noise, not themes
  const sizes = cents.map((_, i) => ids.filter((id) => assign.get(id) === i).length);
  for (const id of ids) {
    const i = assign.get(id);
    if (sizes[i] > 1 || sizes.filter((s) => s > 1).length < 2) continue;
    let bi = i, bs = -Infinity;
    cents.forEach((c, j) => { if (j !== i && sizes[j] > 1) { const s = dot(c, vecs.get(id)) / (Math.sqrt(dot(c, c)) || 1); if (s > bs) { bs = s; bi = j; } } });
    assign.set(id, bi);
  }
  cents.forEach((c, i) => {
    c.fill(0);
    for (const id of ids) if (assign.get(id) === i) { const v = vecs.get(id); for (let j = 0; j < V; j++) c[j] += v[j]; }
  });
  const groups = cents.map((c, i) => {
    const members = ids.filter((id) => assign.get(id) === i);
    const order = [...c].map((w, j) => [w, j]).sort((a, b) => b[0] - a[0]).slice(0, 3).map(([, j]) => vocabEntries[j].term);
    return { members, terms: order };
  }).filter((g) => g.members.length);
  // order topics by first appearance so colors follow reading order
  groups.sort((a, b) => Math.min(...a.members) - Math.min(...b.members));
  const list = groups.map((g, i) => {
    for (const id of g.members) blockTopic[id] = i;
    const words = g.members.reduce((n, id) => n + model.sentences.filter((s) => s.block === id).reduce((m, s) => m + s.wordCount, 0), 0);
    return { id: i, label: g.terms.join(" · "), terms: g.terms, color: TOPIC_COLORS[i], blocks: g.members.length, words };
  });
  return { list, blockTopic };
}
