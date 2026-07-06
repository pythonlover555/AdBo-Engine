/* Conditional Navigation — service worker (the retry loop).
 *
 * Drives ONE tab through a redirect chain:
 *   Source URL  --redirects-->  google.com   (FAILURE: bounce, retry)
 *                            \-> uplevelrewards.com (SUCCESS: scrape & stop)
 *
 * We listen on chrome.webNavigation.onCompleted (main frame only) and act on
 * the URL the tab SETTLES on. Because a single Source load fans out into
 * several hops (glstrk -> ... -> google|uplevel), each onCompleted resets a
 * short "settle" timer; we only judge the URL once navigation has been quiet
 * for SETTLE_MS. That way intermediate hops never get mistaken for the final
 * destination.
 *
 * MV3 note: this worker is event-driven. webNavigation events and our own
 * short timers wake it as needed; we persist the minimal run state to
 * storage.session so a worker eviction mid-loop can be recovered.
 */

// --- configuration ----------------------------------------------------

// FALLBACK source URL. The real one is fetched from the server (/api/config,
// driven by ADBO_SOURCE_URL in .env) at Start; this is used only if the server
// is unreachable. Keep it roughly in sync with the server default.
const SOURCE_URL =
  "https://glstrk.com/?offer_ids=MTQyMSwyMzcw&affiliate_id=MTkwMjMw";
const FAILURE_SUBSTR = "google.com"; // any URL containing this = bounce
const SUCCESS_SUBSTR = "uplevelrewards.com"; // any URL containing this = landed
const REWARD_SUBSTR = "eward4spot.com"; // funnel finished here -> loop again

const SERVER = "http://localhost:8137"; // local FastAPI server (must match server ADBO_PORT)

const RETRY_DELAY_MS = 2000; // pause before re-navigating after a bounce
const RESTART_DELAY_MS = 4000; // pause on the reward page before looping again
const SETTLE_MS = 1500; // quiet window after the last hop before we judge
const MAX_RETRIES = 50; // safety cap on google bounces (infinite-loop guard)
const MAX_UNKNOWN = 12; // safety cap on settles that match neither pattern

// --- watchdog / auto-restart -----------------------------------------
//
// The worker is event/timer driven, so a run can silently freeze: a dropped
// setTimeout after a worker eviction, a funnel page that never reaches the
// reward URL, or a terminal "unknown" landing. A durable chrome.alarms timer
// (survives eviction, unlike setTimeout) periodically checks a "last progress"
// clock and force-restarts the funnel if nothing has advanced. The alarm keys
// off state.sessionActive, which ONLY the user's Stop clears — so every internal
// give-up (bounce/unknown caps, re-nav error, tab reacquired) auto-recovers, and
// the run stays alive until the user explicitly stops it.
const WATCHDOG_ALARM = "cond-nav-watchdog";
const WATCHDOG_PERIOD_MIN = 0.5; // 30s heartbeat check (MV3 min reliable period)
const STALL_TIMEOUT_MS = 90000; // no progress this long => force a fresh restart

// --- dev auto-reload --------------------------------------------------
//
// This is an UNPACKED extension, so it never auto-updates from a store — but
// chrome.runtime.reload() re-reads the files FROM DISK. We self-update by reading
// our OWN manifest.json off disk (Chrome serves unpacked files straight from the
// folder) and reloading whenever its version differs from the loaded build. So
// bumping manifest.json is enough — NO server involvement, no server restart.
// Runs always (even between runs), reloads immediately (per config), and every
// loaded browser instance updates itself independently.
const UPDATE_ALARM = "cond-nav-update-check";
const UPDATE_CHECK_MIN = 0.5; // ~30s poll (MV3 min alarm period)

