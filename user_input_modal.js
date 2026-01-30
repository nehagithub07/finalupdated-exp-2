(function () {
  let initialized = false;

  const fallbackProgress = {
    hasUser: () => false,
    declineReport: () => {},
    getState: () => ({ flags: {} }),
    initPage: () => {},
    mark: () => {},
  };

  const VP = () => (window.VLProgress ? window.VLProgress : fallbackProgress);

  function getPageName() {
    const parts = window.location.pathname.split("/");
    return parts.pop() || "index.html";
  }

  const modalsMarkup = `
    <div id="userFormPrompt" class="fixed inset-0 hidden items-center justify-center z-[99999] bg-black/60 p-4">
      <div class="w-full max-w-lg rounded-2xl bg-white shadow-xl border border-gray-200 p-6">
        <h3 class="text-xl font-bold text-gray-900">Alert</h3>
        <p class="text-gray-700 mt-2">
          If you want to generate a progress report, first you have to fill your details in the user form.
        </p>
        <div class="mt-5 flex justify-end gap-3">
          <button id="promptNo" class="px-4 py-2 rounded-lg border border-gray-300 font-semibold text-gray-700 hover:bg-gray-100">NO</button>
          <button id="promptYes" class="px-4 py-2 rounded-lg bg-blue-600 text-white font-semibold hover:bg-blue-700">YES</button>
        </div>
      </div>
    </div>

    <div id="userInputModal" class="hidden fixed inset-0 z-[100000] bg-black/60 px-4 py-8 items-center justify-center">
      <div class="relative w-full max-w-4xl h-[85vh] bg-white shadow-2xl rounded-3xl overflow-hidden border border-slate-200">
        <div class="flex items-center justify-between px-5 py-3 border-b border-slate-200">
          <h3 class="text-lg font-semibold text-slate-900">User Input Form</h3>
          <button id="userInputModalClose" type="button" class="text-slate-600 hover:text-slate-900 rounded-full">
            <span aria-hidden="true" class="text-2xl leading-none">&times;</span>
          </button>
        </div>
        <iframe id="userInputIframe" class="w-full h-full border-0" src="" title="User Input Form"></iframe>
      </div>
    </div>
  `;

  function ensureModals() {
    if (document.getElementById("userFormPrompt")) return;
    document.body.insertAdjacentHTML("beforeend", modalsMarkup);
  }

  function openPrompt() {
    const el = document.getElementById("userFormPrompt");
    if (!el) return;
    el.classList.remove("hidden");
    el.classList.add("flex");
  }

  function closePrompt() {
    const el = document.getElementById("userFormPrompt");
    if (!el) return;
    el.classList.add("hidden");
    el.classList.remove("flex");
  }

  function openUserInputModal(returnUrl) {
    const modal = document.getElementById("userInputModal");
    const iframe = document.getElementById("userInputIframe");
    if (!modal || !iframe) return;

    const params = new URLSearchParams();
    if (returnUrl) params.set("return", returnUrl);

    iframe.src = `user_input.html${params.toString() ? `?${params}` : ""}`;
    modal.classList.remove("hidden");
    modal.classList.add("flex");
    document.body.classList.add("overflow-hidden");
  }

  function closeUserInputModal() {
    const modal = document.getElementById("userInputModal");
    const iframe = document.getElementById("userInputIframe");
    if (!modal) return;
    modal.classList.add("hidden");
    modal.classList.remove("flex");
    document.body.classList.remove("overflow-hidden");
    if (iframe) iframe.src = "about:blank";
  }

  function disableProgressReportLinks() {
    document.querySelectorAll('[data-progress-report-link], a[href*="progressreport"]').forEach((a) => {
      a.classList.add("opacity-50", "cursor-not-allowed");
      a.setAttribute("aria-disabled", "true");
      a.setAttribute("title", "Fill the user form to enable Progress Report");
      a.style.opacity = "0.55";
      a.style.cursor = "not-allowed";
    });
  }

  function enableProgressReportLinks() {
    document.querySelectorAll('[data-progress-report-link], a[href*="progressreport"]').forEach((a) => {
      a.classList.remove("opacity-50", "cursor-not-allowed");
      a.removeAttribute("aria-disabled");
      a.removeAttribute("title");
      a.style.opacity = "";
      a.style.cursor = "";
    });
  }

  function init() {
    if (initialized) return;
    initialized = true;

    ensureModals();
    VP().initPage();

    const page = getPageName();
    const isAim = page === "aim.html";
    const returnUrl = isAim ? "aim.html#progressreport" : page;

    // Disable/enable report link
    if (VP().hasUser()) enableProgressReportLinks();
    else disableProgressReportLinks();

    // Intercept Progress Report clicks if locked
    document.addEventListener("click", (event) => {
      const a = event.target.closest("a");
      if (!a) return;
      const href = (a.getAttribute("href") || "").toLowerCase();
      if (!href.includes("progressreport")) return;

      if (VP().hasUser()) return;

      event.preventDefault();
      event.stopImmediatePropagation();
      openUserInputModal("progressreport.html");
    }, true);

    // Prompt on aim (optional)
    if (isAim) {
      setTimeout(() => {
        const state = VP().getState();
        if (!VP().hasUser() && !(state.flags && state.flags.reportDeclined)) openPrompt();
      }, 700);
    }

    document.getElementById("promptYes")?.addEventListener("click", () => {
      closePrompt();
      openUserInputModal("progressreport.html");
    });

    document.getElementById("promptNo")?.addEventListener("click", () => {
      closePrompt();
      VP().declineReport();
      disableProgressReportLinks();
    });

    document.getElementById("userInputModalClose")?.addEventListener("click", closeUserInputModal);

    document.getElementById("userInputModal")?.addEventListener("click", (e) => {
      if (e.target.id === "userInputModal") closeUserInputModal();
    });

    // Listen for form submit + simulation report generated
    window.addEventListener("message", (event) => {
      const allowedOrigin = window.location.origin;
      if (allowedOrigin !== "null" && event.origin !== allowedOrigin) return;

      const data = event.data;
      if (!data || !data.type) return;

      if (data.type === "vlab:user_input_cancel") {
        closeUserInputModal();
        return;
      }

      if (data.type === "vlab:user_input_submitted") {
        closeUserInputModal();
        enableProgressReportLinks();
        if (data.returnUrl) window.location.href = data.returnUrl;
        return;
      }

      if (data.type === "vlab:simulation_report_generated") {
        const html = typeof data.html === "string" ? data.html : "";
        const updatedAt = (data.updatedAt || String(Date.now())).toString();
        if (!html.trim()) return;

        try {
          localStorage.setItem("vlab_exp2_simulation_report_html", html);
          localStorage.setItem("vlab_exp2_simulation_report_updated_at", updatedAt);

          const activeHash = localStorage.getItem("vlab_exp2_active_user_hash");
          if (activeHash) {
            localStorage.setItem(`vlab_exp2_user_${activeHash}_simulation_report_html`, html);
            localStorage.setItem(`vlab_exp2_user_${activeHash}_simulation_report_updated_at`, updatedAt);
          }
        } catch {}

        // window.name fallback for file://
        try {
          const PREFIX = "VLAB_EXP2::";
          let wn = {};
          if (typeof window.name === "string" && window.name.startsWith(PREFIX)) {
            wn = JSON.parse(window.name.slice(PREFIX.length)) || {};
          }
          wn["vlab_exp2_simulation_report_html"] = html;
          wn["vlab_exp2_simulation_report_updated_at"] = updatedAt;
          window.name = PREFIX + JSON.stringify(wn);
        } catch {}
      }
    });
  }

  init();
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
})();
