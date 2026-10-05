// Tone lens: word lists written for this project (no third-party lexicon).
// Fast and transparent, and rougher than a trained model: it counts words, it does
// not understand sarcasm or context beyond a simple negation window.

const list = (s) => new Set(s.trim().split(/\s+/));

const POS = list(`good great excellent positive benefit benefits beneficial success successful succeed succeeded improve improved improves improvement gain gains strong stronger strength best better win wins won hope hopeful happy glad pleased welcome welcomed support supports supported praise praised effective efficient safe safer secure love loved enjoy enjoyed celebrate celebrated thrive thriving healthy healthier recover recovered recovery restore restored restoration progress promising opportunity opportunities agree agreed agreement approve approved approval advantage achieve achieved achievement impressive remarkable valuable helpful useful fair proud pride grateful thanks thankful resilient vibrant beautiful wonderful exciting excited boost boosted growth thrive solve solved solution solutions protect protected protection reliable stable stability confident easier favorable optimistic delight delighted satisfied satisfaction encouraging encouraged innovative fascinating benefitted affordable fixed restored revived flourish flourishing lively peaceful calm comfortable generous kind effective`);
const NEG = list(`bad poor worse worst fail fails failed failure failures risk risks risky danger dangerous threat threats threaten threatened harm harmful damage damaged damaging loss losses lose lost decline declined declining crisis problem problems concern concerns concerned worry worried afraid anxious anxiety angry anger outrage outraged criticize criticized criticism blame blamed difficult difficulty struggle struggling struggled poison poisonous venomous toxic disease diseases illness sick death deaths dead die died kill killed killing injury injuries pain painful wrong error errors mistake mistakes misdiagnosis misinformation false myth myths attack attacks violent violence flood floods flooding flooded destroy destroyed collapse collapsed shortage shortfall deficit debt cuts delay delayed delays oppose opposed opposition reject rejected complaint complaints dispute disputed conflict controversial controversy unsafe unfair dirty polluted pollution contaminated waste wasted expensive costly overrun overruns problematic disgusting disgust hate hated terrible horrible awful scary frightening alarming alarmed panic phobia phobias suffer suffering suffered victim victims fear fears feared dread deadly lawsuit fines penalty eroded erosion warn warned warning stalled closed closure layoffs`);
const HEDGE = list(`may might could possibly perhaps likely unlikely probably apparently appear appears appeared seem seems seemed suggest suggests suggested suggesting indicate indicates indicated potential potentially approximately roughly estimated estimate estimates reportedly allegedly arguably somewhat relatively unclear uncertain uncertainty generally typically often sometimes tend tends assume believe believes believed possible possibility plausibly presumably partly preliminary`);
const BOOST = list(`clearly certainly definitely undoubtedly obviously always never must prove proves proved proven demonstrate demonstrates demonstrated establish established confirm confirms confirmed conclusively indeed surely truly guarantee guaranteed absolutely completely entirely undeniable undeniably evident essential every`);
export const EMOTIONS = {
  fear:     list(`fear feared fears afraid scared scary frightening frightened terror terrified panic phobia phobias anxious anxiety dread dreaded alarm alarmed alarming threat threatened danger dangerous worried worry nervous horror horrified venomous deadly`),
  anger:    list(`anger angry outrage outraged furious fury rage frustrated frustration annoyed irritated hostile resent resentment blame blamed criticize criticized condemn condemned protest protested hate hated disgust disgusting`),
  sadness:  list(`sad sadness grief grieve mourning loss lost lonely depressed depression sorrow tragic tragedy unfortunately regret regretted disappointed disappointing disappointment hopeless suffer suffering suffered death died victims despair`),
  joy:      list(`joy happy happiness glad delight delighted pleased celebrate celebrated celebration excited exciting enjoy enjoyed love loved fun wonderful cheerful proud pride thrilled laugh hope hopeful grateful`),
  trust:    list(`trust trusted reliable confidence confident support supported agree agreed agreement credible proven safe secure assurance promise promised loyal honest depend dependable endorse endorsed`),
  surprise: list(`surprise surprised surprising surprisingly unexpected unexpectedly sudden suddenly astonishing astonished shock shocked shocking remarkable amazing amazed startling unusual`)
};
export const EMOTION_KEYS = Object.keys(EMOTIONS);
const NEGATORS = list(`not no never without hardly barely nor cannot neither`);
const CITE_TYPES = new Set(["doi", "isbn", "pmid", "bibcode", "url", "cite", "author", "title"]);

