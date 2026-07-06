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
