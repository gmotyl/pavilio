import { useRef, useState, type CSSProperties, type ReactNode } from "react";

import type { OmniVoiceInfo } from "./openaiVoices";
import {
  BUTTON_CLASS,
  BUTTON_STYLE,
  CONTROL_CLASS,
  CONTROL_STYLE,
  LABEL_CLASS,
  MUTED,
  PANEL_DOWN,
  PRIMARY_STYLE,
  RED,
  VOICES_URL,
  failureOf,
} from "./voicesSectionUi";

/** The voice id rule omnivoice-server enforces: checked here first, so nothing is uploaded in vain. */
const VOICE_NAME = /^[a-z0-9][a-z0-9-]{0,63}$/;
const LOCALES = ["pl-PL", "en-GB", "en-US", "en-CA"] as const;
const GENDERS = ["male", "female", "neutral"] as const;

const BAD: CSSProperties = { borderColor: "var(--red)" };
const HELP_CLASS = "text-xs mt-1";
const HELP: CSSProperties = { color: "var(--text-tertiary)" };
const FULL: CSSProperties = { gridColumn: "1 / -1", minWidth: 0 };

interface FieldErrors {
  name?: string;
  file?: string;
  transcript?: string;
}

interface AddVoiceFormProps {
  /** The server's voices: a custom name is replaced, a bundled one refused. */
  voices: readonly OmniVoiceInfo[];
  /** The clone landed (`201`): reload the list and close. */
  onAdded: () => Promise<void>;
  onCancel: () => void;
  /** Shows a server refusal in the section's red banner; `null` clears it. */
  onError: (message: string | null) => void;
  /** The pane is narrow: one column. */
  narrow: boolean;
}

function FieldError({ children }: { children: ReactNode }) {
  return (
    <p className={HELP_CLASS} style={RED}>
      {children}
    </p>
  );
}

/**
 * The inline *Add voice* form (not a modal): Name, Label, Sample, Transcript, Locale, Gender and
 * Multilingual, POSTed as multipart to the panel server, which clones the voice on the OmniVoice
 * server. A typed name that is an existing custom voice replaces it; a bundled one is a field
 * error. Name, sample and transcript are checked before anything is uploaded, and the fields lock
 * while the server clones.
 */
