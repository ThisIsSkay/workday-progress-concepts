const startInput = document.querySelector("#start-time");
const endInput = document.querySelector("#end-time");
const results = document.querySelector("#results");
const error = document.querySelector("#error");
const warning = document.querySelector("#warning");
const titleText = document.querySelector("#title-text");
const srStatus = document.querySelector("#sr-status");

const LONG_SHIFT_MS = 16 * 60 * 60 * 1000; // flag shifts longer than 16h as likely AM/PM typos

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

startInput.value = readStored("workday-start", "09:00");
endInput.value = readStored("workday-end", "18:00");

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

function getShiftBounds(now) {
  const startMinutes = minutesFromTime(startInput.value);
  const endMinutes = minutesFromTime(endInput.value);
  if (startMinutes === null || endMinutes === null || startMinutes === endMinutes) return null;

  const start = new Date(now);
  start.setHours(Math.floor(startMinutes / 60), startMinutes % 60, 0, 0);
  const end = new Date(now);
  end.setHours(Math.floor(endMinutes / 60), endMinutes % 60, 0, 0);

  const isOvernight = endMinutes < startMinutes;
  if (isOvernight) end.setDate(end.getDate() + 1);

  if (isOvernight && now < start) {
    const previousStart = new Date(start);
    const previousEnd = new Date(end);
    previousStart.setDate(previousStart.getDate() - 1);
    previousEnd.setDate(previousEnd.getDate() - 1);
    if (now - previousEnd <= POST_SHIFT_GRACE_MS) return { start: previousStart, end: previousEnd };
  }

  return { start, end };
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

function update() {
  const now = new Date();
  const shift = getShiftBounds(now);
  error.hidden = Boolean(shift);
  results.hidden = !shift;
  if (!shift) {
    // A half-typed time is not the same mistake as two identical times.
    error.textContent = startInput.value && endInput.value
      ? "ERR_0x01: START AND END TIME MUST DIFFER."
      : "ERR_0x02: ENTER BOTH A CLOCK-IN AND A CLOCK-OUT TIME.";
    warning.hidden = true;
    document.body.classList.remove("complete");
    titleText.textContent = "WHEN CAN I LOG OFF";
    syncLayout();
    return;
  }

  const duration = shift.end - shift.start;
  const elapsed = now - shift.start;
  const progress = Math.min(100, Math.max(0, (elapsed / duration) * 100));
  const worked = Math.min(duration, Math.max(0, elapsed));
  const remaining = Math.min(duration, Math.max(0, shift.end - now));
  const notStarted = elapsed < 0;
  const complete = progress >= 100;

  document.body.classList.toggle("complete", complete);

  titleText.textContent = complete
    ? "YOU MAY LOG OFF NOW"
    : notStarted
      ? "NOT ON THE CLOCK YET"
      : "WHEN CAN I LOG OFF";

  warning.hidden = duration <= LONG_SHIFT_MS;
  warning.textContent = `WARN_0x02: SHIFT SPANS ${formatDuration(duration)}. CHECK AM/PM.`;

  const endTime = shift.end.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const startTime = shift.start.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

  const message = messageFor(progress);

  const wholePercent = Math.floor(progress);
  document.querySelector("#percent").textContent = `${(Math.floor(progress * 10) / 10).toFixed(1)}%`;
  document.querySelector("#end-note").textContent = complete
    ? `LOGGED OFF · SHIFT ENDED ${endTime}`
    : notStarted
      ? `SHIFT NOT STARTED · CLOCK-IN ${startTime}`
      : `FREEDOM ETA: ${endTime}`;
  document.querySelector("#message").textContent = message;
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
  if (!document.hidden) update();
});

startInput.addEventListener("input", saveTimes);
endInput.addEventListener("input", saveTimes);
update();
setInterval(update, 1000);
