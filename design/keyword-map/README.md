# Keyword map (UMAP) design exploration

Not part of the app yet. Saved so the chosen configuration survives until it is built into Trends.

- `config.json`: the chosen configuration ("Your pick") plus the richer-profile candidate.
- `lab.html`: the playground, self-contained (open it in a browser). Presets: Your pick, Your pick · rich, Today, Clouds, Bubbles, Glow + bubbles, Territories.
- `embed.mjs`: recomputes the lab's data from the river sample project. Needs `npm i umap-js@1.4.0` in this folder; run `node embed.mjs > data.json`.

## How the map is built

1. Top 20 Trends keywords; sentences are the unit.
2. Profile per keyword: PPMI (log of "how much more often than chance") against
   - `kw`: the other 19 keywords in the same sentence,
   - `rich`: the 200 most common content words in the same sentence,
   - `rich1`: the same 200 words within one sentence either side, inside the same paragraph.
3. Distance between keywords: cosine distance between profiles.
4. UMAP to 2D (5 neighbours, seeded). Tight / medium / loose = minDist 0.02 / 0.25 / 0.8 (loose uses 8 neighbours).
5. Group names: off. A name is shown only when it is a theme the words imply (e.g. "Flood risk"), never the group's own top words, and drawn in the group's color; in the app Claude would suggest them.
6. Groups: `net` = Louvain on PPMI for pairs seen in 2+ sentences; `profile` = Louvain on each word's 4 nearest profiles.
7. "Grouped" spread: tight layout, each word pulled 65% toward its group centre, then nudged apart. Group positions stay UMAP's; spacing inside a group does not carry meaning.
