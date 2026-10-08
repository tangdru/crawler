# Reference Crawler

A spider-like crawler reads a document in front of you and shows what it finds.

**Live app:** https://tangdru.github.io/crawler/

## What it does

- **Projects with many sources:** add web addresses, files (PDF, Word, Excel, PowerPoint,
  EPUB, OpenDocument, HTML, Markdown, text, CSV, JSON, RTF) or pasted text. The project is
  saved in your browser.
- **Five lenses**, in this order, each with its own crawl effects:
  - **Trends**: TF-IDF keywords, terms rising or fading through the text, topics
    (k-means over paragraphs) and keyword co-occurrence.
  - **Tone**: positive/negative wording, six emotions, hedging vs. certainty, and confident
    claims with no citation nearby. Word lists written for this project; it counts words
    and does not understand sarcasm.
  - **Insights** (Claude): a plain-language read for anyone. The gist and key points, the
    main claims sorted into fact, opinion or prediction and rated by how the text backs them
    (backed, hedged or asserted), who says what, where sources agree or disagree, and what's
    missing or one-sided. **Ask your sources** (in the summary) answers a question using
    only your sources, with quotes.
  - **UXR** (Claude): UX research synthesis. Themes (affinity mapping) with tensions,
    pain points by severity, groups of people (proto-personas) and their needs, jobs to be
    done, opportunities and open questions.
  - **References**: DOIs, ISBNs, PubMed/arXiv/JSTOR IDs, Bibcodes, links, citations, quotes
    (with speakers), authors, dates, figures and page ranges. This pass also runs quietly
    under every other lens.
- **Checked quotes**: every finding from Claude cites sentences with verbatim quotes. The
  page checks each quote against the source text and drops any it can't find word for word.
  Click a quote to read it in context.
- **Every source in turn**: Trends, Tone and References crawl S1, S2, S3… one after
  another, then open the Summary. "Finish now" completes all of them at once.
- **Summary view** that grows with each lens you run. A scope picker shows all sources
  together, one source, or any combination; the charts re-read the chosen sources as one
  text. Every chart links back to the passage, in the right source.
- **CSV export**: `entities.csv`, `sentences.csv`, `terms.csv`, `insights.csv` and
  `uxr.csv` (one row per finding and quote), or all of them as a zip. Every file has source
  columns. Columns from lenses you haven't run stay empty, so the layout never changes.

Everything runs in the browser except two things: web addresses go through the page
fetcher, and the Insights and UXR lenses (and Ask) send the project's sentences to Claude.

## How Claude is called

`supabase/functions/synthesize` sends the numbered sentences of every source to Claude
(`claude-opus-5-5`, adaptive thinking, structured JSON output) and streams the answer back.
It has three modes: `insights`, `uxr` and `ask`. The sources are sent as a cached prompt
block, so follow-up questions within a few minutes cost less. The API key lives only in the
Supabase secret `ANTHROPIC_API_KEY`. Cost is shown before each run; a three-source sample
costs a few cents. The function answers only this app's origins, caps input at 600k
characters and allows 15 runs and 40 questions per hour per client. Set a monthly spend
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
src/ai.js                Insights, UXR and Ask: request, stream, quote verification
src/project.js           saving the project in the browser
src/crawler.js           the crawler animation
src/summary.js           summary charts
src/export.js            CSV and zip export
supabase/functions/      the page fetcher
```

No build step. GitHub Actions publishes the site on every push to `master`.
