// Plain-language explainers for the five lenses. One source for the "What do the lenses
// do?" guide, the lens button tooltips and the summary section intros. Listed in reading
// order: meaning (Insights, UXR), then manner (Tone), then material (Trends, References).

export const LENSES = [
  {
    id: "insights", name: "Insights", accent: "#46f08a", claude: true,
    question: "What does it say, and how much should I trust it?",
    finds: ["The gist and the key points", "The main claims, sorted into fact, opinion or prediction, and rated by how the text backs them: backed, hedged or asserted", "Who says what, and how much space each voice gets", "Where sources agree or disagree", "What's missing or one-sided", "Ask your sources: questions answered only from your text"],
    how: "Claude reads every source",
    cost: "About 10–30¢ a run; questions about 2–5¢",
    scope: "The whole project at once",
    best: "News, reports, policies, essays: anything you need to understand and judge",
    limit: "Rates how a claim is supported in the text, not whether it's true."
  },
  {
    id: "uxr", name: "UXR", accent: "#b58cff", claude: true,
    question: "What do the people in these sources need?",
    finds: ["Themes with supporting quotes, and tensions where people disagree", "Pain points by severity", "Groups of people (proto-personas) and their needs", "Jobs to be done", "Opportunities (\"How might we…\") and open questions"],
    how: "Claude reads every source",
    cost: "About 10–30¢ a run",
    scope: "The whole project at once",
    best: "Interviews, survey answers, reviews, support tickets, research notes",
    limit: "Only as good as the voices in your sources; it can't hear who's absent."
  },
  {
    id: "tone", name: "Tone", accent: "#ff3fd8",
    question: "How does it sound?",
    finds: ["Positive and negative wording, paragraph by paragraph", "Six emotions: trust, fear, anger, joy, sadness, surprise", "Hedging (may, perhaps) versus certainty (clearly, always)", "Confident claims with no citation nearby"],
    how: "Matches word lists in your browser",
    cost: "Free, instant",
    scope: "One source at a time",
    best: "Spotting spin, alarm or overconfidence",
    limit: "It misses sarcasm and context; \"not bad\" is handled, irony isn't."
  },
  {
    id: "trends", name: "Trends", accent: "#33e1ff",
    question: "What is this about, and how does that shift?",
    finds: ["Keywords that set this text apart", "Words that rise or fade from start to end", "Topics: groups of paragraphs about the same thing", "Words that tend to appear together"],
    how: "Counts words in your browser",
    cost: "Free, instant",
    scope: "One source at a time",
    best: "Getting the shape of a long text before you read it",
    limit: "It counts words; it doesn't understand what they mean."
  },
  {
    id: "references", name: "References", accent: "#ffd84d",
    question: "What does it cite, and who is quoted?",
    finds: ["DOIs, ISBNs, PubMed, arXiv and other IDs", "Links, citations and reference lists", "Quotes and who said them", "Dates, figures and page ranges"],
    how: "Pattern matching in your browser; also runs quietly under every other lens",
    cost: "Free, instant",
    scope: "One source at a time",
    best: "Papers, Wikipedia, reference lists, fact-checking",
    limit: "Finds references by their format; it doesn't check they're real."
  }
];
export const LENS = Object.fromEntries(LENSES.map((l) => [l.id, l]));
