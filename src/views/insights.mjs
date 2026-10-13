import { insights } from "../crm.mjs";
import { card, el } from "../ui.mjs";
import { header } from "./apps.mjs";

/*
 * Single-series bar charts in one brand hue: no legend needed (the title names
 * the series), direct value labels on every bar because there are few of them,
 * native hover titles, and a table alternative for screen readers.
 */
export function renderInsights(root, ctx) {
  const data = insights(ctx.data.applications);
  root.append(header("Insights", "How your search is converting, so you can adjust where you spend time."));
  if (!ctx.data.applications.length) {
    root.append(el("div", "empty", "Track a few applications and your funnel shows up here."));
    return;
  }

  root.append(el("div", "stats",
    stat("Response rate", `${data.responseRate}%`, "Share of applications that reached an interview"),
    stat("Interviews", String(data.funnel[2].count)),
    stat("Offers", String(data.funnel[3].count)),
    stat("Rejected", String(data.rejected)),
    data.strongFitInterviewRate != null ? stat("Interviews from 80+ fit", `${data.strongFitInterviewRate}%`, "Of jobs scored 80 or higher") : null));

  root.append(el("div", "chart-grid",
    card("Funnel", hbars(data.funnel.map((row) => ({ label: row.stage, value: row.count })), "applications")),
    card("Applications per week", vbars(data.weeks.map((row) => ({ label: row.label, value: row.count })), "applications sent")),
    card("Fit score of tracked jobs", hbars(data.fitBuckets.map((row) => ({ label: row.label, value: row.count })), "jobs")),
    card("Where your jobs come from", hbars(data.topSources.map((row) => ({ label: row.source, value: row.count })), "jobs"))));
}

function stat(label, value, title = "") {
  return el("div", { class: "stat", title }, el("b", {}, value), el("span", {}, label));
}

function hbars(rows, unit) {
  const max = Math.max(1, ...rows.map((row) => row.value));
  return el("div", { class: "hbars", role: "table", "aria-label": `Bar chart of ${unit}` },
    rows.map((row) => el("div", { class: "hbar-row", role: "row", title: `${row.label}: ${row.value} ${unit}` },
      el("span", { class: "hbar-label", role: "rowheader" }, row.label),
      el("span", "hbar-track", el("span", { class: "hbar", style: `width:${Math.max(row.value ? 2 : 0, (100 * row.value) / max)}%` })),
      el("span", { class: "hbar-value", role: "cell" }, String(row.value)))));
}

function vbars(rows, unit) {
  const max = Math.max(1, ...rows.map((row) => row.value));
  return el("div", { class: "vbars", role: "table", "aria-label": `Bar chart of ${unit}` },
    rows.map((row) => el("div", { class: "vbar-col", role: "row", title: `Week of ${row.label}: ${row.value} ${unit}` },
      el("span", { class: "vbar-value", role: "cell" }, row.value ? String(row.value) : ""),
      el("span", "vbar-track", el("span", { class: "vbar", style: `height:${(100 * row.value) / max}%` })),
      el("span", { class: "vbar-label", role: "rowheader" }, row.label))));
}
