# Workday Progress Concepts

A set of small, self-contained web pages that show how far through a work shift
you currently are. Each concept presents the same underlying data — elapsed
time, remaining time, and percentage complete — in a different visual style.

Every concept is plain HTML, CSS, and JavaScript in a single directory, with no
build step, no dependencies, and no network calls.

**Live demos**

- [retro-terminal](https://thisisskay.github.io/workday-progress-concepts/retro-terminal/) — green phosphor CRT
- [twinkle-twinkle](https://thisisskay.github.io/workday-progress-concepts/twinkle-twinkle/) — Courier Cat, a pastel blind-box ride home

## Concepts

### `retro-terminal/` — WORKDAY.SYS

A green-phosphor CRT terminal that tracks a shift in real time. You enter a
clock-in and clock-out time; shift state and stats update once per second, while
the large percentage can be refreshed at 1, 5, 10, or 30 Hz.

**Display**

| Element | Description |
| --- | --- |
| Headline | Reflects shift state: `NOT ON THE CLOCK YET`, `WHEN CAN I LOG OFF`, or `YOU MAY LOG OFF NOW` |
| Percentage | Progress through the shift, to four decimal places, with a user-selectable 1/5/10/30 Hz refresh rate |
| ASCII bar | `[####----]` progress bar with an integer percentage, sized to span its track |
| End note | Clock-in time, projected finish time, or the time the shift ended |
| Stats | Worked, remaining, and total shift duration |
| Status line | A message that changes as the shift passes 1%, 25%, 50%, 75%, and 100% |

When the shift completes, the entire terminal switches from green to red.

**Behaviour**

- **Overnight shifts** are handled by comparing the two times. If the clock-out
  time is earlier than the clock-in time (for example `22:00` → `06:00`), the
  shift is treated as ending the following day.
- **Daylight saving changes** are respected. Worked and remaining time reflect
  real elapsed time, so a shift crossing a clock change is an hour shorter or
  longer than its entered span. A clock-in or clock-out falling in the hour a
  spring-forward skips does not exist locally, and is reported rather than
  silently moved to a time you did not enter.
- **A finished shift stays on screen.** A day shift remains in its completed
  state until midnight. An overnight shift is held in the completed state for
  six hours after it ends, so the log-off screen is actually visible rather than
  disappearing the moment the shift finishes.
- **Progress readouts always round down.** The bar, the counter, and the
  percentage only reach 100 when the shift has genuinely ended, rather than
  appearing complete in the final minutes.
- **Refresh rate is user-selectable.** The footer offers 1, 5, 10, and 30 Hz.
  Only the large percentage uses the faster ticker; all other calculations stay
  on the original 1 Hz loop. The selected rate is remembered in `localStorage`.
- **Worked and remaining always sum to the total**, by flooring the former and
  rounding the latter up.
- **Long shifts are flagged.** An entered span over 16 hours shows a warning,
  since it usually means an AM/PM mix-up. This measures the times as typed, not
  elapsed time, so a clock change cannot suppress or trigger the warning.
- **Times are remembered** in `localStorage`, and are validated on restore so a
  corrupt or stale value falls back to the default rather than opening the page
  in an error state. If storage is unavailable, the page still works — it just
  will not restore your times or refresh-rate preference next visit.
- **The layout scales to fit.** On short screens the terminal shrinks so it fits
  without scrolling. Below 700px wide it renders at full size and scrolls
  normally.

### `twinkle-twinkle/` — Courier Cat

A courier cat cycling home along a night-time street, where the distance it has
covered *is* how much of your shift has passed. It sets off at clock-in and
rolls under the `HOME` sign at 100%. Styled after designer blind-box toys —
pastel palette, chunky rounded shapes, glossy cream card.

> The folder keeps its original name so the published URL stays stable. The
> concept inside it is the courier cat.

**Display**

| Element | Description |
| --- | --- |
| The road | The cat's position along it is the percentage. Parallax skyline, hills and street scroll behind it |
| Checkpoints | Flags at 25/50/75 that get knocked back and turn green as they are passed |
| Finish | A striped post and `HOME` sign the cat rolls up to at 100% |
| Percentage | Four decimal places, whole number large with the live decimals smaller and dimmer beside it |
| Route line | The rhyme of the ride — a status line that changes as the day goes |
| Stats | Ridden, to go, and the whole route |

**The cat's face**

Its expression tracks the ride, and changes *before* each checkpoint rather than
only after:

| Mood | When |
| --- | --- |
| Resting | Before clock-in — eyes shut, tail curled |
| Eager | Just set off — bright eyes, grin, tail wagging |
| Focused | Settled into the ride |
| Spotting | Within 4% of a checkpoint — sparkling eyes, blush, speed lines |
| Tired | Past half way — strained eyes, panting, drooping ear, effort puffs |
| Second wind | Final stretch — determined brows, tail streaming back |
| Home | Finished — happy eyes, blush, confetti |

Ears and tail carry the mood too, so it is readable before the face is even
legible at size. Wheels and pedals turn, the cat bobs as it rides, and it hops
each time a checkpoint is cleared. The sky warms toward dusk as the shift ends.

**Shared behaviour**

Uses the same shift model as the retro terminal — overnight shifts, the
completed-state grace window, daylight-saving validation, floor-not-round
progress, and the entered-span basis for the long-shift warning. Clock-in and
clock-out times are stored under the same keys, so both concepts stay in sync.

Each concept keeps its own copy of that logic rather than importing a shared
module, so it can still be opened straight off disk. `tests/verify-twinkle.mjs`
re-checks the same invariants here, so the two copies cannot quietly drift.

All motion is CSS on `transform` and `opacity`, so it stays on the compositor —
only the percentage runs faster than once a second (10 Hz). Everything in the
scene is `aria-hidden` and says nothing the text does not. Under
`prefers-reduced-motion: reduce` every animation stops, and the effects that
exist only as motion — effort puffs, speed lines, confetti — are dropped rather
than frozen in place.

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

twinkle-twinkle/
  index.html    Markup, inline SVG cat-and-bicycle rig
  styles.css    Pastel palette, parallax scene, cat moods, animation
  script.js     Shift calculation, rider position, mood and checkpoints

tests/          Browser checks for both concepts — see tests/README.md
```

## Browser support

Any current version of Chrome, Edge, Firefox, or Safari. The pages use
`<input type="time">`, CSS custom properties, `clamp()`, and CSS `zoom`. There
are no polyfills and no transpilation step.

## Accessibility

- The progress bar exposes `role="progressbar"` with a live `aria-valuenow`.
- Progress milestones are announced to screen readers through a polite live
  region, rather than on every percentage refresh tick.
- The refresh-rate controls are native buttons in a labelled group and expose
  the selected setting with `aria-pressed`.
- Validation errors use `role="alert"`; the long-shift warning uses
  `role="status"`. Both are only rewritten when their text actually changes, so
  a live region is not re-announced on every one-second tick.
- Text meets the WCAG 2.2 AA contrast minimum of 4.5:1 against the terminal
  background, in both the running and completed colour schemes.
- The blinking cursor is disabled under `prefers-reduced-motion`, and dim text
  is brightened further under `prefers-contrast: more`.

## Privacy

Everything runs in the browser. The only data stored is your clock-in and
clock-out time plus the selected percentage refresh rate, kept in `localStorage`
on your own device. There is no analytics, no tracking, and no server component.

## Adding a concept

Create a directory at the repository root containing a self-contained
`index.html` plus any assets it needs, then add a section for it above. Keeping
each concept dependency-free means it can be opened directly from disk and
published as a static page without any tooling.

## Repository

https://github.com/ThisIsSkay/workday-progress-concepts