function forms(w) {
  const out = [w];
  if (w.endsWith("ies")) out.push(w.slice(0, -3) + "y");
  if (w.endsWith("es")) out.push(w.slice(0, -2));
  if (w.endsWith("s")) out.push(w.slice(0, -1));
  if (w.endsWith("ed")) out.push(w.slice(0, -2), w.slice(0, -1));
  if (w.endsWith("ing")) out.push(w.slice(0, -3), w.slice(0, -3) + "e");
  if (w.endsWith("ly")) out.push(w.slice(0, -2));
  return out;
}
const inSet = (set, w) => forms(w).some((f) => set.has(f));

export function analyzeTone(model, trends) {
  const tokTone = new Map();
  const sentences = model.sentences.map((s) => {
    let pos = 0, neg = 0, hedges = 0, boosters = 0, flip = 0;
    const emo = Object.fromEntries(EMOTION_KEYS.map((k) => [k, 0]));
    for (let t = s.tokStart; t >= 0 && t < s.tokEnd; t++) {
      const tok = model.tokens[t];
      const w = tok.term || (/n['’]t$/i.test(tok.text) ? "not" : "");
      if (!w) continue;
      if (NEGATORS.has(w) || /n['’]t$/i.test(tok.text)) { flip = 3; continue; }
      const mark = {};
      let pol = 0;
      if (inSet(POS, w)) pol = 1; else if (inSet(NEG, w)) pol = -1;
      if (pol && flip > 0) pol = -pol;
      if (pol > 0) pos++; else if (pol < 0) neg++;
      if (pol) mark.pol = pol;
      if (HEDGE.has(w)) { hedges++; mark.hedge = true; }
      else if (BOOST.has(w)) { boosters++; mark.boost = true; }
      for (const k of EMOTION_KEYS) if (inSet(EMOTIONS[k], w)) { emo[k]++; mark.emo = mark.emo || k; }
      if (Object.keys(mark).length) tokTone.set(t, mark);
      if (flip > 0) flip--;
    }
    const score = Math.max(-1, Math.min(1, ((pos - neg) / Math.sqrt(Math.max(1, s.wordCount))) * 1.2));
    return { id: s.id, pos, neg, score, hedges, boosters, emo };
  });

  // citations within a sentence of each claim
  const cited = new Uint8Array(model.sentences.length);
  for (const e of model.entities) {
    if (CITE_TYPES.has(e.type) || (e.type === "quote" && e.speaker)) {
      for (const d of [-1, 0, 1]) { const k = e.sentence + d; if (k >= 0 && k < cited.length) cited[k] = 1; }
    }
  }
  sentences.forEach((t, k) => {
    t.cited = !!cited[k];
    t.uncitedConfident = t.boosters > 0 && t.hedges === 0 && !t.cited && model.sentences[k].wordCount >= 6;
  });

  // aggregate across the same slices Trends uses
  const segCount = trends.segCount;
  const seg = Array.from({ length: segCount }, () => ({ words: 0, score: 0, n: 0, hedges: 0, boosters: 0, emo: Object.fromEntries(EMOTION_KEYS.map((k) => [k, 0])) }));
  model.sentences.forEach((s, k) => {
    const g = seg[trends.sentSeg[k]], t = sentences[k];
    g.words += s.wordCount; g.n++; g.score += t.score; g.hedges += t.hedges; g.boosters += t.boosters;
    for (const e of EMOTION_KEYS) g.emo[e] += t.emo[e];
  });
  for (const g of seg) {
    const per = g.words ? 100 / g.words : 0;
    g.mean = g.n ? g.score / g.n : 0;
    g.hedgeRate = g.hedges * per; g.boostRate = g.boosters * per;
    g.emoRate = Object.fromEntries(EMOTION_KEYS.map((k) => [k, g.emo[k] * per]));
  }
  const totals = sentences.reduce((a, t) => { a.pos += t.pos; a.neg += t.neg; a.hedges += t.hedges; a.boosters += t.boosters; return a; }, { pos: 0, neg: 0, hedges: 0, boosters: 0 });
  totals.mean = sentences.length ? sentences.reduce((n, t) => n + t.score, 0) / sentences.length : 0;
  return { sentences, tokTone, seg, totals };
}

// Combined view: mood per topic, and the tone around each attributed quote.
export function combine(model, trends, tone) {
  const byTopic = trends.topics.map((tp) => {
    const ss = model.sentences.filter((s) => trends.blockTopic[s.block] === tp.id);
    const mean = ss.length ? ss.reduce((n, s) => n + tone.sentences[s.id].score, 0) / ss.length : 0;
    const hedges = ss.reduce((n, s) => n + tone.sentences[s.id].hedges, 0);
    return { topic: tp, n: ss.length, mean, hedges };
  });
  return { byTopic };
}
