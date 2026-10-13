import {
  APPLICATION_STATUSES, applicationsToCsv, createApplication, updateApplication, upsertApplication
} from "./src/agent.mjs";
import { getApplications, loadAgentContext, mutateApplications, sendToBackground } from "./src/store.mjs";

const $ = (id) => document.getElementById(id);
const MATERIAL_TABS = [
  ["resume", "Tailored resume", "resume.md"],
  ["coverLetter", "Cover letter", "cover-letter.md"],
  ["outreach", "Outreach message", "outreach.txt"]
];
const state = { apps: [], selectedId: "", tab: "resume", agentReady: false, busy: new Set() };

document.addEventListener("DOMContentLoaded", async () => {
  APPLICATION_STATUSES.forEach((status) => $("statusFilter").append(new Option(status, status)));
  $("searchInput").addEventListener("input", renderList);
  $("statusFilter").addEventListener("change", renderList);
  $("newButton").addEventListener("click", () => { $("newForm").reset(); $("newDialog").showModal(); });
  $("newForm").addEventListener("submit", onNewJob);
  $("csvButton").addEventListener("click", exportCsv);
  $("backupButton").addEventListener("click", exportBackup);
  $("restoreButton").addEventListener("click", () => $("restoreInput").click());
  $("restoreInput").addEventListener("change", restoreBackup);
  window.addEventListener("hashchange", () => select(location.hash.slice(1)));
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes.applications) {
      state.apps = changes.applications.newValue || [];
      renderAll({ keepDetail: true });
    }
  });
  checkAgent();
  state.apps = await getApplications();
  state.selectedId = location.hash.slice(1) || state.apps[0]?.id || "";
  renderAll();
});

async function checkAgent() {
  const chip = $("agentChip");
  try {
    const health = await sendToBackground({ type: "agentHealth" });
    state.agentReady = Boolean(health.running && health.agent?.configured);
    chip.textContent = state.agentReady ? `Claude ready · ${health.agent.model}` : health.running ? "AI key missing" : "Agent offline";
    chip.className = `chip ${state.agentReady ? "ready" : "off"}`;
    chip.title = state.agentReady ? "Decision engine online" : health.running
      ? "Set ANTHROPIC_API_KEY and restart the local service."
      : "Start the local service: python3 local_service.py";
  } catch {
    chip.textContent = "Agent offline";
    chip.className = "chip off";
  }
}

/* ------------------------------------------------------------------ */
/* Rendering                                                            */
/* ------------------------------------------------------------------ */

function renderAll({ keepDetail = false } = {}) {
  renderStats();
  renderList();
  // Avoid wiping an editor the person is typing in when storage changes elsewhere.
  if (!keepDetail || !document.activeElement?.closest?.("#detail")) renderDetail();
}

function renderStats() {
  const stats = $("stats");
  stats.replaceChildren();
  const count = (status) => state.apps.filter((item) => item.status === status).length;
  const scored = state.apps.filter((item) => item.analysis?.fit_score != null);
  const average = scored.length ? Math.round(scored.reduce((sum, item) => sum + Number(item.analysis.fit_score), 0) / scored.length) : "–";
  const week = Date.now() - 7 * 864e5;
  [["Tracked", state.apps.length], ["Applied", count("Applied") + count("Interviewing") + count("Offer")], ["Applied this week", state.apps.filter((item) => item.appliedAt && Date.parse(item.appliedAt) > week).length],
    ["Interviewing", count("Interviewing")], ["Avg. fit", average]].forEach(([label, value]) => {
    const box = el("div", "stat");
    box.append(el("b", "", String(value)), el("span", "", label));
    stats.append(box);
  });
}

function filteredApps() {
  const query = $("searchInput").value.trim().toLowerCase();
  const status = $("statusFilter").value;
  return state.apps.filter((item) => (!status || item.status === status) &&
    (!query || `${item.company} ${item.role} ${item.location}`.toLowerCase().includes(query)));
}