// --- remote start (terminal-triggerable) --------------------------------
//
// The server (see server/main.py) holds one counter. Bumping it from a
// terminal (curl -X POST http://localhost:8137/api/trigger-start) is the
// whole "command" — every open browser's extension polls it on this alarm
// and starts a run if the number changed AND it isn't already running.
// Already-running instances are left alone, not interrupted.
const START_CHECK_ALARM = "cond-nav-start-check";
const START_CHECK_MIN = 0.17; // ~10s between checks

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function checkStartSignal() {
  let signal;
  try {
    const resp = await fetch(`${SERVER}/api/start-signal`, { cache: "no-store" });
    if (!resp.ok) return;
    ({ signal } = await resp.json());
  } catch {
    return; // server unreachable — nothing to act on
  }
  if (!signal) return;

  const { lastStartSignal } = await chrome.storage.local.get("lastStartSignal");
  if (signal === lastStartSignal) return; // already handled this one
  await chrome.storage.local.set({ lastStartSignal: signal });

  if (state.sessionActive) return; // already running — leave it alone

  status(`Remote start (signal #${signal}) — starting…`, "run");
  await start();
}

// --- run state --------------------------------------------------------
//
// Held in memory for the active worker and mirrored to storage.session so a
// worker restart can resume the listener wiring. `running` is the master
// switch; `tabId` scopes every event to the one tab we drive.

let state = {
  running: false, // is the redirect LOOP actively bouncing right now?
  sessionActive: false, // is a funnel run in progress? (Start..Stop) — gates the
  //                       content script so it only automates during a run, not
  //                       on every site the user happens to visit.
  tabId: null,
  retries: 0, // count of FAILURE bounces this run
  unknown: 0, // consecutive settles matching neither pattern
  identity: null, // the name+email this run fills into the funnel (one per run)
  details: null, // address/phone/DOB/gender for the registration page (one per run)
  sourceUrl: SOURCE_URL, // resolved from the server (/api/config) at Start
  lastProgressAt: 0, // ms epoch of the last sign of forward motion (watchdog clock)
  recoveries: 0, // how many times the watchdog has revived this run
};
let settleTimer = null; // debounce handle for scheduleEvaluate()

// Bump the watchdog's "last progress" clock. Called on every real sign of
// forward motion (a navigation, a state transition, a content-script message /
// heartbeat) so the watchdog can tell a busy-but-healthy run from a hung one.
// In-memory only on the hot path; durability comes from the persist() calls the
// surrounding handlers already make (and the ~10s content-script heartbeat).
function markProgress() {
  state.lastProgressAt = Date.now();
}

async function persist() {
  await chrome.storage.session.set({ navState: { ...state } });
}

async function restore() {
  const { navState } = await chrome.storage.session.get("navState");
  if (navState) state = { ...state, ...navState };
}

function log(...args) {
  console.log("[cond-nav]", ...args);
}

// Push a one-line status to any open popup (best-effort; ignored if closed)
// and reflect coarse state on the toolbar badge.
function status(text, kind = "info") {
  log(text);
  chrome.runtime.sendMessage({ type: "status", text, kind }).catch(() => {});
  const badge = { run: "…", ok: "✓", fail: "!", info: "" }[kind] ?? "";
  const color = { run: "#6366f1", ok: "#16a34a", fail: "#ef4444", info: "#6b7280" }[kind] ?? "#6b7280";
  chrome.action.setBadgeText({ text: badge });
  chrome.action.setBadgeBackgroundColor({ color });
}

// --- lifecycle --------------------------------------------------------

// Resolve the source URL from the server (.env-driven), falling back to the
// hardcoded SOURCE_URL if the server is unreachable or doesn't provide one.
async function getSourceUrl() {
  try {
    const resp = await fetch(`${SERVER}/api/config`);
    if (resp.ok) {
      const data = await resp.json();
      if (data?.source_url) return data.source_url;
    }
  } catch {
    /* server down — use the fallback below */
  }
  return SOURCE_URL;
}

