const startInput = document.querySelector("#start-time");
const endInput = document.querySelector("#end-time");
const results = document.querySelector("#results");
const error = document.querySelector("#error");
const warning = document.querySelector("#warning");
const titleText = document.querySelector("#title-text");
const srStatus = document.querySelector("#sr-status");
const percentText = document.querySelector("#percent");
const refreshButtons = [...document.querySelectorAll("[data-refresh-hz]")];

const LONG_SHIFT_MINUTES = 16 * 60; // flag shifts longer than 16h as likely AM/PM typos
const REFRESH_RATES = [1, 5, 10, 30];
const DEFAULT_REFRESH_HZ = 1;

const ERR_IDENTICAL = "ERR_0x01: START AND END TIME MUST DIFFER.";
const ERR_INCOMPLETE = "ERR_0x02: ENTER BOTH A CLOCK-IN AND A CLOCK-OUT TIME.";
const ERR_CLOCK_CHANGE = "ERR_0x03: THAT LOCAL TIME DOES NOT EXIST — DAYLIGHT SAVING CHANGE.";

// Assigning textContent replaces the text node even when the string is
// unchanged, and that mutation is what a live region announces. #error is
// role="alert", so rewriting it on every 1Hz tick re-announces it every second.
function setText(el, text) {
  if (el.textContent !== text) el.textContent = text;
}

// A finished day shift stays on screen until midnight simply because the next
// one starts tomorrow. Give an overnight shift the same courtesy, otherwise it
// flips to "NOT ON THE CLOCK YET" the moment it ends and the log-off screen is
// never actually seen.
const POST_SHIFT_GRACE_MS = 6 * 60 * 60 * 1000;

// Storage throws (not just returns null) when cookies are blocked or the page
// is in a sandboxed iframe. Never let that take the whole terminal down.
function readStored(key, fallback) {
  try {
    return localStorage.getItem(key) || fallback;
  } catch {
    return fallback;
  }
}

// A stored value the control rejects is sanitised to "" (anything malformed) or
// kept but silently truncated by the parser (a value carrying seconds, which
// the minute-granular UI would misread). Fall back rather than trust it.
function restoreTime(input, key, fallback) {
  input.value = readStored(key, fallback);
  if (!input.value || !input.validity.valid) input.value = fallback;
}

restoreTime(startInput, "workday-start", "09:00");
restoreTime(endInput, "workday-end", "18:00");

const storedRefreshHz = Number(readStored("workday-refresh-hz", String(DEFAULT_REFRESH_HZ)));
let refreshHz = REFRESH_RATES.includes(storedRefreshHz) ? storedRefreshHz : DEFAULT_REFRESH_HZ;
let percentTimer = null;
let currentShift = null;
let lastPercentHtml = "";

const MESSAGES = [
  [0, "BOOT SEQUENCE INITIATED…"],
  [1, "COMPILING TASKS.EXE…"],
  [25, "BUFFER 25% FULL. NO ERRORS DETECTED (YET)."],
  [50, "HALFWAY TO SHUTDOWN. SUSPICIOUSLY STABLE."],
  [75, "FINAL SECTOR. PREPARE FOR LOGOFF."],
  [100, "SHIFT TERMINATED. LOG OFF AUTHORIZED — GO HOME."],
];

let lastMilestone = -1;

function minutesFromTime(value) {
  if (!value) return null;
  const [hours, minutes] = value.split(":").map(Number);
  if (Number.isNaN(hours) || Number.isNaN(minutes)) return null;
  return hours * 60 + minutes;
}

// setHours() resolves a local time that does not exist — the hour skipped on a
// spring-forward morning — by rolling it forward, so an entered 02:30 quietly
// becomes 03:30. That reports a clock-in nobody typed, and if both ends land on
// the same instant the shift collapses to zero length and progress goes NaN.
// Verify the wall clock we asked for is the wall clock we got.
function validateShift(shift, startMinutes, endMinutes, wallSpanMinutes) {
  const wallMinutes = (date) => date.getHours() * 60 + date.getMinutes();
  const intact = wallMinutes(shift.start) === startMinutes && wallMinutes(shift.end) === endMinutes;
  if (!intact || shift.end <= shift.start) return { error: ERR_CLOCK_CHANGE };
  return { ...shift, wallSpanMinutes };
}

