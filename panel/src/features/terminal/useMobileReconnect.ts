import { useEffect, useRef } from "react"
import {
  reportAutoBlankReopen,
  reportAutoReturnReopen,
} from "./terminalInstances"
import { WATCHDOG_STALE_MS } from "./watchdogConfig"

interface Options {
  ws: WebSocket | null
  getDims: () => { cols: number; rows: number }
  reopen: () => void
  /** True when xterm's buffer has nothing to repaint from — see viewportBlank.ts. */
  isViewportBlank: () => boolean
  /**
   * True when the session's process exited normally — see `hasExited` in
   * terminalInstances.ts. Supplied by the caller for the same reason
   * `isViewportBlank` is: this hook holds a ws, not a session id, and only the
   * cell knows which session the socket belongs to.
   */
  hasExited: () => boolean
}

// Re-exported from the leaf module that owns it: this hook was the original
// home, so existing importers keep working, while `terminalInstances` reads it
// straight from the leaf instead of importing this module back.
export { WATCHDOG_STALE_MS } from "./watchdogConfig"
const WATCHDOG_CHECK_MS = 2_000

export function useMobileReconnect({
  ws,
  getDims,
  reopen,
  isViewportBlank,
  hasExited,
}: Options): void {
  const lastMessageAtRef = useRef(Date.now())
  const getDimsRef = useRef(getDims)
  const reopenRef = useRef(reopen)
  const isViewportBlankRef = useRef(isViewportBlank)
  const hasExitedRef = useRef(hasExited)

  useEffect(() => {
    getDimsRef.current = getDims
    reopenRef.current = reopen
    isViewportBlankRef.current = isViewportBlank
    hasExitedRef.current = hasExited
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
      // Returning to the application is consent, and a socket that is CLOSED
      // (or absent) produces no output — there is nothing arriving for the
      // reopen to scroll away, so the blank gate was never protecting this
      // case. Ahead of the gate on purpose; see ADR 0017.
      // A cleanly exited shell presents the same CLOSED socket, and it is not
      // a fault to repair: `[Process exited]` is already on screen and the
      // server has dropped the session, so a reopen only buys a socket the
      // server closes again — plus an `auto-return` row for a return that
      // repaired nothing, in the log measuring exactly that gesture. Every
      // unasked-repair path excludes it the same way (`reconnectOnActivate`,
      // `disconnectedSessionIds`); see hasExited's own doc comment.
      if (!hasExitedRef.current() && (!ws || ws.readyState === WebSocket.CLOSED)) {
        // Reported before the reopen so the record describes the socket that
        // prompted it, and as `auto-return` rather than `auto-blank`: what is
        // on screen is incidental here, the return is the trigger.
        reportAutoReturnReopen(ws)
        reopenRef.current()
        return
      }
      // Everything still live enough to produce output keeps the old gate: a
      // repaint over content is the unasked interruption ADR 0010 rejected.
      // Left as it was, exit and all: the flag is set in the same breath that
      // writes `[Process exited]` into the buffer, so a viewport belonging to
      // an exited session is not blank and cannot reach this gate. A guard
      // here would be one nothing can exercise.
      if (!isViewportBlankRef.current()) return
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        // Blank, and there is no live socket to nudge over — rebuild it.
        // Reported before the reopen so the record describes the state that
        // prompted it; every path that reconnects without the user asking is
        // invisible in the log unless it says so.
        reportAutoBlankReopen(ws)
        reopenRef.current()
        return
      }
      // A nudge resizes the PTY twice so the TUI redraws from scratch — that
      // costs a visible flicker, so spend it only when the local repaint
      // (`terminal.refresh()` on the visibilitychange refit) cannot help
      // because the buffer itself came back empty.
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
        if (isViewportBlankRef.current()) {
          // The other unasked reopen — same reporting, same ordering.
          reportAutoBlankReopen(ws)
          reopenRef.current()
        }
      }
    }, WATCHDOG_CHECK_MS)
    return () => clearInterval(id)
  }, [ws])
}