async function start() {
  await stop(); // clear any prior run first

  // Drive the CURRENT tab (don't open a new one): navigate the active tab to
  // the source URL and run the whole funnel in place.
  const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!active) {
    status("No active tab to drive.", "fail");
    return;
  }
  const sourceUrl = await getSourceUrl(); // from .env via /api/config (or fallback)
  // Fresh run => drop the previous identity so a new one is issued on the
  // first request from this run's content script (one identity per funnel).
  state = {
    running: true,
    sessionActive: true, // a run is now in progress -> content script may automate
    tabId: active.id,
    retries: 0,
    unknown: 0,
    identity: null,
    details: null,
    sourceUrl, // reused for retries + reward-restart this run
    lastProgressAt: Date.now(),
    recoveries: 0,
  };
  await chrome.storage.local.remove(["identity", "details"]);
  await persist();
  // Arm the durable watchdog for the life of this run (create replaces any
  // existing alarm of the same name, so there's never a duplicate).
  await chrome.alarms.create(WATCHDOG_ALARM, { periodInMinutes: WATCHDOG_PERIOD_MIN });
  await chrome.tabs.update(active.id, { url: sourceUrl });
  status("Started — loading source URL in this tab…", "run");
}

async function stop() {
  state.running = false;
  if (settleTimer) {
    clearTimeout(settleTimer);
    settleTimer = null;
  }
  await persist();
}

// --- navigation handling ----------------------------------------------

// Every completed main-frame load on our tab (re)arms the settle timer.
// Only when the chain goes quiet for SETTLE_MS do we evaluate the result.
chrome.webNavigation.onCompleted.addListener((details) => {
  if (details.tabId !== state.tabId) return;
  if (details.frameId !== 0) return; // ignore sub-frames (ads/iframes)

  markProgress(); // a main-frame load on our tab = the run is moving

  // Reward page = the funnel finished. Even though the redirect LOOP isn't
  // running anymore (it stopped on landing), the session is still active, so
  // loop the whole thing again with a fresh identity.
  if (state.sessionActive && (details.url || "").includes(REWARD_SUBSTR)) {
    onFunnelComplete(details.url);
    return;
  }

  if (!state.running) return;
  scheduleEvaluate();
});

// Reached the reward page: pause briefly (let the conversion register), then
// restart the funnel from the source URL in the same tab. A guard prevents the
// reward page's repeat onCompleted events from stacking restarts.
let restarting = false;
let recovering = false; // guards recoverStall() against overlapping watchdog ticks
async function onFunnelComplete(url) {
  if (restarting) return;
  restarting = true;
  status(`Funnel complete (${shortHost(url)}) — looping again in ${RESTART_DELAY_MS / 1000}s…`, "ok");
  await sleep(RESTART_DELAY_MS);
  if (state.sessionActive && state.tabId != null) {
    await beginFreshRun(state.tabId); // fresh identity, same tab + session, loop again
    status("Restarted — loading source URL…", "run");
  }
  restarting = false;
}

// Start (or restart) the whole funnel in `tabId`: fresh per-run state (new
// identity), redirect loop running again, source URL loaded. Used by the reward
// -page loop and by the watchdog's stall recovery. Assumes the session is still
// active (sessionActive is left untouched — only the user's Stop clears it).
async function beginFreshRun(tabId) {
  state = {
    ...state,
    running: true,
    tabId,
    retries: 0,
    unknown: 0,
    identity: null,
    details: null,
    lastProgressAt: Date.now(),
  };
  await chrome.storage.local.remove(["identity", "details"]);
  await persist();
  await chrome.tabs.update(tabId, { url: state.sourceUrl || SOURCE_URL });
}

function scheduleEvaluate() {
  if (settleTimer) clearTimeout(settleTimer);
  settleTimer = setTimeout(evaluate, SETTLE_MS);
}

async function evaluate() {
  settleTimer = null;
  if (!state.running) return;

  let tab;
  try {
    tab = await chrome.tabs.get(state.tabId);
  } catch {
    // Tab was closed out from under us. Don't end the run — halt the loop for the
    // dead tab and let the watchdog resume in the active tab on its next tick.
    await stop();
    state.lastProgressAt = 0; // force prompt recovery (don't wait the full timeout)
    await persist();
    status("Tab gone — watchdog will resume in the active tab…", "run");
    return;
  }

  const url = tab.url || "";
  if (url.includes(SUCCESS_SUBSTR)) {
    await onSuccess(url);
  } else if (url.includes(FAILURE_SUBSTR)) {
    await onFailure(url);
  } else {
    await onUnknown(url);
  }
}