function getShiftBounds(now) {
  const startMinutes = minutesFromTime(startInput.value);
  const endMinutes = minutesFromTime(endInput.value);
  if (startMinutes === null || endMinutes === null) return { error: ERR_INCOMPLETE };
  if (startMinutes === endMinutes) return { error: ERR_IDENTICAL };

  // What the user typed, independent of any clock change the shift may cross.
  const wallSpanMinutes = (endMinutes - startMinutes + 1440) % 1440;

  const start = new Date(now);
  start.setHours(Math.floor(startMinutes / 60), startMinutes % 60, 0, 0);
  const end = new Date(now);
  end.setHours(Math.floor(endMinutes / 60), endMinutes % 60, 0, 0);

  const isOvernight = endMinutes < startMinutes;

  // Resolve the just-finished shift *before* rolling `end` forward a day.
  // Rolling first and subtracting a day afterwards inherits tomorrow's DST
  // adjustment, which moves an end time that never crossed a clock change.
  if (isOvernight && now < start) {
    const previousStart = new Date(start);
    previousStart.setDate(previousStart.getDate() - 1);
    const previousEnd = new Date(end);
    if (now - previousEnd <= POST_SHIFT_GRACE_MS) {
      return validateShift({ start: previousStart, end: previousEnd }, startMinutes, endMinutes, wallSpanMinutes);
    }
  }

  if (isOvernight) end.setDate(end.getDate() + 1);

  return validateShift({ start, end }, startMinutes, endMinutes, wallSpanMinutes);
}

