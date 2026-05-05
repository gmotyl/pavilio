import type { IBufferCell, Terminal } from "@xterm/xterm";
import { THEME } from "./terminalInstances";
import type { BufferSnapshot, ColoredLine, ColoredRun } from "./TerminalView";

const BASIC_PALETTE: readonly string[] = [
  THEME.black,
  THEME.red,
  THEME.green,
  THEME.yellow,
  THEME.blue,
  THEME.magenta,
  THEME.cyan,
  THEME.white,
  THEME.brightBlack,
  THEME.brightRed,
  THEME.brightGreen,
  THEME.brightYellow,
  THEME.brightBlue,
  THEME.brightMagenta,
  THEME.brightCyan,
  THEME.brightWhite,
];
const CUBE_LEVELS = [0, 95, 135, 175, 215, 255];

function rgbHex(r: number, g: number, b: number): string {
  const h = (n: number) => n.toString(16).padStart(2, "0");
  return `#${h(r)}${h(g)}${h(b)}`;
}

function paletteToHex(idx: number): string {
  if (idx < 16) return BASIC_PALETTE[idx];
  if (idx < 232) {
    const i = idx - 16;
    return rgbHex(
      CUBE_LEVELS[Math.floor(i / 36)],
      CUBE_LEVELS[Math.floor((i % 36) / 6)],
      CUBE_LEVELS[i % 6],
    );
  }
  const v = 8 + (idx - 232) * 10;
  return rgbHex(v, v, v);
}

function packedRgbToHex(packed: number): string {
  const r = (packed >> 16) & 0xff;
  const g = (packed >> 8) & 0xff;
  const b = packed & 0xff;
  return rgbHex(r, g, b);
}

function cellFg(cell: IBufferCell): string | undefined {
  if (cell.isFgDefault()) return undefined;
  if (cell.isFgRGB()) return packedRgbToHex(cell.getFgColor());
  if (cell.isFgPalette()) return paletteToHex(cell.getFgColor());
  return undefined;
}

function cellBg(cell: IBufferCell): string | undefined {
  if (cell.isBgDefault()) return undefined;
  if (cell.isBgRGB()) return packedRgbToHex(cell.getBgColor());
  if (cell.isBgPalette()) return paletteToHex(cell.getBgColor());
  return undefined;
}

interface CellStyle {
  fg?: string;
  bg?: string;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  dim: boolean;
  strike: boolean;
}

function styleForCell(cell: IBufferCell): CellStyle {
  let fg = cellFg(cell);
  let bg = cellBg(cell);
  if (cell.isInverse()) {
    [fg, bg] = [bg ?? THEME.background, fg ?? THEME.foreground];
  }
  return {
    fg,
    bg,
    bold: !!cell.isBold(),
    italic: !!cell.isItalic(),
    underline: !!cell.isUnderline(),
    dim: !!cell.isDim(),
    strike: !!cell.isStrikethrough(),
  };
}

function styleEqual(a: CellStyle, b: CellStyle): boolean {
  return (
    a.fg === b.fg &&
    a.bg === b.bg &&
    a.bold === b.bold &&
    a.italic === b.italic &&
    a.underline === b.underline &&
    a.dim === b.dim &&
    a.strike === b.strike
  );
}

function styleIsDefault(s: CellStyle): boolean {
  return (
    s.fg === undefined &&
    s.bg === undefined &&
    !s.bold &&
    !s.italic &&
    !s.underline &&
    !s.dim &&
    !s.strike
  );
}

function styleToRun(s: CellStyle, text: string): ColoredRun {
  const run: ColoredRun = { text };
  if (s.fg) run.fg = s.fg;
  if (s.bg) run.bg = s.bg;
  if (s.bold) run.bold = true;
  if (s.italic) run.italic = true;
  if (s.underline) run.underline = true;
  if (s.dim) run.dim = true;
  if (s.strike) run.strike = true;
  return run;
}

function captureLine(terminal: Terminal, lineIndex: number): ColoredLine {
  const line = terminal.buffer.active.getLine(lineIndex);
  if (!line) return [];
  const runs: ColoredRun[] = [];
  let currentStyle: CellStyle | null = null;
  let currentText = "";
  const cell = terminal.buffer.active.getNullCell();
  const cols = line.length;
  for (let x = 0; x < cols; x++) {
    const c = line.getCell(x, cell);
    if (!c) continue;
    if (c.getWidth() === 0) continue;
    const chars = c.getChars();
    const ch = chars.length > 0 ? chars : " ";
    const s = styleForCell(c);
    if (currentStyle && styleEqual(currentStyle, s)) {
      currentText += ch;
    } else {
      if (currentStyle != null && currentText.length > 0) {
        runs.push(styleToRun(currentStyle, currentText));
      }
      currentStyle = s;
      currentText = ch;
    }
  }
  if (currentStyle != null && currentText.length > 0) {
    runs.push(styleToRun(currentStyle, currentText));
  }
  while (runs.length > 0) {
    const last = runs[runs.length - 1];
    const isDefault = styleIsDefault({
      fg: last.fg,
      bg: last.bg,
      bold: !!last.bold,
      italic: !!last.italic,
      underline: !!last.underline,
      dim: !!last.dim,
      strike: !!last.strike,
    });
    if (!isDefault) break;
    const trimmed = last.text.replace(/\s+$/, "");
    if (trimmed.length === last.text.length) break;
    if (trimmed.length === 0) {
      runs.pop();
    } else {
      runs[runs.length - 1] = { ...last, text: trimmed };
      break;
    }
  }
  return runs;
}

export function captureBufferSnapshot(
  terminal: Terminal,
  pixelWidth: number,
  fontSize: number,
): BufferSnapshot {
  const buf = terminal.buffer.active;
  const total = buf.length;
  const lines: ColoredLine[] = [];
  for (let i = 0; i < total; i++) lines.push(captureLine(terminal, i));
  const viewportTopIndex = buf.viewportY;
  const viewportBottomIndex = Math.min(
    total - 1,
    viewportTopIndex + terminal.rows - 1,
  );
  return {
    lines,
    viewportTopIndex,
    viewportBottomIndex,
    pageSize: terminal.rows,
    pixelWidth,
    fontSize,
    defaultFg: THEME.foreground,
    defaultBg: THEME.background,
  };
}
