# Reference Crawler

A spider-like crawler reads a document in front of you and shows what it finds.

**Live app:** https://tangdru.github.io/crawler/

## What it does

- **Projects with many sources:** add web addresses, files (PDF, Word, Excel, PowerPoint,
  EPUB, OpenDocument, HTML, Markdown, text, CSV, JSON, RTF) or pasted text. The project is
  saved in your browser.
- **Three lenses**, each with its own crawl effects:
  - **References**: DOIs, ISBNs, PubMed/arXiv/JSTOR IDs, Bibcodes, links, citations, quotes
    (with speakers), authors, dates, figures and page ranges. This pass also runs quietly
    under the other two lenses.
  - **Trends**: TF-IDF keywords, terms rising or fading through the text, topics
    (k-means over paragraphs) and keyword co-occurrence.
  - **Tone**: positive/negative wording, six emotions, hedging vs. certainty, and confident
    claims with no citation nearby. Word lists written for this project; it counts words
    and does not understand sarcasm.
- **Themes** (Claude): thematic analysis across every source, the way a UX researcher builds
  an affinity map. Each theme is a plain-language finding backed by verbatim quotes; sources
  that disagree become "tensions" with quotes on both sides. The page checks every quote
  against the source text and drops any it can't find word for word.
- **Summary view** that grows with each lens you run, plus combined panels once both
  Trends and Tone have run. Every chart links back to the passage.
- **CSV export**: `entities.csv`, `sentences.csv`, `terms.csv`, `themes.csv` (one row per
  theme and quote), or all of them as a zip. Every file has source columns.
  Columns from lenses you haven't run stay empty, so the layout never changes.

Everything runs in the browser except two things: web addresses go through the page
fetcher, and the Themes lens sends the project's sentences to Claude.

## How themes are found

`supabase/functions/synthesize` sends the numbered sentences of every source to Claude
(`claude-opus-5-5`, adaptive thinking, structured JSON output) and streams the answer back.
The API key lives only in the Supabase secret `ANTHROPIC_API_KEY`. Cost is shown before each
run; a three-source sample costs a few cents. The function answers only this app's origins,
caps input at 600k characters and allows 15 runs per hour per client. Set a monthly spend
limit on the Anthropic account as a backstop.

## How web addresses load

Browsers can't read other sites directly, so `supabase/functions/fetch-page` (a Supabase
Edge Function) downloads the page and hands it back. When a page is built by JavaScript
(nearly empty when downloaded), the function retries through
[Jina Reader](https://jina.ai/reader/), which renders it in a headless browser. Jina is a
third-party service: those pages pass through it, and it's rate-limited (about 20 pages a
minute without a key).

The function answers only this app's origins, refuses internal network addresses, caps
size (15 MB) and time (20 s), and rate-limits each client. To use a custom domain, add it
to `ALLOWED_ORIGINS` in the function and redeploy.

## Layout

```
index.html, styles.css   page shell
src/app.js               wiring: sources, lenses, views, export
src/loaders.js           every input format, and URL loading
src/model.js             tokens, sentences, sections, entities
src/references.js        reference grammar
src/trends.js            keywords, term trends, topics, co-occurrence
src/tone.js              sentiment, emotions, hedging, combined view
src/themes.js            Themes lens: request, stream, quote verification
src/project.js           saving the project in the browser
src/crawler.js           the crawler animation
src/summary.js           summary charts
src/export.js            CSV and zip export
supabase/functions/      the page fetcher
```

No build step. GitHub Actions publishes the site on every push to `master`.
