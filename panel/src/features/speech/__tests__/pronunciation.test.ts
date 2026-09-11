import { describe, expect, it } from "vitest";
import {
  INITIAL_LANGUAGE_STATE,
  applyPronunciation,
  nextLanguageState,
  voteLanguage,
} from "../pronunciation";

describe("applyPronunciation", () => {
  it("substitutes a mapped term case-insensitively", () => {
    expect(applyPronunciation("benchmark")).toBe("benczmark");
    expect(applyPronunciation("Benchmark")).toBe("benczmark");
    expect(applyPronunciation("BENCHMARK")).toBe("benczmark");
    expect(applyPronunciation("React")).toBe("reakt");
    // Acronyms match as a standalone word only, but just as case-insensitively.
    expect(applyPronunciation("API")).toBe("ej-pi-aj");
    expect(applyPronunciation("api")).toBe("ej-pi-aj");
    // ...and never as a prefix of a real word.
    expect(applyPronunciation("apiary")).toBe("apiary");
  });

  it("longest key wins over a shorter overlapping key", () => {
    expect(applyPronunciation("Codex")).toBe("kodeks"); // not `code` + "x"
    expect(applyPronunciation("Cloudflare")).toBe("klałdfler"); // not `cloud` + "flare"
    expect(applyPronunciation("pull request")).toBe("pul rikłest"); // phrase beats its words
  });

  it("stem match preserves Polish inflection", () => {
    expect(applyPronunciation("benchmarki")).toBe("benczmarki");
    expect(applyPronunciation("benchmarków")).toBe("benczmarków");
    expect(applyPronunciation("commitowanego")).toBe("komitowanego");
    expect(applyPronunciation("frameworku")).toBe("frejmłerku");
    // A key that is not at a word start is left alone.
    expect(applyPronunciation("arbenchmark")).toBe("arbenchmark");
  });
});

/** Feeds a session one utterance's vote after another, from the initial state. */
const session = (...votes: readonly ("pl" | "en")[]) =>
  votes.reduce(nextLanguageState, INITIAL_LANGUAGE_STATE);

describe("voteLanguage", () => {
  it("votes pl only when Polish diacritics are present", () => {
    expect(voteLanguage("Zrobiłem deploy na Cloudflare.")).toBe("pl");
    expect(voteLanguage("ŁADNIE")).toBe("pl");
    expect(voteLanguage("The panel now speaks the last response.")).toBe("en");
    expect(voteLanguage("")).toBe("en");
    // Accepted consequence: diacritic-free Polish votes en, so the map is
    // simply not applied — the safe failure direction.
    expect(voteLanguage("Do 2026 roku nie ruszamy tego kodu.")).toBe("en");
  });

  it("an English sentence dense in to/we/do still votes en", () => {
    const english = [
      "We do want to do this, so do we go to the next step or not?",
      "To be clear, we do not want to ship that on a Friday.",
      "Do we need to add a test for the case we just fixed?",
      "We can do it after we talk to the team about the release.",
    ];

    for (const sentence of english) expect(voteLanguage(sentence)).toBe("en");
    expect(session(...english.map(voteLanguage)).lang).toBe("en");
  });
});

describe("nextLanguageState", () => {
  it("a single Polish utterance is not enough to switch the session", () => {
    expect(INITIAL_LANGUAGE_STATE.lang).toBe("en");
    expect(session("pl").lang).toBe("en");
    expect(session("pl", "pl").lang).toBe("pl");
    // A long English preamble does not lock the session out of Polish.
    expect(session("en", "en", "en", "en", "en", "pl", "pl").lang).toBe("pl");
  });

  it("flips back to en after three consecutive english votes", () => {
    expect(session("pl", "pl", "en").lang).toBe("pl");
    expect(session("pl", "pl", "en", "en").lang).toBe("pl");
    expect(session("pl", "pl", "en", "en", "en").lang).toBe("en");
    // A Polish vote breaks the run, so two more English votes do not flip it.
    expect(session("pl", "pl", "en", "en", "pl", "en", "en").lang).toBe("pl");
  });

  it("keeps the session on en while English keeps coming after a flip back", () => {
    expect(session("pl", "pl", "en", "en", "en", "en").lang).toBe("en");
    expect(session("pl", "pl", "en", "en", "en", "en", "pl", "pl").lang).toBe("pl");
  });
});
