# Backlog

## Add linked pages (one level deep)

When a source has links, let people pick linked pages to add as their own sources. Each
picked page goes through the page fetcher and becomes a normal source, so cross-source
lenses (Insights, UXR, keyword and mood comparisons) cover them. Their own links are not
followed, so nothing crawls endlessly.

- Entry points: a "Links to N pages · Add linked pages…" line in the document header, and
  an "Also choose linked pages" checkbox on the web-address form.
- Picker: links from the article body only (nav and footer are already stripped). Drop
  same-page anchors, images and media, and wiki housekeeping pages (Special:, File:,
  Talk:…). Group same site vs other sites, add a search filter, and show link text and
  short URL. Mark pages already in the project.
- Up to 10 pages per batch (the fetcher allows 30 a minute), fetched 3 at a time with
  "Fetching 2 of 5…" progress. List the ones that failed and why.
- Each added page records which source it came from.