function renderList() {
  const list = $("appList");
  list.replaceChildren();
  const apps = filteredApps();
  if (!apps.length) {
    list.append(el("div", "empty", state.apps.length ? "No matches." : "No applications yet. Analyze a job from the popup or add one here."));
    return;
  }
  apps.forEach((item) => {
    const button = el("button", `app-item${item.id === state.selectedId ? " active" : ""}`);
    const text = el("div");
    text.append(el("div", "name", item.company || "Unknown company"), el("div", "sub", `${item.role || "Role"} · ${item.status}${item.appliedAt ? ` · ${shortDate(item.appliedAt)}` : ""}`));
    const score = item.analysis?.fit_score;
    button.append(text, el("span", `badge ${scoreClass(score)}`, score == null ? "–" : String(score)));
    button.addEventListener("click", () => { location.hash = item.id; });
    list.append(button);
  });
}

function select(id) {
  state.selectedId = id;
  renderList();
  renderDetail();
}

function current() {
  return state.apps.find((item) => item.id === state.selectedId);
}

function renderDetail() {
  const detail = $("detail");
  detail.replaceChildren();
  const app = current();
  if (!app) {
    detail.append(el("div", "empty", "Select an application, or choose Add a job to paste a job description."));
    return;
  }

  const head = el("div", "detail-head");
  const titles = el("div");
  const company = editableText(app.company, "Company", (value) => save(app.id, { company: value }));
  const role = editableText(app.role, "Role", (value) => save(app.id, { role: value }));
  company.classList.add("company-input");
  titles.append(el("h2", "", app.role || "Untitled role"), company, role);
  if (app.url) {
    const link = el("a", "", app.url);
    link.href = /^https?:/i.test(app.url) ? app.url : "#";
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    titles.append(el("div"), link);
  }
  const controls = el("div", "head-controls");
  const status = document.createElement("select");
  APPLICATION_STATUSES.forEach((value) => status.append(new Option(value, value, false, value === app.status)));
  status.addEventListener("change", () => {
    const changes = { status: status.value };
    if (status.value === "Applied" && !app.appliedAt) changes.appliedAt = new Date().toISOString();
    save(app.id, changes, `status → ${status.value}`);
  });
  const remove = el("button", "danger", "Delete");
  remove.addEventListener("click", async () => {
    if (!confirm(`Delete ${app.company || "this application"} from the tracker? This cannot be undone.`)) return;
    await mutateApplications((list) => list.filter((item) => item.id !== app.id));
    location.hash = "";
    state.selectedId = "";
  });
  controls.append(status, remove);
  head.append(titles, controls);
  detail.append(head);

  detail.append(fitSection(app), materialsSection(app), jobTextSection(app), notesSection(app));
}

