/**
 * The session language tally that gates the Polish pronunciation preset
 * (vendored from motyl's `lib/tts/voice-map.ts`). The preset itself, and the
 * matcher that applies it, live in `anytts/text`; `prepare.ts` applies it on the
 * Polish branch only — see {@link voteLanguage} and {@link nextLanguageState} —
 * because an English answer needs none of it: many preset keys are ordinary
 * English words, so applying it to English prose is not a no-op, it is damage.
 */

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