export function AddVoiceForm({ voices, onAdded, onCancel, onError, narrow }: AddVoiceFormProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState("");
  const [label, setLabel] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [transcript, setTranscript] = useState("");
  const [locale, setLocale] = useState<string>(LOCALES[0]);
  const [gender, setGender] = useState<string>(GENDERS[0]);
  const [multilingual, setMultilingual] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const [busy, setBusy] = useState(false);

  const existing = voices.find((voice) => voice.id === name);
  const bundled = existing?.source === "bundled";
  const replacing = existing?.source === "custom";

  const errors: FieldErrors = {};
  if (bundled) errors.name = `“${name}” is a bundled voice — pick another name.`;
  if (attempted) {
    if (!VOICE_NAME.test(name)) errors.name = "Use lowercase letters, digits and dashes — e.g. my-voice.";
    if (!file) errors.file = "Choose a sample recording.";
    if (transcript.trim() === "")
      errors.transcript = "The transcript is required — the clone is only as good as its match to the audio.";
  }

  const submit = async () => {
    setAttempted(true);
    const blocked =
      bundled || !VOICE_NAME.test(name) || !file || transcript.trim() === "";
    if (blocked) return;
    const body = new FormData();
    body.set("file", file);
    body.set("name", name);
    body.set("label", label.trim() || name);
    body.set("ref_text", transcript.trim());
    body.set("locale", locale);
    body.set("gender", gender);
    body.set("multilingual", multilingual ? "true" : "false");
    setBusy(true);
    onError(null);
    let failure: string | null;
    try {
      const res = await fetch(VOICES_URL, { method: "POST", body });
      failure = res.ok ? null : await failureOf(res);
    } catch {
      failure = PANEL_DOWN;
    }
    if (failure === null) {
      await onAdded();
      return;
    }
    setBusy(false);
    onError(failure);
  };

  const action = replacing ? "Replace voice" : "Add voice";

  return (
    <form
      role="group"
      aria-label="Add voice"
      className="mt-2.5 rounded-md p-2.5"
      style={{ border: "1px dashed var(--border-default)" }}
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <fieldset
        disabled={busy}
        style={{
          display: "grid",
          gridTemplateColumns: narrow ? "1fr" : "1fr 1fr",
          gap: "10px 16px",
          border: 0,
          margin: 0,
          padding: 0,
          minWidth: 0,
          opacity: busy ? 0.6 : 1,
        }}
      >
        <div style={{ minWidth: 0 }}>
          <label htmlFor="voice-add-name" className={LABEL_CLASS} style={MUTED}>
            Name
          </label>
          <input
            id="voice-add-name"
            type="text"
            autoComplete="off"
            spellCheck={false}
            value={name}
            aria-invalid={errors.name ? "true" : undefined}
            onChange={(e) => setName(e.target.value)}
            className={`${CONTROL_CLASS} font-mono`}
            style={{ ...CONTROL_STYLE, ...(errors.name ? BAD : {}) }}
          />
          {errors.name ? (
            <FieldError>{errors.name}</FieldError>
          ) : (
            <p className={HELP_CLASS} style={HELP}>
              Voice id: lowercase letters, digits, dashes.
            </p>
          )}
        </div>
        <div style={{ minWidth: 0 }}>
          <label htmlFor="voice-add-label" className={LABEL_CLASS} style={MUTED}>
            Label
          </label>
          <input id="voice-add-label" type="text" value={label} onChange={(e) => setLabel(e.target.value)} className={CONTROL_CLASS} style={CONTROL_STYLE} />
        </div>
        <div style={FULL}>
          <label htmlFor="voice-add-file" className={LABEL_CLASS} style={MUTED}>
            Sample
          </label>
          <input
            ref={fileRef}
            id="voice-add-file"
            type="file"
            accept="audio/*"
            className="sr-only"
            aria-invalid={errors.file ? "true" : undefined}
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
          <div className="flex items-center flex-wrap gap-2">
            <button type="button" className={BUTTON_CLASS} style={BUTTON_STYLE} onClick={() => fileRef.current?.click()}>
              Choose file…
            </button>
            <span className="text-xs" style={{ color: "var(--text-secondary)" }}>
              {file ? file.name : "no file chosen"}
            </span>
          </div>
          {errors.file && <FieldError>{errors.file}</FieldError>}
          <p className={HELP_CLASS} style={HELP}>
            Any audio format. 3–10 s of clean speech; 8–10 s clones best.
          </p>
        </div>
        <div style={FULL}>
          <label htmlFor="voice-add-transcript" className={LABEL_CLASS} style={MUTED}>
            Transcript — exactly what is said in the sample
          </label>
          <textarea
            id="voice-add-transcript"
            value={transcript}
            aria-invalid={errors.transcript ? "true" : undefined}
            onChange={(e) => setTranscript(e.target.value)}
            className={CONTROL_CLASS}
            style={{ ...CONTROL_STYLE, resize: "vertical", minHeight: 56, ...(errors.transcript ? BAD : {}) }}
          />
          {errors.transcript && <FieldError>{errors.transcript}</FieldError>}
        </div>
        <div style={{ minWidth: 0 }}>
          <label htmlFor="voice-add-locale" className={LABEL_CLASS} style={MUTED}>
            Locale
          </label>
          <select id="voice-add-locale" value={locale} onChange={(e) => setLocale(e.target.value)} className={CONTROL_CLASS} style={CONTROL_STYLE}>
            {LOCALES.map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
        </div>
        <div style={{ minWidth: 0 }}>
          <label htmlFor="voice-add-gender" className={LABEL_CLASS} style={MUTED}>
            Gender
          </label>
          <select id="voice-add-gender" value={gender} onChange={(e) => setGender(e.target.value)} className={CONTROL_CLASS} style={CONTROL_STYLE}>
            {GENDERS.map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
        </div>
        <label style={{ ...FULL, color: "var(--text-primary)" }} className="inline-flex items-center gap-2 text-sm cursor-pointer">
          <input
            type="checkbox"
            checked={multilingual}
            onChange={(e) => setMultilingual(e.target.checked)}
            style={{ accentColor: "var(--accent)", width: 16, height: 16 }}
          />
          Multilingual — serves both Polish and English
        </label>
      </fieldset>
      <div className="flex items-center justify-end flex-wrap gap-2 mt-2.5">
        {busy ? (
          <span className="inline-flex items-center gap-2 text-xs mr-auto" style={{ color: "var(--text-secondary)" }}>
            <span
              aria-hidden="true"
              className="motion-safe:animate-spin"
              style={{ width: 12, height: 12, borderRadius: "50%", border: "2px solid var(--border-default)", borderTopColor: "var(--accent)" }}
            />
            Cloning on the OmniVoice server…
          </span>
        ) : (
          replacing && (
            <span className="text-xs mr-auto" style={{ color: "var(--yellow)" }}>
              ⚠ “{name}” exists — saving replaces it
            </span>
          )
        )}
        <button type="button" className={BUTTON_CLASS} style={BUTTON_STYLE} disabled={busy} onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" className={BUTTON_CLASS} style={PRIMARY_STYLE} disabled={busy}>
          {busy ? (replacing ? "Replacing…" : "Adding…") : action}
        </button>
      </div>
    </form>
  );
}
