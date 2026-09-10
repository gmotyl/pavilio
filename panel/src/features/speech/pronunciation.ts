/**
 * English → Polish phonetic pronunciation maps, vendored verbatim from motyl's
 * `lib/tts/pronunciation.ts`, together with the matcher that applies them
 * (motyl keeps it in `lib/tts/speech.ts`) and the language detection that gates
 * them (motyl's `lib/tts/voice-map.ts`).
 *
 * The maps are a hand-tuned workaround for edge-tts mispronouncing English tech
 * terms *inside Polish prose*. They are applied on the Polish branch only —
 * see {@link detectLanguage} — because an English answer needs none of it.
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

/** Common Polish function words — the signal content-based detection keys on. */
const POLISH_WORDS: ReadonlySet<string> = new Set([
  "jest",
  "ale",
  "dla",
  "tego",
  "tak",
  "jak",
  "to",
  "co",
  "na",
  "do",
  "za",
  "od",
  "po",
  "we",
  "ze",
]);

/** Share of whitespace-separated words that must be Polish function words. */
const POLISH_WORD_RATIO = 0.1;

/**
 * Detects the language of a response — a **language**, never a voice id.
 *
 * Motyl's `detectLanguageFromContent` returns `pl-PL-MarekNeural` /
 * `en-GB-RyanNeural`, so detection silently overrides whichever voice the user
 * picked. Here the two concerns are split: this gates the pronunciation map and
 * nothing else, and the picked voice always wins (see `voices.ts`). Every
 * offered voice is multilingual, so no voice ever has to be switched.
 *
 * The heuristic is motyl's: if more than 10% of the whitespace-separated words
 * are common Polish function words, the text is Polish. Anything else — English
 * prose, an identifier dump, an empty string — is English.
 */
export function detectLanguage(text: string): "pl" | "en" {
  const words = text.toLowerCase().split(/\s+/);
  const polishWordCount = words.filter((word) => POLISH_WORDS.has(word)).length;

  return polishWordCount > words.length * POLISH_WORD_RATIO ? "pl" : "en";
}
