const NEEDLE_TRANSFORM_TRANSLATE = "translate(-50%, -82.5%)";

// Calibrated for the 0-30 A ammeters and 0-410 V voltmeters used in this lab.
const AMMETER_MIN_ANGLE = -69;
const AMMETER_MID_ANGLE = 0;
const AMMETER_MAX_ANGLE = 91.4;

const VOLTMETER_MIN_ANGLE = -76;
const VOLTMETER_MID_ANGLE = 0;
const VOLTMETER_MAX_ANGLE = 86.6;

function clamp(val, min, max) {
  return Math.min(Math.max(val, min), max);
}

// Piecewise linear mapping: [minValue..midValue] -> [minAngle..midAngle], [midValue..maxValue] -> [midAngle..maxAngle]
function valueToMeterAngle(value, { minValue, midValue, maxValue, minAngle, midAngle, maxAngle }) {
  const v = clamp(Number(value) || 0, minValue, maxValue);

  if (v <= midValue) {
    const t = (v - minValue) / (midValue - minValue || 1);
    return minAngle + (midAngle - minAngle) * t;
  } else {
    const t = (v - midValue) / (maxValue - midValue || 1);
    return midAngle + (maxAngle - midAngle) * t;
  }
}

function currentToAngle(currentValue) {
  // Ammeter artwork: 0-30 A with 15 at top center
  return valueToMeterAngle(currentValue, {
    minValue: 0,
    midValue: 15,
    maxValue: 30,
    minAngle: AMMETER_MIN_ANGLE,
    midAngle: AMMETER_MID_ANGLE,
    maxAngle: AMMETER_MAX_ANGLE
  });
}

function voltageToAngle(voltageValue) {
  // Voltmeter artwork: 0-410 V with 180 at top center (compressed right span).
  return valueToMeterAngle(voltageValue, {
    minValue: 0,
    midValue: 180,
    maxValue: 410,
    minAngle: VOLTMETER_MIN_ANGLE,
    midAngle: VOLTMETER_MID_ANGLE,
    maxAngle: VOLTMETER_MAX_ANGLE
  });
}
 
