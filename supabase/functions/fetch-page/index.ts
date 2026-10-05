// fetch-page: downloads a web page for the Reference Crawler app and hands it back
// unchanged. Pages that only appear after JavaScript runs are retried through Jina
// Reader, which renders them in a headless browser.
//
// Guards: answers only the app's own origins, refuses private/internal addresses
// (re-checked on every redirect), caps size and time, and rate-limits per client.

const ALLOWED_ORIGINS = [
  /^https:\/\/tangdru\.github\.io$/,
  /^http:\/\/localhost(:\d+)?$/,
  /^http:\/\/127\.0\.0\.1(:\d+)?$/,
];
const MAX_BYTES = 15 * 1024 * 1024;
const TIMEOUT_MS = 20_000;
const RATE_PER_MIN = 30;
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36 ReferenceCrawler/1.0";

const hits = new Map<string, number[]>();

function cors(origin: string | null): Record<string, string> {
  const ok = origin && ALLOWED_ORIGINS.some((re) => re.test(origin));
  return {
    "Access-Control-Allow-Origin": ok ? origin! : "null",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Expose-Headers": "x-final-url, x-fetched-via, x-content-type",
    "Vary": "Origin",
  };
}

function fail(status: number, error: string, headers: Record<string, string>) {
  return new Response(JSON.stringify({ error }), { status, headers: { ...headers, "Content-Type": "application/json" } });
}

function privateV4(ip: string) {
  const p = ip.split(".").map(Number);
  if (p.length !== 4 || p.some((n) => isNaN(n))) return false;
  const [a, b] = p;
  return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
}
function privateV6(ip: string) {
  const s = ip.toLowerCase().replace(/^\[|\]$/g, "");
  if (s === "::" || s === "::1") return true;
  if (/^f[cd]/.test(s) || /^fe[89ab]/.test(s)) return true;
  const m = s.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  return m ? privateV4(m[1]) : false;
}

async function checkUrl(raw: string): Promise<URL> {
  let u: URL;
  try { u = new URL(raw); } catch { throw new Error("That isn't a valid web address."); }
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error("Only http and https addresses can be loaded.");
  if (u.username || u.password) throw new Error("Addresses with a login in them aren't allowed.");
  const host = u.hostname.toLowerCase().replace(/\.$/, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal") || !host.includes(".") && !host.includes(":")) {
    throw new Error("Internal network addresses can't be loaded.");
  }
  if (privateV4(host) || (host.includes(":") && privateV6(host))) throw new Error("Internal network addresses can't be loaded.");
  if (u.port && !["80", "443", "8080", "8443"].includes(u.port)) throw new Error("That port isn't allowed.");
  // resolve the name too, so a public name pointing at a private address is refused
  try {
    const recs = [
      ...(await Deno.resolveDns(host, "A").catch(() => [] as string[])),
      ...(await Deno.resolveDns(host, "AAAA").catch(() => [] as string[])),
    ];
    if (recs.some((ip) => privateV4(ip) || privateV6(ip))) throw new Error("Internal network addresses can't be loaded.");
  } catch (e) {
    if (e instanceof Error && e.message.startsWith("Internal")) throw e;
  }
  return u;
}

async function readCapped(res: Response): Promise<Uint8Array> {
  const len = Number(res.headers.get("content-length") || 0);
  if (len > MAX_BYTES) throw new Error("That file is too large to load (over 15 MB).");
  const reader = res.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > MAX_BYTES) { await reader.cancel(); throw new Error("That file is too large to load (over 15 MB)."); }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) { out.set(c, off); off += c.length; }
  return out;
}

async function fetchDirect(start: URL, signal: AbortSignal) {
  let url = start;
  for (let hop = 0; hop < 6; hop++) {
    const res = await fetch(url, {
      redirect: "manual", signal,
      headers: { "User-Agent": UA, "Accept": "text/html,application/xhtml+xml,application/pdf;q=0.9,text/plain;q=0.8,*/*;q=0.5", "Accept-Language": "en-US,en;q=0.8" },
    });
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      await res.body?.cancel();
      url = await checkUrl(new URL(res.headers.get("location")!, url).href);
      continue;
    }
    return { res, url };
  }
  throw new Error("The page redirected too many times.");
}

