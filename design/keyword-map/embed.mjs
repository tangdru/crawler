import { buildModel } from "../../src/model.js";
import { analyzeTrends } from "../../src/trends.js";
import { combine } from "../../src/combine.js";
import { SAMPLES, SAMPLE_PROJECTS } from "../../src/samples.js";
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const { UMAP } = require("umap-js");

const srcs = SAMPLE_PROJECTS.river.sources.map((k, i) => { const d = SAMPLES[k](); if (d.blocks[0].kind !== "h1") d.blocks.unshift({ kind: "h1", segs: [{ text: d.title }] }); const model = buildModel(d); analyzeTrends(model); return { key: "k" + i, model }; });
const v = combine(srcs);
const K = 20;
const terms = v.trends.ranked.slice(0, K).map((e) => e.term);
const ix = Object.fromEntries(terms.map((t, i) => [t, i]));
const sents = v.model.sentences.map((s) => [...new Set(s.words.map(v.model.lemma).filter((w) => w in ix))].map((w) => ix[w]));
const N = sents.length, f = Array(K).fill(0), C = terms.map(() => Array(K).fill(0));
for (const s of sents) { for (const a of s) f[a]++; for (const a of s) for (const b of s) if (a !== b) C[a][b]++; }
const P = terms.map((_, i) => terms.map((_, j) => i === j || !C[i][j] ? 0 : Math.max(0, Math.log((C[i][j] * N) / (f[i] * f[j])))));

// Louvain (single-level moves, repeated with aggregation) on PPMI weights for pairs seen >= 2 times
const W = terms.map((_, i) => terms.map((_, j) => (C[i][j] >= 2 ? P[i][j] : 0)));
function louvain(Wm) {
  const n = Wm.length; let comm = [...Array(n).keys()];
  const k = Wm.map((r) => r.reduce((a, b) => a + b, 0)), m2 = k.reduce((a, b) => a + b, 0) || 1;
  let moved = true, guard = 0;
  while (moved && guard++ < 50) {
    moved = false;
    for (let i = 0; i < n; i++) {
      const tot = {}; for (let j = 0; j < n; j++) tot[comm[j]] = (tot[comm[j]] || 0) + k[j];
      const kin = {}; for (let j = 0; j < n; j++) if (j !== i && Wm[i][j]) kin[comm[j]] = (kin[comm[j]] || 0) + Wm[i][j];
      const own = comm[i]; tot[own] -= k[i];
      let best = own, gain = (kin[own] || 0) - (tot[own] * k[i]) / m2;
      for (const c in kin) { const g = kin[c] - (tot[c] * k[i]) / m2; if (g > gain + 1e-9) { gain = g; best = +c; } }
      if (best !== own) { comm[i] = best; moved = true; }
    }
  }
  const map = {}; let c = 0; return comm.map((x) => (map[x] ??= c++));
}
let comm = louvain(W);
// order clusters by total frequency so colours are stable: biggest first
const csize = {}; comm.forEach((c, i) => (csize[c] = (csize[c] || 0) + f[i]));
const order = Object.keys(csize).sort((a, b) => csize[b] - csize[a]).map(Number);
comm = comm.map((c) => order.indexOf(c));

