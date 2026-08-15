const startInput = document.querySelector("#start-time");
const endInput = document.querySelector("#end-time");
const results = document.querySelector("#results");
const error = document.querySelector("#error");
const warning = document.querySelector("#warning");
const titleText = document.querySelector("#title-text");
const srStatus = document.querySelector("#sr-status");
const percentEl = document.querySelector("#percent");
const sceneEl = document.querySelector("#scene");
const riderEl = document.querySelector("#rider");
const fillEl = document.querySelector("#progress-fill");
const checkpointEls = [...document.querySelectorAll(".cp")];

// The shift model below is shared with the retro-terminal concept. Each concept
// stays dependency-free so it can be opened straight off disk, which means this
// logic is duplicated rather than imported — tests/verify-twinkle.mjs re-checks
// the same invariants here so the two cannot quietly drift apart.

const LONG_SHIFT_MINUTES = 16 * 60; // flag shifts longer than 16h as likely AM/PM typos
const PERCENT_HZ = 10; // only the big number ticks this fast; everything else stays at 1Hz

// Checkpoints the rider passes, and how far out they start eyeing the next one.
const CHECKPOINTS = [25, 50, 75];
const SPOT_WINDOW = 4;

const ERR_IDENTICAL = "clock in and clock out can't be the same time";
const ERR_INCOMPLETE = "please set both a clock in and a clock out time";
const ERR_CLOCK_CHANGE = "that time doesn't exist today — the clocks change overnight";

// Assigning textContent replaces the text node even when the string is
// unchanged, and that mutation is what a live region announces. #error is
// role="alert", so rewriting it every tick would re-announce it every tick.
function setText(el, text) {
  if (el.textContent !== text) el.textContent = text;
}

// A finished day shift stays on screen until midnight simply because the next
// one starts tomorrow. Give an overnight shift the same courtesy, otherwise it
// flips straight back to "not started" the moment it ends.
const POST_SHIFT_GRACE_MS = 6 * 60 * 60 * 1000;

// Storage throws (not just returns null) when cookies are blocked or the page
// is in a sandboxed iframe. Never let that take the whole page down.
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

// Same keys as the retro terminal, so times carry across both concepts.
restoreTime(startInput, "workday-start", "09:00");
restoreTime(endInput, "workday-end", "18:00");

const MESSAGES = [
  [0, "kickstand down, waiting on the shift"],
  [1, "wheels up — off we go"],
  [25, "first checkpoint behind us"],
  [50, "halfway. the legs are talking."],
  [75, "final stretch, mostly downhill"],
  [100, "home. park the bike."],
];

let lastMilestone = -1;
let cheerTimer = null;
let currentShift = null;
let lastPercentInt = null;
let lastPercentDec = null;

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

// RIDDEN floors while TO GO ceils, so the two always add up to the whole route
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

function progressForShift(shift, now) {
  const duration = shift.end - shift.start;
  const elapsed = now - shift.start;
  return Math.min(100, Math.max(0, (elapsed / duration) * 100));
}

// Floors rather than rounds, so nothing can read 100 before the shift has
// genuinely ended. Kept on one line: the whole number leads, the live decimals
// sit beside it smaller and dimmer so they never dominate.
function renderPercent(progress) {
  const formatted = (Math.floor(progress * 10000) / 10000).toFixed(4);
  const [whole, fraction] = formatted.split(".");
  if (whole !== lastPercentInt) {
    lastPercentInt = whole;
    percentEl.querySelector(".pct-int").textContent = whole;
  }
  if (fraction !== lastPercentDec) {
    lastPercentDec = fraction;
    percentEl.querySelector(".pct-dec").textContent = `.${fraction}`;
  }
}

// Is a checkpoint close enough ahead to be worth bracing for? This is what
// gives the rider an anticipation beat instead of only reacting after the fact.
function isApproachingCheckpoint(progress) {
  return CHECKPOINTS.some((cp) => progress < cp && progress >= cp - SPOT_WINDOW);
}