async function onSuccess(url) {
  await stop(); // landed — the redirect loop is done
  markProgress(); // hand-off to the funnel stage; content-script heartbeats take over
  await persist();
  // No manual injection needed: content.js is a declared content script on
  // *.uplevelrewards.com, so it auto-runs here AND on every later funnel page.
  status(`Reached target — running funnel on ${shortHost(url)}.`, "ok");
}

// --- identity (one per funnel run, reused across its pages) ------------

// Fetch a name+email from the local server the first time it's needed this
// run, then cache it so every page of the funnel uses the SAME identity.
async function getIdentity() {
  if (state.identity) return state.identity;
  // Survive a service-worker eviction (the funnel spans domains, which often
  // evicts the worker): reuse THIS run's identity from storage before issuing a
  // new one, so the registration page's names stay consistent with the email
  // typed on the first page. start()/onFunnelComplete clear it for a fresh run.
  const stored = (await chrome.storage.local.get("identity")).identity;
  if (stored) {
    state.identity = stored;
    return stored;
  }
  const resp = await fetch(`${SERVER}/api/identity`);
  if (!resp.ok) throw new Error(`server ${resp.status}`);
  const data = await resp.json();
  state.identity = data.identity;
  await chrome.storage.local.set({ identity: state.identity });
  await persist();
  status(
    `Identity: ${state.identity.full_name} <${state.identity.email}>`,
    "run"
  );
  return state.identity;
}

// Registration-form details (address/phone/DOB/gender) — everything except
// the email/name that getIdentity already provides. Same once-per-run cache,
// with the same storage fallback so it survives a worker eviction mid-funnel.
async function getDetails() {
  if (state.details) return state.details;
  const stored = (await chrome.storage.local.get("details")).details;
  if (stored) {
    state.details = stored;
    return stored;
  }
  const resp = await fetch(`${SERVER}/api/details`);
  if (!resp.ok) throw new Error(`server ${resp.status}`);
  const data = await resp.json();
  state.details = data.details;
  await chrome.storage.local.set({ details: state.details });
  await persist();
  status(
    `Details: ${state.details.city}, ${state.details.state} ${state.details.zip}`,
    "run"
  );
  return state.details;
}

async function onFailure(url) {
  state.retries += 1;
  if (state.retries > MAX_RETRIES) {
    status(`Hit the ${MAX_RETRIES}-bounce cap — giving up.`, "fail");
    return stop();
  }
  state.unknown = 0; // a fresh attempt clears the unknown streak
  await persist();
  status(
    `Bounced to ${shortHost(url)} (#${state.retries}) — retrying in ${RETRY_DELAY_MS / 1000}s…`,
    "run"
  );

  // Wait, then re-navigate the SAME tab back to the source to retry the chain.
  setTimeout(() => {
    if (!state.running) return;
    chrome.tabs.update(state.tabId, { url: state.sourceUrl || SOURCE_URL }).catch((e) => {
      status(`Could not re-navigate: ${e.message}`, "fail");
      stop();
    });
  }, RETRY_DELAY_MS);
}

// Settled on a page that is neither the failure nor the success pattern.
// This is usually a still-resolving intermediate hop: we DON'T act, because
// the next onCompleted will re-arm the settle timer and re-evaluate. We only
// count these to break out if a page keeps firing onCompleted without ever
// matching (the genuine "stuck on unknown" case the spec warns about).
async function onUnknown(url) {
  state.unknown += 1;
  await persist();
  // Flag the unexpected landing to the console as a warning (stands out in the
  // service-worker DevTools), matching neither the success nor failure pattern.
  console.warn(`[cond-nav] ⚠ UNEXPECTED redirect (#${state.unknown}):`, url);
  if (state.unknown > MAX_UNKNOWN) {
    status(`Stuck on unexpected page ${shortHost(url)} — stopped.`, "fail");
    return stop();
  }
  status(`Waiting on ${shortHost(url)} (unexpected #${state.unknown})…`, "run");
}

