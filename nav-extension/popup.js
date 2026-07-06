/* Popup: start/stop the navigation loop and mirror the worker's status. */

const statusEl = document.getElementById("status");
const startBtn = document.getElementById("start");
const stopBtn = document.getElementById("stop");
const autoStartedEl = document.getElementById("auto-started");
const autoStartCheckbox = document.getElementById("auto-start-on-install");

// Show the loaded build's version (from the manifest, so it always reflects
// whatever the auto-reloader actually has loaded).
document.getElementById("version").textContent = `v${chrome.runtime.getManifest().version}`;

function setStatus(text) {
  if (text) statusEl.textContent = text;
}

function setAutoStarted(show) {
  autoStartedEl.hidden = !show;
}

startBtn.addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "start" });
  setAutoStarted(false);
  setStatus("Starting…");
});

stopBtn.addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "stop" });
  setAutoStarted(false);
  setStatus("Stopping…");
});

autoStartCheckbox.addEventListener("change", () => {
  chrome.storage.local.set({ autoStartOnInstall: autoStartCheckbox.checked });
});

// Live status pushed by the service worker while the popup is open.
chrome.runtime.onMessage.addListener((req) => {
  if (req.type === "status") setStatus(req.text);
});

chrome.storage.local.get(["autoStarted", "autoStartOnInstall"], ({ autoStarted, autoStartOnInstall }) => {
  setAutoStarted(!!autoStarted);
  autoStartCheckbox.checked = autoStartOnInstall !== false; // default ON
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local" || !changes.autoStarted) return;
  setAutoStarted(!!changes.autoStarted.newValue);
});

// Reflect current run state when the popup opens.
chrome.runtime.sendMessage({ type: "get-state" }, (res) => {
  if (chrome.runtime.lastError) return; // worker asleep; leave default text
  if (res?.autoStarted) setAutoStarted(true);
  if (res?.running) setStatus(`Running… (${res.retries} bounces so far)`);
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
