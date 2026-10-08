// Word-sense disambiguation for the meaning map. For each keyword: list its WordNet senses,
// embed each sense as "word: definition", embed every sentence the keyword appears in, let
// each sentence vote for its closest sense, and keep the winner. The text only picks the
// sense; the meaning vector is the dictionary definition, so it carries no co-occurrence.
import { readFileSync } from "fs";
const WN = process.env.WORDNET;
const POS = { noun: "n", verb: "v", adj: "a" };
const index = new Map(), data = {};
for (const pos of Object.keys(POS)) {
  for (const line of readFileSync(`${WN}/index.${pos}`, "utf8").split("\n")) {
    if (!line || line.startsWith(" ")) continue;
    const p = line.trim().split(" "), n = +p[2];
    (index.get(p[0]) ?? index.set(p[0], []).get(p[0])).push(...p.slice(-n).map((off) => [pos, off]));
  }
  data[pos] = new Map();
  for (const line of readFileSync(`${WN}/data.${pos}`, "utf8").split("\n")) {
    if (!line || line.startsWith(" ")) continue;
    const off = line.slice(0, 8), bar = line.indexOf(" | ");
    data[pos].set(off, line.slice(bar + 3).trim());
  }
}
export function senses(word) {
  for (const w of [word, word.replace(/es$/, ""), word.replace(/s$/, "")]) if (index.has(w)) return index.get(w).map(([pos, off], rank) => {
    const gloss = data[pos].get(off) || "", def = gloss.split(/;\s*"/)[0].trim();
    return { pos, rank, def, example: (gloss.match(/"([^"]+)"/) || [])[1] || "" };
  });
  return [];
}
// Part of speech from the word before: "to vote", "would cost" are verbs; "the vote",
// "flood risk" are nouns. Default noun: most keywords are nouns.
const VERB_BEFORE = new Set("to will would could can should might may must did does do not never also n't".split(" "));
const NOUN_BEFORE = new Set("the a an this that these those its their our his her my your of for in on at by with from and old new more less any every each no some".split(" "));
function posIn(t, sentence) {
  const words = sentence.toLowerCase().match(/[a-z']+/g) || [];
  for (let i = 0; i < words.length; i++) if (words[i] === t || words[i].replace(/(es|s|ed|ing)$/, "") === t.replace(/(es|s)$/, "")) {
    const prev = words[i - 1] || "", w = words[i];
    if (/(ed|ing)$/.test(w) && w !== t) return "verb";
    if (VERB_BEFORE.has(prev)) return "verb";
    if (NOUN_BEFORE.has(prev)) return "noun";
    return "noun";
  }
  return "noun";
}
// A few words either side of the keyword: closer to the sense than the whole sentence.
function windowOf(t, sentence, k = 6) {
  const words = sentence.split(/\s+/), i = words.findIndex((w) => w.toLowerCase().replace(/[^a-z]/g, "").startsWith(t.replace(/(es|s)$/, "")));
  return i < 0 ? sentence : words.slice(Math.max(0, i - k), i + k + 1).join(" ");
}
// The words that most often surround the keyword (within its sentences), most frequent first.
const STOP = new Set("a about after again all also an and any are as at be been before but by can could did do does for from had has have he her his how i if in into is it its just more most my no not of on one or our out over said says she so some than that the their them then there these they this those through to too up us very was we were what when which who will with would you your".split(" "));
function contextBag(t, sents, k = 10) {
  const stem = t.replace(/(es|s)$/, ""), n = new Map();
  for (const s of sents) for (const w of new Set((s.toLowerCase().match(/[a-z]+/g) || []).filter((w) => w.length > 2 && !STOP.has(w) && !w.startsWith(stem)))) n.set(w, (n.get(w) || 0) + 1);
  return [...n].sort((a, b) => b[1] - a[1]).slice(0, k).map((x) => x[0]);
}
export const MARGIN = +(process.env.WSD_MARGIN ?? 0.02);
export async function pickSenses(ex, terms, ctxSents) {
  const cos = (a, b) => a.reduce((s, x, i) => s + x * b[i], 0);
  const emb = async (xs) => (await ex(xs, { pooling: "mean", normalize: true })).tolist();
  const out = {};
  for (const t of terms) {
    const all = senses(t);
    if (!all.length) { out[t] = { text: t, def: null }; continue; }
    const sents = ctxSents[t], posVotes = { noun: 0, verb: 0 };
    for (const s of sents) posVotes[posIn(t, s)]++;
    const pos = posVotes.verb > posVotes.noun ? "verb" : "noun";
    let cand = all.filter((c) => c.pos === pos); if (!cand.length) cand = all;
    cand = cand.map((c, r) => ({ ...c, prank: r }));
    // Two context signals: the keyword's surrounding words (a bag) and a few words either side
    // of it in each sentence. Start from WordNet's first (most common) sense and switch only
    // when both signals prefer another sense by a clear margin.
    const bag = contextBag(t, sents);
    const C = await emb(cand.map((c) => c.def)), [B] = await emb([bag.join(" ")]), Wv = await emb(sents.map((x) => windowOf(t, x)));
    const sBag = cand.map((_, i) => cos(C[i], B)), sWin = cand.map((_, i) => Wv.reduce((a, v) => a + cos(C[i], v), 0) / Wv.length);
    const lift = cand.map((_, i) => Math.min(sBag[i] - sBag[0], sWin[i] - sWin[0]));
    const alt = lift.indexOf(Math.max(...lift)), win = lift[alt] > MARGIN ? alt : 0;
    out[t] = { lift: +lift[alt].toFixed(3), altDef: cand[alt].def, bag, text: `${t}: ${cand[win].def}`, def: cand[win].def, pos: cand[win].pos, sense: cand[win].prank + 1, of: cand.length, n: sents.length, posVotes, first: cand[0].def };
  }
  return out;
}