function shortHost(url) {
  try {
    return new URL(url).host;
  } catch {
    return url.slice(0, 40);
  }
}

// --- wiring -----------------------------------------------------------

// If our driven tab is closed, DON'T abandon the run: halt the loop machinery
// for the dead tab and let the watchdog adopt the current active tab on its next
// tick (forced prompt by zeroing the progress clock). Only the user's Stop ends
// a run.
chrome.tabs.onRemoved.addListener(async (tabId) => {
  if (state.sessionActive && tabId === state.tabId) {
    await stop();
    state.lastProgressAt = 0; // recover on the next watchdog tick, not after the timeout
    await persist();
    status("Driven tab closed — watchdog will resume in the active tab…", "run");
  }
});

// Receive scraped data from content.js and stash the latest result so the
// popup can show / the user can retrieve it. (Swap this for a POST to your
// collection endpoint if you want it pushed somewhere.)
chrome.runtime.onMessage.addListener((req, _sender, sendResponse) => {
  if (req.type === "heartbeat") {
    // The content script is actively working a funnel page. Keep the watchdog's
    // progress clock fresh so a long-but-healthy funnel isn't mistaken for a stall.
    markProgress();
    persist();
    sendResponse?.({ ok: true });
    return; // sync
  }
  if (req.type === "scrape-result") {
    chrome.storage.local.set({ lastScrape: req.data });
    markProgress();
    status(`Scraped ${req.data?.fieldCount ?? 0} fields from target.`, "ok");
    sendResponse?.({ ok: true });
    return; // sync response
  }
  if (req.type === "get-identity") {
    markProgress();
    getIdentity()
      .then((identity) => sendResponse?.({ ok: true, identity }))
      .catch((e) => {
        status(`Could not get identity from server: ${e.message}`, "fail");
        sendResponse?.({ ok: false, error: e.message });
      });
    return true; // async
  }
  if (req.type === "get-details") {
    markProgress();
    getDetails()
      .then((details) => sendResponse?.({ ok: true, details }))
      .catch((e) => {
        status(`Could not get details from server: ${e.message}`, "fail");
        sendResponse?.({ ok: false, error: e.message });
      });
    return true; // async
  }
  if (req.type === "start") {
    start().then(() => sendResponse?.({ ok: true }));
    return true; // async
  }
  if (req.type === "stop") {
    state.sessionActive = false; // user ended the run -> content script goes inert
    chrome.alarms.clear(WATCHDOG_ALARM); // the ONLY place the watchdog is torn down
    stop().then(() => {
      status("Stopped by user.", "info");
      sendResponse?.({ ok: true });
    });
    return true; // async
  }
  if (req.type === "is-active") {
    // The content script asks this before doing anything, so it automates only
    // during an active run (we run on <all_urls>, so this gate is what keeps it
    // from touching forms on unrelated sites).
    if (state.sessionActive) {
      sendResponse?.({ active: true });
      return; // sync fast path
    }
    // The worker may have just respawned on a deeper funnel domain (cross-domain
    // navigation evicts it) BEFORE restore() ran, so the in-memory flag is still
    // false. Fall back to the persisted state so we don't wrongly skip an active
    // run (which left surveys un-answered).
    chrome.storage.session.get("navState").then(({ navState }) => {
      if (navState) state = { ...state, ...navState }; // rehydrate for later msgs
      sendResponse?.({ active: !!navState?.sessionActive });
    });
    return true; // async
  }
  if (req.type === "get-state") {
    sendResponse?.({
      running: state.running,
      sessionActive: state.sessionActive,
      tabId: state.tabId,
      retries: state.retries,
      unknown: state.unknown,
      recoveries: state.recoveries,
      lastProgressAt: state.lastProgressAt,
      stallTimeoutMs: STALL_TIMEOUT_MS,
      hasIdentity: !!state.identity,
      hasDetails: !!state.details,
      sourceUrl: state.sourceUrl,
    });
    return; // sync
  }
});

