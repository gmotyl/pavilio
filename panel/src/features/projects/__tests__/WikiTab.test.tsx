import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { screen, waitFor, fireEvent, within, cleanup } from "@testing-library/react";
import { useLocation } from "react-router-dom";
import { installMatchMedia, mockFetchResponses, renderWithRouter } from "../../../test-utils";

vi.mock("../../realtime/useWebSocket", () => ({
  useWebSocket: () => ({ lastMessage: null }),
}));

// The clipboard helper is the seam the copy button writes through.
vi.mock("../../../lib/clipboard", () => ({
  copyToClipboard: vi.fn(async () => true),
}));

import WikiTab from "../WikiTab";
import { copyToClipboard } from "../../../lib/clipboard";
import { expandCommand } from "../../terminal/expandCommand";
import { readLastSectionFile } from "../../shell/lastPath";
import type { WikiPageInfo, WikiTree } from "../useProjectWiki";

const PROJECT = "pavilio";

function page(path: string, title: string, over: Partial<WikiPageInfo> = {}): WikiPageInfo {
  return {
    path,
    title,
    description: null,
    type: null,
    sourceCount: 0,
    updated: null,
    created: null,
    backlinks: [],
    sources: [],
    ...over,
  };
}

const progress = [1, 2, 3, 4].map((n) =>
  page(`wiki/sources/progress-2026-10-1${n}.md`, `progress · 2026-10-1${n}`, {
    type: "source",
    description: n === 1 ? "tts relay on node20" : `day ${n}`,
  }),
);
const change = page("wiki/sources/change-2026-10-07-draft.md", "change · composer draft lost", {
  type: "source",
});

const UTTERANCE = page("wiki/concepts/utterance.md", "Utterance", {
  type: "concept",
  description: "One finished agent response",
  updated: "2026-10-19",
  created: "2026-10-01",
  backlinks: ["wiki/concepts/catch-up.md", "wiki/concepts/speech-relay.md"],
  sources: [...progress.map((p) => p.path), change.path],
  sourceCount: 5,
});

const concepts = [
  page("wiki/concepts/catch-up.md", "Catch-up", { type: "concept" }),
  page("wiki/concepts/return-is-consent.md", "Return is consent", { type: "concept" }),
  page("wiki/concepts/speech-relay.md", "Speech relay", { type: "concept" }),
  UTTERANCE,
  page("wiki/concepts/utterance-queue.md", "Utterance queue", { type: "concept" }),
  page("wiki/concepts/x6.md", "Zeta six", { type: "concept" }),
  page("wiki/concepts/x7.md", "Zeta seven", { type: "concept" }),
  page("wiki/concepts/x8.md", "Zeta eight", { type: "concept" }),
];

const TREE: WikiTree = {
  project: PROJECT,
  overview: page("wiki/overview.md", "Overview", { description: "What this wiki covers" }),
  entities: {
    count: 3,
    kinds: [
      {
        kind: "person",
        count: 1,
        pages: [page("wiki/entities/greg-motyl.md", "Greg Motyl", { description: "maintainer" })],
      },
      {
        kind: "repository",
        count: 2,
        pages: [
          page("wiki/entities/pavilio.md", "pavilio", { description: "upstream" }),
          page("wiki/entities/anytts.md", "anytts", { description: "TTS lib" }),
        ],
      },
    ],
  },
  concepts: { count: concepts.length, pages: concepts },
  repos: {
    count: 4,
    repos: [
      {
        name: "anytts",
        count: 1,
        pages: [page("wiki/repos/anytts/index.md", "anytts code")],
      },
      {
        name: "pavilio",
        count: 3,
        pages: [
          page("wiki/repos/pavilio/index.md", "pavilio code"),
          page("wiki/repos/pavilio/ARCHITECTURE.md", "Architecture"),
          page("wiki/repos/pavilio/speech-host.md", "Speech host"),
        ],
      },
    ],
  },
  interaction: {
    count: 4,
    openQuestions: page("wiki/open-questions.md", "Open questions"),
    openQuestionsCount: 7,
    notes: [page("wiki/notes/n1.md", "A note")],
    questions: [page("wiki/questions/q1.md", "Why node20"), page("wiki/questions/q2.md", "Why relay")],
  },
  sources: {
    count: 5,
    kinds: [
      { kind: "change", count: 1, pages: [change] },
      { kind: "progress", count: 4, pages: progress },
    ],
  },
  other: [],
};

const UTTERANCE_MD = [
  "---",
  "type: concept",
  "description: One finished agent response",
  "---",
  "# Utterance",
  "",
  "One finished agent response. Recovered by [[wiki/concepts/catch-up]];",
  "[[wiki/concepts/speech-budget]] is still waiting.",
  "",
].join("\n");

const FILE = `${PROJECT}/wiki/concepts/utterance.md`;

