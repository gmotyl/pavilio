// highlight.js on a huge file stalls the tab; past this it renders plain.
// Its own module so a test can cross the limit with a few lines instead of half a megabyte.
export const MAX_HIGHLIGHT_CHARS = 500_000;
