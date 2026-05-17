declare const Bun: {
  serve: (options: {
    port: number;
    fetch: (request: Request) => Response;
  }) => void;
};

const port = Number(process.env.PORT ?? 3000);

const html = (body: string) =>
  new Response(body, {
    headers: {
      "content-type": "text/html; charset=utf-8",
    },
  });

const homePage = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>demo.dev</title>
    <style>
      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        color: #111827;
        background: #f8fafc;
      }
      main {
        width: min(760px, calc(100vw - 48px));
      }
      h1 {
        margin: 0 0 12px;
        font-size: clamp(40px, 8vw, 72px);
        line-height: 1;
      }
      p {
        margin: 0;
        color: #475569;
        font-size: 18px;
        line-height: 1.6;
      }
      a {
        color: #2563eb;
        font-weight: 650;
      }
    </style>
  </head>
  <body>
    <main>
      <h1>demo.dev</h1>
      <p>Product demo generation for teams that want polished demos from real application flows.</p>
      <p><a href="/showcase/sheet">Open the spreadsheet showcase</a></p>
    </main>
  </body>
</html>`;

const sheetShowcasePage = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Launch Metrics Sheet</title>
    <style>
      :root {
        color-scheme: light;
        --ink: #172033;
        --muted: #64748b;
        --line: #dbe3ef;
        --panel: #ffffff;
        --bg: #f5f7fb;
        --blue: #2563eb;
        --green: #0f9f6e;
        --amber: #b7791f;
        --rose: #d9466a;
        --violet: #7c3aed;
      }
      * {
        box-sizing: border-box;
      }
      body {
        margin: 0;
        min-height: 100vh;
        background: var(--bg);
        color: var(--ink);
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      button,
      input {
        font: inherit;
      }
      .shell {
        min-height: 100vh;
        display: grid;
        grid-template-rows: auto auto 1fr;
      }
      .topbar {
        height: 64px;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 20px;
        padding: 0 28px;
        background: #ffffff;
        border-bottom: 1px solid var(--line);
      }
      .brand {
        display: flex;
        align-items: center;
        gap: 12px;
        min-width: 260px;
      }
      .mark {
        width: 32px;
        height: 32px;
        border-radius: 7px;
        display: grid;
        place-items: center;
        color: white;
        font-weight: 800;
        background: linear-gradient(135deg, #2563eb, #0f9f6e);
      }
      .brand-title {
        font-weight: 760;
        letter-spacing: 0;
      }
      .brand-subtitle {
        font-size: 12px;
        color: var(--muted);
        margin-top: 2px;
      }
      .search {
        flex: 1;
        max-width: 560px;
        height: 38px;
        border: 1px solid var(--line);
        border-radius: 7px;
        padding: 0 14px;
        color: #475569;
        background: #f8fafc;
      }
      .status {
        display: flex;
        align-items: center;
        gap: 8px;
        color: #475569;
        font-size: 13px;
        white-space: nowrap;
      }
      .dot {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background: var(--green);
        box-shadow: 0 0 0 4px rgba(15, 159, 110, 0.12);
      }
      .toolbar {
        height: 58px;
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 0 28px;
        background: #fbfdff;
        border-bottom: 1px solid var(--line);
      }
      .tool {
        border: 1px solid var(--line);
        border-radius: 7px;
        background: #ffffff;
        color: #263247;
        min-height: 36px;
        padding: 0 13px;
        font-weight: 650;
        cursor: pointer;
        transition: border-color 160ms ease, box-shadow 160ms ease, transform 160ms ease;
      }
      .tool:hover {
        border-color: #a9b8ce;
        box-shadow: 0 8px 22px rgba(15, 23, 42, 0.08);
        transform: translateY(-1px);
      }
      .tool.primary {
        background: #172033;
        border-color: #172033;
        color: #fff;
      }
      .canvas {
        display: grid;
        grid-template-columns: minmax(680px, 1fr) 360px;
        gap: 18px;
        padding: 20px 28px 28px;
      }
      .sheet,
      .side-panel {
        background: var(--panel);
        border: 1px solid var(--line);
        border-radius: 8px;
        box-shadow: 0 18px 45px rgba(15, 23, 42, 0.07);
        overflow: hidden;
      }
      .formula {
        display: grid;
        grid-template-columns: 54px 1fr;
        border-bottom: 1px solid var(--line);
        background: #f8fafc;
      }
      .formula-label {
        display: grid;
        place-items: center;
        color: var(--muted);
        font-size: 12px;
        border-right: 1px solid var(--line);
      }
      .formula-value {
        padding: 11px 14px;
        font-family: "SFMono-Regular", Consolas, monospace;
        color: #334155;
        min-height: 42px;
      }
      .grid {
        width: 100%;
        border-collapse: collapse;
        table-layout: fixed;
        font-size: 14px;
      }
      .grid th,
      .grid td {
        height: 39px;
        border-right: 1px solid var(--line);
        border-bottom: 1px solid var(--line);
        padding: 0 10px;
        text-align: right;
        overflow: hidden;
        white-space: nowrap;
        text-overflow: ellipsis;
      }
      .grid th {
        background: #edf2f8;
        color: #475569;
        text-align: center;
        font-size: 12px;
        font-weight: 750;
      }
      .grid td:first-child,
      .grid th:first-child {
        width: 42px;
        text-align: center;
        color: #64748b;
        background: #f8fafc;
        font-size: 12px;
        font-weight: 700;
      }
      .grid td:nth-child(2),
      .grid th:nth-child(2) {
        text-align: left;
        width: 172px;
      }
      .grid td.strong {
        font-weight: 760;
        color: #111827;
      }
      .grid td.positive {
        color: var(--green);
        font-weight: 700;
      }
      .grid td.negative {
        color: var(--rose);
        font-weight: 700;
      }
      .grid tr.header-row td:not(:first-child) {
        background: #172033;
        color: #fff;
        font-weight: 760;
      }
      .grid tr.total-row td:not(:first-child) {
        background: #eefcf6;
        font-weight: 760;
      }
      .selected {
        outline: 2px solid var(--blue);
        outline-offset: -2px;
        background: rgba(37, 99, 235, 0.08);
      }
      .side-panel {
        display: grid;
        grid-template-rows: auto auto 1fr;
      }
      .panel-header {
        padding: 18px 18px 14px;
        border-bottom: 1px solid var(--line);
      }
      .panel-title {
        margin: 0;
        font-size: 18px;
        letter-spacing: 0;
      }
      .panel-subtitle {
        margin-top: 5px;
        color: var(--muted);
        font-size: 13px;
      }
      .kpis {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 10px;
        padding: 14px 18px;
        border-bottom: 1px solid var(--line);
      }
      .kpi {
        border: 1px solid var(--line);
        border-radius: 7px;
        padding: 12px;
        background: #fbfdff;
      }
      .kpi-label {
        color: var(--muted);
        font-size: 12px;
      }
      .kpi-value {
        margin-top: 6px;
        font-size: 22px;
        line-height: 1;
        font-weight: 800;
      }
      .kpi:nth-child(1) .kpi-value {
        color: var(--blue);
      }
      .kpi:nth-child(2) .kpi-value {
        color: var(--green);
      }
      .kpi:nth-child(3) .kpi-value {
        color: var(--amber);
      }
      .kpi:nth-child(4) .kpi-value {
        color: var(--violet);
      }
      .chart-wrap {
        padding: 18px;
      }
      .chart-title {
        margin: 0 0 14px;
        font-size: 14px;
        color: #334155;
      }
      .bars {
        display: grid;
        gap: 11px;
      }
      .bar-row {
        display: grid;
        grid-template-columns: 94px 1fr 48px;
        align-items: center;
        gap: 10px;
        font-size: 12px;
        color: #475569;
      }
      .bar-track {
        height: 10px;
        background: #edf2f8;
        border-radius: 999px;
        overflow: hidden;
      }
      .bar-fill {
        width: 0%;
        height: 100%;
        border-radius: inherit;
        background: var(--blue);
        transition: width 680ms cubic-bezier(0.2, 0.8, 0.2, 1);
      }
      .bar-row:nth-child(2) .bar-fill {
        background: var(--green);
      }
      .bar-row:nth-child(3) .bar-fill {
        background: var(--amber);
      }
      .bar-row:nth-child(4) .bar-fill {
        background: var(--rose);
      }
      .bar-row:nth-child(5) .bar-fill {
        background: var(--violet);
      }
      .insight {
        margin-top: 18px;
        border: 1px solid #cfe8dc;
        background: #f0fbf6;
        border-radius: 8px;
        padding: 13px;
        color: #14543d;
        font-size: 13px;
        line-height: 1.45;
        opacity: 0;
        transform: translateY(6px);
        transition: opacity 260ms ease, transform 260ms ease;
      }
      .insight.visible {
        opacity: 1;
        transform: translateY(0);
      }
      .empty {
        color: #94a3b8;
      }
      @media (max-width: 1040px) {
        .canvas {
          grid-template-columns: 1fr;
        }
        .side-panel {
          min-height: 420px;
        }
      }
    </style>
  </head>
  <body>
    <div class="shell">
      <header class="topbar">
        <div class="brand">
          <div class="mark">S</div>
          <div>
            <div class="brand-title">Launch Metrics Sheet</div>
            <div class="brand-subtitle">Q3 product launch dashboard</div>
          </div>
        </div>
        <input class="search" aria-label="Search commands" value="Analyze launch performance and prepare executive summary" readonly />
        <div class="status"><span class="dot"></span><span id="status-text">Ready for AI operation</span></div>
      </header>

      <nav class="toolbar" aria-label="Sheet actions">
        <button class="tool primary" data-testid="import-data">Import data</button>
        <button class="tool" data-testid="apply-formulas">Apply formulas</button>
        <button class="tool" data-testid="format-dashboard">Format dashboard</button>
        <button class="tool" data-testid="build-chart">Build chart</button>
        <button class="tool" data-testid="write-summary">Write summary</button>
      </nav>

      <main class="canvas">
        <section class="sheet" aria-label="Spreadsheet">
          <div class="formula">
            <div class="formula-label">fx</div>
            <div class="formula-value" id="formula">Select a cell or run an AI action.</div>
          </div>
          <table class="grid" aria-label="Launch metrics data">
            <thead>
              <tr>
                <th></th>
                <th>A</th>
                <th>B</th>
                <th>C</th>
                <th>D</th>
                <th>E</th>
                <th>F</th>
              </tr>
            </thead>
            <tbody id="sheet-body"></tbody>
          </table>
        </section>

        <aside class="side-panel" aria-label="Dashboard summary">
          <div class="panel-header">
            <h1 class="panel-title">Executive Snapshot</h1>
            <div class="panel-subtitle">Updated from spreadsheet formulas and chart data.</div>
          </div>
          <div class="kpis">
            <div class="kpi"><div class="kpi-label">Pipeline</div><div class="kpi-value" id="pipeline">$0</div></div>
            <div class="kpi"><div class="kpi-label">Activation</div><div class="kpi-value" id="activation">0%</div></div>
            <div class="kpi"><div class="kpi-label">CAC</div><div class="kpi-value" id="cac">$0</div></div>
            <div class="kpi"><div class="kpi-label">ROI</div><div class="kpi-value" id="roi">0.0x</div></div>
          </div>
          <div class="chart-wrap">
            <h2 class="chart-title">Channel contribution</h2>
            <div class="bars" id="bars">
              <div class="empty">No chart yet.</div>
            </div>
            <div class="insight" id="insight">AI summary will appear here.</div>
          </div>
        </aside>
      </main>
    </div>

    <script>
      const rows = [
        ["Channel", "Leads", "Trials", "Customers", "Revenue", "Spend", "ROI"],
        ["Product Hunt", "4,820", "1,104", "241", "$72,300", "$8,400", ""],
        ["LinkedIn Ads", "3,140", "612", "118", "$35,400", "$11,800", ""],
        ["Partner Webinar", "1,880", "546", "163", "$48,900", "$4,600", ""],
        ["SEO Launch Hub", "2,760", "718", "151", "$45,300", "$3,900", ""],
        ["Founder Newsletter", "1,420", "468", "126", "$37,800", "$1,200", ""],
        ["Total", "", "", "", "", "", ""],
      ];
      const body = document.getElementById("sheet-body");
      const formula = document.getElementById("formula");
      const statusText = document.getElementById("status-text");
      const numbers = (value) => Number(String(value).replace(/[^0-9.-]/g, ""));

      const renderEmpty = () => {
        body.innerHTML = "";
        for (let r = 1; r <= 14; r++) {
          const tr = document.createElement("tr");
          tr.innerHTML = "<td>" + r + "</td>" + Array.from({ length: 6 }, () => "<td></td>").join("");
          body.appendChild(tr);
        }
      };

      const importData = () => {
        body.innerHTML = "";
        rows.forEach((row, index) => {
          const tr = document.createElement("tr");
          if (index === 0) tr.classList.add("header-row");
          if (index === rows.length - 1) tr.classList.add("total-row");
          tr.innerHTML = "<td>" + (index + 1) + "</td>" + row.map((cell) => "<td>" + cell + "</td>").join("");
          body.appendChild(tr);
        });
        formula.textContent = "Imported TSV: channel, leads, trials, customers, revenue, spend.";
        statusText.textContent = "Raw launch data imported";
      };

      const applyFormulas = () => {
        const tableRows = [...body.querySelectorAll("tr")];
        if (!tableRows.length || tableRows[0].children.length < 7) importData();
        const dataRows = [...body.querySelectorAll("tr")].slice(1, 6);
        dataRows.forEach((tr) => {
          const revenue = numbers(tr.children[5].textContent);
          const spend = numbers(tr.children[6].textContent);
          tr.children[7].textContent = (revenue / spend).toFixed(1) + "x";
          tr.children[7].classList.add("positive");
        });
        const totals = [...body.querySelectorAll("tr")][6].children;
        const sum = (index) => dataRows.reduce((acc, tr) => acc + numbers(tr.children[index].textContent), 0);
        totals[2].textContent = sum(2).toLocaleString();
        totals[3].textContent = sum(3).toLocaleString();
        totals[4].textContent = sum(4).toLocaleString();
        totals[5].textContent = "$" + sum(5).toLocaleString();
        totals[6].textContent = "$" + sum(6).toLocaleString();
        totals[7].textContent = (sum(5) / sum(6)).toFixed(1) + "x";
        document.getElementById("pipeline").textContent = "$" + sum(5).toLocaleString();
        document.getElementById("activation").textContent = Math.round((sum(4) / sum(2)) * 100) + "%";
        document.getElementById("cac").textContent = "$" + Math.round(sum(6) / sum(4));
        document.getElementById("roi").textContent = (sum(5) / sum(6)).toFixed(1) + "x";
        formula.textContent = "=SUM(E2:E6), =SUM(F2:F6), =E7/F7, =D7/B7";
        statusText.textContent = "Formulas applied";
      };

      const formatDashboard = () => {
        applyFormulas();
        [...body.querySelectorAll("td")].forEach((cell) => cell.classList.remove("selected"));
        const cells = [...body.querySelectorAll("tr")].slice(1, 7).flatMap((tr) => [...tr.children].slice(2, 8));
        cells.forEach((cell, index) => {
          if (index % 3 !== 1) cell.classList.add("selected");
        });
        formula.textContent = "Applied header styling, KPI emphasis, and executive-ready number formats.";
        statusText.textContent = "Dashboard formatted";
      };

      const buildChart = () => {
        applyFormulas();
        const dataRows = [...body.querySelectorAll("tr")].slice(1, 6);
        const maxRevenue = Math.max(...dataRows.map((tr) => numbers(tr.children[5].textContent)));
        const bars = document.getElementById("bars");
        bars.innerHTML = "";
        dataRows.forEach((tr) => {
          const label = tr.children[1].textContent;
          const revenue = numbers(tr.children[5].textContent);
          const row = document.createElement("div");
          row.className = "bar-row";
          row.innerHTML = "<div>" + label + "</div><div class='bar-track'><div class='bar-fill'></div></div><div>$" + Math.round(revenue / 1000) + "k</div>";
          bars.appendChild(row);
          requestAnimationFrame(() => {
            row.querySelector(".bar-fill").style.width = Math.round((revenue / maxRevenue) * 100) + "%";
          });
        });
        formula.textContent = "Chart range: A2:E6, sorted by launch revenue.";
        statusText.textContent = "Chart created";
      };

      const writeSummary = () => {
        buildChart();
        const insight = document.getElementById("insight");
        insight.textContent = "Product Hunt leads revenue, but Partner Webinar and Founder Newsletter are the highest efficiency channels. Shift budget from paid social into partner-led launch motions.";
        insight.classList.add("visible");
        formula.textContent = "AI summary generated from contribution, activation, CAC, and ROI.";
        statusText.textContent = "Executive summary ready";
      };

      document.querySelector("[data-testid='import-data']").addEventListener("click", importData);
      document.querySelector("[data-testid='apply-formulas']").addEventListener("click", applyFormulas);
      document.querySelector("[data-testid='format-dashboard']").addEventListener("click", formatDashboard);
      document.querySelector("[data-testid='build-chart']").addEventListener("click", buildChart);
      document.querySelector("[data-testid='write-summary']").addEventListener("click", writeSummary);
      renderEmpty();
    </script>
  </body>
</html>`;

Bun.serve({
  port,
  fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/showcase/sheet") return html(sheetShowcasePage);
    return html(homePage);
  },
});

console.log(`demo.dev website running at http://localhost:${port}`);
