/**
 * English → Polish phonetic pronunciation maps, vendored verbatim from motyl's
 * `lib/tts/pronunciation.ts`, together with the matcher that applies them
 * (motyl keeps it in `lib/tts/speech.ts`) and the language tally that gates
 * them (motyl's `lib/tts/voice-map.ts`).
 *
 * The maps are a hand-tuned workaround for edge-tts mispronouncing English tech
 * terms *inside Polish prose*. They are applied on the Polish branch only —
 * see {@link voteLanguage} and {@link nextLanguageState} — because an English
 * answer needs none of it: roughly 38 of the keys below are ordinary English
 * words, so applying the map to English prose is not a no-op, it is damage.
 *
 * HOW TO EDIT: add `englishStem: "polishPhonetic"` entries below. Matching is
 * case-insensitive and stem-based: the key is matched at a word start and any
 * trailing Polish inflection is preserved. E.g. `benchmark: "benczmark"` turns
 * "benchmarki" into "benczmarki". Values should be lowercase Polish phonetic
 * spelling.
 */
export const PRONUNCIATION_MAP: Readonly<Record<string, string>> = Object.freeze({
  tldr: "..",
  summary: ",,",
  benchmark: "benczmark",
  react: "reakt",
  microsoft: "mikrosoft",

  // Leading "c": a Polish voice reads it as "ts", so English c-words are the
  // most mangled. Note: matching is longest-key-first, so `codex` and
  // `cloudflare` win over `code` / `cloud`, and phrase keys win over their words.
  claude: "klod",
  cursor: "kersor",
  cache: "kesz",
  cloud: "klałd",
  cloudflare: "klałdfler",
  commit: "komit",
  codex: "kodeks",
  code: "koud",
  copilot: "kopajlot",
  checkout: "czekałt",
  checkpoint: "czekpojnt",
  compliance: "komplajens",
  chrome: "krołm",
  // Polish reads "ch" as /x/, so an unmapped "chunk" comes out as "hunk"
  chunk: "czank",

  // Product / library names
  ai: "ej aj",
  aws: "ej dablju es",
  spacexai: "spejs eks ej aj",
  openai: "oupen ej aj",
  gpt: "dżi pi ti",
  chatgpt: "czat dżi pi ti",
  mac: "mak",
  macu: "maku",
  macbook: "makbuk",
  macos: "makos",
  ios: "aj os",
  android: "endroid",
  windows: "łindous",
  linux: "linuks",
  github: "git chab",
  gemini: "dżemini",
  vercel: "wersel",
  deepseek: "dipsik",
  tailwind: "tejlłind",
  typescript: "tajpskrypt",
  usememo: "juz memo",
  usecallback: "juz kolbek",
  useeffect: "juz efekt",
  usestate: "juz stejt",
  useref: "juz ref",
  compiler: "kompajler",
  nvidia: "en widia",
  "node.js": "noud dżej es",
  npm: "en-pi-em",
  nodejs: "noud dżej es",
  turbopack: "turbo pak",
  turbopacku: "turbo paku",
  tubopacka: "turbo pak",
  turbopackiem: "turbo pakiem",
  trace: "trejs",
  traców: "trejsuf",
  tracem: "trejsem",
  tracami: "trejsemi",
  tracu: "trejsu",
  tracach: "trejsach",

  // Jargon
  githuba: "git chaba",
  framework: "frejmłerk",
  workflow: "łerkflou",
  runtime: "rantajm",
  feature: "ficzer",
  review: "rywju",
  build: "bild",
  bundler: "bandler",
  bundle: "bandel",
  pipeline: "pajplajn",
  deploy: "diploj",
  release: "rilis",
  update: "apdejt",
  dashboard: "daszbord",
  endpoint: "endpojnt",
  merge: "merdż",
  hook: "huk",
  source: "sors",
  gateway: "gejtłej",
  provider: "prowajder",
  layout: "lejałt",
  payload: "pejloud",
  storage: "storidż",
  design: "dizajn",
  sandbox: "sendboks",
  exploit: "eksplojt",
  edge: "edż",
  bug: "bag",
  reasoning: "rizoning",
  vram: "fał ram",
  "type-aware": "tajp ełer",
  "js/ts": "dżej es / ti es",
  "key takeaways": "kluczowe wnioski:",
  "pipeline'y": "pajplajny",
  worker: "łerker",

  // Multi-word phrases (safe: longest-key-first beats the component words;
  // the phrase also avoids the `face`→"facet" collision of a bare `face` stem)
  "pull request": "pul rikłest",
  "open source": "oupen sors",
  "hugging face": "haging fejs",
});

