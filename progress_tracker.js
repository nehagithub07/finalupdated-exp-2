/* File: progress_tracker.js
   Include on every page:
   <script src="./progress_tracker.js"></script>
   <script>VLProgress.initPage();</script>
*/

(function () {
  const KEY = "vlab_exp2_progress_v1";
  const VERSION = 1;

  const nowISO = () => new Date().toISOString();

  const GENERAL_PROGRESS_KEYS = [
    "vlab_exp2_pretest_score",
    "vlab_exp2_pretest_total",
    "vlab_exp2_pretest_updated_at",
    "vlab_exp2_posttest_score",
    "vlab_exp2_posttest_total",
    "vlab_exp2_posttest_updated_at",
    "vlab_exp2_simulation_report_html",
    "vlab_exp2_simulation_report_updated_at"
  ];

  const WINDOW_NAME_PREFIX = "VLAB_EXP2::";

  function safeParse(json, fallback) {
    try {
      const v = JSON.parse(json);
      return v && typeof v === "object" ? v : fallback;
    } catch {
      return fallback;
    }
  }

  function loadWindowNameData() {
    try {
      if (typeof window.name === "string" && window.name.startsWith(WINDOW_NAME_PREFIX)) {
        return safeParse(window.name.slice(WINDOW_NAME_PREFIX.length), {});
      }
    } catch {}
    return {};
  }

  function saveWindowNameData(data) {
    try { window.name = WINDOW_NAME_PREFIX + JSON.stringify(data || {}); } catch {}
  }

  function setWindowNameValues(values) {
    try {
      const current = loadWindowNameData();
      const merged = { ...(current && typeof current === "object" ? current : {}), ...(values || {}) };
      saveWindowNameData(merged);
    } catch {}
  }

  function normalizeEmail(email) {
    if (!email || typeof email !== "string") return "";
    return email.trim().toLowerCase();
  }

  function computeUserHash(email) {
    const normalized = normalizeEmail(email);
    if (!normalized) return "";
    let hash = 0;
    for (let i = 0; i < normalized.length; i++) {
      hash = ((hash << 5) - hash) + normalized.charCodeAt(i);
      hash |= 0;
    }
    return `u${(hash >>> 0).toString(16).padStart(8, "0")}`;
  }

  function baseState() {
    return {
      version: VERSION,
      user: null,
      flags: { reportDeclined: false },
      timestamps: {
        sessionStart: null,
        aimAfterIntro: null,
        simulationStart: null,
        contributorsVisited: null,
        reportViewedAt: null
      },
      pages: {},
      steps: [],
      userHistory: []
    };
  }

  function ensureHistory(state) {
    if (!Array.isArray(state.userHistory)) state.userHistory = [];
  }

  function load() {
    let raw = null;
    try { raw = localStorage.getItem(KEY); } catch {}
    const parsed = raw ? safeParse(raw, baseState()) : baseState();

    const merged = { ...baseState(), ...parsed };
    merged.flags = merged.flags || { reportDeclined: false };
    merged.timestamps = merged.timestamps || baseState().timestamps;
    merged.pages = merged.pages || {};
    merged.steps = Array.isArray(merged.steps) ? merged.steps : [];
    merged.userHistory = Array.isArray(merged.userHistory) ? merged.userHistory : [];

    // file:// fallback for user data
    try {
      if (!merged.user || !(merged.user.name && merged.user.email && merged.user.designation)) {
        const wn = loadWindowNameData();
        const name = (wn.vlab_exp2_user_name || "").toString().trim();
        const email = (wn.vlab_exp2_user_email || "").toString().trim();
        const designation = (wn.vlab_exp2_user_designation || "").toString().trim();
        if (name && email && designation) {
          merged.user = { name, email, designation, submittedAt: wn.vlab_exp2_user_submitted_at || nowISO() };
        }
      }
    } catch {}

    return merged;
  }

  function save(state) {
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch {}
  }

  function pageName() {
    const p = window.location.pathname.split("/").pop();
    return p || "index.html";
  }

  function ensureSessionStart(state) {
    if (!state.timestamps.sessionStart) state.timestamps.sessionStart = nowISO();
  }

  function formatMs(ms) {
    const totalSec = Math.max(0, Math.floor((ms || 0) / 1000));
    const hh = String(Math.floor(totalSec / 3600)).padStart(2, "0");
    const mm = String(Math.floor((totalSec % 3600) / 60)).padStart(2, "0");
    const ss = String(totalSec % 60).padStart(2, "0");
    return `${hh}:${mm}:${ss}`;
  }

  function initPage() {
    const state = load();
    ensureSessionStart(state);

    const p = pageName();
    const rec = state.pages[p] || { firstEnter: null, lastExit: null, timeMs: 0, visits: 0 };

    if (!rec.firstEnter) rec.firstEnter = nowISO();
    rec.visits += 1;
    state.pages[p] = rec;

    // auto stamps
    if (p === "index.html" && /\/simulation\//.test(window.location.pathname)) {
      if (!state.timestamps.simulationStart) state.timestamps.simulationStart = nowISO();
    }
    if (p === "contributors.html" && !state.timestamps.contributorsVisited) {
      state.timestamps.contributorsVisited = nowISO();
    }

    save(state);

    try {
      sessionStorage.setItem("vlab_exp2_current_page", p);
      sessionStorage.setItem("vlab_exp2_page_enter_ms", String(Date.now()));
    } catch {}
  }

  function recordPageExit() {
    const state = load();

    const p = (() => {
      try { return sessionStorage.getItem("vlab_exp2_current_page") || pageName(); }
      catch { return pageName(); }
    })();

    let enterMs = null;
    try {
      const s = sessionStorage.getItem("vlab_exp2_page_enter_ms");
      enterMs = s ? Number(s) : null;
    } catch {}

    const delta = (enterMs && Number.isFinite(enterMs)) ? (Date.now() - enterMs) : 0;

    const rec = state.pages[p] || { firstEnter: null, lastExit: null, timeMs: 0, visits: 0 };
    rec.timeMs = (rec.timeMs || 0) + Math.max(0, delta);
    rec.lastExit = nowISO();
    state.pages[p] = rec;

    save(state);
  }

  function logStep(name, meta = {}) {
    const state = load();
    ensureSessionStart(state);
    state.steps.push({ name: String(name || "").trim(), ts: nowISO(), meta: meta || {} });
    save(state);
  }

  function recordUserHistory(state, user) {
    const normalizedEmail = normalizeEmail(user?.email);
    if (!normalizedEmail) return false;
    ensureHistory(state);

    const now = nowISO();
    const existing = state.userHistory.find(e => e.email === normalizedEmail);
    if (existing) {
      existing.name = (user?.name || "").trim();
      existing.designation = (user?.designation || "").trim();
      existing.lastSeen = now;
      return false;
    }

    state.userHistory.push({
      email: normalizedEmail,
      name: (user?.name || "").trim(),
      designation: (user?.designation || "").trim(),
      firstSeen: now,
      lastSeen: now
    });

    return true;
  }

  function clearGeneralProgressKeys() {
    try {
      for (const key of GENERAL_PROGRESS_KEYS) localStorage.removeItem(key);
    } catch {}
  }

  function migrateGeneralProgressKeysToUser(userHash) {
    if (!userHash) return;
    try {
      let movedAny = false;
      const prefix = `vlab_exp2_user_${userHash}_`;

      for (const key of GENERAL_PROGRESS_KEYS) {
        const value = localStorage.getItem(key);
        if (!value || !String(value).trim()) continue;

        const suffix = key.replace(/^vlab_exp2_/, "");
        const destKey = prefix + suffix;

        const existing = localStorage.getItem(destKey);
        if (!existing || !String(existing).trim()) localStorage.setItem(destKey, value);

        movedAny = true;
      }

      if (movedAny) clearGeneralProgressKeys();
    } catch {}
  }

  function setUser(user) {
    const trimmedUser = {
      name: (user?.name || "").trim(),
      email: (user?.email || "").trim(),
      designation: (user?.designation || "").trim()
    };

    const normalizedEmail = normalizeEmail(trimmedUser.email);
    const newHash = normalizedEmail ? computeUserHash(normalizedEmail) : "";

    let prevHash = "";
    try { prevHash = localStorage.getItem("vlab_exp2_active_user_hash") || ""; } catch {}

    const state = load();
    const isNewUserByEmail = recordUserHistory(state, trimmedUser);

    state.user = { ...trimmedUser, submittedAt: nowISO() };
    state.flags.reportDeclined = false;

    try {
      if (newHash) localStorage.setItem("vlab_exp2_active_user_hash", newHash);
      else localStorage.removeItem("vlab_exp2_active_user_hash");
    } catch {}

    if (newHash) {
      if (isNewUserByEmail && prevHash && prevHash !== newHash) clearGeneralProgressKeys();
      migrateGeneralProgressKeysToUser(newHash);
    }

    setWindowNameValues({
      vlab_exp2_user_name: trimmedUser.name,
      vlab_exp2_user_email: trimmedUser.email,
      vlab_exp2_user_designation: trimmedUser.designation,
      vlab_exp2_user_submitted_at: state.user.submittedAt
    });

    save(state);
  }

  function hasUser() {
    const s = load();
    return !!(s.user && s.user.name && s.user.email && s.user.designation);
  }

  function declineReport() {
    const state = load();
    state.flags.reportDeclined = true;
    save(state);
  }

  function clearDecline() {
    const state = load();
    state.flags.reportDeclined = false;
    save(state);
  }

  function mark(key) {
    const state = load();
    state.timestamps = state.timestamps || baseState().timestamps;
    state.timestamps[key] = nowISO();
    save(state);
  }

  function markReportViewed() {
    const state = load();
    if (!state.timestamps.reportViewedAt) state.timestamps.reportViewedAt = nowISO();
    save(state);
  }

  function resetAll() {
    let activeHash = "";
    try { activeHash = localStorage.getItem("vlab_exp2_active_user_hash") || ""; } catch {}

    // remove main state
    try { localStorage.removeItem(KEY); } catch {}

    // remove active hash
    try { localStorage.removeItem("vlab_exp2_active_user_hash"); } catch {}

    // remove general keys
    clearGeneralProgressKeys();

    // remove current user-scoped keys for assessments + simulation report
    if (activeHash) {
      try {
        const prefix = `vlab_exp2_user_${activeHash}_`;
        const suffixes = GENERAL_PROGRESS_KEYS.map(k => k.replace(/^vlab_exp2_/, ""));
        for (const suf of suffixes) localStorage.removeItem(prefix + suf);
      } catch {}
    }

    // session keys
    try {
      sessionStorage.removeItem("vlab_exp2_current_page");
      sessionStorage.removeItem("vlab_exp2_page_enter_ms");
    } catch {}

    // window.name user data
    try {
      const wn = loadWindowNameData();
      delete wn.vlab_exp2_user_name;
      delete wn.vlab_exp2_user_email;
      delete wn.vlab_exp2_user_designation;
      delete wn.vlab_exp2_user_submitted_at;
      delete wn.vlab_exp2_simulation_report_html;
      delete wn.vlab_exp2_simulation_report_updated_at;
      saveWindowNameData(wn);
    } catch {}
  }

  // capture exit
  window.addEventListener("pagehide", recordPageExit);
  window.addEventListener("beforeunload", recordPageExit);

  window.VLProgress = {
    initPage,
    recordPageExit,
    logStep,
    setUser,
    hasUser,
    declineReport,
    clearDecline,
    mark,
    markReportViewed,
    getState: load,
    saveState: save,
    formatMs,
    resetAll
  };
})();