// Rough check for pages whose content only appears after JavaScript runs.
function looksEmpty(html: string) {
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z#0-9]+;/gi, " ")
    .replace(/\s+/g, " ").trim();
  return text.length < 600 || /enable javascript|javascript is (disabled|required)|just a moment\.\.\.|checking your browser/i.test(text.slice(0, 2000));
}

async function fetchJina(url: string, signal: AbortSignal) {
  const res = await fetch(`https://r.jina.ai/${url}`, {
    signal,
    headers: { "X-Return-Format": "html", "Accept": "text/html", "X-Timeout": "15" },
  });
  if (!res.ok) throw new Error(`renderer ${res.status}`);
  return await readCapped(res);
}

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");
  const headers = cors(origin);
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers });
  if (req.method !== "GET") return fail(405, "Only GET is supported.", headers);
  if (!origin || !ALLOWED_ORIGINS.some((re) => re.test(origin))) return fail(403, "This fetcher only serves the Reference Crawler app.", headers);

  const ip = (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || "unknown";
  const now = Date.now();
  const recent = (hits.get(ip) || []).filter((t) => now - t < 60_000);
  if (recent.length >= RATE_PER_MIN) return fail(429, "Too many pages in a minute. Wait a moment and try again.", headers);
  recent.push(now);
  hits.set(ip, recent);

  const target = new URL(req.url).searchParams.get("url") || "";
  let url: URL;
  try { url = await checkUrl(target); } catch (e) { return fail(400, (e as Error).message, headers); }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    let body: Uint8Array | null = null;
    let ctype = "";
    let finalUrl = url.href;
    let status = 0;
    try {
      const { res, url: last } = await fetchDirect(url, ctrl.signal);
      status = res.status;
      finalUrl = last.href;
      ctype = (res.headers.get("content-type") || "").toLowerCase();
      body = await readCapped(res);
    } catch (e) {
      const msg = (e as Error).message || "";
      if (/too large|valid web address|Internal|port|login|redirected/.test(msg)) return fail(400, msg, headers);
      body = null; // network trouble: let the renderer try
    }

    const isHtml = /html|xml/.test(ctype) || (!ctype && body !== null);
    const html = body && isHtml ? new TextDecoder().decode(body) : "";
    const needsRender = body === null || status >= 400 || (isHtml && looksEmpty(html));

    if (!needsRender) {
      return new Response(body, { status: 200, headers: { ...headers, "Content-Type": "application/octet-stream", "x-content-type": ctype || "text/html", "x-final-url": finalUrl, "x-fetched-via": "direct" } });
    }
    try {
      const rendered = await fetchJina(finalUrl, ctrl.signal);
      return new Response(rendered, { status: 200, headers: { ...headers, "Content-Type": "application/octet-stream", "x-content-type": "text/html", "x-final-url": finalUrl, "x-fetched-via": "jina" } });
    } catch {
      if (body && status < 400) {
        return new Response(body, { status: 200, headers: { ...headers, "Content-Type": "application/octet-stream", "x-content-type": ctype || "text/html", "x-final-url": finalUrl, "x-fetched-via": "direct" } });
      }
      const why = status === 401 || status === 403 ? "The site refused to share this page (it may need a login or block automated readers)."
        : status === 404 ? "The page wasn't found (404). Check the address."
        : status >= 400 ? `The site answered with an error (${status}).`
        : "The page couldn't be reached. Check the address, or try again in a moment.";
      return fail(502, why + " If you can see it in your browser, copy its text and paste it instead.", headers);
    }
  } catch (e) {
    const aborted = (e as Error).name === "AbortError";
    return fail(504, aborted ? "The page took too long to load." : "The page couldn't be loaded.", headers);
  } finally {
    clearTimeout(timer);
  }
});
