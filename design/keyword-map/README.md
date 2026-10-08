# Keyword map (UMAP) design exploration

Not part of the app yet. Saved so the chosen configuration survives until it is built into Trends.

- `config.json`: the chosen configuration ("Your pick") plus the richer-profile candidate.
- `lab.html`: the playground, self-contained (open it in a browser). Presets: Your pick, Your pick · rich, Today, Clouds, Bubbles, Glow + bubbles, Territories.
- `embed.mjs`: recomputes the lab's text-based data from the river sample project. Needs `npm i umap-js@1.4.0` in this folder; run `node embed.mjs > text.json`.
- `meaning.mjs`: adds meaning-based distance (`WORDNET=<wordnet-db>/dict node meaning.mjs text.json > data.json`). Embeds each keyword in the sense it has in the text, and also on its own, with all-MiniLM-L6-v2 through `@huggingface/transformers` 3.5.1, loading the model from `./models/minilm/` (onnx/model.onnx, tokenizer.json, a BERT config.json and tokenizer_config.json); remote model downloads are off. The meaning layout is aligned to the text layout (Procrustes) in the lab so the Distance toggle only moves what differs.

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

## Text versus meaning

- In this text: cosine distance between text profiles (above).
- In meaning: cosine distance between MiniLM embeddings of "word: definition", where the definition is the WordNet 3.1 sense the word has in the text (`senses.json`). General English; knows nothing about the sources beyond which sense is meant. A "bare word" version (the keyword alone, so its most common sense) is kept for comparison.
- Senses (`senses.json`) were chosen by Claude after reading every sentence each keyword appears in; in the app this would be one Claude call. `wsd.mjs` also holds an automatic picker (part of speech from the previous word, then definitions scored against the keyword's surrounding words and sentences). With MiniLM it chose wrongly too often (e.g. construction as "drawing a figure… proving a theorem"), so it is not used. Its fallback, the dictionary's first sense of the right part of speech, was right for 16 of 20 keywords.
- WordNet data: npm package `wordnet-db` 3.1.14 (dictionary files only).
- The lab ranks all 190 pairs by each distance and lists the biggest gaps: "linked by this text" (close in text, far in meaning) and "kept apart by this text" (close in meaning, far in text). The gaps are the finding: how this text frames the topic.