function mockApi() {
  return mockFetchResponses({
    "/api/files/exists": {
      exists: {
        "pavilio/wiki/concepts/catch-up.md": true,
        "pavilio/wiki/concepts/speech-budget.md": false,
      },
    },
    [`/api/files/read/${FILE}`]: { content: UTTERANCE_MD, absolutePath: `/ws/projects/${FILE}` },
    "/api/files/read/": { content: "# Some page\n\nbody\n", absolutePath: "/ws/projects/x.md" },
    [`/api/projects/${PROJECT}/wiki`]: TREE,
  });
}

function LocationProbe() {
  const loc = useLocation();
  return <span data-testid="location-search">{loc.search}</span>;
}

function renderTab(search = "") {
  return renderWithRouter(
    <>
      <WikiTab projectName={PROJECT} />
      <LocationProbe />
    </>,
    { initialEntries: [`/project/${PROJECT}/wiki${search}`] },
  );
}

const fileParam = (path: string) => `?file=${encodeURIComponent(path)}`;

const row = (path: string) => screen.queryByTestId(`wiki-page-${path}`);
const groupHeader = (id: string) => screen.getByTestId(`wiki-tab-source-${id}`);
const sub = (id: string) => screen.getByTestId(`wiki-sub-${id}`);

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  installMatchMedia();
  mockApi();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("WikiTab", () => {
  it("renders the tree groups with counts", async () => {
    renderTab();
    await screen.findByTestId("wiki-page-wiki/overview.md");

    // Filter box with the page wording.
    const filter = screen.getByTestId("file-list-filter-input") as HTMLInputElement;
    expect(filter.placeholder).toBe("Filter pages…");
    // No sort pills: wiki pages are listed in index order.
    expect(screen.queryByTestId("file-list-sort-date")).toBeNull();

    // Overview leads, above every group.
    expect(row("wiki/overview.md")?.textContent).toContain("Overview");

    // Groups in mockup order, each with its count.
    const ids = ["entities", "concepts", "repos", "interaction", "sources"];
    const headers = ids.map(groupHeader);
    for (let i = 1; i < headers.length; i++) {
      expect(
        headers[i - 1].compareDocumentPosition(headers[i]) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    }
    expect(groupHeader("entities").textContent).toMatch(/Entities.*3/);
    expect(groupHeader("concepts").textContent).toMatch(/Concepts.*8/);
    expect(groupHeader("repos").textContent).toMatch(/Repos.*4/);
    expect(groupHeader("sources").textContent).toMatch(/Sources.*5/);

    // Entities split by kind with counts.
    expect(sub("entities:person").textContent).toMatch(/People.*1/);
    expect(sub("entities:repository").textContent).toMatch(/Repositories.*2/);

    // Repos carry the code badge and a page count per repo.
    expect(within(groupHeader("repos")).getByTestId("wiki-code-badge").textContent).toBe("code");
    expect(sub("repos:pavilio").textContent).toMatch(/pavilio.*3 pages/);
    expect(sub("repos:anytts").textContent).toMatch(/anytts.*1 page/);

    // Interaction: Open questions (with its count), Notes, Questions.
    expect(row("wiki/open-questions.md")?.textContent).toMatch(/Open questions.*7/);
    expect(sub("interaction:notes").textContent).toMatch(/Notes.*1/);
    expect(sub("interaction:questions").textContent).toMatch(/Questions.*2/);

    // Sources split by kind with counts.
    expect(sub("sources:progress").textContent).toMatch(/progress.*4/);
    expect(sub("sources:change").textContent).toMatch(/change.*1/);
  });

  it("collapses repos and sources by default", async () => {
    renderTab();
    await screen.findByTestId("wiki-page-wiki/overview.md");

    for (const id of ["repos:pavilio", "repos:anytts", "sources:progress", "sources:change"]) {
      expect(sub(id).getAttribute("aria-expanded")).toBe("false");
    }
    expect(row("wiki/repos/pavilio/speech-host.md")).toBeNull();
    expect(row(progress[0].path)).toBeNull();

    // The other groups start open.
    expect(sub("entities:person").getAttribute("aria-expanded")).toBe("true");
    expect(row("wiki/entities/greg-motyl.md")).not.toBeNull();
    expect(row("wiki/concepts/catch-up.md")).not.toBeNull();

    fireEvent.click(sub("repos:pavilio"));
    expect(sub("repos:pavilio").getAttribute("aria-expanded")).toBe("true");
    expect(row("wiki/repos/pavilio/speech-host.md")).not.toBeNull();
  });

  it("expands a long group from plus N more", async () => {
    renderTab();
    await screen.findByTestId("wiki-page-wiki/overview.md");

    const conceptRows = () =>
      concepts.filter((c) => row(c.path) !== null).map((c) => c.title);
    expect(conceptRows()).toEqual(concepts.slice(0, 5).map((c) => c.title));

    const more = screen.getByTestId("wiki-more-concepts");
    expect(more.textContent).toBe("+ 3 more");
    fireEvent.click(more);

    expect(conceptRows()).toEqual(concepts.map((c) => c.title));
    expect(screen.queryByTestId("wiki-more-concepts")).toBeNull();
  });

  it("shows the description on hover", async () => {
    renderTab();
    const greg = await screen.findByTestId("wiki-page-wiki/entities/greg-motyl.md");
    fireEvent.mouseEnter(greg);
    // The row's native tooltip — the same mechanism FileRow gives every file list.
    expect(greg.getAttribute("title")).toBe("maintainer");
    expect(row("wiki/overview.md")?.getAttribute("title")).toBe("What this wiki covers");
  });

  it("filters pages across groups", async () => {
    renderTab();
    await screen.findByTestId("wiki-page-wiki/overview.md");

    fireEvent.change(screen.getByTestId("file-list-filter-input"), {
      target: { value: "relay" },
    });

    // Title match in Concepts, description match in a collapsed Sources kind,
    // title match in Interaction.
    await waitFor(() => expect(row("wiki/entities/greg-motyl.md")).toBeNull());
    expect(row("wiki/concepts/speech-relay.md")).not.toBeNull();
    expect(row(progress[0].path)).not.toBeNull();
    expect(row("wiki/questions/q2.md")).not.toBeNull();
    // Non-matching pages and the emptied groups are gone.
    expect(row("wiki/overview.md")).toBeNull();
    expect(row("wiki/concepts/utterance.md")).toBeNull();
    expect(row(progress[1].path)).toBeNull();
    expect(screen.queryByTestId("wiki-tab-source-entities")).toBeNull();
    expect(screen.queryByTestId("wiki-tab-source-repos")).toBeNull();
  });

  it("renders breadcrumb title and chips", async () => {
    const { container } = renderTab(fileParam(FILE));

    expect((await screen.findByTestId("wiki-crumbs")).textContent).toBe(
      "wiki / concepts / utterance",
    );
    expect(screen.getByTestId("wiki-title").textContent).toBe("Utterance");

    const chips = within(screen.getByTestId("wiki-chips"));
    expect(chips.getByTestId("wiki-chip-type").textContent).toBe("concept");
    expect(chips.getByTestId("wiki-chip-sources").textContent).toBe("5 sources");
    expect(chips.getByTestId("wiki-chip-updated").textContent).toBe("updated 2026-10-19");
    expect(chips.getByTestId("wiki-chip-created").textContent).toBe("created 2026-10-01");

    // Rendered body: frontmatter stripped, the H1 not repeated under the title.
    const body = await screen.findByTestId("wiki-body");
    await waitFor(() => expect(body.textContent).toContain("One finished agent response."));
    expect(body.textContent).not.toContain("type: concept");
    expect(body.querySelector("h1")).toBeNull();

    // Wikilinks: resolved → a wiki-tab link, missing → amber warning text.
    const resolved = body.querySelector('a[href="/project/pavilio/wiki?file=pavilio%2Fwiki%2Fconcepts%2Fcatch-up.md"]');
    expect(resolved).not.toBeNull();
    await waitFor(() =>
      expect(container.querySelector(".wikilink-missing")?.textContent).toContain(
        "speech-budget",
      ),
    );
  });

  it("renders linked-from and built-from footer", async () => {
    renderTab(fileParam(FILE));

    const linked = within(await screen.findByTestId("wiki-linked-from"));
    expect(linked.getByText("Linked from")).toBeTruthy();
    expect(linked.getByText("Catch-up")).toBeTruthy();
    expect(linked.getByText("Speech relay")).toBeTruthy();

    const builtEl = screen.getByTestId("wiki-built-from");
    const built = within(builtEl);
    expect(built.getByText("Built from")).toBeTruthy();
    expect(built.getAllByTestId("wiki-footer-link")).toHaveLength(3);
    const more = built.getByTestId("wiki-built-from-more");
    expect(more.textContent).toBe("+ 2 more");
    fireEvent.click(more);
    expect(built.getAllByTestId("wiki-footer-link")).toHaveLength(5);
    expect(built.getByText("change · composer draft lost")).toBeTruthy();

    // A footer entry opens that page in the tab.
    fireEvent.click(linked.getByText("Catch-up"));
    expect(screen.getByTestId("location-search").textContent).toBe(
      fileParam(`${PROJECT}/wiki/concepts/catch-up.md`),
    );
  });

  it("reveals a folded subgroup when the selection moves into it", async () => {
    renderTab(fileParam(FILE));
    const built = within(await screen.findByTestId("wiki-built-from"));
    expect(sub("sources:progress").getAttribute("aria-expanded")).toBe("false");
    expect(row(progress[0].path)).toBeNull();

    // Selecting a page from the footer opens the subgroup that holds its row.
    fireEvent.click(built.getByText(progress[0].title));
    await waitFor(() =>
      expect(sub("sources:progress").getAttribute("aria-expanded")).toBe("true"),
    );
    expect(row(progress[0].path)).not.toBeNull();

    // The user can still fold it again while the selection stays inside.
    fireEvent.click(sub("sources:progress"));
    expect(sub("sources:progress").getAttribute("aria-expanded")).toBe("false");
    expect(row(progress[0].path)).toBeNull();
  });

  it("records and restores the selection via ?file=", async () => {
    renderTab();
    fireEvent.click(await screen.findByTestId("wiki-page-wiki/concepts/utterance.md"));

    expect(screen.getByTestId("location-search").textContent).toBe(fileParam(FILE));
    expect((await screen.findByTestId("wiki-title")).textContent).toBe("Utterance");
    // Remembered for the tab link, so returning to the tab restores it.
    await waitFor(() => expect(readLastSectionFile(PROJECT, "wiki")).toBe(FILE));
    expect(
      screen.getByTestId("wiki-page-wiki/concepts/utterance.md").style.background,
    ).toBe("var(--bg-active)");

    // A reload (fresh mount on the same URL) opens the same page.
    cleanup();
    renderTab(fileParam(FILE));
    expect((await screen.findByTestId("wiki-title")).textContent).toBe("Utterance");
    expect(readLastSectionFile(PROJECT, "wiki")).toBe(FILE);

    // A selection hidden behind "+ N more" is revealed, not lost.
    cleanup();
    renderTab(fileParam(`${PROJECT}/wiki/concepts/x8.md`));
    expect(await screen.findByTestId("wiki-page-wiki/concepts/x8.md")).toBeTruthy();
  });

  it("stacks list above page at 390px", async () => {
    installMatchMedia({ mobile: true });
    renderTab(fileParam(FILE));
    await screen.findByTestId("wiki-title");

    // Phones open on the folded rail, like every file-list tab; unfolding it
    // puts the list in the column above the page.
    expect(screen.queryByTestId("file-list-sidebar")).toBeNull();
    fireEvent.click(screen.getByTestId("file-list-sidebar-toggle"));

    const list = screen.getByTestId("file-list-sidebar");
    const detail = screen.getByTestId("file-list-sidebar-detail");
    const row = list.parentElement!;
    // Column on phones, side by side from `md` up; the list comes first.
    expect(row.className).toMatch(/(^|\s)flex-col(\s|$)/);
    expect(row.className).toContain("md:flex-row");
    expect(row).toBe(detail.parentElement);
    expect(list.compareDocumentPosition(detail) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // Full-bleed list: no fixed pane width on mobile.
    expect(list.style.width).toBe("");

    // Nothing in the page view can push the row wider than the screen.
    const view = screen.getByTestId("wiki-view");
    expect(view.className).toContain("min-w-0");
    expect(view.className).toContain("break-words");
    expect(screen.getByTestId("wiki-chips").className).toContain("flex-wrap");
    expect(screen.getByTestId("wiki-footer").className).toContain("grid-cols-1");
    expect(screen.getByTestId("wiki-footer").className).toContain("md:grid-cols-2");
  });

  it("has no ask box", async () => {
    renderTab(fileParam(FILE));
    await screen.findByTestId("wiki-title");
    // The ask hint is static text with a copy button — nothing is sent anywhere.
    expect(screen.queryByText(/send to terminal/i)).toBeNull();
    // The filter is the only text input on the tab.
    expect(screen.getAllByRole("textbox")).toEqual([
      screen.getByTestId("file-list-filter-input"),
    ]);
  });

  it("wiki tab shows the ask hint with the project name", async () => {
    renderTab();
    const hint = await screen.findByTestId("wiki-ask-hint");
    expect(hint.textContent).toContain(`Ask this wiki: /pavilio-wiki ${PROJECT} "…"`);
    expect(within(hint).getByTestId("wiki-ask-copy")).toBeTruthy();
  });

  it("copy writes the expanded skill instruction", async () => {
    const copy = vi.mocked(copyToClipboard);
    copy.mockClear();
    renderTab();
    fireEvent.click(await screen.findByTestId("wiki-ask-copy"));
    await waitFor(() => expect(copy).toHaveBeenCalledTimes(1));
    const expected = `Read and follow the instructions in skills/pavilio-wiki/SKILL.md exactly. ${PROJECT} "…"`;
    expect(copy).toHaveBeenCalledWith(expected);
    // The same text the composer's expansion produces for the typed command.
    expect(expected).toBe(expandCommand(`/pavilio-wiki ${PROJECT} "…"`, new Set(["pavilio-wiki"])));
  });
});