/**
 * Whole-word acronym pronunciations. Unlike {@link PRONUNCIATION_MAP} (which is
 * stem-based and re-appends any trailing Polish inflection), these match ONLY as
 * a standalone word (optionally with a trailing plural "s"). That is required
 * for short acronyms that are a PREFIX of real words — e.g. `cli` starts
 * "client"/"click", `api` could start "apiary" — where the stem map would
 * corrupt those words.
 *
 * Values are lowercase Polish phonetic spellings. Letter-by-letter acronyms use
 * hyphens so the voice paces them like an acronym instead of blurring into one
 * word; word-style acronyms (e.g. JSON → "jay-son") are spelled as one token.
 */
export const ACRONYM_MAP: Readonly<Record<string, string>> = Object.freeze({
  cli: "si-el-aj",
  api: "ej-pi-aj",
  sdk: "es-di-kej",
  gpu: "dżi-pi-ju",
  cpu: "si-pi-ju",
  ui: "ju-łaj,",
  json: "dżej-son",
  ndjson: "en-di-dżej-es-on",

  // More known acronyms (English letter names, Polish phonetic, hyphen-paced)
  ux: "ju-eks",
  url: "ju-ar-el",
  html: "ejcz-ti-em-el",
  css: "si-es-es",
  xml: "eks-em-el",
  sql: "es-kju-el",
  llm: "el-el-em",
  jwt: "dżej-dabl-ju-ti",
  npm: "en-pi-em",
  ide: "aj-di-i",
  ssh: "es-es-ejcz",
  dns: "di-en-es",
  tts: "ti-ti-es",
  pr: "pi-ar",
  mr: "em-ar",
  qa: "kju-ej",
  "ci/cd": "si-aj-si-di",
});

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Rewrites mapped terms to their Polish phonetic spelling. Keys are applied
 * longest-first, so `codex` beats `code`, `cloudflare` beats `cloud`, and a
 * phrase key beats its component words.
 */
export function applyPronunciation(text: string): string {
  let out = text;

  // 1) Whole-word acronyms first. Match only as a standalone word (Unicode
  // boundaries, so Polish diacritics count) plus an optional plural "s"
  // (APIs, GPUs) — NOT as a prefix, so "client"/"click" are never touched.
  const acronymKeys = Object.keys(ACRONYM_MAP).sort((a, b) => b.length - a.length);
  for (const key of acronymKeys) {
    const re = new RegExp(`(?<![\\p{L}\\p{N}_])${escapeRegExp(key)}(s?)(?![\\p{L}\\p{N}_])`, "giu");
    out = out.replace(re, (_match, plural: string) => ACRONYM_MAP[key] + plural);
  }

  // 2) Stem map: match at a word start and preserve trailing Polish inflection.
  const keys = Object.keys(PRONUNCIATION_MAP).sort((a, b) => b.length - a.length);
  for (const key of keys) {
    const re = new RegExp(`(?<![\\p{L}\\p{N}_])${escapeRegExp(key)}(\\p{L}*)`, "giu");
    out = out.replace(re, (_match, suffix: string) => PRONUNCIATION_MAP[key] + suffix);
  }

  return out;
}

/**
 * The letters that only Polish has. They are the ONLY evidence a vote keys on,
 * because they are unambiguous: no English text contains them, so the
 * false-positive class that the old function-word ratio produced — six of ten
 * ordinary English sentences read as Polish — cannot arise.
 */
