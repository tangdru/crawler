// Loaders: every source becomes { title, meta, blocks: [{ kind, segs, ordered? }] }.

import { LIBS, FETCH_FUNCTION, SUPABASE_ANON_KEY } from "./config.js";

const scripts = new Map();
export function loadScript(src) {
  if (!scripts.has(src)) {
    scripts.set(src, new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = src; s.async = true;
      s.onload = resolve;
      s.onerror = () => { scripts.delete(src); reject(new Error(`Could not load a helper library (${new URL(src).pathname.split("/")[2] || src}). Check your connection and try again.`)); };
      document.head.appendChild(s);
    }));
  }
  return scripts.get(src);
}

const block = (kind, text, extra) => ({ kind, segs: [{ text }], ...extra });

/* ---------- plain text and markdown ---------- */
function mdSegs(line) {
  const segs = [];
  const re = /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g;
  let pos = 0, m;
  const clean = (s) => s.replace(/(\*\*|__|`)/g, "").replace(/(^|\s)[*_]([^*_]+)[*_]/g, "$1$2");
  while ((m = re.exec(line))) {
    if (m.index > pos) segs.push({ text: clean(line.slice(pos, m.index)) });
    segs.push({ text: clean(m[1]), href: m[2] });
    pos = m.index + m[0].length;
  }
  if (pos < line.length) segs.push({ text: clean(line.slice(pos)) });
  return segs;
}

export function fromText(raw, title, meta = {}) {
  const blocks = [];
  const text = raw.replace(/\r\n?/g, "\n");
  for (const para of text.split(/\n\s*\n/)) {
    const lines = para.split("\n").map((l) => l.trimEnd()).filter((l) => l.trim());
    if (!lines.length) continue;
    const listLike = lines.length > 2 && lines.every((l) => l.length < 400);
    let buf = [];
    const flush = () => { if (buf.length) { blocks.push({ kind: "p", segs: mdSegs(buf.join(" ")) }); buf = []; } };
    for (const l of lines) {
      const h = l.match(/^(#{1,6})\s+(.*)$/);
      const li = l.match(/^\s*(?:[-*•]|(\d+)[.)])\s+(.*)$/);
      if (h) { flush(); blocks.push({ kind: h[1].length <= 2 ? "h2" : "h3", segs: mdSegs(h[2]) }); }
      else if (li) { flush(); blocks.push({ kind: "li", ordered: !!li[1], segs: mdSegs(li[2]) }); }
      else if (listLike) { flush(); blocks.push({ kind: "li", segs: mdSegs(l.trim()) }); }
      else buf.push(l.trim());
    }
    flush();
  }
  const first = blocks.find((b) => /^h/.test(b.kind));
  return { title: title || (first ? first.segs.map((s) => s.text).join("") : "Pasted text"), meta, blocks };
}

/* ---------- HTML (pages, Word, EPUB) ---------- */
const SKIP = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "SVG", "BUTTON", "FORM", "INPUT", "SELECT", "TEXTAREA", "IFRAME", "CANVAS", "VIDEO", "AUDIO", "TEMPLATE", "OBJECT"]);
const CHROME = new Set(["NAV", "FOOTER", "HEADER", "ASIDE"]);
const BLOCKS = new Set(["P", "H1", "H2", "H3", "H4", "H5", "H6", "LI", "BLOCKQUOTE", "PRE", "TABLE", "UL", "OL", "DL", "DT", "DD", "FIGCAPTION", "DIV", "SECTION", "ARTICLE", "MAIN", "FIGURE", "HEADER", "FOOTER", "ASIDE", "NAV", "TR", "CAPTION", "DETAILS", "SUMMARY", "HR", "BR_BLOCK"]);

function inlineSegs(el, base, segs = [], href = null) {
  for (const n of el.childNodes) {
    if (n.nodeType === 3) { segs.push({ text: n.nodeValue, href }); continue; }
    if (n.nodeType !== 1 || SKIP.has(n.tagName)) continue;
    if (n.tagName === "UL" || n.tagName === "OL") continue; // nested lists become their own blocks
    if (n.tagName === "BR") { segs.push({ text: " ", href }); continue; }
    if (n.classList && (n.classList.contains("mw-editsection") || n.classList.contains("noprint"))) continue;
    let h = href;
    if (n.tagName === "A" && n.getAttribute("href")) {
      const raw = n.getAttribute("href");
      if (!raw.startsWith("#") && !/^javascript:/i.test(raw)) {
        try { h = new URL(raw, base || undefined).href; } catch { h = null; }
      }
    }
    inlineSegs(n, base, segs, h);
  }
  return segs;
}

function hasBlockChild(el) {
  for (const c of el.children) if (BLOCKS.has(c.tagName)) return true;
  return false;
}

function walk(el, base, blocks, opts) {
  for (const n of el.children) {
    const tag = n.tagName;
    if (SKIP.has(tag)) continue;
    if (opts.dropChrome && CHROME.has(tag)) continue;
    if (n.getAttribute && (n.getAttribute("aria-hidden") === "true" || n.hidden)) continue;
    if (/^H[1-6]$/.test(tag)) { blocks.push({ kind: tag === "H1" || tag === "H2" ? "h2" : "h3", segs: inlineSegs(n, base) }); continue; }
    if (tag === "UL" || tag === "OL") {
      for (const li of n.children) {
        if (li.tagName !== "LI") continue;
        const segs = inlineSegs(li, base);
        if (segs.some((s) => s.text.trim())) blocks.push({ kind: "li", ordered: tag === "OL", segs });
        for (const sub of li.querySelectorAll(":scope > ul, :scope > ol, :scope > div")) walk({ children: [sub] }, base, blocks, opts);
      }
      continue;
    }
    if (tag === "TABLE") {
      for (const tr of n.querySelectorAll("tr")) {
        const cells = [...tr.children].filter((c) => /^T[DH]$/.test(c.tagName));
        const segs = [];
        cells.forEach((c, i) => { if (i) segs.push({ text: " │ " }); inlineSegs(c, base, segs); });
        if (segs.some((s) => s.text.trim() && s.text !== " │ ")) blocks.push({ kind: "row", segs });
      }
      continue;
    }
    if (tag === "BLOCKQUOTE" && !hasBlockChild(n)) { blocks.push({ kind: "quote", segs: inlineSegs(n, base) }); continue; }
    if (tag === "PRE") { blocks.push({ kind: "pre", segs: [{ text: n.textContent }] }); continue; }
    if (hasBlockChild(n)) { walk(n, base, blocks, opts); continue; }
    const segs = inlineSegs(n, base);
    if (segs.some((s) => s.text.trim())) blocks.push({ kind: "p", segs });
  }
}

function metaFrom(doc) {
  const get = (...names) => {
    for (const nm of names) {
      const el = doc.querySelector(`meta[name="${nm}"], meta[property="${nm}"]`);
      if (el && el.content) return el.content.trim();
    }
    return "";
  };
  return {
    title: get("citation_title", "og:title", "twitter:title"),
    tabTitle: (doc.title || "").trim(),
    author: get("citation_author", "author", "article:author", "dc.creator", "parsely-author"),
    published: get("citation_publication_date", "citation_date", "article:published_time", "date", "dc.date", "pubdate"),
    site: get("og:site_name", "application-name"),
    doi: get("citation_doi", "dc.identifier"),
    description: get("description", "og:description")
  };
}

export async function fromHtml(html, baseUrl, opts = {}) {
  const parsed = new DOMParser().parseFromString(html, "text/html");
  if (baseUrl) { const b = parsed.createElement("base"); b.href = baseUrl; parsed.head.prepend(b); }
  const meta = metaFrom(parsed);
  let root = parsed.body, title = meta.title, byline = "", reader = null;
  if (!opts.noReadability) {
    try {
      await loadScript(LIBS.readability);
      reader = new window.Readability(parsed.cloneNode(true), { charThreshold: 300, keepClasses: false }).parse();
    } catch { reader = null; }
    if (reader && reader.textContent && reader.textContent.trim().length > 400) {
      root = new DOMParser().parseFromString(reader.content, "text/html").body;
      title = title || reader.title;
      byline = reader.byline || "";
    }
  }
  const blocks = [];
  if (root) walk(root, baseUrl, blocks, { dropChrome: !reader });
  // "Spider silk - Wikipedia" → "Spider silk": drop a trailing site name, or use the page's
  // own heading when the tab title starts with it
  const site = meta.site || reader?.siteName || "";
  const pickTitle = (t) => {
    if (!t) return t;
    const h1 = parsed.querySelector("h1")?.textContent.trim();
    if (h1 && h1.length > 2 && t.startsWith(h1) && /^\s*[-|–—:·]/.test(t.slice(h1.length))) return h1;
    if (site) t = t.replace(new RegExp(`\\s*[-|–—:·]\\s*${site.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`, "i"), "");
    return t;
  };
  title = pickTitle(title);
  if (reader && reader.title) reader.title = pickTitle(reader.title);
  meta.tabTitle = pickTitle(meta.tabTitle);
  return {
    title: (title || reader?.title || meta.tabTitle || "Untitled page").replace(/\s+/g, " "),
    meta: {
      author: meta.author || byline, published: meta.published || reader?.publishedTime || "",
      site: meta.site || reader?.siteName || "", doi: meta.doi, url: baseUrl || ""
    },
    blocks
  };
}

/* ---------- PDF ---------- */
async function fromPdf(buf, name) {
  await loadScript(LIBS.pdf);
  const pdfjs = window.pdfjsLib;
  pdfjs.GlobalWorkerOptions.workerSrc = LIBS.pdfWorker;
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(buf), isEvalSupported: false }).promise;
  const pages = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const tc = await page.getTextContent();
    const lines = [];
    let cur = null;
    for (const it of tc.items) {
      if (!("str" in it)) continue;
      const y = Math.round(it.transform[5]);
      const h = Math.abs(it.transform[3]) || it.height || 10;
      if (!cur || Math.abs(cur.y - y) > h * 0.4) { cur = { y, h, text: "" }; lines.push(cur); }
      const gapX = it.transform[4] - (cur.lastX || 0);
      cur.text += (cur.text && !/\s$/.test(cur.text) && !/^\s/.test(it.str) && gapX > h * 0.15 ? " " : "") + it.str;
      cur.h = Math.max(cur.h, h);
      cur.lastX = it.transform[4] + (it.width || 0);
      if (it.hasEOL) cur = null;
    }
    pages.push(lines.filter((l) => l.text.trim()));
  }
  // drop running headers/footers: lines repeated on most pages
  const freq = new Map();
  const key = (s) => s.trim().replace(/\d+/g, "#");
  for (const lines of pages) for (const k of new Set(lines.map((l) => key(l.text)))) freq.set(k, (freq.get(k) || 0) + 1);
  const repeated = (s) => pages.length > 3 && freq.get(key(s)) > pages.length * 0.5;

  const all = pages.flat().filter((l) => !repeated(l.text));
  const total = all.reduce((n, l) => n + l.text.trim().length, 0);
  if (total < 40) throw new Error("This PDF has no text layer; it is probably a scan. Reading scans needs text recognition, which isn't built yet. If you can copy the text from the PDF, paste it instead.");
  const hs = all.map((l) => l.h).sort((a, b) => a - b);
  const median = hs[Math.floor(hs.length / 2)] || 10;
  const blocks = [];
  let para = "";
  const flush = () => { if (para.trim()) blocks.push(block("p", para.trim())); para = ""; };
  for (const pageLines of pages) {
    let prevY = null;
    for (const l of pageLines) {
      if (repeated(l.text)) continue;
      const t = l.text.replace(/\s+/g, " ").trim();
      const gap = prevY == null ? 0 : Math.abs(prevY - l.y);
      prevY = l.y;
      if (l.h > median * 1.25 && t.length < 120) { flush(); blocks.push(block("h2", t)); continue; }
      if (gap > median * 1.8) flush();
      if (para.endsWith("-") && /^[a-z]/.test(t)) para = para.slice(0, -1) + t;
      else para += (para ? " " : "") + t;
    }
    flush();
  }
  let info = {};
  try { info = (await pdf.getMetadata()).info || {}; } catch {}
  const good = info.Title && !/^(about:blank|untitled|microsoft word|document\d*)/i.test(info.Title.trim()) && !/\.\w{2,4}$/.test(info.Title.trim());
  return { title: good ? info.Title.trim() : name.replace(/\.pdf$/i, ""), meta: { author: info.Author || "", file: name }, blocks };
}

/* ---------- Office and zip-based formats ---------- */
async function fromDocx(buf, name) {
  await loadScript(LIBS.mammoth);
  const res = await window.mammoth.convertToHtml({ arrayBuffer: buf });
  const doc = await fromHtml(res.value, null, { noReadability: true });
  doc.title = doc.blocks.find((b) => /^h/.test(b.kind))?.segs.map((s) => s.text).join("") || name.replace(/\.\w+$/, "");
  doc.meta = { file: name };
  return doc;
}

async function fromSheet(buf, name, isText) {
  await loadScript(LIBS.xlsx);
  const wb = isText ? window.XLSX.read(new TextDecoder().decode(buf), { type: "string" }) : window.XLSX.read(buf, { type: "array" });
  const blocks = [];
  for (const sn of wb.SheetNames) {
    const rows = window.XLSX.utils.sheet_to_json(wb.Sheets[sn], { header: 1, raw: false, blankrows: false });
    if (!rows.length) continue;
    if (wb.SheetNames.length > 1) blocks.push(block("h2", sn));
    for (const r of rows) {
      const cells = r.map((c) => (c == null ? "" : String(c).trim())).filter(Boolean);
      if (cells.length) blocks.push(block("row", cells.join(" │ ")));
    }
  }
  return { title: name.replace(/\.\w+$/, ""), meta: { file: name }, blocks };
}

const xml = (s) => new DOMParser().parseFromString(s, "application/xml");
const byLocal = (doc, local) => [...doc.getElementsByTagName("*")].filter((n) => n.localName === local);

async function fromPptx(buf, name) {
  await loadScript(LIBS.jszip);
  const zip = await window.JSZip.loadAsync(buf);
  const slides = Object.keys(zip.files).filter((f) => /^ppt\/slides\/slide\d+\.xml$/.test(f))
    .sort((a, b) => +a.match(/\d+/)[0] - +b.match(/\d+/)[0]);
  const blocks = [];
  for (const [i, f] of slides.entries()) {
    const d = xml(await zip.file(f).async("string"));
    const paras = byLocal(d, "p").map((p) => byLocal(p, "t").map((t) => t.textContent).join("")).filter((t) => t.trim());
    blocks.push(block("h2", `Slide ${i + 1}${paras[0] ? ": " + paras[0] : ""}`));
    for (const t of paras.slice(1)) blocks.push(block("li", t));
  }
  return { title: name.replace(/\.\w+$/, ""), meta: { file: name }, blocks };
}

async function fromOdt(buf, name) {
  await loadScript(LIBS.jszip);
  const zip = await window.JSZip.loadAsync(buf);
  const d = xml(await zip.file("content.xml").async("string"));
  const blocks = [];
  for (const n of byLocal(d, "body")[0]?.getElementsByTagName("*") || []) {
    if (n.localName === "h") blocks.push(block("h2", n.textContent));
    else if (n.localName === "p" && n.parentNode.localName !== "list-item") { if (n.textContent.trim()) blocks.push(block("p", n.textContent)); }
    else if (n.localName === "list-item") blocks.push(block("li", n.textContent));
  }
  return { title: name.replace(/\.\w+$/, ""), meta: { file: name }, blocks };
}

async function fromEpub(buf, name) {
  await loadScript(LIBS.jszip);
  const zip = await window.JSZip.loadAsync(buf);
  const container = xml(await zip.file("META-INF/container.xml").async("string"));
  const opfPath = byLocal(container, "rootfile")[0].getAttribute("full-path");
  const dir = opfPath.includes("/") ? opfPath.slice(0, opfPath.lastIndexOf("/") + 1) : "";
  const opf = xml(await zip.file(opfPath).async("string"));
  const manifest = new Map(byLocal(opf, "item").map((i) => [i.getAttribute("id"), i.getAttribute("href")]));
  const blocks = [];
  for (const ref of byLocal(opf, "itemref")) {
    const href = manifest.get(ref.getAttribute("idref"));
    const f = href && zip.file(dir + decodeURIComponent(href));
    if (!f) continue;
    const part = await fromHtml(await f.async("string"), null, { noReadability: true });
    blocks.push(...part.blocks);
  }
  const title = byLocal(opf, "title")[0]?.textContent || name.replace(/\.\w+$/, "");
  return { title, meta: { author: byLocal(opf, "creator")[0]?.textContent || "", file: name }, blocks };
}

function fromRtf(text, name) {
  const plain = text
    .replace(/\{\\\*[^{}]*\}/g, "")
    .replace(/\\'([0-9a-f]{2})/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/\\u(-?\d+)\??/g, (_, n) => String.fromCharCode(n < 0 ? 65536 + +n : +n))
    .replace(/\\(par|line)\b ?/g, "\n")
    .replace(/\\[a-z]+-?\d* ?/gi, "")
    .replace(/[{}]/g, "");
  return fromText(plain, name.replace(/\.\w+$/, ""), { file: name });
}

function fromJson(text, name) {
  const blocks = [];
  const visit = (v, key) => {
    if (typeof v === "string") { if (v.trim()) blocks.push(block(v.length > 120 ? "p" : "li", key && v.length <= 120 ? `${key}: ${v}` : v)); }
    else if (Array.isArray(v)) v.forEach((x) => visit(x, key));
    else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) visit(x, k);
  };
  visit(JSON.parse(text), "");
  return { title: name.replace(/\.\w+$/, ""), meta: { file: name }, blocks };
}

/* ---------- entry points ---------- */
export async function loadFile(file) {
  const name = file.name || "file";
  const ext = (name.match(/\.(\w+)$/) || [, ""])[1].toLowerCase();
  const buf = await file.arrayBuffer();
  const text = () => new TextDecoder().decode(buf);
  const doc = await loadBuffer(buf, name, ext, file.type, text);
  doc.meta = { ...doc.meta, file: name, kind: ext || file.type };
  return doc;
}

async function loadBuffer(buf, name, ext, mime, text) {
  if (ext === "pdf" || mime === "application/pdf") return fromPdf(buf, name);
  if (ext === "docx") return fromDocx(buf, name);
  if (["xlsx", "xls", "ods", "xlsm"].includes(ext)) return fromSheet(buf, name, false);
  if (["csv", "tsv"].includes(ext)) return fromSheet(buf, name, true);
  if (ext === "pptx") return fromPptx(buf, name);
  if (ext === "odt" || ext === "odp") return fromOdt(buf, name);
  if (ext === "epub") return fromEpub(buf, name);
  if (ext === "rtf") return fromRtf(text(), name);
  if (ext === "json") return fromJson(text(), name);
  if (["html", "htm", "xhtml"].includes(ext) || /html/.test(mime || "")) return fromHtml(text(), null);
  if (/^image\//.test(mime || "") || ["png", "jpg", "jpeg", "gif", "webp", "heic", "bmp", "tif", "tiff"].includes(ext)) {
    throw new Error("Images need text recognition, which isn't built yet. If the image came from a page or document, open that instead, or paste its text.");
  }
  if (["doc", "ppt", "pages", "key", "numbers"].includes(ext)) {
    throw new Error(`.${ext} files use an older or Apple-only format that browsers can't read. Save it as .docx, .pptx, .xlsx or PDF and open that.`);
  }
  const t = text();
  const bad = (t.match(/\uFFFD/g) || []).length;
  if (bad > t.length * 0.02) throw new Error(`This file type (.${ext || "unknown"}) isn't supported. Try PDF, Word, Excel, PowerPoint, EPUB, HTML or plain text.`);
  return fromText(t, name.replace(/\.\w+$/, ""));
}

// True when the page is not on its own site (for example inside a claude.ai artifact),
// where requests to other servers are blocked.
export const sandboxed = () => !/^(tangdru\.github\.io|localhost|127\.0\.0\.1)$/.test(location.hostname);

export async function loadUrl(input) {
  let url = input.trim();
  if (!/^https?:\/\//i.test(url)) url = "https://" + url;
  try { new URL(url); } catch { throw new Error("That doesn't look like a web address. Check it and try again."); }
  let res;
  try {
    res = await fetch(`${FETCH_FUNCTION}?url=${encodeURIComponent(url)}`, {
      headers: { Authorization: `Bearer ${SUPABASE_ANON_KEY}`, apikey: SUPABASE_ANON_KEY }
    });
  } catch {
    throw new Error(sandboxed()
      ? "This copy of the app runs inside claude.ai, which blocks requests to other websites, so web addresses can't load here. Open https://tangdru.github.io/crawler/ to load them, or paste the page's text below."
      : "Couldn't reach the page fetcher. Check your connection and try again.");
  }
  if (!res.ok) {
    let msg = `The page couldn't be loaded (error ${res.status}).`;
    try { const j = await res.json(); if (j.error) msg = j.error; } catch {}
    throw new Error(msg);
  }
  const ctype = (res.headers.get("x-content-type") || res.headers.get("content-type") || "").toLowerCase();
  const finalUrl = res.headers.get("x-final-url") || url;
  const via = res.headers.get("x-fetched-via") || "direct";
  const buf = await res.arrayBuffer();
  const name = decodeURIComponent(new URL(finalUrl).pathname.split("/").pop() || new URL(finalUrl).hostname);
  let doc;
  if (/pdf/.test(ctype)) doc = await fromPdf(buf, name);
  else if (/html|xml/.test(ctype) || !ctype) doc = await fromHtml(new TextDecoder().decode(buf), finalUrl);
  else if (/markdown|text\/plain/.test(ctype)) doc = fromText(new TextDecoder().decode(buf), "");
  else {
    const ext = (name.match(/\.(\w+)$/) || [, ""])[1].toLowerCase();
    doc = await loadBuffer(buf, name, ext, ctype, () => new TextDecoder().decode(buf));
  }
  if (!doc.blocks.length) throw new Error("The page loaded but had no readable text. It may need a login, or be mostly images or video.");
  doc.meta = { ...doc.meta, url: finalUrl, via, kind: "url" };
  if (!doc.title || doc.title === "Untitled page" || doc.title === "Pasted text") doc.title = new URL(finalUrl).hostname;
  return doc;
}
