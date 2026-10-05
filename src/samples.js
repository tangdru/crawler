// Built-in samples. Both are fictional and say so on screen.

const toDoc = (s, meta) => {
  const blocks = [{ kind: "h1", segs: [{ text: s.title }] }];
  for (const sec of s.sections) {
    if (sec.h) blocks.push({ kind: "h2", segs: [{ text: sec.h }] });
    for (const p of sec.p || []) blocks.push({ kind: "p", segs: [{ text: p }] });
    for (const li of sec.list || []) blocks.push({ kind: "li", ordered: true, segs: [{ text: li }] });
  }
  return { title: s.title, meta, blocks };
};

const SPIDERS = 
{
  title: "Spiders in human culture",
  sections: [
    { h: null, p: [
      "Spiders have appeared in folklore, art and science for at least three thousand years. Weaving goddesses, trickster figures and omens of luck all draw on the same small animal, and the modern fear of spiders is among the most frequently studied phobias. Surveys published since 1990 put the share of adults reporting a strong fear of spiders at between 3 and 6 percent.",
      "Scholarly interest spans entomology, psychology, classics and materials science. Spider silk in particular has attracted research since the 1990s, when work on recombinant silk proteins in plants and bacteria first appeared in journals such as \"Plant Biotechnology Journal\" and \"Biomacromolecules\". Accounts of the fossil record have grown as well: the oldest spider web preserved in amber was described in 2006, and Carboniferous arachnids continue to be reclassified."
    ]},
    { h: "References", list: [
      "Hartwell, M. J. (2002). Weavers and Tricksters: Spiders in World Mythology. Lisbon: Coastline Academic Press. pp. 112–118. ISBN 978-0-19-874512-3.",
      "Okafor, Adaeze (14 March 2007). \"The Spider Woman Cycle in Plains Storytelling\". Journal of Folklore Studies. 41 (2): 66–73. doi:10.3389/jfs.2007.41208. JSTOR 4412071.",
      "Lindqvist, P.; Moreau, É. (1998). \"Fear of spiders in a general population sample\". Behaviour Research Quarterly. 36 (4): 389–96. doi:10.1016/S0005-7967(98)00024-1. PMID 9670601.",
      "Brandt, Ingrid (9 June 2009). \"Spider fears or arachnophobia?\". phobias-research.org. Archived from the original on 25 June 2009. Retrieved 2 August 2009.",
      "Varga, T. & Ellison, R. (2005). Cognitive Science: An Introduction to the Study of Mind. Thousand Oaks: Meridian Academic. pp. 244–246. ISBN 978-1-4129-2568-6.",
      "Delacroix, G. C. L. (1994). \"The disgusting spider: disease, illness and the perpetuation of fear\". Society and Animals. 2 (1): 17–25. doi:10.1163/156853094X00045. PMC 3087214.",
      "Ruiz-Montaño, Carla (2011). \"Silk proteins in transgenic tobacco leaves: accumulation and field production\". Plant Biotechnology Journal. 2 (5): 431–38. Bibcode:2004PBioJ...2..431M. doi:10.1111/j.1467-7652.2004.00087.x. PMID 17168889.",
      "Asante, K.; Lowe, H. (2016). \"How informative are case studies of spider bites in the medical literature?\". Toxicon. 114: 40–44. Bibcode:2016Txcn..114...40S. doi:10.1016/j.toxicon.2016.02.023. PMID 26923161.",
      "Nakashima, S. (2001). \"Misdiagnosis of brown recluse spider bite\". Western Journal of Medicine. 174 (4): 240. doi:10.1136/ewjm.174.4.240. PMC 1071344. PMID 11290673.",
      "Petrov, V. (August 2022). \"The global spread of misinformation on spiders\". Current Biology. 32 (16): R871–R873. Bibcode:2022CBio...32.R871M. doi:10.1016/j.cub.2022.07.026. hdl:10400.3/6470. ISSN 0960-9822.",
      "Whitcombe, Richard S.; Eklund, Geoffrey K. (2008). \"Medical aspects of spider bites\". Annual Review of Entomology. 53 (1): 409–29. doi:10.1146/annurev.ento.53.103106.093503. PMID 17877450.",
      "Haddad, J. H. (1 August 2004). \"The global epidemiology, syndromic classification, management, and prevention of spider bites\". American Journal of Tropical Medicine and Hygiene. 71 (2): 239–50. doi:10.4269/ajtmh.2004.71.2.0700239. PMID 15306718.",
      "Okonkwo, Elizabeth (2013). Aspects of Ekphrastic Technique in Ovid's Metamorphoses. Newcastle: Cambridge Scholars Publishing. p. 166. ISBN 978-1-4438-4271-6.",
      "Fennimore, Eleanor Winsor (January 1974). \"Ekphrasis and the theme of artistic failure in Ovid's Metamorphoses\". Ramus. 3 (2): 102–142. doi:10.1017/S0048671X00004549.",
      "Penney, D. & Selden, P. A. (2007). \"Spinning with the dinosaurs: the fossil record of spiders\". Geology Today. 23 (6): 231–37. Bibcode:2007GeolT..23..231P. doi:10.1111/j.1365-2451.2007.00641.x.",
      "Gwynne, R. (2006). \"Oldest spider web found in amber\". https://news.example.org/science/5144694.stm. Retrieved 15 October 2009.",
      "Dunlop, J. A. (1999). \"A replacement name for the trigonotarbid arachnid from the Upper Silurian of Shropshire\". Palaeontology. 42 (1): 191. Bibcode:1999Palgy..42..191D. doi:10.1111/1475-4983.00068.",
      "Krantz, G. W. & Walter, D. E. (2009). A Manual of Acarology. Lubbock: Texas Tech University Press. p. 98. ISBN 978-0-89672-620-8.",
      "Vollrath, F. & Selden, P. A. (2007). \"The role of behavior in the evolution of spiders, silks, and webs\". Annual Review of Ecology, Evolution, and Systematics. 38 (1): 819–46. Bibcode:2007AREES..38..819V. doi:10.1146/annurev.ecolsys.37.091305.110221.",
      "Selden, P. A.; Shih, ChungKun; Ren, Dong (2011). \"A golden orb-weaver spider from the Middle Jurassic of China\". Biology Letters. 7 (5): 775–78. doi:10.1098/rsbl.2011.0228. PMC 3169061. PMID 21508021.",
      "Mammola, S.; Malumbres-Olarte, J.; Arabesky, V. (2022). \"The global spread of misinformation on spiders\". Current Biology. 32 (16): R871–R873. doi:10.1016/j.cub.2022.07.026. PMID 35998593.",
      "Lozano-Fernandez, Jesús; Tanner, Alastair R. (2019). \"Increasing species sampling in chelicerate genomic-scale datasets\". Frontiers in Genetics. 11: 182. doi:10.3389/fgene.2020.00182. PMID 32218802."
    ]}
  ]
};