// UMAP on PPMI rows, cosine distance, seeded
function mulberry32(a) { return function () { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const cosine = (a, b) => { let d = 0, x = 0, y = 0; for (let i = 0; i < a.length; i++) { d += a[i] * b[i]; x += a[i] * a[i]; y += b[i] * b[i]; } return x && y ? 1 - d / Math.sqrt(x * y) : 1; };

// Richer profiles: describe each keyword by its PPMI with the most common content words
// (not just the other 19 keywords). "win" = how many neighbouring sentences count as context.
const ctxTerms = [...v.trends.terms.values()].sort((a, b) => b.count - a.count).slice(0, 200).map((e) => e.term);
const cix = Object.fromEntries(ctxTerms.map((t, i) => [t, i]));
const sentCtx = v.model.sentences.map((s) => [...new Set(s.words.map(v.model.lemma).filter((w) => w in cix))].map((w) => cix[w]));
const sentBlock = v.model.sentences.map((s) => s.block);
function richProfile(win) {
  const M = ctxTerms.length, Kc = terms.map(() => new Float64Array(M)), kf = Array(K).fill(0), cf = new Float64Array(M);
  let n = 0;
  for (let si = 0; si < N; si++) {
    // context bag: this sentence plus win neighbours inside the same paragraph
    const bag = new Set();
    for (let d = -win; d <= win; d++) { const j = si + d; if (j >= 0 && j < N && sentBlock[j] === sentBlock[si]) for (const c of sentCtx[j]) bag.add(c); }
    n++; for (const c of bag) cf[c]++;
    for (const a of sents[si]) { kf[a]++; for (const c of bag) if (ctxTerms[c] !== terms[a]) Kc[a][c]++; }
  }
  return Kc.map((row, a) => Array.from(row, (x, c) => (x ? Math.max(0, Math.log((x * n) / (kf[a] * cf[c]))) : 0)));
}
const profiles = { kw: P, rich: richProfile(0), rich1: richProfile(1) };
const variants = {};
const sep = (e) => { let a = 0, na = 0, b = 0, nb = 0; for (let i = 0; i < K; i++) for (let j = i + 1; j < K; j++) { const D = Math.hypot(e[i][0] - e[j][0], e[i][1] - e[j][1]); if (comm[i] === comm[j]) { a += D; na++; } else { b += D; nb++; } } return +(a / na / (b / nb)).toFixed(2); };
const report = {};
for (const [pn, prof] of Object.entries(profiles)) for (const [name, nn, md] of [["tight", 5, 0.02], ["medium", 5, 0.25], ["loose", 8, 0.8]]) {
  const u = new UMAP({ nComponents: 2, nNeighbors: nn, minDist: md, spread: 1, random: mulberry32(7), distanceFn: cosine, nEpochs: 600 });
  const e = u.fit(prof);
  variants[pn + ":" + name] = e.map((p) => [+p[0].toFixed(3), +p[1].toFixed(3)]);
  report[pn + ":" + name] = sep(e);
}
// nearest neighbours by profile, to sanity-check what each profile thinks is similar
const nnOf = (prof) => Object.fromEntries(terms.map((t, i) => [t, terms.map((u, j) => [u, j === i ? 9 : cosine(prof[i], prof[j])]).sort((a, b) => a[1] - b[1]).slice(0, 3).map((x) => x[0]).join(", ")]));
// Groups from each profile: Louvain on a k-nearest-neighbour similarity graph (k=4, cosine).
function profGroups(prof, k = 4) {
  const S = terms.map((_, i) => terms.map((_, j) => (i === j ? 0 : 1 - cosine(prof[i], prof[j]))));
  const Wk = terms.map(() => Array(K).fill(0));
  for (let i = 0; i < K; i++) { const nb = S[i].map((x, j) => [x, j]).filter(([, j]) => j !== i).sort((a, b) => b[0] - a[0]).slice(0, k); for (const [x, j] of nb) if (x > 0) { Wk[i][j] = Math.max(Wk[i][j], x); Wk[j][i] = Math.max(Wk[j][i], x); } }
  let g = louvain(Wk); const sz = {}; g.forEach((c, i) => (sz[c] = (sz[c] || 0) + f[i])); const ord = Object.keys(sz).sort((a, b) => sz[b] - sz[a]).map(Number); return g.map((c) => ord.indexOf(c));
}
const pgroups = Object.fromEntries(Object.entries(profiles).map(([pn, prof]) => [pn, profGroups(prof)]));
for (const pn in pgroups) { const by = {}; pgroups[pn].forEach((c, i) => (by[c] ??= []).push(terms[i])); console.error(pn, "groups:", Object.values(by).map((x) => x.join(" ")).join(" | ")); }
console.error(JSON.stringify(report), "ctx words:", ctxTerms.length);
for (const pn of ["kw", "rich1"]) { const m = nnOf(profiles[pn]); console.error(pn, ["flood", "budget", "plan", "council", "storm", "vote", "cost"].map((t) => t + "→" + m[t]).join(" | ")); }
const dist = Object.fromEntries(Object.entries(profiles).map(([pn, prof]) => [pn, terms.map((_, i) => terms.map((_, j) => +cosine(prof[i], prof[j]).toFixed(3)))]));
// sentences each keyword appears in, so the meaning step can pick the word's sense
const ctxSents = Object.fromEntries(terms.map((t, i) => [t, v.model.sentences.filter((_, k) => sents[k].includes(i)).map((s) => s.text.trim())]));
console.log(JSON.stringify({ N, ctx: ctxTerms.length, dist, ctxSents, terms: terms.map((t, i) => ({ t, f: f[i], c: comm[i], g: Object.fromEntries(Object.entries(pgroups).map(([pn, g]) => [pn, g[i]])), nn: Object.fromEntries(Object.entries(profiles).map(([pn, prof]) => [pn, terms.map((u, j) => [u, j === i ? 9 : cosine(prof[i], prof[j])]).sort((a, b) => a[1] - b[1]).slice(0, 3).map((x) => x[0])])) })), variants, links: (() => { const L = []; for (let i = 0; i < K; i++) for (let j = i + 1; j < K; j++) if (C[i][j] >= 2) L.push({ a: terms[i], b: terms[j], c: C[i][j], lift: +Math.exp(P[i][j]).toFixed(2) }); return L; })() }));
process.exit(0);
