import type { DemoPlan } from "@demo-dev/types";

export const buildSheetShowcasePlan = (baseUrl: string): DemoPlan => {
  const url = new URL("/showcase/sheet", baseUrl).toString();

  return {
    title: "AI Builds a Launch Metrics Dashboard",
    summary:
      "A controlled spreadsheet-style showcase where AI imports launch data, applies formulas, formats KPIs, builds a chart, and writes an executive summary.",
    branch: "showcase/sheet",
    generatedAt: new Date().toISOString(),
    scenes: [
      {
        id: "sheet-import",
        title: "Import Launch Data",
        goal: "Open the spreadsheet showcase and import raw launch metrics.",
        url,
        viewport: { width: 1600, height: 900 },
        actions: [
          { type: "navigate", url },
          { type: "wait", ms: 800 },
          { type: "click", target: { strategy: "testId", value: "import-data" } },
          { type: "waitForText", value: "Raw launch data imported", timeoutMs: 5000 },
        ],
        narration:
          "The AI imports raw launch metrics and turns an empty sheet into usable source data.",
        caption: "Import raw launch data",
        durationMs: 7000,
        evidenceHints: ["Raw launch data imported"],
      },
      {
        id: "sheet-formulas",
        title: "Apply Spreadsheet Formulas",
        goal: "Calculate totals, activation, CAC, and ROI from the imported data.",
        url,
        viewport: { width: 1600, height: 900 },
        actions: [
          { type: "click", target: { strategy: "testId", value: "apply-formulas" } },
          { type: "waitForText", value: "Formulas applied", timeoutMs: 5000 },
          { type: "wait", ms: 700 },
        ],
        narration:
          "It applies formulas for pipeline, activation, CAC, and ROI across every channel.",
        caption: "Calculate KPI formulas",
        durationMs: 6500,
        evidenceHints: ["Formulas applied"],
      },
      {
        id: "sheet-format",
        title: "Format the Dashboard",
        goal: "Turn the spreadsheet into an executive-ready dashboard.",
        url,
        viewport: { width: 1600, height: 900 },
        actions: [
          { type: "click", target: { strategy: "testId", value: "format-dashboard" } },
          { type: "waitForText", value: "Dashboard formatted", timeoutMs: 5000 },
          { type: "wait", ms: 900 },
        ],
        narration:
          "Then it formats the dashboard so leaders can scan the numbers instantly.",
        caption: "Format for executive review",
        durationMs: 6500,
        evidenceHints: ["Dashboard formatted"],
      },
      {
        id: "sheet-chart",
        title: "Build the Revenue Chart",
        goal: "Create a chart from the channel contribution data.",
        url,
        viewport: { width: 1600, height: 900 },
        actions: [
          { type: "click", target: { strategy: "testId", value: "build-chart" } },
          { type: "waitForText", value: "Chart created", timeoutMs: 5000 },
          { type: "wait", ms: 1000 },
        ],
        narration:
          "Next, it builds a contribution chart to reveal the strongest revenue drivers.",
        caption: "Build a contribution chart",
        durationMs: 6500,
        evidenceHints: ["Chart created"],
      },
      {
        id: "sheet-summary",
        title: "Write the Executive Summary",
        goal: "Generate a concise summary from the computed metrics.",
        url,
        viewport: { width: 1600, height: 900 },
        actions: [
          { type: "click", target: { strategy: "testId", value: "write-summary" } },
          { type: "waitForText", value: "Executive summary ready", timeoutMs: 5000 },
          { type: "wait", ms: 1200 },
        ],
        narration:
          "Finally, it writes the executive takeaway with the clearest recommendation.",
        caption: "Generate the executive takeaway",
        durationMs: 7500,
        evidenceHints: ["Executive summary ready"],
      },
    ],
  };
};