const RIVER = {
  title: "The river that split a city",
  sections: [
    { h: null, p: [
      "WEXLEY, 12 March 2026. For most of the last century the Wexley River ran through a concrete channel, hidden behind warehouses and a six-lane road. On Tuesday the city council voted 7 to 4 to tear the channel out, a $214 million plan that supporters call the most hopeful project the city has attempted in a generation.",
      "\"This is the best decision this council has made in decades,\" said Mayor Lina Okoro after the vote. \"We are giving the river back to the people who live beside it, and we are protecting thousands of homes from flooding at the same time.\""
    ]},
    { h: "A river under concrete", p: [
      "Engineers first buried the river in 1958, after a flood destroyed more than 300 homes and killed eleven people. The channel worked, for a while. But the concrete has cracked, and a 2024 survey found that the walls could fail during a severe storm. Officials say repairs alone would cost roughly $90 million and might only last twenty years.",
      "Ecologists have long argued that the channel killed the river as well. Fish counts fell by 80% between 1960 and 1990, and the water is still among the most polluted in the region. \"There is almost nothing living in that stretch,\" said Dr. Tomas Reyes, a freshwater biologist at Wexley University. \"Restoration clearly works. We have seen salmon return within five years in rivers like this one.\""
    ]},
    { h: "The cost and the doubts", p: [
      "Not everyone shares the excitement. The four councillors who voted against the plan warned that the budget could grow, and that the city already carries a $1.2 billion debt. \"Every large project in this city has gone over budget,\" said Councillor Mark Haines. \"I am afraid we are promising residents something we cannot pay for, and they will be angry when the bill arrives.\"",
      "An independent review in January found that the estimate was reasonable but uncertain, and suggested that costs may rise by 15 to 25 percent if construction is delayed. The review also noted that federal grants, which the plan assumes will cover a third of the cost, have not been confirmed.",
      "Business owners along River Road are worried too. The project will close two lanes of traffic for at least three years. \"We barely survived the last road works,\" said Priya Natarajan, who runs a bakery on the corner of River Road and Fifth Street. \"Another three years of construction could finish us.\""
    ]},
    { h: "Flooding and the climate", p: [
      "Supporters argue that the real risk is doing nothing. Climate projections suggest that heavy storms in the region will likely become more frequent, and the city's own flood maps show that more than 4,000 homes sit in areas that could flood in a major storm. A restored river with wide, planted banks can hold far more water than the old channel, according to the engineering report.",
      "\"A natural river is simply better flood protection,\" Reyes said. \"It is proven in city after city.\" Other experts were more careful. A hydrologist who reviewed the plan for the council said the design appears sound, but that the benefits depend heavily on how the upstream wetlands are managed."
    ]},
    { h: "What comes next", p: [
      "Construction is expected to begin in spring 2027 and to finish by 2031. The council will hold public meetings in each affected neighbourhood this summer, and residents can comment on the design until 30 June.",
      "For many people the vote was emotional. Grace Mensah, 74, remembers the 1958 flood and the years of grief that followed. \"I lost my uncle that night,\" she said, standing at the edge of the channel after the vote. \"I never thought I would see this river again. Today I am happy, and a little afraid, but mostly happy.\""
    ]}
  ]
};


