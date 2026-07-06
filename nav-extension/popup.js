/* Popup: start/stop the navigation loop and mirror the worker's status. */

const statusEl = document.getElementById("status");
const startBtn = document.getElementById("start");
const stopBtn = document.getElementById("stop");
const runningTagEl = document.getElementById("running-tag");

// Show the loaded build's version (from the manifest, so it always reflects
// whatever the auto-reloader actually has loaded).
document.getElementById("version").textContent = `v${chrome.runtime.getManifest().version}`;

function setStatus(text) {
  if (text) statusEl.textContent = text;
}

// Reflects state.sessionActive, which the service worker keeps ONLY in
// chrome.storage.session (in-memory, cleared when the browser closes) — never
// chrome.storage.local — so "Running" never survives past a real browser
// restart, matching a live run rather than a persisted flag.
function setRunningTag(show) {
  runningTagEl.hidden = !show;
}

startBtn.addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "start" });
  setStatus("Starting…");
});

stopBtn.addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "stop" });
  setStatus("Stopping…");
});

// Live status pushed by the service worker while the popup is open.
chrome.runtime.onMessage.addListener((req) => {
  if (req.type === "status") setStatus(req.text);
});

// Reflect current run state when the popup opens.
chrome.runtime.sendMessage({ type: "get-state" }, (res) => {
  if (chrome.runtime.lastError) return; // worker asleep; leave default text
  if (res?.running) setStatus(`Running… (${res.retries} bounces so far)`);
  setRunningTag(!!res?.sessionActive);
});

// --- debug panel: live state, polled while the popup stays open ---------
//
// The point is to catch an unexpected funnel -> redirecting flip: if
// `recoveries` jumps between two polls, the watchdog force-restarted the
// funnel because it saw no progress for stallTimeoutMs (not because the
// reward page was reached) — that's the "no proper reason" case.

const dbg = {
  phase: document.getElementById("dbg-phase"),
  idle: document.getElementById("dbg-idle"),
  retries: document.getElementById("dbg-retries"),
  unknown: document.getElementById("dbg-unknown"),
  recoveries: document.getElementById("dbg-recoveries"),
  identity: document.getElementById("dbg-identity"),
  tabid: document.getElementById("dbg-tabid"),
};
let lastRecoveries = null;
const POLL_MS = 1000;

function renderDebug(res) {
  if (!res) return;
  setRunningTag(!!res.sessionActive);
  const phase = res.running ? "redirecting" : res.sessionActive ? "funnel" : "idle";
  dbg.phase.textContent = phase;
  dbg.phase.className = `v ${phase === "idle" ? "" : `phase-${phase}`}`;

  const idleMs = res.lastProgressAt ? Date.now() - res.lastProgressAt : null;
  dbg.idle.textContent = idleMs == null ? "—" : `${(idleMs / 1000).toFixed(0)}s`;
  dbg.idle.className = `v ${idleMs != null && idleMs > res.stallTimeoutMs * 0.75 ? "flag" : ""}`;

  dbg.retries.textContent = res.retries ?? "—";
  dbg.unknown.textContent = res.unknown ?? "—";

  dbg.recoveries.textContent = res.recoveries ?? "—";
  const jumped = lastRecoveries != null && res.recoveries > lastRecoveries;
  dbg.recoveries.className = `v ${jumped ? "flag" : ""}`;
  if (jumped) {
    setStatus(`⚠ Watchdog force-restarted the funnel (recovery #${res.recoveries}) — not a reward landing.`);
  }
  lastRecoveries = res.recoveries ?? lastRecoveries;

  dbg.identity.textContent = res.hasIdentity ? (res.hasDetails ? "set (+details)" : "set") : "none";
  dbg.tabid.textContent = res.tabId ?? "—";
}

function pollState() {
  chrome.runtime.sendMessage({ type: "get-state" }, (res) => {
    if (chrome.runtime.lastError) return; // worker asleep; try again next tick
    renderDebug(res);
  });
}

pollState();
setInterval(pollState, POLL_MS);
