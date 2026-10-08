// Reference grammar: the identifiers, citations and quoted material the References lens
// finds. Pure pattern matching, no guessing.

export const ENTITY_TYPES = {
  doi:     { label: "DOI",      color: "#33e1ff", fx: "callout", atomic: true },
  isbn:    { label: "ISBN",     color: "#4f7dff", fx: "callout", atomic: true },
  pmid:    { label: "ID",       color: "#46f08a", fx: "callout", atomic: true },
  bibcode: { label: "Bibcode",  color: "#b07cff", fx: "callout", atomic: true },
  url:     { label: "Link",     color: "#8487ee", fx: "callout", atomic: true },
  email:   { label: "Email",    color: "#8487ee", fx: "callout", atomic: true },
  cite:    { label: "Citation", color: "#62ffd0", fx: "tag",     atomic: true },
  title:   { label: "Title",    color: "#ff3fd8", fx: "bar" },
  quote:   { label: "Quote",    color: "#ff3fd8", fx: "bar" },
  author:  { label: "Author",   color: "#ffb547", fx: "tag" },
  date:    { label: "Date",     color: "#ff6b5e", fx: "tag" },
  figure:  { label: "Figure",   color: "#ffd84d", fx: "callout" },
  pages:   { label: "Pages",    color: "#9aa0b4", fx: "tag" }
};

const MONTHS = "January|February|March|April|May|June|July|August|September|October|November|December|Jan\\.?|Feb\\.?|Mar\\.?|Apr\\.?|Jun\\.?|Jul\\.?|Aug\\.?|Sept?\\.?|Oct\\.?|Nov\\.?|Dec\\.?";

// Order matters: earlier rules win when two match at the same position.
const RULES = [
  ["doi",     String.raw`(?:doi:\s?|https?:\/\/(?:dx\.)?doi\.org\/)?\b10\.\d{4,9}\/[^\s"<>]*[^\s"<>.,;)\]]`],
  ["email",   String.raw`\b[\w.+-]+@[\w-]+(?:\.[\w-]+)*\.[a-z]{2,}\b`],
  ["url",     String.raw`\bhttps?:\/\/[^\s<>"]+[^\s<>".,;)\]]|\bwww\.[\w-]+(?:\.[\w-]+)+(?:\/[^\s<>"]*[^\s<>".,;)\]])?`],
  ["isbn",    String.raw`\bISBN(?:-1[03])?:?\s?(?:97[89][-–\s]?)?\d[\d\-–\s]{7,14}[\dX]\b`],
  ["pmid",    String.raw`\b(?:PMID|PMCID|PMC|ISSN|JSTOR|OCLC|hdl|arXiv)[:\s]\s?[\w./-]*\d[\w./-]*\d|\bPMC\d{5,9}\b`],
  ["bibcode", String.raw`\bBibcode:\s?\S+[^\s.]`],
  ["cite",    String.raw`\[\d{1,3}(?:[,–-]\s?\d{1,3})*\]`],
  ["quote",   String.raw`"[^"\n]{3,400}"|“[^”\n]{3,400}”`],
  ["author",  String.raw`\b[A-Z][\p{L}’'-]+,\s(?:[A-Z]\.\s?){1,3}(?=[\s;,&(]|$)|\b[A-Z][\p{L}’'-]+,\s[A-Z][\p{L}]+(?:\s[A-Z][\p{L}]+)?(?=\s\(|;|\s&)`],
  ["figure",  String.raw`[$€£¥]\s?\d[\d,]*(?:\.\d+)?(?:\s?(?:million|billion|trillion|thousand|[mbk]n?)\b)?|\b\d[\d,]*(?:\.\d+)?\s?(?:%|percent\b|per cent\b)|\b\d[\d,]*(?:\.\d+)?\s(?:million|billion|trillion)\b`],
  ["date",    String.raw`\b(?:\d{1,2}\s)?(?:${MONTHS})\s(?:\d{1,2},\s)?\d{4}\b|\b(?:${MONTHS})\s\d{1,2}(?:st|nd|rd|th)?\b|\b\d{4}-\d{2}-\d{2}\b|\b(?:1[5-9]|20)\d{2}s?\b`],
  ["pages",   String.raw`\bpp?\.\s?[A-Z]?\d+(?:[–-][A-Z]?\d+)?`]
];
export const ENTITY_RE = new RegExp(RULES.map(([k, r]) => `(?<${k}>${r})`).join("|"), "gu");

