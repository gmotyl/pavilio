import { useEffect, useRef } from "react"

interface Options {
  ws: WebSocket | null
  getDims: () => { cols: number; rows: number }
  reopen: () => void
  /** True when xterm's buffer has nothing to repaint from — see viewportBlank.ts. */
  isViewportBlank: () => boolean
}

export const WATCHDOG_STALE_MS = 25_000
const WATCHDOG_CHECK_MS = 2_000

export function useMobileReconnect({
  ws,
  getDims,
  reopen,
  isViewportBlank,
}: Options): void {
  const lastMessageAtRef = useRef(Date.now())
  const getDimsRef = useRef(getDims)
  const reopenRef = useRef(reopen)
  const isViewportBlankRef = useRef(isViewportBlank)

  useEffect(() => {
    getDimsRef.current = getDims
    reopenRef.current = reopen
    isViewportBlankRef.current = isViewportBlank
  })

  useEffect(() => {
    if (!ws) return
    // Reset the watchdog clock whenever a new ws appears, so slow cold-starts
    // or reopen()s don't trip the staleness check before the first message.
    lastMessageAtRef.current = Date.now()
    const mark = () => {
      lastMessageAtRef.current = Date.now()
    }
    ws.addEventListener("message", mark)
    return () => ws.removeEventListener("message", mark)
  }, [ws])

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== "visible") return
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        reopenRef.current()
        return
      }
      // A nudge resizes the PTY twice so the TUI redraws from scratch — that
      // costs a visible flicker, so spend it only when the local repaint
      // (`terminal.refresh()` on the visibilitychange refit) cannot help
      // because the buffer itself came back empty.
      if (!isViewportBlankRef.current()) return
      const { cols, rows } = getDimsRef.current()
      ws.send(JSON.stringify({ type: "mobile-nudge", cols, rows }))
      lastMessageAtRef.current = Date.now()
    }
    document.addEventListener("visibilitychange", onVisible)
    return () => document.removeEventListener("visibilitychange", onVisible)
  }, [ws])

  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState !== "visible") return
      // Only evaluate staleness once the ws is actually open; otherwise we'd
      // fire reopen() during cold-start connection.
      if (!ws || ws.readyState !== WebSocket.OPEN) return
      if (Date.now() - lastMessageAtRef.current > WATCHDOG_STALE_MS) {
        lastMessageAtRef.current = Date.now()
        // Only auto-reopen when there is nothing on screen to lose. Reopening
        // over live content flickers and interrupts work; when content is
        // present we stay silent and leave recovery to the manual Reconnect
        // button (see reconnectSession in terminalInstances.ts).
        if (isViewportBlankRef.current()) reopenRef.current()
      }
    }, WATCHDOG_CHECK_MS)
    return () => clearInterval(id)
  }, [ws])
}
