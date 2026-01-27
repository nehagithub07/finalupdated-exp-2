(() => {
      const form = document.getElementById("reportForm");
      const preInput = document.getElementById("preScore");
      const postInput = document.getElementById("postScore");
      const preHint = document.getElementById("preHint");
      const postHint = document.getElementById("postHint");
      const refreshButton = document.getElementById("refreshButton");
      const resetButton = document.getElementById("resetButton");
      const clearSavedButton = document.getElementById("clearSavedButton");
      const useScoresCheckbox = document.getElementById("useScores");
      const attachSimCheckbox = document.getElementById("attachSim");
      const placeholder = document.getElementById("reportPlaceholder");
      const reportContent = document.getElementById("reportContent");
      const historyPanel = document.getElementById("historyPanel");
      const historyList = document.getElementById("historyList");
      const emailInput = document.getElementById("email");
      const formStatus = document.getElementById("formStatus");
      const generateBtn = document.querySelector('button[type="submit"]');
      const downloadPdfBtn = document.getElementById("downloadPdfBtn");
      const exportDataBtn = document.getElementById("exportDataBtn");
      const importDataBtn = document.getElementById("importDataBtn");
      const importFile = document.getElementById("importFile");
      const toastStack = document.getElementById("toastStack");

      const state = { pre: null, post: null, sim: null, attachSim: false, useScores: false, simOversize: false };
      let currentHash = null;
      let importDoneForHash = new Set();
      let currentHashRequestId = 0;
      let lastReportSnapshot = null;

      const storage = {
        get(key) {
          try { return localStorage.getItem(key); } catch (e) { return null; }
        },
        set(key, value) {
          try { localStorage.setItem(key, String(value)); return true; } catch (e) { return false; }
        },
        remove(key) {
          try { localStorage.removeItem(key); return true; } catch (e) { return false; }
        }
      };

      function parseStamp(ms) {
        if (ms === null || ms === undefined || ms === "" || ms === 0) return "";
        const num = Number(ms);
        if (!Number.isFinite(num) || num <= 0) return "";
        return new Date(num).toLocaleString();
      }

      function escapeHtml(text) {
        return String(text ?? "").replace(/[&<>"']/g, (ch) => {
          return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch] || ch;
        });
      }

      function pushToast(msg, type = "info") {
        if (!toastStack) return;
        const toast = document.createElement("div");
        toast.className = `toast ${type}`;
        toast.textContent = msg;
        toastStack.appendChild(toast);
        setTimeout(() => toast.remove(), 3200);
      }

      function showMessage(msg, type = "info") {
        if (formStatus) {
          formStatus.textContent = msg;
          formStatus.classList.remove("hidden", "error", "success", "info");
          formStatus.classList.add(type);
        }
        const live = document.getElementById("statusLive");
        if (live) live.textContent = msg;
        pushToast(msg, type);
      }

      function hideMessage() {
        if (!formStatus) return;
        formStatus.classList.add("hidden");
      }

      function normalizeEmail(email) {
        return String(email ?? "").trim().toLowerCase();
      }

      function fnv1aHex(text) {
        const input = String(text ?? "");
        if (typeof BigInt !== "undefined") {
          let hash = 0xcbf29ce484222325n;
          const prime = 0x100000001b3n;
          for (let i = 0; i < input.length; i++) {
            hash ^= BigInt(input.charCodeAt(i));
            hash = (hash * prime) & 0xffffffffffffffffn;
          }
          return hash.toString(16).padStart(16, "0");
        }
        let hash = 0x811c9dc5;
        for (let i = 0; i < input.length; i++) {
          hash ^= input.charCodeAt(i);
          hash = Math.imul(hash, 0x01000193);
        }
        return (hash >>> 0).toString(16).padStart(8, "0");
      }

      async function sha256(text) {
        const normalized = normalizeEmail(text);
        try {
          if (!globalThis.crypto?.subtle?.digest) throw new Error("WebCrypto not available");
          if (typeof TextEncoder === "undefined") throw new Error("TextEncoder not available");
          const enc = new TextEncoder().encode(normalized);
          const buf = await crypto.subtle.digest("SHA-256", enc);
          return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("");
        } catch (e) {
          return fnv1aHex(normalized);
        }
      }

      const userKey = (hash, suffix) => `vlab_exp2_user_${hash}_${suffix}`;

      function importLegacyData(hash) {
        if (!hash || importDoneForHash.has(hash)) return;
        const legacy = (k) => storage.get(`vlab_exp2_${k}`);
        const hasUserValue = (suffix) => storage.get(userKey(hash, suffix)) !== null;
        const legacySet = (suffix, val) => storage.set(userKey(hash, suffix), val);
        const pre = legacy("pretest_score");
        const preT = legacy("pretest_total");
        const preTs = legacy("pretest_updated_at");
        const needsPre = !hasUserValue("pretest_score") || !hasUserValue("pretest_total");
        if (needsPre && pre !== null && preT !== null) {
          if (!hasUserValue("pretest_score")) legacySet("pretest_score", pre);
          if (!hasUserValue("pretest_total")) legacySet("pretest_total", preT);
          if (!hasUserValue("pretest_updated_at") && preTs) legacySet("pretest_updated_at", preTs);
        }
        const post = legacy("posttest_score");
        const postT = legacy("posttest_total");
        const postTs = legacy("posttest_updated_at");
        const needsPost = !hasUserValue("posttest_score") || !hasUserValue("posttest_total");
        if (needsPost && post !== null && postT !== null) {
          if (!hasUserValue("posttest_score")) legacySet("posttest_score", post);
          if (!hasUserValue("posttest_total")) legacySet("posttest_total", postT);
          if (!hasUserValue("posttest_updated_at") && postTs) legacySet("posttest_updated_at", postTs);
        }
        const simHtml = storage.get("vlab_exp2_simulation_report_html");
        const simTs = storage.get("vlab_exp2_simulation_report_updated_at");
        if (!hasUserValue("simulation_report_html") && simHtml) {
          legacySet("simulation_report_html", simHtml);
          if (!hasUserValue("simulation_report_updated_at") && simTs) legacySet("simulation_report_updated_at", simTs);
        }
        importDoneForHash.add(hash);
      }

      function fetchScore(kind) {
        if (!currentHash) return null;
        const scoreRaw = storage.get(userKey(currentHash, `${kind}_score`));
        const totalRaw = storage.get(userKey(currentHash, `${kind}_total`));
        const updatedAtRaw = storage.get(userKey(currentHash, `${kind}_updated_at`));
        if (scoreRaw === null || totalRaw === null) return null;
        const score = Number(scoreRaw);
        const total = Number(totalRaw);
        const updatedAt = updatedAtRaw === null ? null : Number(updatedAtRaw);
        if (!Number.isFinite(score) || !Number.isFinite(total) || total <= 0) return null;
        if (score < 0 || score > total) return null;
        return { score, total, updatedAt: Number.isFinite(updatedAt) && updatedAt > 0 ? updatedAt : null };
      }

      function fetchSimulation() {
        if (!currentHash) return null;
        const html = storage.get(userKey(currentHash, "simulation_report_html"));
        const updatedAtRaw = storage.get(userKey(currentHash, "simulation_report_updated_at"));
        const updatedAt = updatedAtRaw === null ? null : Number(updatedAtRaw);
        if (html && typeof html === "string" && html.trim()) {
          const MAX_SIM_HTML = 2000000; // chars, allow full sim content in PDF
          state.simOversize = html.length > MAX_SIM_HTML;
          return { html, updatedAt: Number.isFinite(updatedAt) && updatedAt > 0 ? updatedAt : null };
        }
        state.simOversize = false;
        return null;
      }

      function renderScoreField(input, hint, data, label) {
        if (data) {
          input.value = data.score;
          input.readOnly = true;
          hint.textContent = `${label} auto-filled (${data.score} / ${data.total})${data.updatedAt ? " | saved " + parseStamp(data.updatedAt) : ""}`;
        } else {
          input.value = "";
          input.placeholder = "Not available";
          input.readOnly = true;
          hint.textContent = `${label} score not found. Complete the ${label.toLowerCase()} to auto-fill it.`;
        }
      }

      function refreshSavedData(autoDetect = false) {
        setLoading(true);
        if (!currentHash) {
          state.pre = state.post = state.sim = null;
          renderScoreField(preInput, preHint, state.pre, "Pre-test");
          renderScoreField(postInput, postHint, state.post, "Post-test");
          state.attachSim = false;
          attachSimCheckbox.checked = false;
          attachSimCheckbox.disabled = true;
          updateGenerateState();
          renderHistory([]);
          setLoading(false);
          return;
        }

        importLegacyData(currentHash);

        const maybePre = fetchScore("pretest");
        const maybePost = fetchScore("posttest");
        const maybeSim = fetchSimulation();

        if (autoDetect) {
          if (maybePre || maybePost) useScoresCheckbox.checked = true;
        }

        state.useScores = useScoresCheckbox.checked;
        attachSimCheckbox.disabled = !Boolean(maybeSim && maybeSim.html);
        state.attachSim = maybeSim ? attachSimCheckbox.checked : false;
        attachSimCheckbox.checked = state.attachSim;

        state.pre = state.useScores ? maybePre : null;
        state.post = state.useScores ? maybePost : null;
        state.sim = maybeSim;

        renderScoreField(preInput, preHint, state.pre, "Pre-test");
        renderScoreField(postInput, postHint, state.post, "Post-test");
        resetReportView();
        updateGenerateState();
        renderHistory(loadHistory());
        setLoading(false);
      }

      function formatScoreDisplay(data) {
        return data ? `${data.score} / ${data.total}` : "Not available";
      }

      function renderSimulation(target) {
        target.innerHTML = "";
        if (!state.attachSim) {
          target.innerHTML = '<p class="empty">Simulation report not attached (option unchecked).</p>';
          return;
        }
        if (!state.sim || !state.sim.html) {
          target.innerHTML = '<p class="empty">Simulation report not found. Generate it from the Simulation section and click Refresh Saved Scores.</p>';
          return;
        }
        if (state.simOversize) {
          target.innerHTML = '<p class="empty">Simulation report is too large; showing a truncated view. Please regenerate with fewer data points.</p>';
        }
        const iframe = document.createElement("iframe");
        iframe.className = "sim-frame";
        iframe.title = "Simulation Report";
        iframe.loading = "lazy";
        iframe.setAttribute("sandbox", "allow-scripts allow-modals");
        iframe.srcdoc = state.sim.html;
        target.appendChild(iframe);
      }

      function renderReport(payload) {
        const now = new Date();
        const LAB_VERSION = "v1.0.0";
        const safeName = escapeHtml(payload.name);
        const safeEmail = escapeHtml(payload.email);
        const safeDesignation = escapeHtml(payload.designation);
        const improvement = payload.pre && payload.post
          ? payload.post.score - payload.pre.score
          : null;
        const improvementPct = payload.pre && payload.post && payload.pre.total > 0 && payload.post.total > 0
          ? Math.round(((payload.post.score / payload.post.total) - (payload.pre.score / payload.pre.total)) * 1000) / 10
          : null;
        const pass = payload.post && payload.post.total > 0
          ? (payload.post.score / payload.post.total >= 0.6)
          : false;

        const reportId = "R-" + Date.now().toString(36);
        const historyPreview = [ { timestamp: Date.now(), pre: payload.pre, post: payload.post }, ...loadHistory() ];
        const attemptCount = historyPreview.length;
        const bestPost = Math.max(...historyPreview.map(h => (h.post ? h.post.score : -Infinity)).filter(Number.isFinite));
        const lastAttemptTs = historyPreview[0]?.timestamp || Date.now();
        const previous = historyPreview[1];
        const deltaFromPrev = previous && previous.post ? (payload.post.score - previous.post.score) : null;

        placeholder.classList.add("hidden");
        reportContent.classList.remove("hidden");
        reportContent.innerHTML = `
          <div class="report-head">
            <div>
              <p class="eyebrow">User Details</p>
              <h3 style="margin:4px 0 2px;">${safeName}</h3>
              <p class="lede" style="margin:0;">${safeEmail} | ${safeDesignation}</p>
            </div>
            <div class="stamp">Generated ${now.toLocaleString()}</div>
          </div>

          <div class="report-grid">
            <div class="block">
              <h3>User Details</h3>
              <dl>
                <dt>Name</dt><dd>${safeName}</dd>
                <dt>Email ID</dt><dd>${safeEmail}</dd>
                <dt>Designation</dt><dd>${safeDesignation}</dd>
                <dt>Report ID</dt><dd>${reportId}</dd>
                <dt>Experiment</dt><dd>Load Test on DC Shunt Generator</dd>
                <dt>Objective</dt><dd>Study load characteristics and voltage regulation under varying load.</dd>
                <dt>Lab Version</dt><dd>${LAB_VERSION}</dd>
                <dt>Attempt Count</dt><dd>${attemptCount}</dd>
                <dt>Best Post-test</dt><dd>${Number.isFinite(bestPost) ? bestPost : "N/A"}</dd>
                <dt>Last Attempt</dt><dd>${new Date(lastAttemptTs).toLocaleString()}</dd>
              </dl>
            </div>

            <div class="block">
              <h3>Assessment Results</h3>
              <div class="stats">
                <div class="stat">
                  <span class="hint" style="margin:0;">Pre-test Score</span>
                  <strong>${formatScoreDisplay(payload.pre)}</strong>
                </div>
                <div class="stat">
                  <span class="hint" style="margin:0;">Post-test Score</span>
                  <strong>${formatScoreDisplay(payload.post)}</strong>
                </div>
                <div class="stat">
                  <span class="hint" style="margin:0;">Improvement</span>
                  <strong>${improvement !== null ? `${improvement >=0 ? "+" : ""}${improvement}` : "N/A"} (${improvementPct !== null ? (isFinite(improvementPct) ? `${improvementPct}%` : "N/A") : "N/A"})</strong>
                  <span class="hint" style="margin:0;">Status: ${pass ? "Pass" : "Fail"}</span>
                  <span class="hint" style="margin:0;">Change vs previous: ${deltaFromPrev !== null ? (deltaFromPrev>=0?"+":"")+deltaFromPrev : "N/A"}</span>
                </div>
              </div>
            </div>

            <div class="block">
              <h3>Simulation Details</h3>
              <p class="hint" id="simStatusText">
                ${state.attachSim
                  ? (state.sim && state.sim.updatedAt
                      ? "Attached from your latest simulation report saved " + parseStamp(state.sim.updatedAt) + "."
                      : "No simulation report available. Generate it in the Simulation section.")
                  : "Simulation report not attached (option unchecked)."}
              </p>
              <div id="simReportHolder" class="sim-wrapper"></div>
            </div>
          </div>

          <div class="actions" style="margin-top:4px;">
            <button type="button" class="btn-primary" onclick="window.print()">Print / Save as PDF</button>
          </div>
        `;

        const simHolder = reportContent.querySelector("#simReportHolder");
        renderSimulation(simHolder);
        reportContent.scrollIntoView({ behavior: "smooth", block: "start" });

        const snapshotJson = {
          reportId,
          timestamp: Date.now(),
          user: { name: payload.name, email: payload.email, designation: payload.designation },
          pre: payload.pre,
          post: payload.post,
          improvement,
          improvementPct,
          pass,
          simAttached: state.attachSim,
          simOversize: state.simOversize,
          metadata: { labVersion: "v1.0.0", experiment: "Load Test on DC Shunt Generator", objective: "Study load characteristics and voltage regulation under varying load." }
        };
        lastReportSnapshot = {
          html: reportContent.innerHTML,
          json: snapshotJson
        };

        saveHistoryEntry({ reportId, timestamp: snapshotJson.timestamp, pre: payload.pre, post: payload.post, sim: state.attachSim });
        renderHistory(loadHistory());
      }

      function resetReportView() {
        reportContent.classList.add("hidden");
        placeholder.classList.remove("hidden");
        reportContent.innerHTML = "";
      }

      function updateGenerateState() {
        const scoresReady = Boolean(state.pre && state.post);
        const simRequested = Boolean(attachSimCheckbox.checked);
        const simReady = !simRequested || Boolean(state.sim && state.sim.html);
        const ready = scoresReady && simReady;
        generateBtn.disabled = !ready;
        if (!scoresReady) {
          showMessage("New user or missing scores. Complete pre-test & post-test (and simulation if needed), then click Refresh.", "info");
        } else if (!simReady) {
          showMessage("Simulation report not found for this email. Generate it in the Simulation section (or uncheck “Attach latest Simulation Report”), then click Refresh.", "info");
        } else {
          hideMessage();
        }
      }

      function saveHistoryEntry(entry) {
        if (!currentHash) return;
        const key = userKey(currentHash, "history");
        const list = loadHistory();
        list.unshift(entry);
        if (list.length > 5) list.length = 5;
        storage.set(key, JSON.stringify(list));
      }

      function loadHistory() {
        if (!currentHash) return [];
        const raw = storage.get(userKey(currentHash, "history"));
        if (!raw) return [];
        try {
          const arr = JSON.parse(raw);
          return Array.isArray(arr) ? arr : [];
        } catch (e) { return []; }
      }

      function renderHistory(list) {
        if (!historyPanel || !historyList) return;
        if (!list || list.length === 0) {
          historyPanel.classList.add("hidden");
          historyList.innerHTML = "";
          return;
        }
        historyPanel.classList.remove("hidden");
        historyList.innerHTML = list.map((item, idx) => {
          const ts = new Date(item.timestamp || Date.now()).toLocaleString();
          const pre = item.pre ? `${item.pre.score}/${item.pre.total}` : "N/A";
          const post = item.post ? `${item.post.score}/${item.post.total}` : "N/A";
          return `<li class="history-item">
            <div class="history-meta">${ts} &bull; ID: ${item.reportId || "N/A"}</div>
            <div class="history-meta">Pre: ${pre} | Post: ${post} | Sim: ${item.sim ? "Attached" : "Not attached"}</div>
            <button type="button" class="btn-ghost history-view-btn" data-history-index="${idx}">View</button>
          </li>`;
        }).join("");
      }

      function viewHistoryEntry(index) {
        const list = loadHistory();
        const entry = list[index];
        if (!entry) {
          showMessage("History item not found.", "error");
          return;
        }
        state.pre = entry.pre || null;
        state.post = entry.post || null;
        state.sim = fetchSimulation();
        state.attachSim = Boolean(entry.sim && state.sim);
        attachSimCheckbox.checked = state.attachSim;
        renderScoreField(preInput, preHint, state.pre, "Pre-test");
        renderScoreField(postInput, postHint, state.post, "Post-test");
        resetReportView();
        const payload = {
          name: document.getElementById("fullName").value.trim(),
          email: document.getElementById("email").value.trim(),
          designation: document.getElementById("designation").value,
          pre: state.pre,
          post: state.post
        };
        renderReport(payload);
        showMessage("Loaded past report from history.", "success");
      }

      function setLoading(flag) {
        [refreshButton, generateBtn, resetButton, clearSavedButton].forEach(btn => {
          if (!btn) return;
          btn.disabled = flag;
        });
      }

      function downloadBlob(content, filename, type) {
        const blob = new Blob([content], { type });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
      }

      function downloadReportPdf() {
        if (!lastReportSnapshot) {
          showMessage("Generate a report first.", "error");
          return;
        }
        const simHtml = state.attachSim && state.sim && state.sim.html ? state.sim.html : null;
        let pdfBody = lastReportSnapshot.html;
        if (simHtml) {
          pdfBody = pdfBody.replace(
            /<div id="simReportHolder"[^>]*>[\s\S]*?<\/div>/,
            `<div id="simReportHolder" class="sim-wrapper"><div class="sim-frame sim-inline">${simHtml}</div></div>`
          );
        }
        const doc = `<!doctype html><html><head><meta charset="UTF-8"><title>Experiment Report</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Manrope:wght@500;600;700&display=swap" rel="stylesheet">
<style>
  @page { size: A4; margin: 18mm; }
  * { -webkit-print-color-adjust: exact; color-adjust: exact; }
  body { font-family: 'Manrope', Arial, sans-serif; margin: 0; padding: 0; background: #f5f7fb; color: #0b1224; }
  .pdf-wrapper { max-width: 760px; margin: 0 auto; padding: 10px 0 30px; }
  .pdf-head { display:flex; justify-content: space-between; align-items: center; gap: 12px; margin-bottom: 14px; }
  .pdf-title { font-size: 24px; margin: 0; }
  .pdf-meta { color: #4b5563; font-size: 13px; margin: 0; }
  .stamp { background: linear-gradient(135deg,#0f6ad8,#0bb9e8); color:#fff; padding:10px 14px; border-radius:12px; font-weight:700; font-size:14px; }
  .report-content { gap: 14px; display: grid; }
  .block { border:1px solid #d9e3f5; border-radius:12px; padding:14px 16px; background:#fff; box-shadow: 0 10px 30px rgba(15,23,42,0.06); }
  .block h3 { margin: 4px 0 6px; font-size:16px; }
  dl { margin:0; display:grid; grid-template-columns: auto 1fr; row-gap:8px; column-gap:10px; }
  dt { color:#6b7280; font-weight:600; }
  dd { margin:0; font-weight:700; }
  .stats { display:grid; grid-template-columns: repeat(auto-fit,minmax(180px,1fr)); gap:10px; }
  .stat { border:1px solid #d9e3f5; border-radius:12px; background:#f8fbff; padding:12px 14px; }
  .stat strong { display:block; font-size:20px; margin-top:4px; }
  .hint { color:#4b5563; font-size:13px; margin:4px 0 0; }
  .sim-frame { width:100%; min-height:900px; border:1px solid #e5e7eb; border-radius:12px; overflow:hidden; background:#fff; }
  .sim-inline iframe { width:100%; border:0; }
  .actions { display:none; }
</style>
</head><body onload="window.print();setTimeout(()=>window.close(),1200);"><div class="pdf-wrapper">
  <div class="pdf-head">
    <div>
      <p class="pdf-meta">AI-Enhanced Electrical Machines Lab</p>
      <h1 class="pdf-title">Experiment Progress Report</h1>
    </div>
    <div class="stamp">Ready for submission</div>
  </div>
  ${pdfBody}
</div></body></html>`;
        const blob = new Blob([doc], { type: "text/html" });
        const url = URL.createObjectURL(blob);
        const win = window.open(url);
        if (!win) {
          showMessage("Allow pop-ups to save the PDF.", "error");
        } else {
          win.focus();
        }
        setTimeout(() => URL.revokeObjectURL(url), 30000);
      }

      function exportUserData() {
        if (!currentHash) {
          showMessage("Enter an email first to export data.", "error");
          return;
        }
        const data = {
          pre: fetchScore("pretest"),
          post: fetchScore("posttest"),
          sim: fetchSimulation(),
          history: loadHistory()
        };
        downloadBlob(JSON.stringify(data, null, 2), "vlab_exp2_data.json", "application/json");
        showMessage("Exported data for this email hash.", "success");
      }

      function importUserDataFromObject(obj) {
        if (!currentHash) {
          showMessage("Enter an email first to import data.", "error");
          return;
        }
        try {
          if (obj.pre) {
            storage.set(userKey(currentHash, "pretest_score"), obj.pre.score);
            storage.set(userKey(currentHash, "pretest_total"), obj.pre.total);
            if (obj.pre.updatedAt) storage.set(userKey(currentHash, "pretest_updated_at"), obj.pre.updatedAt);
          }
          if (obj.post) {
            storage.set(userKey(currentHash, "posttest_score"), obj.post.score);
            storage.set(userKey(currentHash, "posttest_total"), obj.post.total);
            if (obj.post.updatedAt) storage.set(userKey(currentHash, "posttest_updated_at"), obj.post.updatedAt);
          }
          if (obj.sim && obj.sim.html) {
            storage.set(userKey(currentHash, "simulation_report_html"), obj.sim.html);
            if (obj.sim.updatedAt) storage.set(userKey(currentHash, "simulation_report_updated_at"), obj.sim.updatedAt);
          }
          if (Array.isArray(obj.history)) {
            storage.set(userKey(currentHash, "history"), JSON.stringify(obj.history));
          }
          refreshSavedData(true);
          showMessage("Imported data for this email hash.", "success");
        } catch (e) {
          showMessage("Import failed: invalid file.", "error");
        }
      }

      function resetEverything() {
        attachSimCheckbox.checked = false;
        state.attachSim = false;
        useScoresCheckbox.checked = false;
        state.useScores = false;
        form.reset();
        preInput.value = "";
        postInput.value = "";
        currentHash = null;
        storage.remove("vlab_exp2_active_user_hash");
        refreshSavedData(false);
        resetReportView();
        showMessage("Cleared form. Enter email and refresh to load saved data.", "info");
      }

      function handleEmailChange() {
        const currentEmail = emailInput.value.trim().toLowerCase();
        if (!currentEmail) {
          setLoading(false);
          currentHash = null;
          state.pre = state.post = state.sim = null;
          state.attachSim = false;
          state.useScores = false;
          attachSimCheckbox.checked = false;
          attachSimCheckbox.disabled = true;
          useScoresCheckbox.checked = false;
          storage.remove("vlab_exp2_active_user_hash");
          resetReportView();
          renderScoreField(preInput, preHint, null, "Pre-test");
          renderScoreField(postInput, postHint, null, "Post-test");
          renderHistory([]);
          generateBtn.disabled = true;
          showMessage("Enter your email to load saved progress or create a new report.", "info");
          return;
        }
        if (emailInput.validity && !emailInput.validity.valid) {
          setLoading(false);
          currentHash = null;
          state.pre = state.post = state.sim = null;
          state.attachSim = false;
          state.useScores = false;
          attachSimCheckbox.checked = false;
          attachSimCheckbox.disabled = true;
          useScoresCheckbox.checked = false;
          storage.remove("vlab_exp2_active_user_hash");
          resetReportView();
          renderScoreField(preInput, preHint, null, "Pre-test");
          renderScoreField(postInput, postHint, null, "Post-test");
          renderHistory([]);
          generateBtn.disabled = true;
          showMessage("Enter a valid email address to load saved progress.", "info");
          return;
        }
        // Immediately clear current view while we resolve the hash for the new user
        state.pre = state.post = state.sim = null;
        state.attachSim = false;
        attachSimCheckbox.checked = false;
        attachSimCheckbox.disabled = true;
        state.useScores = false;
        useScoresCheckbox.checked = false;
        resetReportView();
        renderHistory([]);
        renderScoreField(preInput, preHint, null, "Pre-test");
        renderScoreField(postInput, postHint, null, "Post-test");
        showMessage("Checking saved data for this email...", "info");
        setLoading(true);

        const reqId = ++currentHashRequestId;
        sha256(currentEmail).then((hash) => {
          if (reqId !== currentHashRequestId) { setLoading(false); return; } // stale request
          currentHash = hash;
          storage.set("vlab_exp2_active_user_hash", currentHash);
          importLegacyData(currentHash);
          refreshSavedData(true);
        }).catch(() => {
          if (reqId !== currentHashRequestId) return;
          currentHash = null;
          storage.remove("vlab_exp2_active_user_hash");
          setLoading(false);
          showMessage("Unable to process this email in your browser. Please try again.", "error");
        });
      }

      form.addEventListener("submit", (event) => {
        event.preventDefault();
        // Always fetch latest saved data in case simulation/pre/post were completed just now in another tab
        refreshSavedData(false);
        if (!form.reportValidity()) return;
        state.attachSim = attachSimCheckbox.checked;

        const currentEmail = emailInput.value.trim().toLowerCase();
        if (!currentEmail || !currentHash) {
          showMessage("Please enter a valid email to continue.", "error");
          return;
        }
        if (!state.pre || !state.post) {
          showMessage("Pre-test and Post-test scores are required for this email. Complete them and click Refresh Saved Scores.", "error");
          return;
        }

        if (state.attachSim && (!state.sim || !state.sim.html)) {
          showMessage("Simulation report not found. Generate it in the Simulation section, then click Refresh Saved Scores.", "error");
          return;
        }

        const payload = {
          name: document.getElementById("fullName").value.trim(),
          email: document.getElementById("email").value.trim(),
          designation: document.getElementById("designation").value,
          pre: state.pre,
          post: state.post
        };

        renderReport(payload);
        showMessage("Report generated successfully.", "success");
      });

      refreshButton.addEventListener("click", () => refreshSavedData(true));
      attachSimCheckbox.addEventListener("change", () => {
        state.attachSim = attachSimCheckbox.checked;
        resetReportView();
        updateGenerateState();
      });
      useScoresCheckbox.addEventListener("change", () => {
        refreshSavedData(false);
      });
      resetButton.addEventListener("click", resetEverything);
      clearSavedButton.addEventListener("click", () => {
        if (!currentHash) {
          showMessage("Enter an email first to clear saved data for that user.", "error");
          return;
        }
        const keys = [
          "pretest_score","pretest_total","pretest_updated_at",
          "posttest_score","posttest_total","posttest_updated_at",
          "simulation_report_html","simulation_report_updated_at",
          "history"
        ];
        keys.forEach(k => storage.remove(userKey(currentHash, k)));
        // also clear legacy (non-email) values so a page reload doesn't re-import old scores
        ["vlab_exp2_pretest_score","vlab_exp2_pretest_total","vlab_exp2_pretest_updated_at",
         "vlab_exp2_posttest_score","vlab_exp2_posttest_total","vlab_exp2_posttest_updated_at",
         "vlab_exp2_simulation_report_html","vlab_exp2_simulation_report_updated_at"
        ].forEach(k => storage.remove(k));
        state.pre = state.post = state.sim = null;
        state.attachSim = false;
        state.useScores = false;
        attachSimCheckbox.checked = false;
        attachSimCheckbox.disabled = true;
        useScoresCheckbox.checked = false;
        generateBtn.disabled = true;
        lastReportSnapshot = null;
        renderScoreField(preInput, preHint, null, "Pre-test");
        renderScoreField(postInput, postHint, null, "Post-test");
        renderHistory([]);
        resetReportView();
        showMessage("Saved data cleared on this device.", "success");
      });
      emailInput.addEventListener("input", handleEmailChange);
      downloadPdfBtn.addEventListener("click", downloadReportPdf);
      exportDataBtn.addEventListener("click", exportUserData);
      importDataBtn.addEventListener("click", () => importFile.click());
      importFile.addEventListener("change", (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
          try {
            const obj = JSON.parse(String(reader.result));
            importUserDataFromObject(obj);
          } catch (err) {
            showMessage("Import failed: invalid JSON.", "error");
          }
        };
        reader.readAsText(file);
        importFile.value = "";
      });
      historyList.addEventListener("click", (e) => {
        const btn = e.target.closest(".history-view-btn");
        if (!btn) return;
        const idx = Number(btn.dataset.historyIndex);
        if (Number.isInteger(idx)) viewHistoryEntry(idx);
      });
      window.addEventListener("storage", (e) => {
        if (!currentHash) return;
        if (e.key && e.key.startsWith(userKey(currentHash, ""))) {
          refreshSavedData(false);
        }
      });

      // on load: start clean; no auto data shown
      resetReportView();
      generateBtn.disabled = true;
      attachSimCheckbox.disabled = true;
      showMessage("Enter your email to load saved progress or create a new report.", "info");
    })();
