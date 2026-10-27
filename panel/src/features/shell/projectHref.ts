/**
 * Where tapping a project sends the user.
 *
 * A phone lands on the terminal tab: the sections are reading surfaces the user
 * opens deliberately, while the reason to pick up a phone at all is the agent
 * waiting in a terminal. A desktop gets the bare route, so the Last-open-view
 * bookmark restores wherever they left off. This is a destination override and
 * nothing more — the bookmark is still written by the page the user lands on
 * (`useLastPath`, mounted in `ProjectView`), so a phone visit never loses the
 * desktop's place.
 *
 * `isMobile` comes from the caller's live `useIsMobile()`, so a rotation moves
 * the destination with it; it is never stored, because being on a phone is a
 * fact about the viewport, not a preference.
 *
 * The name is percent-encoded, matching `QuickTerminalModal`, which builds the
 * same `/project/<name>/iterm` target. A project may be named with a space or a
 * `#`, and unencoded those do not survive the trip: a `#` starts the fragment,
 * so the route would see a truncated name. Encoding is safe on the far side —
 * `matchProjectFromPath` decodes the segment itself, and the router hands
 * `useParams` the decoded form, which is what every preference scope downstream
 * (the bookmark, the expand state) is keyed on.
 */
export function projectHref(name: string, isMobile: boolean): string {
  return isMobile
    ? `/project/${encodeURIComponent(name)}/iterm`
    : `/project/${encodeURIComponent(name)}`;
}