function fitSection(app) {
  const section = el("section", "section");
  const title = el("div", "section-title");
  title.append(el("h3", "", "Fit analysis"));
  const run = el("button", "secondary", app.analysis ? "Re-analyze" : "Analyze with Claude");
  run.disabled = state.busy.has(`analyze:${app.id}`);
  run.addEventListener("click", () => analyze(app.id));
  title.append(run);
  section.append(title);
  const line = el("div", "status-line");
  line.id = `analyzeStatus-${app.id}`;
  section.append(line);

  const analysis = app.analysis;
  if (!analysis) {
    section.append(el("p", "muted", app.jobText ? "Not analyzed yet." : "Add the job description below, then analyze."));
    return section;
  }
  const fit = el("div", "fit");
  fit.append(el("div", `fit-score ${scoreClass(analysis.fit_score)}`, String(analysis.fit_score)));
  const summary = el("div");
  summary.append(el("div", "rec", analysis.recommendation || ""), el("p", "", analysis.decision_reasoning || ""), el("p", "muted", analysis.summary || ""));
  const meta = [analysis.location, analysis.work_model !== "unknown" ? analysis.work_model : "", analysis.employment_type, analysis.seniority].filter(Boolean).join(" · ");
  if (meta) summary.append(el("div", "muted", meta));
  fit.append(summary);
  section.append(fit);

  if (analysis.red_flags?.length) section.append(listBlock("Check these yourself", analysis.red_flags, "flags"));

  if (analysis.requirements?.length) {
    section.append(el("h3", "", "Requirements"));
    const table = document.createElement("table");
    const headRow = document.createElement("tr");
    ["Requirement", "Type", "Met", "Evidence"].forEach((name) => headRow.append(el("th", "", name)));
    table.append(headRow);
    analysis.requirements.forEach((item) => {
      const row = document.createElement("tr");
      row.append(el("td", "", item.requirement), el("td", "", item.importance), el("td", `met-${item.met}`, item.met), el("td", "", item.evidence));
      table.append(row);
    });
    section.append(table);
  }

  const cols = el("div", "cols");
  if (analysis.strengths?.length) cols.append(listBlock("Strengths", analysis.strengths));
  if (analysis.gaps?.length) cols.append(listBlock("Gaps and how to address them", analysis.gaps.map((gap) => `${gap.gap} → ${gap.mitigation}`)));
  if (analysis.talking_points?.length) cols.append(listBlock("Lead with", analysis.talking_points));
  section.append(cols);

  if (analysis.ats_keywords?.length) {
    section.append(el("h3", "", "ATS keywords"));
    const keywords = el("div", "keywords");
    analysis.ats_keywords.forEach((word) => keywords.append(el("span", "keyword", word)));
    section.append(keywords);
  }
  return section;
}

function materialsSection(app) {
  const section = el("section", "section material");
  const title = el("div", "section-title");
  title.append(el("h3", "", "Tailored materials"));
  const actions = el("div", "head-controls");
  const generateAll = el("button", "primary", app.materials ? "Regenerate all" : "Generate all three");
  generateAll.disabled = state.busy.has(`materials:${app.id}`);
  generateAll.addEventListener("click", () => generate(app.id, MATERIAL_TABS.map(([key]) => key)));
  actions.append(generateAll);
  title.append(actions);
  section.append(title);

  const instructions = document.createElement("input");
  instructions.placeholder = "Optional direction for Claude, e.g. “emphasize GKE and platform migrations, keep the resume to two pages”";
  instructions.style.width = "100%";
  instructions.style.marginTop = "10px";
  instructions.id = `instructions-${app.id}`;
  section.append(instructions);

  const tabs = el("div", "tabs");
  MATERIAL_TABS.forEach(([key, label]) => {
    const tab = el("button", `tab${state.tab === key ? " active" : ""}`, label);
    tab.addEventListener("click", () => { state.tab = key; renderDetail(); });
    tabs.append(tab);
  });
  section.append(tabs);

  const [key, label, filename] = MATERIAL_TABS.find(([name]) => name === state.tab);
  const editor = document.createElement("textarea");
  editor.value = app.materials?.[key] || "";
  editor.placeholder = `No ${label.toLowerCase()} yet. Generate one with Claude, or write your own here.`;
  editor.addEventListener("change", () => save(app.id, { materials: { ...(app.materials || {}), [key]: editor.value } }, `edited ${label.toLowerCase()}`));
  section.append(editor);

  const row = el("div", "material-actions");
  const one = el("button", "secondary", `Regenerate ${label.toLowerCase()} only`);
  one.disabled = state.busy.has(`materials:${app.id}`);
  one.addEventListener("click", () => generate(app.id, [key]));
  const copy = el("button", "secondary", "Copy");
  copy.addEventListener("click", async () => { await navigator.clipboard.writeText(editor.value); flash(copy, "Copied"); });
  const download = el("button", "secondary", "Download");
  download.addEventListener("click", () => downloadText(`${slug(app.company)}-${slug(app.role)}-${filename}`, editor.value));
  row.append(one, copy, download);
  section.append(row);

  const line = el("div", "status-line");
  line.id = `materialsStatus-${app.id}`;
  section.append(line);

  if (app.materials?.honestyFlags?.length) section.append(listBlock("Not claimed (you don't have evidence for these yet)", app.materials.honestyFlags, "flags"));
  if (app.materials?.tailoringNotes?.length) section.append(listBlock("What Claude changed", app.materials.tailoringNotes));
  return section;
}