// WORKED floors while REMAINING ceils, so the two always add up to TOTAL SHIFT
// instead of reading a minute short for most of the day.
function formatDuration(milliseconds, round = Math.floor) {
  const totalMinutes = Math.max(0, round(milliseconds / 60000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours}h ${String(minutes).padStart(2, "0")}m`;
}

function messageFor(progress) {
  let text = MESSAGES[0][1];
  for (const [threshold, msg] of MESSAGES) {
    if (progress >= threshold) text = msg;
  }
  return text;
}

// Every readout floors rather than rounds: rounding let the bar fill up and the
// counter read 100 several minutes before the shift actually ended.
function asciiBar(progress, width) {
  const filled = Math.floor((progress / 100) * width);
  return `[${"#".repeat(filled)}${"-".repeat(width - filled)}] ${String(Math.floor(progress)).padStart(3, "0")}%`;
}

function progressForShift(shift, now) {
  const duration = shift.end - shift.start;
  const elapsed = now - shift.start;
  return Math.min(100, Math.max(0, (elapsed / duration) * 100));
}

function renderPercent(progress) {
  // Floor to thousandths so the readout can visibly move without ever showing
  // 100.000% before the shift has actually ended. The whole number stays large,
  // the live .000 sits underneath it, and the percent sign spans the stack.
  const formatted = (Math.floor(progress * 1000) / 1000).toFixed(3);
  const [whole, fraction] = formatted.split(".");
  const html = `<span class="percent-whole">${whole}</span><span class="percent-fraction">.${fraction}</span><span class="percent-sign">%</span>`;
  if (html === lastPercentHtml) return;
  lastPercentHtml = html;
  percentText.innerHTML = html;
}

// The rest of the terminal remains on its original 1Hz update loop. Higher
// refresh rates only redraw the large percentage, keeping 30Hz deliberately
// cheap even on modest hardware.
function updateLivePercent() {
  if (!currentShift || document.hidden) return;
  renderPercent(progressForShift(currentShift, new Date()));
}

function restartPercentTicker() {
  if (percentTimer !== null) {
    clearInterval(percentTimer);
    percentTimer = null;
  }
  if (refreshHz > 1) {
    percentTimer = setInterval(updateLivePercent, 1000 / refreshHz);
  }
}

function syncRefreshControls() {
  for (const button of refreshButtons) {
    button.setAttribute("aria-pressed", String(Number(button.dataset.refreshHz) === refreshHz));
  }
}

function setRefreshHz(nextHz) {
  if (!REFRESH_RATES.includes(nextHz) || nextHz === refreshHz) return;
  refreshHz = nextHz;
  try {
    localStorage.setItem("workday-refresh-hz", String(refreshHz));
  } catch {
    // A blocked/full store should not stop the control from working this session.
  }
  syncRefreshControls();
  restartPercentTicker();
  updateLivePercent();
}

function update() {
  const now = new Date();
  const shift = getShiftBounds(now);
  const failed = Boolean(shift.error);
  error.hidden = !failed;
  results.hidden = failed;
  if (failed) {
    currentShift = null;
    setText(error, shift.error);
    warning.hidden = true;
    document.body.classList.remove("complete");
    setText(titleText, "WHEN CAN I LOG OFF");
    syncLayout();
    return;
  }

  currentShift = shift;
  const duration = shift.end - shift.start;
  const elapsed = now - shift.start;
  const progress = progressForShift(shift, now);
  const worked = Math.min(duration, Math.max(0, elapsed));
  const remaining = Math.min(duration, Math.max(0, shift.end - now));
  const notStarted = elapsed < 0;
  const complete = progress >= 100;

  document.body.classList.toggle("complete", complete);

  setText(titleText, complete
    ? "YOU MAY LOG OFF NOW"
    : notStarted
      ? "NOT ON THE CLOCK YET"
      : "WHEN CAN I LOG OFF");

  // Typo detection is about what was typed, so measure the entered wall-clock
  // span. Elapsed time gains or loses an hour across a clock change, which
  // would flag — or miss — a shift purely because of the date it falls on.
  warning.hidden = shift.wallSpanMinutes <= LONG_SHIFT_MINUTES;
  setText(warning, `WARN_0x02: SHIFT SPANS ${formatDuration(shift.wallSpanMinutes * 60000)}. CHECK AM/PM.`);

  const endTime = shift.end.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const startTime = shift.start.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

  const message = messageFor(progress);

  const wholePercent = Math.floor(progress);
  renderPercent(progress);
  setText(document.querySelector("#end-note"), complete
    ? `LOGGED OFF · SHIFT ENDED ${endTime}`
    : notStarted
      ? `SHIFT NOT STARTED · CLOCK-IN ${startTime}`
      : `FREEDOM ETA: ${endTime}`);
  setText(document.querySelector("#message"), message);
  document.querySelector("#progress-count").textContent = `${String(wholePercent).padStart(3, "0")}/100`;
  document.querySelector("#ascii-bar").textContent = asciiBar(progress, 24);
  document.querySelector("#progress-track").setAttribute("aria-valuenow", wholePercent);
  document.querySelector("#worked").textContent = formatDuration(worked);
  document.querySelector("#remaining").textContent = formatDuration(remaining, Math.ceil);
  document.querySelector("#duration").textContent = formatDuration(duration);

  const milestone = Math.floor(progress / 25) * 25;
  if (milestone !== lastMilestone) {
    lastMilestone = milestone;
    srStatus.textContent = `${wholePercent} percent complete. ${message}`;
  }

  syncLayout();
}

function saveTimes() {
  try {
    localStorage.setItem("workday-start", startInput.value);
    localStorage.setItem("workday-end", endInput.value);
  } catch {
    // Storage unavailable or full — the terminal still runs, it just won't
    // remember these times next visit.
  }
  update();
}

// Shrink the whole terminal to fit the viewport so it never needs scrolling
// on short screens (e.g. 720p laptops). Skipped on narrow phones, where
// scrolling is natural and shrink-to-fit would make text too small.
const card = document.querySelector(".crt");
function fitToViewport() {
  card.style.zoom = "1";
  if (window.innerWidth < 700) return;
  // The gutter is main's padding, which is a clamp() and so changes with the
  // viewport. A hard-coded guess understated it and left the card overflowing
  // on exactly the 720p screens this exists for, so measure it instead.
  const shell = getComputedStyle(card.parentElement);
  const slack = 1; // absorbs sub-pixel rounding
  const availY = window.innerHeight - parseFloat(shell.paddingTop) - parseFloat(shell.paddingBottom) - slack;
  const availX = window.innerWidth - parseFloat(shell.paddingLeft) - parseFloat(shell.paddingRight) - slack;

  // The card's padding and type are sized in vh/vw, which grow relative to the
  // card as it shrinks, so a single pass always lands short. Converge instead.
  let scale = 1;
  for (let i = 0; i < 5; i++) {
    const box = card.getBoundingClientRect();
    if (!box.height || !box.width) break;
    const next = Math.min(1, scale * Math.min(availY / box.height, availX / box.width));
    if (Math.abs(next - scale) < 0.001) break;
    scale = next;
    card.style.zoom = scale;
  }
}

// Measuring the card forces a reflow, so only re-fit when something that can
// change its height changed. The ticking numbers never do.
let lastLayoutKey = "";
function syncLayout() {
  const key = `${results.hidden}|${error.hidden}|${warning.hidden}|${titleText.textContent}`;
  if (key === lastLayoutKey) return;
  lastLayoutKey = key;
  fitToViewport();
}

let resizeQueued = false;
window.addEventListener("resize", () => {
  if (resizeQueued) return;
  resizeQueued = true;
  requestAnimationFrame(() => {
    resizeQueued = false;
    fitToViewport();
  });
});

// Timers are throttled in background tabs and stop entirely while a device
// sleeps, so catch up as soon as the terminal is on screen again.
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) {
    update();
    updateLivePercent();
  }
});

startInput.addEventListener("input", saveTimes);
endInput.addEventListener("input", saveTimes);
for (const button of refreshButtons) {
  button.addEventListener("click", () => setRefreshHz(Number(button.dataset.refreshHz)));
}

syncRefreshControls();
update();
restartPercentTicker();
setInterval(update, 1000);
