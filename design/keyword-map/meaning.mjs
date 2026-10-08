// Meaning-based distance with all-MiniLM-L6-v2 (general English; knows nothing about this text).
// Two versions: "bare" embeds the keyword alone, so it takes the word's most common sense;
// "meaning" embeds "word: definition" for the WordNet sense the word has in this text
// (senses.json, chosen by Claude from the keyword's sentences). Same UMAP and grouping as the text.
import { pipeline, env } from "@huggingface/transformers";
import { readFileSync } from "fs";
import { senses } from "./wsd.mjs";
import { createRequire } from "module";
const { UMAP } = createRequire(import.meta.url)("umap-js");
env.allowRemoteModels = false; env.localModelPath = new URL("./models/", import.meta.url).pathname;
const D = JSON.parse(readFileSync(process.argv[2], "utf8"));
const terms = D.terms.map((x) => x.t), K = terms.length, f = D.terms.map((x) => x.f);
const ex = await pipeline("feature-extraction", "minilm", { dtype: "fp32" });
const SN = JSON.parse(readFileSync(new URL("./senses.json", import.meta.url), "utf8"));
const def = (t) => { const c = senses(t).filter((x) => x.pos === SN[t].pos); return c[SN[t].n - 1].def; };
const cosine = (a, b) => { let d = 0, x = 0, y = 0; for (let i = 0; i < a.length; i++) { d += a[i] * b[i]; x += a[i] * a[i]; y += b[i] * b[i]; } return 1 - d / Math.sqrt(x * y); };
function mulberry32(a) { return function () { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function louvain(Wm) {
  const n = Wm.length; let comm = [...Array(n).keys()];
  const k = Wm.map((r) => r.reduce((a, b) => a + b, 0)), m2 = k.reduce((a, b) => a + b, 0) || 1;
  let moved = true, guard = 0;
  while (moved && guard++ < 50) { moved = false;
    for (let i = 0; i < n; i++) { const tot = {}; for (let j = 0; j < n; j++) tot[comm[j]] = (tot[comm[j]] || 0) + k[j];
      const kin = {}; for (let j = 0; j < n; j++) if (j !== i && Wm[i][j]) kin[comm[j]] = (kin[comm[j]] || 0) + Wm[i][j];
      const own = comm[i]; tot[own] -= k[i]; let best = own, gain = (kin[own] || 0) - (tot[own] * k[i]) / m2;
      for (const c in kin) { const g = kin[c] - (tot[c] * k[i]) / m2; if (g > gain + 1e-9) { gain = g; best = +c; } }
      if (best !== own) { comm[i] = best; moved = true; } } }
  const map = {}; let c = 0; return comm.map((x) => (map[x] ??= c++));
}
D.senses = Object.fromEntries(terms.map((t) => [t, { def: def(t), pos: SN[t].pos, n: SN[t].n, why: SN[t].why || "" }]));
delete D.ctxSents;
for (const [key, texts] of [["bare", terms], ["meaning", terms.map((t) => `${t}: ${def(t)}`)]]) {
  const E = (await ex(texts, { pooling: "mean", normalize: true })).tolist();
  for (const [name, nn, md] of [["tight", 5, 0.02], ["medium", 5, 0.25], ["loose", 8, 0.8]]) {
    const u = new UMAP({ nComponents: 2, nNeighbors: nn, minDist: md, spread: 1, random: mulberry32(7), distanceFn: cosine, nEpochs: 600 });
    D.variants[key + ":" + name] = u.fit(E).map((p) => [+p[0].toFixed(3), +p[1].toFixed(3)]);
  }
  const dm = terms.map((_, i) => terms.map((_, j) => cosine(E[i], E[j])));
  const Wk = terms.map(() => Array(K).fill(0));
  for (let i = 0; i < K; i++) for (const [x, j] of dm[i].map((d, j) => [1 - d, j]).filter(([, j]) => j !== i).sort((a, b) => b[0] - a[0]).slice(0, 4)) if (x > 0) { Wk[i][j] = Math.max(Wk[i][j], x); Wk[j][i] = Wk[i][j]; }
  let g = louvain(Wk); const sz = {}; g.forEach((c, i) => (sz[c] = (sz[c] || 0) + f[i])); const ord = Object.keys(sz).sort((a, b) => sz[b] - sz[a]).map(Number); g = g.map((c) => ord.indexOf(c));
  D.terms.forEach((x, i) => { x.g[key] = g[i]; x.nn[key] = terms.map((u, j) => [u, j === i ? 9 : dm[i][j]]).sort((a, b) => a[1] - b[1]).slice(0, 3).map((y) => y[0]); });
  D.dist[key] = dm.map((r) => r.map((x) => +x.toFixed(3)));
  const by = {}; g.forEach((c, i) => (by[c] ??= []).push(terms[i])); console.error(key, "groups:", Object.values(by).map((x) => x.join(" ")).join(" | "));
}
console.log(JSON.stringify(D));
