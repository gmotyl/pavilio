/**
 * The one viewport the panel changes layout on: Tailwind's `md` breakpoint,
 * read from the other side. A component that renders `md:w-72` and one that
 * asks `matchMedia` have to agree on where the phone stops, and they only do
 * while both spell it from here.
 *
 * `index.css`'s `@media (max-width: 767px)` is the same line in CSS, and it
 * stays a copy — a stylesheet cannot import a TypeScript constant. It is the
 * one place that has to be changed by hand alongside this.
 */
export const MOBILE_QUERY = "(max-width: 767px)";