const INTERVIEWS = {
  title: "Resident interviews, River Road",
  sections: [
    { h: null, p: [
      "Field notes from six short interviews conducted on River Road between 18 and 22 March 2026. Names are changed. Interviewer questions are in brackets."
    ]},
    { h: "Interview 1: café owner, 41", p: [
      "[How do you feel about the vote?] Honestly, nervous. I want the river back, everyone does, but three years of half a road is a long time for a small business.",
      "The last road works took eighteen months and we lost about a third of our lunch trade. Nobody from the city came to talk to us then, and nobody has come now.",
      "If they gave us a clear timeline and some help with signage, I think most of us would get behind it."
    ]},
    { h: "Interview 2: retired teacher, 70", p: [
      "[What do you remember about the river?] I remember swimming in it before they poured the concrete. My grandchildren have never seen it as anything but a ditch.",
      "I think it's the right thing to do. I worry about the cost, of course, but I worry more about the next big storm.",
      "The flood maps scared me. My street is on them."
    ]},
    { h: "Interview 3: parent of two, 35", p: [
      "[Would you use the restored river?] Every weekend. There's no green space in this part of town at all.",
      "My kids play in a car park. A park along the water would change this neighbourhood.",
      "I'm not sure I trust the timeline, though. Things here always take twice as long as they say."
    ]},
    { h: "Interview 4: hardware store owner, 58", p: [
      "[Did you support the plan?] No. I think it's a vanity project. The council can't fix potholes, and now they want to rebuild a river?",
      "The money would be better spent on repairing the channel and lowering business rates.",
      "If construction runs late, half the shops on this street will be gone."
    ]},
    { h: "Interview 5: nurse, 29", p: [
      "[What would make the project work for you?] Honest updates. Put the schedule and the budget online and update them every month.",
      "People will put up with a lot if they feel they're being told the truth."
    ]},
    { h: "Interview 6: retired engineer, 66", p: [
      "[Do you think the flood design will work?] The principle is sound. Wide banks hold water. But everything depends on the wetlands upstream, and the plan is vague about who manages them.",
      "I'd want to see the maintenance budget for the next thirty years, not just the construction cost."
    ]}
  ]
};

const MEMO = {
  title: "Council finance briefing: river restoration",
  sections: [
    { h: null, p: [
      "Briefing note prepared for the finance committee, 2 April 2026. Draft for discussion; figures are estimates."
    ]},
    { h: "Costs", p: [
      "The approved budget is $214 million, including a contingency of $18 million. The independent review rated the estimate as reasonable, but noted that projects of this kind have historically exceeded their budgets by 15 to 25 percent.",
      "Annual maintenance of the restored banks and upstream wetlands is estimated at $1.4 million. This figure is not yet included in the long-term operating budget."
    ]},
    { h: "Funding", p: [
      "The plan assumes $71 million in federal resilience grants. Officials expect a decision by October 2026, but approval is not guaranteed.",
      "If the grants are refused, the city would need to borrow the shortfall or phase the project over a longer period."
    ]},
    { h: "Support for local businesses", p: [
      "Staff recommend a $2 million fund to support businesses on River Road during construction, including signage, marketing and short-term rent relief.",
      "Evidence from similar projects suggests that clear communication about timelines matters as much as direct financial help."
    ]},
    { h: "Risks", p: [
      "The main financial risks are construction delays, rising material costs and the federal grant decision.",
      "Doing nothing is not free: emergency repairs to the existing channel would cost roughly $90 million and would not reduce flood risk for the 4,000 homes on the city's flood maps."
    ]}
  ]
};

export const SAMPLES = {
  references: () => toDoc(SPIDERS, { sample: true, note: "Sample reference list. The citations are illustrative, not real sources." }),
  article: () => toDoc(RIVER, { sample: true, note: "Sample news article. The city, people and figures are fictional." }),
  interviews: () => toDoc(INTERVIEWS, { sample: true, note: "Sample interview notes. The people and quotes are fictional." }),
  memo: () => toDoc(MEMO, { sample: true, note: "Sample council briefing. The figures are fictional." })
};

// Sample projects: each is a list of sources.
export const SAMPLE_PROJECTS = {
  river: { name: "River restoration (3 sources)", sources: ["article", "interviews", "memo"] },
  references: { name: "Spider reference list", sources: ["references"] }
};