function jobTextSection(app) {
  const section = el("section", "section");
  const details = document.createElement("details");
  details.open = !app.jobText;
  details.append(el("summary", "", `Job description${app.jobText ? ` (${app.jobText.length.toLocaleString()} characters)` : " (missing)"}`));
  const text = document.createElement("textarea");
  text.rows = 12;
  text.value = app.jobText || "";
  text.placeholder = "Paste the job description here.";
  text.addEventListener("change", () => save(app.id, { jobText: text.value.slice(0, 20000) }, "updated job description"));
  details.append(text);
  section.append(details);
  return section;
}

function notesSection(app) {
  const section = el("section", "section");
  section.append(el("h3", "", "Notes"));
  const notes = document.createElement("textarea");
  notes.rows = 4;
  notes.value = app.notes || "";
  notes.placeholder = "Recruiter name, referral, interview dates, follow-ups…";
  notes.addEventListener("change", () => save(app.id, { notes: notes.value }));
  section.append(notes);
  const events = el("div", "events");
  (app.events || []).slice(-8).reverse().forEach((event) => events.append(el("div", "", `${new Date(event.at).toLocaleString()} · ${event.type}`)));
  section.append(events);
  return section;
}

/* ------------------------------------------------------------------ */
/* Actions                                                              */
/* ------------------------------------------------------------------ */

async function save(id, changes, eventType = "") {
  state.apps = await mutateApplications((list) => updateApplication(list, id, changes, eventType));
  renderStats();
  renderList();
}

async function onNewJob(event) {
  if (event.submitter?.value !== "save") return;
  const data = Object.fromEntries(new FormData($("newForm")).entries());
  const record = createApplication({ url: data.url.trim(), company: data.company.trim(), role: data.role.trim(), text: data.text.trim() });
  state.apps = await mutateApplications((list) => upsertApplication(list, record));
  location.hash = record.id;
  select(record.id);
  if (state.agentReady) analyze(record.id);
}

async function analyze(id) {
  const app = state.apps.find((item) => item.id === id);
  if (!app) return;
  if (!state.agentReady) return setLine(`analyzeStatus-${id}`, "Claude is not available. Start the local service with an API key.", true);
  if ((app.jobText || "").length < 80) return setLine(`analyzeStatus-${id}`, "Add the job description first.", true);
  state.busy.add(`analyze:${id}`);
  renderDetail();
  setLine(`analyzeStatus-${id}`, "Claude is analyzing this job…");
  try {
    const context = await loadAgentContext();
    const analysis = await sendToBackground({
      type: "agentCall",
      endpoint: "/agent/analyze-job",
      payload: { ...context, job: { company: app.company, role: app.role, url: app.url, location: app.location, text: app.jobText } }
    });
    state.busy.delete(`analyze:${id}`);
    await save(id, {
      analysis: { ...analysis, analyzedAt: new Date().toISOString() },
      company: app.company || analysis.company || "",
      role: app.role || analysis.role || "",
      location: app.location || analysis.location || ""
    }, "analyzed");
    renderDetail();
  } catch (error) {
    state.busy.delete(`analyze:${id}`);
    renderDetail();
    setLine(`analyzeStatus-${id}`, error.message, true);
  }
}