export function matchEntities(text) {
  const out = [];
  ENTITY_RE.lastIndex = 0;
  let m;
  while ((m = ENTITY_RE.exec(text))) {
    if (!m[0]) { ENTITY_RE.lastIndex++; continue; }
    const type = Object.keys(m.groups).find((k) => m.groups[k] !== undefined);
    out.push({ type, start: m.index, end: m.index + m[0].length, text: m[0] });
  }
  return out;
}

// A link's target can be an identifier even when its visible text is not.
export function classifyHref(href, pageHost) {
  let u;
  try { u = new URL(href); } catch { return null; }
  if (!/^https?:$/.test(u.protocol)) return u.protocol === "mailto:" ? "email" : null;
  const h = u.hostname.replace(/^www\./, "");
  if (/(^|\.)doi\.org$/.test(h)) return "doi";
  if (/pubmed|ncbi\.nlm\.nih\.gov|europepmc|jstor\.org|arxiv\.org|handle\.net|worldcat\.org/.test(h)) return "pmid";
  if (/adsabs\.harvard\.edu/.test(h)) return "bibcode";
  if (/isbnsearch|Special:BookSources/i.test(href)) return "isbn";
  if (pageHost && h === pageHost.replace(/^www\./, "")) return null; // internal navigation
  if (/(^|\.)wikipedia\.org$|wikimedia|wikidata/.test(h)) return null;
  return "url";
}

export function normalizeEntity(type, text, href) {
  const t = text.trim();
  switch (type) {
    case "doi": {
      const m = (href || t).match(/10\.\d{4,9}\/[^\s"<>]+/);
      return m ? m[0].replace(/[.,;)\]]+$/, "").toLowerCase() : t;
    }
    case "isbn": return t.replace(/^ISBN(?:-1[03])?:?\s?/i, "").replace(/[\s–-]/g, "");
    case "pmid": return t.replace(/\s+/g, " ");
    case "url": return href || (/^www\./.test(t) ? "https://" + t : t);
    case "quote": case "title": return t.replace(/^["“]|["”]$/g, "");
    case "date": return t;
    default: return href || t;
  }
}

// Year carried by a date entity, when there is one.
export function yearOf(text) {
  const m = text.match(/\b(1[5-9]|20)\d{2}\b/);
  return m ? +m[0] : null;
}

const SAY = "said|says|told|wrote|writes|added|adds|explained|argued|argues|noted|notes|warned|warns|asked|replied|insisted|recalled|according to";
const NAME = String.raw`(?:(?:Dr|Mr|Mrs|Ms|Prof|Sen|Rep|Gov|Mayor|Councillor|Councilmember)\.?\s)?[A-Z][\p{L}’'-]+(?:\s[A-Z][\p{L}’'-]+){0,2}`;
const AFTER_RE = new RegExp(String.raw`(?:${SAY})\s+(${NAME})`, "u");
const BEFORE_RE = new RegExp(String.raw`(${NAME})\s+(?:${SAY})\b`, "u");
const NOT_NAMES = /^(The|A|An|He|She|They|It|We|I|This|That|These|Those|His|Her|Their|In|On|At|But|And|Officials?|Residents?|Researchers?)$/;

// Best-effort speaker for a quote, from the sentence around it.
export function speakerFor(sentenceText, quoteText) {
  const rest = sentenceText.replace(quoteText, " ");
  for (const re of [AFTER_RE, BEFORE_RE]) {
    const m = rest.match(re);
    if (m && !NOT_NAMES.test(m[1].split(" ")[0])) return m[1].trim();
  }
  return "";
}