function moodFor(progress, notStarted, complete) {
  if (complete) return "done";
  if (notStarted) return "resting";
  if (isApproachingCheckpoint(progress)) return "spotting";
  if (progress < 25) return "eager";
  if (progress < 50) return "focused";
  if (progress < 75) return "tired";
  return "secondwind";
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
    setText(titleText, "cycling home");
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
    ? "made it home"
    : notStarted
      ? "not on the road yet"
      : "cycling home");

  // Typo detection is about what was typed, so measure the entered wall-clock
  // span. Elapsed time gains or loses an hour across a clock change, which
  // would flag — or miss — a shift purely because of the date it falls on.
  warning.hidden = shift.wallSpanMinutes <= LONG_SHIFT_MINUTES;
  setText(warning, `that's a ${formatDuration(shift.wallSpanMinutes * 60000)} route — check am/pm?`);

  const endTime = shift.end.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const startTime = shift.start.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const message = messageFor(progress);
  const wholePercent = Math.floor(progress);

  renderPercent(progress);
  riderEl.dataset.mood = moodFor(progress, notStarted, complete);
  // The rider's position along the road is the progress bar.
  sceneEl.style.setProperty("--p", progress.toFixed(2));

  for (const cp of checkpointEls) {
    cp.classList.toggle("passed", progress >= Number(cp.dataset.at));
  }

  setText(document.querySelector("#mood-note"), message);
  setText(document.querySelector("#end-note"), complete
    ? `home since ${endTime}`
    : notStarted
      ? `not started · you set off at ${startTime}`
      : `home by ${endTime}`);

  fillEl.style.width = `${progress}%`;
  document.querySelector("#progress-track").setAttribute("aria-valuenow", wholePercent);

  document.querySelector("#worked").textContent = formatDuration(worked);
  document.querySelector("#remaining").textContent = formatDuration(remaining, Math.ceil);
  document.querySelector("#duration").textContent = formatDuration(duration);

  const milestone = Math.floor(progress / 25) * 25;
  if (milestone !== lastMilestone) {
    const isFirstPaint = lastMilestone === -1;
    lastMilestone = milestone;
    srStatus.textContent = `${wholePercent} percent of the way home. ${message}`;
    // A hop for clearing a checkpoint, but not for merely loading the page
    // part-way through the route.
    if (!isFirstPaint) cheer();
  }
}

// Restarting a CSS animation needs the class off for a frame, otherwise
// re-adding it in the same tick does nothing.
function cheer() {
  clearTimeout(cheerTimer);
  riderEl.classList.remove("cheer");
  void riderEl.offsetWidth;
  riderEl.classList.add("cheer");
  cheerTimer = setTimeout(() => riderEl.classList.remove("cheer"), 850);
}

// Only the big number runs fast. Everything else stays on the 1Hz loop, so the
// higher rate costs one number redraw rather than a whole-page update.
function updateLivePercent() {
  if (!currentShift || document.hidden) return;
  const progress = progressForShift(currentShift, new Date());
  // Crossing 100 between 1Hz ticks would otherwise park the number at 100.0000%
  // while the rider, road and colours still read as in-progress. Hand the
  // crossing to the full update instead.
  if (progress >= 100 && !document.body.classList.contains("complete")) {
    update();
    return;
  }
  renderPercent(progress);
}

function saveTimes() {
  try {
    localStorage.setItem("workday-start", startInput.value);
    localStorage.setItem("workday-end", endInput.value);
  } catch {
    // Storage unavailable or full — the page still runs, it just won't
    // remember these times next visit.
  }
  update();
}

// Timers are throttled in background tabs and stop entirely while a device
// sleeps, so catch up as soon as the page is on screen again.
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) {
    update();
    updateLivePercent();
  }
});

startInput.addEventListener("input", saveTimes);
endInput.addEventListener("input", saveTimes);

update();
setInterval(update, 1000);
setInterval(updateLivePercent, 1000 / PERCENT_HZ);
