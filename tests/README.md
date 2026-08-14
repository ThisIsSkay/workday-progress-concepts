# Tests

Browser checks for `retro-terminal/`, driven by Playwright against Chromium.
Every suite fakes the clock, so shift boundaries and daylight saving
transitions are exercised deterministically rather than depending on when the
tests happen to run.

```
./tests/run.sh
```

Exits non-zero if any suite fails. Set `PORT` to use a different port, or
`BASE_URL` to point the suites at an already-running server.

| Suite | Covers |
| --- | --- |
| `verify.mjs` | Core behaviour: overnight shifts, the completed-state grace window, no readout reaching 100 early, and selectable/persisted 1/5/10/30 Hz percentage refresh |
| `verify-dst.mjs` | Daylight saving: the nonexistent hour on spring-forward, the overnight grace window inheriting a DST adjustment, the entered-span basis for the long-shift warning, and validation of restored values. Runs under `America/New_York` |
| `verify-storage.mjs` | The page stays usable where `localStorage` throws (blocked cookies, sandboxed iframe) |
| `sums.mjs` | `WORKED + REMAINING` always equals `TOTAL SHIFT` |
| `sweep.mjs` | Shrink-to-fit leaves no vertical overflow across 13 viewport sizes |

## Dates these rely on

US daylight saving in 2026: forward **8 March**, back **1 November**. The DST
suite pins absolute UTC instants and sets the browser timezone explicitly, so
it does not depend on the host machine's zone.

## Adding a case

The suites are plain scripts with a local `check(label, actual, expected)`
helper; `expected` may be a value or a predicate. Prefer asserting on rendered
text through `page.evaluate`, so a test fails when the user-visible output is
wrong rather than when an internal detail changes.