async function generate(id, kinds) {
  const app = state.apps.find((item) => item.id === id);
  if (!app) return;
  const lineId = `materialsStatus-${id}`;
  if (!state.agentReady) return setLine(lineId, "Claude is not available. Start the local service with an API key.", true);
  if ((app.jobText || "").length < 80) return setLine(lineId, "Add the job description first.", true);
  const instructions = $(`instructions-${id}`)?.value || "";
  state.busy.add(`materials:${id}`);
  renderDetail();
  setLine(lineId, `Claude is writing ${kinds.length === 3 ? "your resume, cover letter, and outreach message" : "this draft"}… this can take a minute or two.`);
  try {
    const context = await loadAgentContext();
    if (kinds.includes("resume") && context.resumeText.trim().length < 200) throw new Error("Add your master resume text in Profile first, so Claude has a source to tailor.");
    const result = await sendToBackground({
      type: "agentCall",
      endpoint: "/agent/materials",
      payload: { ...context, kinds, instructions, job: { company: app.company, role: app.role, url: app.url, location: app.location, text: app.jobText, analysis: app.analysis } }
    });
    const latest = (await getApplications()).find((item) => item.id === id) || app;
    const materials = { ...(latest.materials || {}), generatedAt: new Date().toISOString(), model: result.model };
    kinds.forEach((kind) => { if (result[kind]) materials[kind] = result[kind]; });
    materials.tailoringNotes = result.tailoringNotes || materials.tailoringNotes || [];
    materials.honestyFlags = result.honestyFlags || materials.honestyFlags || [];
    state.busy.delete(`materials:${id}`);
    await save(id, { materials }, `generated ${kinds.join(", ")}`);
    renderDetail();
    setLine(lineId, "Done. Read it through and edit anything that doesn't sound like you.");
  } catch (error) {
    state.busy.delete(`materials:${id}`);
    renderDetail();
    setLine(lineId, error.message, true);
  }
}

function exportCsv() {
  downloadText(`applypilot-applications-${new Date().toISOString().slice(0, 10)}.csv`, applicationsToCsv(state.apps), "text/csv");
}

function exportBackup() {
  downloadText(`applypilot-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify({ version: 1, applications: state.apps }, null, 2), "application/json");
}

async function restoreBackup(event) {
  const file = event.target.files?.[0];
  event.target.value = "";
  if (!file) return;
  try {
    const parsed = JSON.parse(await file.text());
    const incoming = Array.isArray(parsed) ? parsed : parsed.applications;
    if (!Array.isArray(incoming) || incoming.some((item) => !item || typeof item.id !== "string")) throw new Error("This file is not an ApplyPilot backup.");
    state.apps = await mutateApplications((list) => incoming.reduce((acc, item) => upsertApplication(acc, item), list));
    alert(`Restored ${incoming.length} application(s).`);
    renderAll();
  } catch (error) {
    alert(error.message);
  }
}

/* ------------------------------------------------------------------ */
/* Utilities                                                            */
/* ------------------------------------------------------------------ */

function editableText(value, placeholder, onSave) {
  const input = document.createElement("input");
  input.value = value || "";
  input.placeholder = placeholder;
  input.style.margin = "6px 6px 0 0";
  input.addEventListener("change", () => onSave(input.value.trim()));
  return input;
}

function listBlock(title, items, className = "") {
  const box = el("div");
  box.append(el("h3", "", title));
  const list = el("ul", className);
  items.forEach((item) => list.append(el("li", "", String(item))));
  box.append(list);
  return box;
}

function setLine(id, message, error = false) {
  const line = document.getElementById(id);
  if (!line) return;
  line.textContent = message;
  line.className = `status-line${error ? " error" : ""}`;
}

function downloadText(filename, content, type = "text/markdown") {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function flash(button, text) {
  const original = button.textContent;
  button.textContent = text;
  setTimeout(() => { button.textContent = original; }, 1200);
}

function scoreClass(score) {
  if (score == null) return "";
  return score >= 80 ? "high" : score >= 60 ? "mid" : "low";
}

function shortDate(value) {
  return new Date(value).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function slug(value = "") {
  return String(value || "job").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "job";
}

function el(tag, className = "", textContent = "") {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (textContent) node.textContent = textContent;
  return node;
}
