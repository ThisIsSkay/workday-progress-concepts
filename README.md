# Workday Progress Concepts

A set of small, self-contained web pages that show how far through a work shift
you currently are. Each concept presents the same underlying data — elapsed
time, remaining time, and percentage complete — in a different visual style.

Every concept is plain HTML, CSS, and JavaScript in a single directory, with no
build step, no dependencies, and no network calls.

**Live demo:** https://thisisskay.github.io/workday-progress-concepts/retro-terminal/

## Concepts

### `retro-terminal/` — WORKDAY.SYS

A green-phosphor CRT terminal that tracks a shift in real time. You enter a
clock-in and clock-out time; the display updates once per second.

**Display**

| Element | Description |
| --- | --- |
| Headline | Reflects shift state: `NOT ON THE CLOCK YET`, `WHEN CAN I LOG OFF`, or `YOU MAY LOG OFF NOW` |
| Percentage | Progress through the shift, to one decimal place |
| ASCII bar | 24-cell `[####----]` progress bar with an integer percentage |
| End note | Clock-in time, projected finish time, or the time the shift ended |
| Stats | Worked, remaining, and total shift duration |
| Status line | A message that changes as the shift passes 1%, 25%, 50%, 75%, and 100% |

When the shift completes, the entire terminal switches from green to red.

**Behaviour**

- **Overnight shifts** are handled by comparing the two times. If the clock-out
  time is earlier than the clock-in time (for example `22:00` → `06:00`), the
  shift is treated as ending the following day.
- **A finished shift stays on screen.** A day shift remains in its completed
  state until midnight. An overnight shift is held in the completed state for
  six hours after it ends, so the log-off screen is actually visible rather than
  disappearing the moment the shift finishes.
- **Progress readouts always round down.** The bar, the counter, and the
  percentage only reach 100 when the shift has genuinely ended, rather than
  appearing complete in the final minutes.
- **Worked and remaining always sum to the total**, by flooring the former and
  rounding the latter up.
- **Long shifts are flagged.** Anything over 16 hours shows a warning, since it
  usually means an AM/PM mix-up.
- **Times are remembered** in `localStorage`. If storage is unavailable, the
  page still works — it just will not restore your times next visit.
- **The layout scales to fit.** On short screens the terminal shrinks so it fits
  without scrolling. Below 700px wide it renders at full size and scrolls
  normally.

## Running locally

Open the concept's `index.html` directly:

```
open retro-terminal/index.html
```

Or serve the directory, which is closer to how the demo is hosted and avoids
browser restrictions on local files:

```
npx http-server retro-terminal -p 8080
```

Then visit http://localhost:8080.

## Project layout

```
retro-terminal/
  index.html    Markup and static content
  styles.css    CRT styling, responsive rules, completed-shift theme
  script.js     Shift calculation, rendering, persistence, layout fitting
```

## Browser support

Any current version of Chrome, Edge, Firefox, or Safari. The pages use
`<input type="time">`, CSS custom properties, `clamp()`, and CSS `zoom`. There
are no polyfills and no transpilation step.

## Accessibility

- The progress bar exposes `role="progressbar"` with a live `aria-valuenow`.
- Progress milestones are announced to screen readers through a polite live
  region, rather than on every one-second tick.
- Validation errors use `role="alert"`; the long-shift warning uses
  `role="status"`.
- The blinking cursor is disabled under `prefers-reduced-motion`, and dim text
  is brightened under `prefers-contrast: more`.

## Privacy

Everything runs in the browser. The only data stored is your clock-in and
clock-out time, kept in `localStorage` on your own device. There is no
analytics, no tracking, and no server component.

## Adding a concept

Create a directory at the repository root containing a self-contained
`index.html` plus any assets it needs, then add a section for it above. Keeping
each concept dependency-free means it can be opened directly from disk and
published as a static page without any tooling.

## Repository

https://github.com/ThisIsSkay/workday-progress-concepts