const POLISH_DIACRITICS_RE = /[ąćęłńóśźż]/i;

/**
 * One utterance's vote for the session's language.
 *
 * Known and accepted: short diacritic-free Polish ("do 2026 roku") votes `en`,
 * so the pronunciation map is simply not applied. That is the safe failure
 * direction — ~38 map keys are ordinary English words (`build`, `update`,
 * `summary`), so misapplying the map mangles the output, while withholding it
 * only leaves a Polish sentence saying "deploy" in English.
 */
export function voteLanguage(text: string): "pl" | "en" {
  return POLISH_DIACRITICS_RE.test(text) ? "pl" : "en";
}

/**
 * A session's running language tally. Language is a property of the SESSION,
 * not of one response: certainty accumulates across utterances, so no single
 * line can flip the pronunciation map on.
 *
 * The two counters are deliberately asymmetric, because the two rules they
 * serve are:
 * - `plVotes` is the Polish evidence **since the session last flipped back to
 *   English**. It only grows while the session has not flipped back; the
 *   flip-back clears it, so re-entering Polish costs two fresh votes, exactly
 *   as it did on first entry — one utterance is never enough, anywhere.
 * - `enVotes` is the **current run** of consecutive English votes — the counter
 *   the "three consecutive" flip-back rule needs — and any Polish vote resets
 *   it. A lifetime English tally here would let a long English preamble lock a
 *   session out of Polish forever, which a genuinely bilingual agent session
 *   must not do: sessions open in English, so `en×5, pl, pl` would need six
 *   Polish votes to clear a lifetime tally and the 2-vote threshold would be
 *   dead on arrival.
 */
export interface LanguageState {
  /** Count of `pl` votes since the last flip back to English; reset by one. */
  plVotes: number;
  /** Length of the current run of `en` votes; reset by any `pl` vote. */
  enVotes: number;
  lang: "pl" | "en";
}

/** Polish votes needed before the map may be switched on. */
const PL_SWITCH_VOTES = 2;
/** Consecutive English votes that switch it back off. */
const EN_FLIP_BACK_VOTES = 3;

/**
 * A session starts English. Misapplying the map is the harm, so the default is
 * the branch that changes nothing.
 */
export const INITIAL_LANGUAGE_STATE: LanguageState = Object.freeze({
  plVotes: 0,
  enVotes: 0,
  lang: "en",
});

/**
 * Folds one utterance's vote into the session's tally. Pure — the state lives
 * with the rest of the per-session speech state, not here.
 *
 * The flip-back is checked FIRST, and it clears `plVotes`: three English
 * utterances in a row mean the session has switched language, and that beats
 * however much Polish evidence came before it — which is also why the old
 * evidence is thrown away rather than kept. Re-entering Polish then costs two
 * fresh votes, so a single Polish utterance can no more re-enter Polish than it
 * could enter it in the first place. (Checking the switch first instead would
 * let `pl,pl,pl,pl,en,en,en` stay Polish on the strength of the four old
 * votes.)
 *
 * The `plVotes > enVotes` comparison is a restatement of that clearing, not a
 * second rule: every `pl` vote zeroes `enVotes`, so the comparison holds on
 * every vote that could switch the session on. It is kept as an explicit floor
 * — Polish evidence must outweigh the current English run — but brute force
 * over every vote sequence of length ≤ 10 shows it changes no outcome today.
 * It is not, and must not be described as, the thing that stops a just-flipped
 * session from bouncing back to Polish: clearing `plVotes` is.
 */
export function nextLanguageState(state: LanguageState, vote: "pl" | "en"): LanguageState {
  const plVotes = vote === "pl" ? state.plVotes + 1 : state.plVotes;
  const enVotes = vote === "en" ? state.enVotes + 1 : 0;

  if (enVotes >= EN_FLIP_BACK_VOTES) return { plVotes: 0, enVotes, lang: "en" };
  if (plVotes >= PL_SWITCH_VOTES && plVotes > enVotes) return { plVotes, enVotes, lang: "pl" };

  return { plVotes, enVotes, lang: state.lang };
}
