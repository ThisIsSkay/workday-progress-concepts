# Workday Progress Concepts

**▶ Live demo:** https://thisisskay.github.io/workday-progress-concepts/retro-terminal/

Small, self-contained web toys that answer one question: **when can I log off?**

## Concepts

### `retro-terminal/` — WORKDAY.SYS

A green-phosphor CRT terminal that tracks your shift in real time. Enter your
clock-in and clock-out times and watch the day tick toward 100%.

- **Live progress** — big percent-complete, ASCII progress bar, and a "FREEDOM ETA".
- **Worked / remaining / total** shift stats, updated every second.
- **Overnight shifts** handled correctly (e.g. 22:00 → 06:00).
- **Long-shift warning** — flags likely AM/PM typos (a shift over 16h).
- **State-aware headline** — `NOT ON THE CLOCK YET` before your shift,
  `WHEN CAN I LOG OFF` during, and a red `YOU MAY LOG OFF NOW` when you're done.
- **Remembers your times** in the browser, so you can resume tomorrow.
- **Responsive** — scales to fit on 720p laptops, phones, and large displays.
- **Private** — no data leaves the browser; no build step, no dependencies.

**Run it:** open `retro-terminal/index.html` in any modern browser.

## Tech

Plain HTML, CSS, and JavaScript. No frameworks, no build tooling.

## Repository

https://github.com/ThisIsSkay/workday-progress-concepts
