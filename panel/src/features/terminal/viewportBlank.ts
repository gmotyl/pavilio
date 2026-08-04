interface BufferLike {
  rows: number;
  buffer: {
    active: {
      viewportY: number;
      getLine: (index: number) => { translateToString: (trim?: boolean) => string } | undefined;
    };
  };
}

/**
 * True when every row currently in the viewport is empty — i.e. xterm's own
 * buffer holds nothing to repaint from, so a local `terminal.refresh()` cannot
 * bring the screen back and only the PTY can. Distinguishes "the canvas went
 * stale" (fixable locally, no flicker) from "there is nothing to draw".
 */
export function viewportLooksBlank(terminal: BufferLike): boolean {
  const buf = terminal.buffer.active;
  for (let row = 0; row < terminal.rows; row++) {
    const line = buf.getLine(buf.viewportY + row);
    if (line && line.translateToString(true).trim() !== "") return false;
  }
  return true;
}
