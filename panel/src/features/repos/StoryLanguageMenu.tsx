import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import type { StoryLanguage } from "../../preferences/declarations";

const OPTIONS: { lang: StoryLanguage; label: string }[] = [
  { lang: "pl", label: "Polski — PL" },
  { lang: "en", label: "English — EN" },
];

const NAME: Record<StoryLanguage, string> = { en: "English", pl: "Polish" };

interface Props {
  lang: StoryLanguage;
  onPick: (lang: StoryLanguage) => void;
  /** While the row's story is being written: the half shows the language but does not open. */
  disabled?: boolean;
  tabIndex?: number;
  testId?: string;
}

/**
 * The right half of a story launch split button: `EN ▾` / `PL ▾`, opening the
 * story-language menu. The choice is global, so the caller holds the value and
 * every half in the list reads the same one.
 *
 * Same open/close shape as `LayoutPresetMenu` (an invisible backdrop closes it
 * on click, Escape on the keyboard), with arrow keys between the two items as in
 * `SidebarRowMenu`. Keys stop here, so the PR list's roving focus never sees an
 * arrow pressed inside the menu.
 *
 * The menu hangs leftwards from the half; when that would cut it off at the
 * left edge of its pane (the `.prs-view` container, else the window), as for a
 * lone Explain in a narrow pane, it opens rightwards instead.
 */
export function StoryLanguageMenu({ lang, onPick, disabled = false, tabIndex, testId }: Props) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const items = useRef<(HTMLButtonElement | null)[]>([]);
  const menu = useRef<HTMLDivElement>(null);
  const [alignStart, setAlignStart] = useState(false);

  useLayoutEffect(() => {
    if (!open) return setAlignStart(false);
    const el = menu.current;
    if (!el) return;
    const pane = el.closest(".prs-view")?.getBoundingClientRect().left ?? 0;
    setAlignStart(el.getBoundingClientRect().left < pane);
  }, [open]);

  useEffect(() => {
    // Opening puts focus on the current choice.
    if (open) items.current[OPTIONS.findIndex((o) => o.lang === lang)]?.focus();
  }, [open, lang]);

  const close = () => {
    setOpen(false);
    trigger.current?.focus();
  };

  const onMenuKey = (e: KeyboardEvent<HTMLDivElement>) => {
    e.stopPropagation();
    const at = items.current.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      const step = e.key === "ArrowDown" ? 1 : -1;
      items.current[(at + step + OPTIONS.length) % OPTIONS.length]?.focus();
    } else if (e.key === "Home") items.current[0]?.focus();
    else if (e.key === "End") items.current[OPTIONS.length - 1]?.focus();
    else if (e.key === "Escape") close();
    else if (e.key === "Tab") setOpen(false);
    else return;
    if (e.key !== "Tab") e.preventDefault();
  };

  return (
    <span className="pr-lang-wrap">
      <button
        ref={trigger}
        type="button"
        className="pr-act pr-lang"
        data-testid={testId}
        tabIndex={tabIndex}
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Story language: ${NAME[lang]}`}
        title={`Story language: ${NAME[lang]}`}
        onClick={() => !disabled && setOpen((o) => !o)}
      >
        {lang.toUpperCase()} <span className="pr-caret">{open ? "▴" : "▾"}</span>
      </button>
      {open && (
        <>
          <span className="pr-lang-backdrop" aria-hidden="true" onClick={close} />
          <div
            ref={menu}
            className="pr-lang-menu"
            data-align={alignStart ? "start" : undefined}
            role="menu" aria-label="Story language" onKeyDown={onMenuKey}>
            <div className="pr-lang-hd">Story language</div>
            {OPTIONS.map((o, i) => (
              <button
                key={o.lang}
                ref={(el) => {
                  items.current[i] = el;
                }}
                type="button"
                role="menuitemradio"
                aria-checked={o.lang === lang}
                tabIndex={-1}
                onClick={() => {
                  onPick(o.lang);
                  close();
                }}
              >
                {o.label}
              </button>
            ))}
            <div className="pr-lang-ft">Applies to every project</div>
          </div>
        </>
      )}
    </span>
  );
}