// --- watchdog -----------------------------------------------------------
//
// A durable, ~30s alarm (survives worker eviction, unlike setTimeout) that
// force-restarts the funnel whenever a run has made no progress for
// STALL_TIMEOUT_MS — covering dropped retry/restart timers after an eviction,
// funnel pages that never reach the reward URL, and terminal unexpected
// landings. Keyed off sessionActive, so it runs from Start until the user Stops.
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === UPDATE_ALARM) return void checkForUpdate();
  if (alarm.name === START_CHECK_ALARM) return void checkStartSignal();
  if (alarm.name !== WATCHDOG_ALARM) return;
  await restore(); // rehydrate in-memory state after a possible eviction
  if (!state.sessionActive) {
    await chrome.alarms.clear(WATCHDOG_ALARM); // no active run -> no orphan alarm
    return;
  }
  const idle = Date.now() - (state.lastProgressAt || 0);
  if (idle < STALL_TIMEOUT_MS) return; // still moving (or legitimately busy)
  await recoverStall(idle);
});

// Read the extension's OWN manifest.json FROM DISK and reload when its version
// differs from the loaded build. Since this is unpacked, the fetch reads the
// current file off disk (cache: no-store to be sure), so bumping manifest.json is
// the whole trigger. The storage.local guard is a safety net: if a browser ever
// serves a stale manifest and the reload doesn't "take", back off 60s instead of
// looping.
async function checkForUpdate() {
  let diskVersion;
  try {
    const resp = await fetch(chrome.runtime.getURL("manifest.json"), { cache: "no-store" });
    if (!resp.ok) return;
    diskVersion = (await resp.json())?.version;
  } catch {
    return;
  }
  if (!diskVersion) return;
  const loaded = chrome.runtime.getManifest().version;
  if (diskVersion === loaded) return; // already running the on-disk build

  const { updateGuard } = await chrome.storage.local.get("updateGuard");
  const now = Date.now();
  if (updateGuard?.target === diskVersion && now - updateGuard.at < 60000) {
    return; // just tried this target and it didn't take — avoid a tight loop
  }
  await chrome.storage.local.set({ updateGuard: { target: diskVersion, at: now } });
  log(`update: disk manifest ${diskVersion} != loaded ${loaded} — reloading from disk`);
  chrome.runtime.reload();
}

// The run has frozen. Guaranteed forward action: restart the funnel fresh in the
// driven tab — or, if that tab is gone, ADOPT the current active tab (per config;
// we never open a new tab). If no tab exists to drive, reset the clock and retry
// on the next tick.
async function recoverStall(idle) {
  if (recovering) return; // don't stack recoveries across overlapping ticks
  recovering = true;
  try {
    let tabId = state.tabId;
    try {
      await chrome.tabs.get(tabId);
    } catch {
      const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!active) {
        markProgress(); // nothing to drive right now; back off one tick
        await persist();
        status("Watchdog: no tab to drive — will retry.", "run");
        return;
      }
      tabId = active.id;
    }
    state.recoveries += 1;
    status(
      `Watchdog: no progress for ${Math.round(idle / 1000)}s — restarting funnel (recovery #${state.recoveries}).`,
      "run"
    );
    await beginFreshRun(tabId);
  } finally {
    recovering = false;
  }
}

// Recover in-memory state if the worker was evicted and re-spawned by an event.
restore();

// Dev auto-reload: keep a version-poll alarm alive (create replaces any existing
// one, so no duplicate) and check once now, so a new build is picked up promptly
// on every worker wake, not only on the ~30s tick.
chrome.alarms.create(UPDATE_ALARM, { periodInMinutes: UPDATE_CHECK_MIN });
checkForUpdate();

// Remote start: keep the signal-poll alarm alive and check once now.
chrome.alarms.create(START_CHECK_ALARM, { periodInMinutes: START_CHECK_MIN });
checkStartSignal();

log("service worker loaded");