(function initObservations() {
  const sessionStartMs = Date.now();
  const sessionStart =
    typeof window.sessionStart === "number" ? window.sessionStart : sessionStartMs;
  if (typeof window.sessionStart !== "number") {
    window.sessionStart = sessionStart;
  }
  if (typeof window.labTracking?.markSimulationStart === "function") {
    window.labTracking.markSimulationStart(sessionStart);
  }
  const minGraphPoints = 6;
  const lampSelect = document.getElementById("number");
  const bulbs = Array.from(document.querySelectorAll(".lamp-bulb"));

  const observationBody = document.getElementById("observationBody");
  const graphBars = document.getElementById("graphBars");
  const graphPlot = document.getElementById("graphPlot");
  const graphSection = document.querySelector(".graph-section");
  const graphCanvas = document.querySelector(".graph-canvas");

  const addTableBtn =
    findButtonByLabel("Add Table") ||
    findButtonByLabel("Add To Table") ||
    findButtonByLabel("Add");
  const graphBtn = findButtonByLabel("Graph");
  const resetBtn = findButtonByLabel("Reset");
  const printBtn = findButtonByLabel("Print");
  const reportBtn = findButtonByLabel("Report");
[addTableBtn, graphBtn, resetBtn, printBtn, reportBtn].forEach((btn) => {
  if (btn) btn.setAttribute("type", "button");
});

// Stop Enter key from submitting while editing the observation table
document.addEventListener("keydown", (e) => {
  const inObservationTable = e.target && e.target.closest && e.target.closest("#observationTable");
  if (inObservationTable && e.key === "Enter") {
    e.preventDefault();
  }
});
  const needle1 = document.querySelector(".meter-needle1"); // Ammeter-1 (motor current)
  const needle2 = document.querySelector(".meter-needle2"); // Ammeter-2 (load current)
  const needle3 = document.querySelector(".meter-needle3"); // Voltmeter-1 (supply voltage)
  const needle4 = document.querySelector(".meter-needle4"); // Voltmeter-2 (terminal voltage)

  // Reading sets pulled from the legacy implementation
  const ammeter1Readings = [3, 3.6, 5.4, 6.8, 8, 10, 11.5, 13, 14.2, 15.2];
  const voltmeter1Readings = [225, 225, 225, 225, 225, 225, 225, 225, 225, 225];
  const ammeter2Readings = [1.2, 2.8, 3.2, 3.6, 5.5, 7, 8.1, 10.2, 11, 12.7];
  const voltmeter2Readings = [220, 212, 208, 205, 200, 195, 189, 184, 179, 176];
  // Optional manual needle angles (degrees) per bulb index; edit as needed.
  const ammeter1ManualAngles = [-58.5, -55.4, -46.1, -41, -34.8, -26.2, -18.6, -11, -2.5, 2];
  const ammeter2ManualAngles = [-63.1, -58.9, -57, -54.9, -46.8, -38.7, -33.8, -24.0, -20, -13];
  // Override voltmeter-1 dial to land on ~225 V once starter is on.
  const voltmeter1ManualAngles = [5.5, 5.5, 5.5, 5.5, 5.5, 5.5, 5.5, 5.5, 5.5, 5.5];
  const voltmeter2ManualAngles = [3, 1, -1, -3, -5, -7.8, -10, -13, -17, -20];
  const GRAPH_TITLE_TEXT = "Terminal Voltage (V) vs Load Current (A)";
  const GRAPH_X_AXIS_LABEL = "Load Current (A)";
  const GRAPH_Y_AXIS_LABEL = "Terminal Voltage (V)";
  const GRAPH_X_TICK_VALUES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16];

  const readingsRecorded = [];
  let selectedIndex = -1;
  let readingArmed = false;
  let addReadingAlertShown = false;
  let graphReadyAnnounced = false;
  let graphPlotAlertShown = false;
  let graphPlotted = false;
  let allReadingsAlertShown = false;

  function speechIsActive() {
    return (
      typeof window !== "undefined" &&
      window.labSpeech &&
      typeof window.labSpeech.isActive === "function" &&
      window.labSpeech.isActive()
    );
  }

  function speak(input) {
    const payload = input;
    const text = getSpeechText(payload);
    const hasKeyedPayload =
      payload && typeof payload === "object" && !Array.isArray(payload) && !!payload.key;
    if ((!text && !hasKeyedPayload) || !speechIsActive()) return;
    if (window.labSpeech && typeof window.labSpeech.say === "function") {
      window.labSpeech.say(payload, { interruptFirst: true });
    }
  }

  function speakOrAlert(input) {
    const text = getSpeechText(input);
    if (!text) return;
    if (speechIsActive()) speak(input);
    else showPopup(text);
  }

  function updateGraphControls() {
    const enoughReadings = readingsRecorded.length >= minGraphPoints;
    if (graphBtn) graphBtn.disabled = !enoughReadings;
    if (reportBtn) reportBtn.disabled = !enoughReadings || !graphPlotted;
  }

  function enforceReady(action) {
    if (!connectionsVerified) {
      speakOrAlert(buildVoicePayload("please_check_connections_first"));
      if (action === "lampSelect" && lampSelect) {
        lampSelect.value = "";
        selectedIndex = -1;
        readingArmed = false;
        updateBulbs(0);
        updateNeedles(-1);
      }
      return false;
    }
    if (!mcbOn) {
      speakOrAlert(buildVoicePayload("please_turn_on_mcb"));
      return false;
    }
    if (!starterMoved) {
      speakOrAlert(buildVoicePayload("please_move_starter"));
      return false;
    }
    return true;
  }

  function setNeedleRotation(el, angleDeg) {
    if (!el) return;
    el.style.transform = `${NEEDLE_TRANSFORM_TRANSLATE} rotate(${angleDeg}deg)`;
  }

  // Show supply voltage as soon as the starter handle is moved to ON.
  window.addEventListener(STARTER_MOVED_EVENT, () => {
    if (!needle3) return;
    // Use the same calibrated/manual angle used during readings.
    const starterAngle = resolveAngle(voltmeter1ManualAngles, 0, voltageToAngle(225));
    setNeedleRotation(needle3, starterAngle);
  });

  // Park voltmeter-1 when the MCB is turned off.
  window.addEventListener(MCB_TURNED_OFF_EVENT, () => {
    if (!needle3) return;
    setNeedleRotation(needle3, voltageToAngle(0));
  });

  function resolveAngle(manualAngles, idx, fallbackAngle) {
    const manual = manualAngles && Number.isFinite(manualAngles[idx]) ? manualAngles[idx] : null;
    return Number.isFinite(manual) ? manual : fallbackAngle;
  }

  function updateBulbs(count) {
    bulbs.forEach((bulb, idx) => {
      const isOn = idx < count;
      bulb.src = isOn ? "../images/on-bulb.png" : "../images/off-bulb.png";
      bulb.classList.toggle("on", isOn);
      bulb.classList.toggle("off", !isOn);
    });
  }

  /* ✅ REPLACED: calibrated updateNeedles() (uses global currentToAngle/voltageToAngle) */
  function updateNeedles(idx) {
    const safeIdx = Number.isFinite(idx) ? idx : -1;

    if (safeIdx < 0) {
      // park needles at 0
      setNeedleRotation(needle1, currentToAngle(0));
      setNeedleRotation(needle2, currentToAngle(0));
      setNeedleRotation(needle3, voltageToAngle(0));
      setNeedleRotation(needle4, voltageToAngle(0));
      return;
    }

    setNeedleRotation(
      needle1,
      resolveAngle(ammeter1ManualAngles, safeIdx, currentToAngle(ammeter1Readings[safeIdx]))
    );
    setNeedleRotation(
      needle2,
      resolveAngle(ammeter2ManualAngles, safeIdx, currentToAngle(ammeter2Readings[safeIdx]))
    );
    setNeedleRotation(
      needle3,
      resolveAngle(voltmeter1ManualAngles, safeIdx, voltageToAngle(voltmeter1Readings[safeIdx]))
    );
    setNeedleRotation(
      needle4,
      resolveAngle(voltmeter2ManualAngles, safeIdx, voltageToAngle(voltmeter2Readings[safeIdx]))
    );
  }

  /* ===== everything below remains SAME as your current code ===== */

  function renderGraph() {
    if (readingsRecorded.length < minGraphPoints) {
      speakOrAlert(`Please take at least ${minGraphPoints} readings in the table.`);
      return;
    }
    graphPlotted = false;

    const currents = readingsRecorded.map(r => r.current);
    const voltages = readingsRecorded.map(r => r.voltage);

    function ensurePlotly() {
      if (window.Plotly) return Promise.resolve();
      return new Promise((resolve, reject) => {
        const script = document.createElement("script");
        script.src = "https://cdn.plot.ly/plotly-3.0.1.min.js";
        script.onload = () => resolve();
        script.onerror = reject;
        document.head.appendChild(script);
      });
    }

    ensurePlotly()
      .then(() => {
        if (!graphPlot) return;

        const trace = {
          x: currents,
          y: voltages,
          mode: "lines+markers",
          type: "scatter",
          name: GRAPH_TITLE_TEXT,
          marker: { color: "#1b6fb8", size: 8 },
          line: { color: "#1b6fb8", width: 3 }
        };
        const layout = {
          title: { text: `<b>${GRAPH_TITLE_TEXT}</b>` },
          margin: { l: 60, r: 20, t: 40, b: 50 },
          xaxis: {
            title: `<b>${GRAPH_X_AXIS_LABEL}</b>`,
            gridcolor: "rgba(0, 0, 0, 0.07)",
            tickmode: "array",
            tickvals: GRAPH_X_TICK_VALUES
          },
          yaxis: { title: `<b>${GRAPH_Y_AXIS_LABEL}</b>`, gridcolor: "rgba(0, 0, 0, 0.07)" },
          paper_bgcolor: "rgba(0,0,0,0)",
          plot_bgcolor: "rgba(0,0,0,0)"
        };

        if (graphBars) graphBars.style.display = "none";
        graphPlot.style.display = "block";
        if (graphCanvas) graphCanvas.classList.add("is-plotting");

        window.Plotly.newPlot(graphPlot, [trace], layout, { displaylogo: false, responsive: true });
        graphPlotted = true;
        window.labTracking?.recordStep?.("Graph plotted");
        stepGuide.complete("graph");
        updateGraphControls();
        if (!graphPlotAlertShown) {
          graphPlotAlertShown = true;
          showPopup("Graph plotted. You can now generate the report.", "Graph Ready");
        }
        speak(buildVoicePayload("graph_complete"));
      })
      .catch(() => {
        graphPlotted = false;
        showPopup("Unable to load graphing library. Please check your connection and try again.", "Graph Error");
      });
  }

  function escapeHtml(text) {
    return String(text)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function generateReport() {
    const tableEl = document.getElementById("observationTable");
    if (!tableEl) {
      speakOrAlert("Report table not found.");
      return;
    }
    if (!graphPlotted) {
      speakOrAlert("Please plot the graph before generating the report.");
      return;
    }

    const rows = Array.from(tableEl.rows || []);
    const observationRows = [];
    const currentValues = [];
    const voltageValues = [];

    rows.slice(1).forEach((row) => {
      const cells = Array.from(row.cells);
      if (cells.length >= 3) {
        const entry = {
          sNo: cells[0].textContent.trim() || (observationRows.length + 1),
          current: cells[1].textContent.trim(),
          voltage: cells[2].textContent.trim()
        };
        observationRows.push(entry);
        const cVal = parseFloat(entry.current);
        const vVal = parseFloat(entry.voltage);
        if (!Number.isNaN(cVal)) currentValues.push(cVal);
        if (!Number.isNaN(vVal)) voltageValues.push(vVal);
      }
    });

    const now = new Date();
    // Ensure all relative assets resolve correctly inside the new report window and in html2canvas.
    const baseHref =
      (() => {
        try {
          const link = document.createElement("a");
          link.href = window.location.href;
          // strip file name, keep trailing slash
          link.pathname = link.pathname.replace(/[^/]*$/, "");
          return link.href;
        } catch (e) {
          return document.baseURI || window.location.href;
        }
      })();
    const logoLeftSrc = new URL("../images/IIT Logo.png", baseHref).toString();
    const logoRightSrc = new URL("../images/image.png", baseHref).toString();
    const css = `
body {
  font-family: 'Inter', 'Segoe UI', sans-serif;
  background: #f3f6fb;
  color: #1f2d3d;
  margin: 40px auto;
  max-width: 960px;
  padding: 32px;
  background-color: #ffffff;
  border-radius: 16px;
  border: 1px solid #e5e9f2;
  box-shadow: 0 10px 30px rgba(31, 45, 61, 0.12);
  line-height: 1.65;
}
h1, h2, h3 { color: #1f2d3d; margin-top: 0; font-weight: 700; }
h1 {
  font-size: 28px;
  margin-bottom: 14px;
  padding-bottom: 10px;
  border-bottom: 3px solid #2f7bfa;
}
h2 { font-size: 22px; margin-bottom: 10px; color: #2b3f55; }
h3 { font-size: 18px; margin-bottom: 8px; }
.section {
  background: linear-gradient(135deg, #f8fbff 0%, #f3f6fb 100%);
  padding: 20px 22px;
  margin-bottom: 28px;
  border-radius: 12px;
  border: 1px solid #e5e9f2;
  box-shadow: 0 4px 12px rgba(31,45,61,0.06);
}
.label { font-weight: 600; color: #1f2d3d; }
ul { padding-left: 20px; margin-top: 10px; }
.two-column-list { column-count: 2; column-gap: 40px; list-style-position: inside; margin-top: 10px; }
.info-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 12px;
  margin-top: 12px;
}
.info-card {
  background: #fff;
  border: 1px solid #e5e9f2;
  border-radius: 10px;
  padding: 12px 14px;
  box-shadow: 0 4px 10px rgba(31,45,61,0.05);
  font-size: 14px;
}
table {
  width: 100%;
  border-collapse: collapse;
  margin-top: 15px;
  box-shadow: 0 2px 10px rgba(31, 45, 61, 0.06);
  background-color: white;
  border-radius: 10px;
  overflow: hidden;
}
th, td {
  border: 1px solid #e5e9f2;
  padding: 12px;
  text-align: center;
  font-size: 15px;
}
th {
  background: linear-gradient(135deg, #2f7bfa 0%, #1f62d0 100%);
  color: white;
  font-weight: 700;
  letter-spacing: 0.2px;
}
tr:nth-child(even) { background-color: #f8fbff; }
.graph {
  text-align: center;
  margin-top: 24px;
  padding: 20px;
  border: 1px solid #e5e9f2;
  border-radius: 12px;
  background: #ffffff;
  box-shadow: 0 4px 10px rgba(31,45,61,0.06);
}
.header-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 26px;
}
.header-row h1 {
  flex: 1;
  text-align: center;
  margin: 0;
}
.badge {
  padding: 8px 14px;
  border-radius: 20px;
  background: #e8f1ff;
  color: #1f62d0;
  font-weight: 600;
  font-size: 13px;
}
.vl-logo {
  height: 100px;
  width: auto;
  max-width: 200px;
  object-fit: contain;
  flex-shrink: 0;
}
.report-actions {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  margin-top: 28px;
}
.print-btn,
.download-btn {
  padding: 12px 24px;
  font-size: 15px;
  border: none;
  border-radius: 30px;
  color: white;
  cursor: pointer;
  transition: all 0.25s ease;
}
.print-btn {
  background: linear-gradient(to right, #2f7bfa, #1f62d0);
}
.download-btn {
  background: linear-gradient(to right, #28a745, #1f8d38);
}
.print-btn:hover,
.download-btn:hover {
  transform: translateY(-2px);
  box-shadow: 0 6px 14px rgba(31,45,61,0.12);
}
@media print {
  .print-btn,
  .download-btn,
  .report-actions { display:none; }
  body { margin:0; box-shadow:none; border:none; padding:0; }
}
    `;

    const startTimeText = new Date(sessionStart).toLocaleTimeString();
    const endTime = Date.now();
    const endTimeText = new Date(endTime).toLocaleTimeString();
    const durationMs = Math.max(0, endTime - sessionStart);
    const durationTotalSeconds = Math.floor(durationMs / 1000);
    const durationMinutes = Math.floor(durationTotalSeconds / 60);
    const durationSeconds = durationTotalSeconds % 60;
    const durationText = `${durationMinutes} min ${String(durationSeconds).padStart(2, "0")} sec`;
    if (typeof window.labTracking?.markSimulationEnd === "function") {
      window.labTracking.markSimulationEnd(endTime);
    }
    window.labTracking?.recordStep?.("Simulation report generated");

    const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Simulation Report</title>
  <base href="${baseHref}">
  <style>${css}</style>
  <script src="https://cdn.plot.ly/plotly-3.0.1.min.js"></script>
</head>
<body id="report-root">
<div class="header-row">
  <img src="${logoLeftSrc}" class="vl-logo" />
  <h1>Virtual Labs Simulation Report</h1>
  <img src="${logoRightSrc}" class="vl-logo" />
</div>

  <div class="section">
    <p class="badge">Electrical Machines Lab</p>
    <p><span class="label">Experiment Title:</span>To study the Load Characteristics of DC shunt generator</p>
    <p><span class="label">Date:</span> ${now.toLocaleDateString()}</p>
    <div class="info-grid">
        <div class="info-card"><span class="label">Start Time:</span><br>${startTimeText}</div>
        <div class="info-card"><span class="label">End Time:</span><br>${endTimeText}</div>
        <div class="info-card"><span class="label">Total Time Spent:</span><br>${durationText}</div>
      </div>
    </div>

  <div class="section">
    <h2>Summary</h2>
    <h3>Aim</h3>
    <p style="text-align:justify;">To study the external characteristic of a DC shunt generator by varying the lamp load, measuring the terminal voltage and load current, and plotting the terminal voltage versus load current (V–I) curve.</p>

    <h3>Simulation Summary</h3>
    <p style="text-align:justify;">Connections were completed as instructed, supply was switched ON, lamp load was varied, and the corresponding load current and terminal voltage readings were recorded, and a graph was generated between terminal voltage and load current.</p>

    <h3>Components and key Parameters</h3>
    <ul class="two-column-list">
      <li>MCB</li>
      <li>3-Point Starter: 220V DC, 7.5 HP</li>
      <li>DC Shunt Motor: 5 HP, 220 V DC, 19 A (max), 1500 RPM</li>
      <li>DC Shunt Generator: 3 kW, 220 V DC, 1500 RPM</li>
      <li>Load Type: Resistive Lamp Load</li>
      <li>Bulbs: 10 × 200 W each</li>
      <li>DC Voltmeter: 0-420 V</li>
      <li>DC Ammeter: 0-30 A</li>
      <li>Connecting Leads</li>
    </ul>
 
  </div>

  <div class="section">
    <h3>Observation Table</h3>
    <table>
      <thead>
        <tr><th>S.No.</th><th>Load Current (A)</th><th>Terminal Voltage (V)</th></tr>
      </thead>
      <tbody>
        ${observationRows.length ? observationRows.map(function (r) {
            return "<tr><td>" + r.sNo + "</td><td>" + r.current + "</td><td>" + r.voltage + "</td></tr>";
        }).join("") : "<tr><td colspan='3'>No readings recorded.</td></tr>"}
      </tbody>
    </table>
  </div>

  <div class="section graph">
    <h3>Graph</h3>
    <div id="report-graph" style="position:relative;width:100%;height:360px;"></div>
  </div>

  <div class="report-actions">
    <button class="print-btn" onclick="window.print()">PRINT</button>
    <button class="download-btn" onclick="downloadReport()">DOWNLOAD</button>
  </div>

  <script>
    (function() {
      var currents = ${JSON.stringify(currentValues)};
      var voltages = ${JSON.stringify(voltageValues)};
      var graphTitle = ${JSON.stringify(GRAPH_TITLE_TEXT)};
      var graphXAxisLabel = ${JSON.stringify(GRAPH_X_AXIS_LABEL)};
      var graphYAxisLabel = ${JSON.stringify(GRAPH_Y_AXIS_LABEL)};
      var graphXTickValues = ${JSON.stringify(GRAPH_X_TICK_VALUES)};
      var graphContainer = document.getElementById('report-graph');
      var graphReady = Promise.resolve();

      if (currents.length && voltages.length) {
         var trace = { x: currents, y: voltages, type: 'scatter', mode: 'lines+markers', name: graphTitle, line: { color: '#3498db' } };
        var layout = {
          title: { text: '<b>' + graphTitle + '</b>' },
          xaxis: {
            title: { text: '<b>' + graphXAxisLabel + '</b>', standoff: 12 },
            automargin: true,
            tickmode: 'array',
            tickvals: graphXTickValues
          },
          yaxis: { title: { text: '<b>' + graphYAxisLabel + '</b>', standoff: 12 }, automargin: true },
          margin: { t: 70, r: 30, l: 80, b: 70 }
        };
        graphReady = Plotly.newPlot('report-graph', [trace], layout, {displaylogo:false}).then(function(gd) {
          return Plotly.toImage(gd, {format:'png', width: gd.offsetWidth || 900, height: gd.offsetHeight || 360});
        }).then(function(imgData) {
          var img = new Image();
          img.src = imgData;
          img.alt = graphTitle;
          img.style.maxWidth = '100%';
          img.style.height = 'auto';
          graphContainer.innerHTML = '';
          graphContainer.appendChild(img);
        }).catch(function() {
          // keep the interactive graph if snapshot fails
        });
      } else {
        graphContainer.innerHTML = '<em>No readings available to plot.</em>';
      }

      window.reportGraphReady = graphReady;
    })();
    function ensureHtml2Pdf() {
      return new Promise(function(resolve, reject) {
        if (window.html2pdf) return resolve();
        var script = document.createElement('script');
        script.src = 'https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js';
        script.onload = resolve;
        script.onerror = reject;
        document.head.appendChild(script);
      });
    }
    function downloadReport() {
      var waitForGraph = window.reportGraphReady || Promise.resolve();
      waitForGraph.then(ensureHtml2Pdf).then(function() {
        var element = document.getElementById('report-root') || document.body;
        var opts = {
          margin: [0.3, 0.3, 0.3, 0.3],
          filename: 'simulation-report.pdf',
          image: { type: 'jpeg', quality: 0.98 },
          html2canvas: { scale: 2, useCORS: true, scrollX: 0, scrollY: 0 },
          jsPDF: { unit: 'in', format: 'a4', orientation: 'portrait' }
        };
        return window.html2pdf().set(opts).from(element).save();
      }).catch(function() {
        alert('Unable to download the report automatically. Please use your browser\\'s Save as PDF option.');
      });
    }
</script>
</body>
</html>`;

    try {
      const stamp = String(Date.now());
      localStorage.setItem("vlab_exp2_simulation_report_html", html);
      localStorage.setItem("vlab_exp2_simulation_report_updated_at", stamp);
      const activeHash = localStorage.getItem("vlab_exp2_active_user_hash");
      if (activeHash) {
        localStorage.setItem(`vlab_exp2_user_${activeHash}_simulation_report_html`, html);
        localStorage.setItem(`vlab_exp2_user_${activeHash}_simulation_report_updated_at`, stamp);
      }
    } catch (e) {}

    const reportWindow = window.open("", "report");
    if (!reportWindow) {
      speakOrAlert("Please allow pop-ups to view the report.");
      return;
    }

    try {
      reportWindow.document.open("text/html", "replace");
      reportWindow.document.write(html);
      reportWindow.document.close();
      reportWindow.focus();
    } catch (err) {
      try {
        const blob = new Blob([html], { type: "text/html" });
        const url = URL.createObjectURL(blob);
        reportWindow.location = url;
        setTimeout(function () {
          URL.revokeObjectURL(url);
        }, 5000);
      } catch (err2) {
        console.error("Report generation failed:", err2);
        speakOrAlert("Unable to render the report. Please disable popup blockers and try again.");
      }
    }
  }

  function handleReportClick() {
    if (!graphPlotted) {
      speakOrAlert("Please plot the graph before generating the report.");
      return;
    }
    showPopup(
      getSpeechText(buildVoicePayload("report_ready")),
      "Report Ready"
    );
    if (speechIsActive()) {
      speak(buildVoicePayload("report_ready"));
    }
    waitForWarningModalAcknowledgement().then(() => {
      generateReport();
    });
  }

  function addRowToTable(idx) {
    if (!observationBody) return;
    const placeholder = observationBody.querySelector(".placeholder-row");
    if (placeholder) placeholder.remove();

    const row = document.createElement("tr");
    const serial = readingsRecorded.length; // already includes new entry
    const a2 = ammeter2Readings[idx];
    const v2 = voltmeter2Readings[idx];

    row.innerHTML = `<td>${serial}</td><td>${a2}</td><td>${v2}</td>`;
    observationBody.appendChild(row);
  }

  function handleAddReading() {
    if (!enforceReady("addReading")) return;
    if (selectedIndex < 0) {
      speakOrAlert(buildVoicePayload("before_add_table_select_bulbs"));
      return;
    }
    if (!readingArmed) {
      speakOrAlert(buildVoicePayload("duplicate_reading"));
      return;
    }
    if (readingsRecorded.length >= 10) {
      speakOrAlert(buildVoicePayload("max_readings"));
      return;
    }

    const load = selectedIndex + 1;
    if (readingsRecorded.some((reading) => reading.load === load)) {
      showPopup(
        getSpeechText(buildVoicePayload("duplicate_reading")),
        "Duplicate Reading"
      );
      if (speechIsActive()) {
        speak(buildVoicePayload("duplicate_reading"));
      }
      readingArmed = false;
      return;
    }

    readingsRecorded.push({
      load,
      current: ammeter2Readings[selectedIndex],
      voltage: voltmeter2Readings[selectedIndex]
    });
    window.labTracking?.recordStep?.(`Reading added (Load ${load})`);

    addRowToTable(selectedIndex);
    graphPlotted = false;
    if (!addReadingAlertShown) {
      addReadingAlertShown = true;
      showPopup("Reading added to the observation table.", "Observation");
      speak(buildVoicePayload("reading_added"));
    }
    if (!allReadingsAlertShown && readingsRecorded.length === 10) {
      allReadingsAlertShown = true;
      showPopup(
        "All 10 readings have been recorded. Now, plot the graph and then click on the report button to generate your report.",
        "All Readings Added"
      );
      speak(buildVoicePayload("after_ten_readings_done"));
    }
    readingArmed = false;
    stepGuide.complete("reading");

    updateGraphControls();

    if (readingsRecorded.length < minGraphPoints) {
      speak(buildVoicePayload("after_first_reading_added"));
    } else if (readingsRecorded.length >= minGraphPoints && readingsRecorded.length < 10) {
      speak(buildVoicePayload("graph_or_more_readings"));
    }

    if (!graphReadyAnnounced && readingsRecorded.length >= minGraphPoints) {
      graphReadyAnnounced = true;
      showPopup(
        "You have added 6 readings. Now you can plot the graph.",
        "Graph Ready"
      );
    }
  }

  function handleSelectionChange() {
    if (!enforceReady("lampSelect")) {
      lampSelect.value = "";
      selectedIndex = -1;
      readingArmed = false;
      updateBulbs(0);
      updateNeedles(-1);
      return;
    }

    const count = parseInt(lampSelect.value, 10);
    if (isNaN(count) || count < 1 || count > 10) {
      selectedIndex = -1;
      readingArmed = false;
      updateBulbs(0);
      updateNeedles(-1);
      return;
    }

    selectedIndex = count - 1;
    readingArmed = true;

    updateBulbs(count);
    updateNeedles(selectedIndex);

    if (readingsRecorded.length === 0) {
      speak(buildVoicePayload("first_reading_selected"));
    } else {
      speak(buildVoicePayload("second_reading"));
    }
  }

  function resetObservations() {
    const wasGuiding =
      typeof window.isGuideActive === "function" && window.isGuideActive();

    if (window.labSpeech && typeof window.labSpeech.stop === "function") {
      window.labSpeech.stop();
    }

    if (wasGuiding && window.labSpeech && typeof window.labSpeech.speak === "function") {
      window.labSpeech.speak(buildVoicePayload("reset"), {
        onend: () => {
          if (typeof window.stopGuideSpeech === "function") {
            window.stopGuideSpeech();
          } else {
            resetSpeakButtonUI();
          }
        }
      });
    } else {
      resetSpeakButtonUI();
      if (typeof window.stopGuideSpeech === "function") {
        window.stopGuideSpeech();
      }
    }

    if (window.jsPlumb) {
      if (typeof jsPlumb.deleteEveryConnection === "function") jsPlumb.deleteEveryConnection();
      else if (typeof jsPlumb.getAllConnections === "function") jsPlumb.getAllConnections().forEach(c => jsPlumb.deleteConnection(c));
      if (typeof jsPlumb.repaintEverything === "function") jsPlumb.repaintEverything();
    }

    readingsRecorded.length = 0;
    addReadingAlertShown = false;
    graphReadyAnnounced = false;
    graphPlotAlertShown = false;
    graphPlotted = false;
    allReadingsAlertShown = false;

    // Re-enable primary controls after reset
    const resetCheckBtn = findButtonByLabel("Check") || findButtonByLabel("Check Connections");
    if (resetCheckBtn) resetCheckBtn.disabled = false;
    const resetAutoBtn = findButtonByLabel("Auto Connect");
    if (resetAutoBtn) {
      resetAutoBtn.disabled = false;
      delete resetAutoBtn.dataset.checkedLocked;
      delete resetAutoBtn.dataset.guideLocked;
    }

    if (observationBody) {
      observationBody.innerHTML = "";
    }

    selectedIndex = -1;
    readingArmed = false;
    if (lampSelect) lampSelect.value = "";

    updateBulbs(0);
    updateNeedles(-1);

    if (graphBars) graphBars.style.display = "block";
    if (graphPlot) {
      graphPlot.innerHTML = "";
      graphPlot.style.display = "none";
    }
    if (graphCanvas) graphCanvas.classList.remove("is-plotting");

    connectionsVerified = false;
    starterMoved = false;
    mcbOn = false;

    sharedControls.setMcbState(false, { silent: true });

    const starter = sharedControls.starterHandle || document.querySelector(".starter-handle");
    if (starter) {
      starter.style.left = "16.67%";
      starter.style.top = "37.04%";
      starter.classList.remove("moved");
    }

    sharedControls.updateControlLocks();
    updateRotorSpin();
    stepGuide.reset();
    updateGraphControls();
    showPopup(getSpeechText(buildVoicePayload("reset")), "Reset");
  }

  if (lampSelect) {
    lampSelect.addEventListener("change", handleSelectionChange);
    lampSelect.disabled = true;
  }

  if (addTableBtn) {
    addTableBtn.addEventListener("click", handleAddReading);
    addTableBtn.disabled = true;
  }

  if (graphBtn) {
    graphBtn.disabled = true;
    graphBtn.addEventListener("click", function () {
      renderGraph();
      if (graphSection && typeof graphSection.scrollIntoView === "function") {
        graphSection.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    });
  }

  const SIM_PRINT_CONTAINER_ID = "simulation-print-container";
  const SIM_PRINT_ACTIVE_CLASS = "simulation-print-active";
  const SIM_PRINT_CLONE_SCALE = 0.78;
  let printLaunchInProgress = false;

  function wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function waitForNextFrame() {
    return new Promise((resolve) => requestAnimationFrame(resolve));
  }

  function cleanupSimulationPrintContainer() {
    const existing = document.getElementById(SIM_PRINT_CONTAINER_ID);
    if (existing) {
      existing.remove();
    }
    if (document.body) {
      document.body.classList.remove(SIM_PRINT_ACTIVE_CLASS);
    }
  }

  async function waitForPrintAssets(targets) {
    const fontReady =
      document.fonts && typeof document.fonts.ready?.then === "function"
        ? document.fonts.ready.catch(() => {})
        : Promise.resolve();

    const pendingImages = [];
    targets.forEach((target) => {
      if (!target || !target.querySelectorAll) return;
      target.querySelectorAll("img").forEach((img) => {
        if (img.complete) return;
        pendingImages.push(
          new Promise((resolve) => {
            const done = () => resolve();
            img.addEventListener("load", done, { once: true });
            img.addEventListener("error", done, { once: true });
          })
        );
      });
    });

    await Promise.race([Promise.all([fontReady, Promise.all(pendingImages)]), wait(1400)]);
  }

  async function syncPlotlyGraphForPrint(sourceFooter, clonedFooter) {
    const sourcePlot = sourceFooter?.querySelector("#graphPlot");
    const clonedPlot = clonedFooter?.querySelector("#graphPlot");
    if (!sourcePlot || !clonedPlot) return;

    const hasPlotData = Array.isArray(sourcePlot.data) && sourcePlot.data.length > 0;
    if (!hasPlotData) return;
    if (!window.Plotly || typeof window.Plotly.toImage !== "function") return;

    try {
      const rect = sourcePlot.getBoundingClientRect();
      const width = Math.max(420, Math.round(rect.width || sourcePlot.clientWidth || 420));
      const height = Math.max(280, Math.round(rect.height || sourcePlot.clientHeight || 280));
      const dataUrl = await window.Plotly.toImage(sourcePlot, {
        format: "png",
        width,
        height,
        scale: 2
      });

      const plotImage = document.createElement("img");
      plotImage.src = dataUrl;
      plotImage.alt = "Output graph";
      plotImage.className = "print-plot-image";
      clonedPlot.replaceChildren(plotImage);
      clonedPlot.style.display = "block";

      const clonedBars = clonedFooter.querySelector("#graphBars");
      if (clonedBars) clonedBars.style.display = "none";
    } catch (error) {
      console.warn("Print graph export failed; using cloned Plotly DOM output.", error);
    }
  }

  function normalizePrintPanelClone(panelClone) {
    const graphActions = panelClone?.querySelector(".graph-actions");
    if (!graphActions) return;
    // Keep action buttons at their original UI position in the print clone.
    graphActions.classList.remove("print-actions-below-table");
  }

  function freezeMeterLabelPositionsForPrint(sourcePanel, panelClone) {
    const sourceMeters = sourcePanel?.querySelector(".meters");
    const cloneMeters = panelClone?.querySelector(".meters");
    if (!sourceMeters || !cloneMeters) return;

    const meterLabelIds = ["ammter1-label", "voltmeter1-label", "ammter2-label", "voltmeter2-label"];
    const PRINT_LABEL_X_OFFSET = -14;
    const PRINT_LABEL_Y_OFFSET = -6;
    const sourceMetersRect = sourceMeters.getBoundingClientRect();

    meterLabelIds.forEach((labelId) => {
      const sourceLabel = sourcePanel.querySelector(`#${labelId}`);
      const cloneLabel = panelClone.querySelector(`#${labelId}`);
      if (!sourceLabel || !cloneLabel) return;

      const labelRect = sourceLabel.getBoundingClientRect();
      const frozenLeft = Math.round(labelRect.left - sourceMetersRect.left + PRINT_LABEL_X_OFFSET);
      const frozenTop = Math.round(labelRect.top - sourceMetersRect.top + PRINT_LABEL_Y_OFFSET);

      cloneLabel.style.position = "absolute";
      cloneLabel.style.left = `${frozenLeft}px`;
      cloneLabel.style.top = `${frozenTop}px`;
      cloneLabel.style.margin = "0";
      cloneLabel.style.transform = "none";
      cloneLabel.style.gridColumn = "auto";
      cloneLabel.style.gridRow = "auto";
      cloneLabel.style.zIndex = "4";
    });

    cloneMeters.style.position = "relative";
  }

  // Simple print path: clone panel/footer, print clone only, then clean up.
  async function simplePrintSimulation() {
    if (printLaunchInProgress) return;
    printLaunchInProgress = true;

    const panel = document.querySelector(".panel");
    const panelFooter = document.querySelector(".panel-footer");
    if (!panel || !panelFooter || !document.body) {
      printLaunchInProgress = false;
      window.print();
      return;
    }

    if (speechIsActive()) {
      window.labSpeech.speak(buildVoicePayload("print"));
    }

    cleanupSimulationPrintContainer();

    if (window.jsPlumb && typeof window.jsPlumb.repaintEverything === "function") {
      try {
        window.jsPlumb.repaintEverything();
      } catch {}
    }

    await waitForNextFrame();
    await waitForPrintAssets([panel, panelFooter]);
    await wait(60);

    const panelRect = panel.getBoundingClientRect();
    const panelFooterRect = panelFooter.getBoundingClientRect();
    const frozenPrintWidth = Math.max(
      1,
      Math.ceil(panelRect.width || panel.offsetWidth || 0),
      Math.ceil(panelFooterRect.width || panelFooter.offsetWidth || 0)
    );

    const printContainer = document.createElement("div");
    printContainer.id = SIM_PRINT_CONTAINER_ID;
    printContainer.setAttribute("aria-hidden", "true");
    printContainer.style.setProperty("--simulation-print-scale", String(SIM_PRINT_CLONE_SCALE));
    printContainer.style.width = `${frozenPrintWidth}px`;
    printContainer.style.maxWidth = "none";
    printContainer.style.overflow = "visible";

    const panelClone = panel.cloneNode(true);
    const panelFooterClone = panelFooter.cloneNode(true);
    panelClone.classList.add("print-clone-panel");
    panelFooterClone.classList.add("print-clone-footer");
    normalizePrintPanelClone(panelClone);
    freezeMeterLabelPositionsForPrint(panel, panelClone);

    // Freeze the clone at desktop geometry so print media queries do not reflow point positions.
    panelClone.style.width = `${Math.ceil(panelRect.width || panel.offsetWidth || frozenPrintWidth)}px`;
    panelClone.style.maxWidth = "none";
    panelClone.style.maxHeight = "none";
    panelClone.style.overflow = "visible";
    panelClone.setAttribute("data-print-frozen", "true");

    panelFooterClone.style.width = `${Math.ceil(panelFooterRect.width || panelFooter.offsetWidth || frozenPrintWidth)}px`;
    panelFooterClone.style.maxWidth = "none";
    panelFooterClone.style.maxHeight = "none";
    panelFooterClone.style.overflow = "visible";
    panelFooterClone.setAttribute("data-print-frozen", "true");

    await syncPlotlyGraphForPrint(panelFooter, panelFooterClone);

    printContainer.append(panelClone, panelFooterClone);
    document.body.appendChild(printContainer);
    document.body.classList.add(SIM_PRINT_ACTIVE_CLASS);

    let cleanedUp = false;
    let fallbackTimerId = 0;

    const cleanupAfterPrint = () => {
      if (cleanedUp) return;
      cleanedUp = true;
      window.clearTimeout(fallbackTimerId);
      cleanupSimulationPrintContainer();
      printLaunchInProgress = false;
    };

    window.addEventListener("afterprint", cleanupAfterPrint, { once: true });
    fallbackTimerId = window.setTimeout(cleanupAfterPrint, 120000);

    try {
      await waitForNextFrame();
      window.print();
    } catch (error) {
      console.warn("Unable to open print dialog.", error);
      cleanupAfterPrint();
    }
  }
  window.simplePrintSimulation = simplePrintSimulation;

  if (resetBtn) resetBtn.addEventListener("click", resetObservations);
  if (printBtn) {
    printBtn.addEventListener("click", simplePrintSimulation);
  }
  document.addEventListener("keydown", (event) => {
    const printShortcut = (event.ctrlKey || event.metaKey) && String(event.key).toLowerCase() === "p";
    if (!printShortcut) return;
    event.preventDefault();
    simplePrintSimulation();
  });
  if (reportBtn) {
    reportBtn.addEventListener("click", handleReportClick);
    reportBtn.disabled = true;
  }

  window.addEventListener(MCB_TURNED_OFF_EVENT, function () {
    selectedIndex = -1;
    if (lampSelect) {
      lampSelect.value = "";
      lampSelect.disabled = true;
    }
    if (addTableBtn) addTableBtn.disabled = true;
    updateBulbs(0);
    updateNeedles(-1);
  });

  // initialize defaults
  updateBulbs(0);
  updateNeedles(-1);
  updateGraphControls();
  sharedControls.updateControlLocks();

  window.addEventListener(CONNECTION_VERIFIED_EVENT, function () {
    connectionsVerified = true;
    starterMoved = false;
    sharedControls.updateControlLocks();
    updateRotorSpin();
    stepGuide.complete("connect");
  });
})();
