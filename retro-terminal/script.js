const startInput = document.querySelector("#start-time");
const endInput = document.querySelector("#end-time");
const results = document.querySelector("#results");
const error = document.querySelector("#error");
const warning = document.querySelector("#warning");
const titleText = document.querySelector("#title-text");
const srStatus = document.querySelector("#sr-status");

const LONG_SHIFT_MS = 16 * 60 * 60 * 1000; // flag shifts longer than 16h as likely AM/PM typos

startInput.value = localStorage.getItem("workday-start") || "09:00";
endInput.value = localStorage.getItem("workday-end") || "18:00";

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
    if (now <= previousEnd) return { start: previousStart, end: previousEnd };
  }

  return { start, end };
}

function formatDuration(milliseconds) {
  const totalMinutes = Math.max(0, Math.floor(milliseconds / 60000));
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

function asciiBar(progress, width) {
  const filled = Math.round((progress / 100) * width);
  return `[${"#".repeat(filled)}${"-".repeat(width - filled)}] ${String(Math.round(progress)).padStart(3, "0")}%`;
}

function update() {
  const now = new Date();
  const shift = getShiftBounds(now);
  error.hidden = Boolean(shift);
  results.hidden = !shift;
  if (!shift) {
    warning.hidden = true;
    document.body.classList.remove("complete");
    titleText.textContent = "WHEN CAN I LOG OFF";
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

  document.querySelector("#percent").textContent = `${progress.toFixed(1)}%`;
  document.querySelector("#end-note").textContent = complete
    ? `LOGGED OFF · SHIFT ENDED ${endTime}`
    : notStarted
      ? `SHIFT NOT STARTED · CLOCK-IN ${startTime}`
      : `FREEDOM ETA: ${endTime}`;
  document.querySelector("#message").textContent = message;
  document.querySelector("#progress-count").textContent = `${String(Math.round(progress)).padStart(3, "0")}/100`;
  document.querySelector("#ascii-bar").textContent = asciiBar(progress, 24);
  document.querySelector("#progress-track").setAttribute("aria-valuenow", Math.round(progress));
  document.querySelector("#worked").textContent = formatDuration(worked);
  document.querySelector("#remaining").textContent = formatDuration(remaining);
  document.querySelector("#duration").textContent = formatDuration(duration);

  const milestone = Math.floor(progress / 25) * 25;
  if (milestone !== lastMilestone) {
    lastMilestone = milestone;
    srStatus.textContent = `${Math.round(progress)} percent complete. ${message}`;
  }
}

function saveTimes() {
  localStorage.setItem("workday-start", startInput.value);
  localStorage.setItem("workday-end", endInput.value);
  update();
}

// Shrink the whole terminal to fit the viewport so it never needs scrolling
// on short screens (e.g. 720p laptops). Skipped on narrow phones, where
// scrolling is natural and shrink-to-fit would make text too small.
const card = document.querySelector(".crt");
let appliedZoom = -1;
function fitToViewport() {
  card.style.zoom = "1";
  if (window.innerWidth < 700) {
    appliedZoom = 1;
    return;
  }
  const pad = 28; // breathing room around the card
  const scale = Math.min(
    1,
    (window.innerHeight - pad) / card.offsetHeight,
    (window.innerWidth - pad) / card.offsetWidth,
  );
  card.style.zoom = scale;
  appliedZoom = scale;
}

startInput.addEventListener("input", saveTimes);
endInput.addEventListener("input", saveTimes);
window.addEventListener("resize", fitToViewport);
update();
fitToViewport();
setInterval(() => {
  update();
  fitToViewport();
}, 1000);
