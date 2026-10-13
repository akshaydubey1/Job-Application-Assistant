import { APPLICATION_STATUSES, applicationsToCsv, createApplication, updateApplication, upsertApplication } from "../agent.mjs";
import { atsCheck } from "../ats.mjs";
import { createDocument, dueItems, peopleSearchLinks } from "../crm.mjs";
import {
  button, card, chips, dateInputValue, isPastDay, localDay, downloadText, el, emptyState, exportButtons, field, list, scoreClass, select, setLine, shortDate, statusLine
} from "../ui.mjs";

const MATERIALS = [["resume", "Tailored resume"], ["coverLetter", "Cover letter"], ["outreach", "Outreach message"]];
const CLOSED = ["Rejected", "Withdrawn", "Skipped"];

/* ------------------------------------------------------------------ */
/* Today                                                                */
/* ------------------------------------------------------------------ */

export function renderToday(root, ctx) {
  const { applications, contacts, reminderSettings } = ctx.data;
  const items = dueItems({ applications, contacts }, new Date(), { staleAfterDays: reminderSettings?.staleAfterDays || 7 });
  root.append(header("Today", "Follow-ups, next steps, and where your search stands."));

  const week = Date.now() - 7 * 864e5;
  const stats = [
    ["Active", applications.filter((app) => !CLOSED.includes(app.status) && app.status !== "Offer").length],
    ["Applied this week", applications.filter((app) => app.appliedAt && Date.parse(app.appliedAt) > week).length],
    ["Interviewing", applications.filter((app) => app.status === "Interviewing").length],
    ["Follow-ups due", items.filter((item) => item.overdue || item.today).length]
  ];
  root.append(el("div", "stats", stats.map(([label, value]) => el("div", "stat", el("b", {}, String(value)), el("span", {}, label)))));

  const dueCard = card("Follow-ups");
  if (!items.length) dueCard.append(el("p", "muted", "Nothing due. Set a next step on any application or contact and it shows up here."));
  items.forEach((item) => {
    const row = el("div", `due-row${item.overdue ? " overdue" : item.today ? " today" : ""}`,
      el("div", {}, el("strong", {}, item.title), el("div", "muted", item.overdue ? `Overdue since ${shortDate(item.due)}` : item.today ? "Due today" : `Due ${shortDate(item.due)}`)),
      el("div", "button-row",
        button("Open", () => ctx.go(item.kind === "contact" ? `#/contacts/${item.id}` : `#/apps/${item.id}`)),
        button("Snooze 2 days", () => snooze(ctx, item, 2)),
        button("Done", () => complete(ctx, item), "primary")));
    dueCard.append(row);
  });
  root.append(dueCard);

  const recent = [...applications].sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt))).slice(0, 6);
  const recentCard = card("Recently active");
  if (!recent.length) recentCard.append(emptyState("No jobs yet. Use Save job or Analyze fit from the popup, or add one here.", button("Add a job", () => newJobDialog(ctx), "primary")));
  recent.forEach((app) => recentCard.append(appRow(ctx, app)));
  root.append(recentCard);

  const settings = card("Reminder settings",
    el("div", "inline-form",
      field("Nudge me when there's no reply after", select([[5, "5 days"], [7, "7 days"], [10, "10 days"], [14, "14 days"]], reminderSettings?.staleAfterDays || 7,
        (value) => ctx.mutate("reminderSettings", (current) => ({ ...(current || {}), staleAfterDays: Number(value) })))),
      el("label", "check", el("input", { type: "checkbox", checked: reminderSettings?.notifications !== false,
        onchange: (event) => ctx.mutate("reminderSettings", (current) => ({ ...(current || {}), notifications: event.target.checked })) }), "Desktop notifications for due follow-ups")));
  root.append(settings);
}

async function snooze(ctx, item, days) {
  const due = localDay(days);
  if (item.kind === "contact") await ctx.mutate("contacts", (list) => list.map((c) => (c.id === item.id ? { ...c, followUpOn: due } : c)));
  else await ctx.mutate("applications", (list) => updateApplication(list, item.id, { nextActionOn: due, nextAction: list.find((a) => a.id === item.id)?.nextAction || "Follow up" }, `snoozed to ${due}`));
  ctx.rerender();
}

async function complete(ctx, item) {
  const now = new Date().toISOString();
  if (item.kind === "contact") await ctx.mutate("contacts", (list) => list.map((c) => (c.id === item.id ? { ...c, followUpOn: "", lastContactAt: now } : c)));
  else await ctx.mutate("applications", (list) => updateApplication(list, item.id, { nextActionOn: "", nextAction: "", lastFollowUpAt: now, ...(item.suggested ? { nextActionOn: localDay(7), nextAction: "Check for a reply" } : {}) }, item.suggested ? "followed up" : "next step done"));
  ctx.rerender();
}

/* ------------------------------------------------------------------ */
/* Applications list + detail                                           */
/* ------------------------------------------------------------------ */

export function renderApps(root, ctx, [selectedId]) {
  const apps = ctx.data.applications;
  const head = header("Applications", `${apps.length} tracked`);
  head.append(el("div", "button-row",
    button("Add a job", () => newJobDialog(ctx), "primary"),
    button("Export CSV", () => downloadText(`applypilot-applications-${today()}.csv`, applicationsToCsv(apps), "text/csv")),
    button("Backup JSON", () => backup(ctx)),
    button("Restore", () => restore(ctx))));
  root.append(head);

  const layout = el("div", "split");
  const pane = el("aside", "list-pane");
  const search = el("input", { type: "search", placeholder: "Search company, role, location", value: ctx.appSearch || "" });
  const status = select([["", "All statuses"], ...APPLICATION_STATUSES], ctx.appStatus || "", null);
  const listBox = el("div", "app-list");
  const drawList = () => {
    ctx.appSearch = search.value;
    ctx.appStatus = status.value;
    const query = search.value.trim().toLowerCase();
    const filtered = apps.filter((app) => (!status.value || app.status === status.value) && (!query || `${app.company} ${app.role} ${app.location}`.toLowerCase().includes(query)));
    listBox.replaceChildren(...(filtered.length ? filtered.map((app) => appRow(ctx, app, app.id === selectedId)) : [el("div", "empty", apps.length ? "No matches." : "No applications yet.")]));
  };
  search.addEventListener("input", drawList);
  status.addEventListener("change", drawList);
  pane.append(el("div", "filters", search, status), listBox);
  drawList();

  const detail = el("section", "detail");
  const app = apps.find((item) => item.id === selectedId) || (!selectedId ? null : undefined);
  if (app) renderDetail(detail, ctx, app);
  else detail.append(emptyState(apps.length ? "Select an application to see its fit, materials, contacts, and next steps." : "Save a job from the popup (Alt+Shift+S) or paste one here.", button("Add a job", () => newJobDialog(ctx), "primary")));
  layout.append(pane, detail);
  root.append(layout);
}

function appRow(ctx, app, active = false) {
  const score = app.analysis?.fit_score;
  return el("button", { class: `app-item${active ? " active" : ""}`, type: "button", onclick: () => ctx.go(`#/apps/${app.id}`) },
    el("div", {}, el("div", "name", app.company || "Unknown company"),
      el("div", "sub", `${app.role || "Role"} · ${app.status}${app.appliedAt ? ` · ${shortDate(app.appliedAt)}` : ""}${app.nextActionOn ? ` · next: ${shortDate(app.nextActionOn)}` : ""}`)),
    el("span", { class: `badge ${scoreClass(score)}`, title: score == null ? "Not analyzed" : `Fit ${score}/100` }, score == null ? "–" : String(score)));
}

function renderDetail(root, ctx, app) {
  const save = (changes, event = "") => ctx.mutate("applications", (list) => updateApplication(list, app.id, changes, event));
  const statusSelect = select(APPLICATION_STATUSES, app.status, async (value) => {
    await save({ status: value, ...(value === "Applied" && !app.appliedAt ? { appliedAt: new Date().toISOString() } : {}) }, `status → ${value}`);
    ctx.rerender();
  });
  const titleInput = (value, placeholder, key) => el("input", { value: value || "", placeholder, class: "title-input", onchange: (event) => save({ [key]: event.target.value.trim() }) });
  root.append(el("div", "detail-head",
    el("div", {}, el("h2", {}, app.role || "Untitled role"),
      el("div", "inline-form", titleInput(app.company, "Company", "company"), titleInput(app.role, "Role", "role"), titleInput(app.location, "Location", "location")),
      app.url ? el("a", { href: /^https?:/i.test(app.url) ? app.url : "#", target: "_blank", rel: "noopener noreferrer", class: "url" }, app.url) : null),
    el("div", "button-row", statusSelect, button("Delete", async () => {
      if (!confirm(`Delete ${app.company || "this application"}? This cannot be undone.`)) return;
      await ctx.mutate("applications", (list) => list.filter((item) => item.id !== app.id));
      ctx.go("#/apps");
    }, "danger"))));

  // Next step
  const nextText = el("input", { value: app.nextAction || "", placeholder: "e.g. Follow up with recruiter, prep system design" });
  const nextDate = el("input", { type: "date", value: dateInputValue(app.nextActionOn) });
  root.append(card("Next step", el("div", "inline-form",
    field("What", nextText), field("When", nextDate),
    button("Save next step", async () => { await save({ nextAction: nextText.value.trim(), nextActionOn: nextDate.value }, nextDate.value ? `next step ${nextDate.value}` : ""); ctx.rerender(); }, "primary")),
  app.appliedAt ? el("p", "muted", `Applied ${new Date(app.appliedAt).toLocaleDateString()}.`) : null));

  root.append(fitCard(ctx, app), quickToolsCard(ctx, app), materialsCard(ctx, app), contactsCard(ctx, app), jobTextCard(ctx, app, save), notesCard(app, save));
}

function fitCard(ctx, app) {
  const lineId = `fit-${app.id}`;
  const run = button(app.analysis ? "Re-analyze" : "Analyze with Claude", () => analyze(ctx, app, lineId), "secondary", { disabled: ctx.busy.has(lineId) });
  const section = card(null, el("div", "section-title", el("h3", {}, "Fit analysis"), run), statusLine(lineId));
  const a = app.analysis;
  if (!a) {
    section.append(el("p", "muted", app.jobText ? "Not analyzed yet." : "Add the job description below, then analyze."));
    return section;
  }
  section.append(el("div", "fit",
    el("div", { class: `fit-score ${scoreClass(a.fit_score)}`, title: "Fit score out of 100" }, String(a.fit_score)),
    el("div", {}, el("div", "rec", a.recommendation || ""), el("p", {}, a.decision_reasoning || ""), el("p", "muted", a.summary || ""),
      el("div", "muted", [a.location, a.work_model !== "unknown" ? a.work_model : "", a.employment_type, a.seniority].filter(Boolean).join(" · ")))));
  if (a.red_flags?.length) section.append(el("h4", {}, "Check these yourself"), list(a.red_flags, "flags"));
  if (a.requirements?.length) {
    const table = el("table", {}, el("tr", {}, ["Requirement", "Type", "Met", "Evidence"].map((name) => el("th", {}, name))));
    a.requirements.forEach((req) => table.append(el("tr", {}, el("td", {}, req.requirement), el("td", {}, req.importance), el("td", `met-${req.met}`, req.met), el("td", {}, req.evidence))));
    section.append(el("h4", {}, "Requirements"), el("div", "table-wrap", table));
  }
  section.append(el("div", "cols",
    a.strengths?.length ? el("div", {}, el("h4", {}, "Strengths"), list(a.strengths)) : null,
    a.gaps?.length ? el("div", {}, el("h4", {}, "Gaps and how to address them"), list(a.gaps.map((gap) => `${gap.gap} → ${gap.mitigation}`))) : null,
    a.talking_points?.length ? el("div", {}, el("h4", {}, "Lead with"), list(a.talking_points)) : null));
  if (a.ats_keywords?.length) section.append(el("h4", {}, "ATS keywords"), chips(a.ats_keywords, "keyword"));
  return section;
}

async function analyze(ctx, app, lineId) {
  if ((app.jobText || "").length < 80) return setLine(lineId, "Add the job description first.", true);
  ctx.busy.add(lineId);
  setLine(lineId, "Claude is analyzing this job…");
  try {
    const analysis = await ctx.call("/agent/analyze-job", { job: { company: app.company, role: app.role, url: app.url, location: app.location, text: app.jobText } });
    await ctx.mutate("applications", (list) => updateApplication(list, app.id, {
      analysis: { ...analysis, analyzedAt: new Date().toISOString() },
      company: app.company || analysis.company || "", role: app.role || analysis.role || "", location: app.location || analysis.location || ""
    }, "analyzed"));
    ctx.busy.delete(lineId);
    ctx.keepScroll = true;
    ctx.rerender();
  } catch (error) {
    ctx.busy.delete(lineId);
    setLine(lineId, error.message, true);
  }
}

function quickToolsCard(ctx, app) {
  const local = app.jobText && ctx.data.resumeText ? atsCheck(ctx.data.resumeText, app.jobText) : null;
  return card("Quick tools",
    local ? el("p", {}, el("strong", {}, `ATS keyword match: ${local.score}/100. `), local.missing.length ? `Missing: ${local.missing.slice(0, 8).map((m) => m.term).join(", ")}${local.missing.length > 8 ? "…" : ""}` : "All key terms present.") : el("p", "muted", "Add your master resume in Profile and a job description to see the ATS keyword match."),
    el("div", "button-row",
      button("ATS deep check", () => ctx.go(`#/studio/ats/${app.id}`)),
      button("Interview prep", () => ctx.go(`#/interview/${app.id}`)),
      button("Summarize posting", () => ctx.go(`#/studio/write/jd_summary/${app.id}`)),
      button("Follow-up email", () => ctx.go(`#/studio/write/follow_up/${app.id}`)),
      button("Thank-you note", () => ctx.go(`#/studio/write/thank_you/${app.id}`))));
}

function materialsCard(ctx, app) {
  const lineId = `materials-${app.id}`;
  ctx.materialTab = ctx.materialTab || "resume";
  const [key, label] = MATERIALS.find(([name]) => name === ctx.materialTab);
  const instructions = el("input", { placeholder: "Optional direction for Claude, e.g. “lead with GKE migrations, keep it to two pages”", class: "wide" });
  const busy = ctx.busy.has(lineId);
  const section = card(null, el("div", "section-title", el("h3", {}, "Tailored materials"),
    button(app.materials ? "Regenerate all" : "Generate all three", () => generate(ctx, app, MATERIALS.map(([k]) => k), instructions.value, lineId), "primary", { disabled: busy })), instructions);
  section.append(el("div", "tabs", MATERIALS.map(([name, text]) => button(text, () => { ctx.materialTab = name; ctx.keepScroll = true; ctx.rerender(); }, `tab${name === key ? " active" : ""}`))));
  const editor = el("textarea", { class: "doc-editor", placeholder: `No ${label.toLowerCase()} yet. Generate one with Claude, or write your own here.` });
  editor.value = app.materials?.[key] || "";
  editor.addEventListener("change", () => ctx.mutate("applications", (list) => updateApplication(list, app.id, { materials: { ...(app.materials || {}), [key]: editor.value } }, `edited ${label.toLowerCase()}`)));
  const docTitle = () => `${label} - ${app.company || "Company"} - ${app.role || "Role"}`;
  section.append(editor, el("div", "button-row",
    button(`Regenerate ${label.toLowerCase()} only`, () => generate(ctx, app, [key], instructions.value, lineId), "secondary", { disabled: busy }),
    button("Save to Documents", async () => {
      await ctx.mutate("documents", (docs) => [createDocument({ name: docTitle(), kind: key === "resume" ? "resume" : key === "coverLetter" ? "cover letter" : "message", content: editor.value, applicationId: app.id }), ...(docs || [])]);
      setLine(lineId, "Saved to Documents.");
    }),
    exportButtons(docTitle, () => editor.value)), statusLine(lineId));
  if (app.materials?.honestyFlags?.length) section.append(el("h4", {}, "Not claimed (no evidence yet)"), list(app.materials.honestyFlags, "flags"));
  if (app.materials?.tailoringNotes?.length) section.append(el("h4", {}, "What Claude changed"), list(app.materials.tailoringNotes));
  return section;
}

async function generate(ctx, app, kinds, instructions, lineId) {
  if ((app.jobText || "").length < 80) return setLine(lineId, "Add the job description first.", true);
  if (kinds.includes("resume") && (ctx.data.resumeText || "").trim().length < 200) return setLine(lineId, "Add your master resume text in Profile or Documents first.", true);
  ctx.busy.add(lineId);
  setLine(lineId, `Claude is writing ${kinds.length === 3 ? "your resume, cover letter, and outreach message" : "this draft"}… this can take a minute or two.`);
  try {
    const result = await ctx.call("/agent/materials", { kinds, instructions, job: { company: app.company, role: app.role, url: app.url, location: app.location, text: app.jobText, analysis: app.analysis } });
    await ctx.mutate("applications", (list) => list.map((item) => {
      if (item.id !== app.id) return item;
      const materials = { ...(item.materials || {}), generatedAt: new Date().toISOString(), model: result.model, tailoringNotes: result.tailoringNotes || [], honestyFlags: result.honestyFlags || [] };
      kinds.forEach((kind) => { if (result[kind]) materials[kind] = result[kind]; });
      return { ...item, materials, updatedAt: new Date().toISOString(), events: [...(item.events || []), { at: new Date().toISOString(), type: `generated ${kinds.join(", ")}` }] };
    }));
    ctx.busy.delete(lineId);
    ctx.keepScroll = true;
    ctx.rerender();
  } catch (error) {
    ctx.busy.delete(lineId);
    setLine(lineId, error.message, true);
  }
}

function contactsCard(ctx, app) {
  const linked = ctx.data.contacts.filter((contact) => contact.applicationId === app.id || (app.company && contact.company && contact.company.toLowerCase() === app.company.toLowerCase()));
  const section = card(null, el("div", "section-title", el("h3", {}, "People"), button("Add contact", () => ctx.go(`#/contacts/new/${app.id}`))));
  if (linked.length) linked.forEach((contact) => section.append(el("div", "contact-line", el("a", { href: `#/contacts/${contact.id}` }, contact.name || "Unnamed"), ` · ${contact.title || contact.relationship} · ${contact.stage}`)));
  else section.append(el("p", "muted", "No contacts yet. A referral or a short note to the hiring manager usually beats a cold application."));
  const links = peopleSearchLinks(app.company, app.role);
  if (links.length) section.append(el("h4", {}, "Find recruiters and hiring managers"), el("div", "link-list", links.map((link) => el("a", { href: link.url, target: "_blank", rel: "noopener noreferrer" }, link.label))));
  return section;
}

function jobTextCard(ctx, app, save) {
  const text = el("textarea", { rows: 12, placeholder: "Paste the job description here." });
  text.value = app.jobText || "";
  text.addEventListener("change", () => save({ jobText: text.value.slice(0, 20000) }, "updated job description"));
  return card(null, el("details", { open: !app.jobText }, el("summary", {}, `Job description${app.jobText ? ` (${app.jobText.length.toLocaleString()} characters)` : " (missing)"}`), text));
}

function notesCard(app, save) {
  const notes = el("textarea", { rows: 4, placeholder: "Recruiter name, referral, salary range they shared, interview dates…" });
  notes.value = app.notes || "";
  notes.addEventListener("change", () => save({ notes: notes.value }));
  return card("Notes & history", notes, el("div", "events", (app.events || []).slice(-10).reverse().map((event) => el("div", {}, `${new Date(event.at).toLocaleString()} · ${event.type}`))));
}

/* ------------------------------------------------------------------ */
/* Kanban board                                                         */
/* ------------------------------------------------------------------ */

export function renderBoard(root, ctx) {
  const head = header("Board", "Drag cards between columns to update status.");
  head.append(button("Add a job", () => newJobDialog(ctx), "primary"));
  root.append(head);
  const board = el("div", "board");
  for (const status of APPLICATION_STATUSES) {
    const apps = ctx.data.applications.filter((app) => app.status === status);
    const column = el("section", { class: "column", "data-status": status, "aria-label": status },
      el("header", {}, el("span", {}, status), el("span", "count", String(apps.length))));
    column.addEventListener("dragover", (event) => { event.preventDefault(); column.classList.add("drop"); });
    column.addEventListener("dragleave", () => column.classList.remove("drop"));
    column.addEventListener("drop", async (event) => {
      event.preventDefault();
      column.classList.remove("drop");
      const id = event.dataTransfer.getData("text/plain");
      const app = ctx.data.applications.find((item) => item.id === id);
      if (!app || app.status === status) return;
      await ctx.mutate("applications", (list) => updateApplication(list, id, { status, ...(status === "Applied" && !app.appliedAt ? { appliedAt: new Date().toISOString() } : {}) }, `status → ${status}`));
      ctx.keepScroll = true;
      ctx.rerender();
    });
    apps.forEach((app) => {
      const score = app.analysis?.fit_score;
      const moveSelect = select(APPLICATION_STATUSES, app.status, async (value) => {
        await ctx.mutate("applications", (list) => updateApplication(list, app.id, { status: value, ...(value === "Applied" && !app.appliedAt ? { appliedAt: new Date().toISOString() } : {}) }, `status → ${value}`));
        ctx.keepScroll = true;
        ctx.rerender();
      }, { "aria-label": "Move to", class: "move" });
      const cardNode = el("article", { class: "kcard", draggable: "true" },
        el("div", "kcard-top", el("a", { href: `#/apps/${app.id}`, class: "name" }, app.company || "Unknown"), el("span", { class: `badge ${scoreClass(score)}` }, score == null ? "–" : String(score))),
        el("div", "sub", app.role || "Role"),
        app.nextActionOn ? el("div", `sub${isPastDay(app.nextActionOn) ? " overdue-text" : ""}`, `Next: ${app.nextAction || "follow up"} · ${shortDate(app.nextActionOn)}`) : null,
        moveSelect);
      cardNode.addEventListener("dragstart", (event) => event.dataTransfer.setData("text/plain", app.id));
      column.append(cardNode);
    });
    board.append(column);
  }
  root.append(board);
}

/* ------------------------------------------------------------------ */
/* Shared                                                               */
/* ------------------------------------------------------------------ */

function header(title, subtitle) {
  return el("header", "view-head", el("div", {}, el("h1", {}, title), subtitle ? el("p", "muted", subtitle) : null));
}

export function newJobDialog(ctx) {
  ctx.openDialog((close) => {
    const company = el("input", { required: true });
    const role = el("input");
    const url = el("input", { type: "url", placeholder: "https://" });
    const text = el("textarea", { rows: 12, placeholder: "Paste the full posting from LinkedIn, Work at a Startup, an email…" });
    const analyzeBox = el("input", { type: "checkbox", checked: ctx.agent.ready });
    const form = el("form", { class: "dialog-form", onsubmit: async (event) => {
      event.preventDefault();
      const record = createApplication({ url: url.value.trim(), company: company.value.trim(), role: role.value.trim(), text: text.value.trim() });
      await ctx.mutate("applications", (list) => upsertApplication(list, record));
      close();
      ctx.go(`#/apps/${record.id}`);
      if (analyzeBox.checked && record.jobText.length >= 80) setTimeout(() => analyze(ctx, record, `fit-${record.id}`), 50);
    } },
    el("h2", {}, "Add a job"),
    el("div", "grid2", field("Company", company), field("Role", role)),
    field("Posting URL", url), field("Job description", text),
    el("label", "check", analyzeBox, "Analyze fit with Claude after saving"),
    el("div", "button-row end", button("Cancel", close), el("button", { class: "primary", type: "submit" }, "Save")));
    return form;
  });
}

function backup(ctx) {
  const payload = { version: 2, exportedAt: new Date().toISOString(), applications: ctx.data.applications, contacts: ctx.data.contacts, documents: ctx.data.documents, interviews: ctx.data.interviews };
  downloadText(`applypilot-backup-${today()}.json`, JSON.stringify(payload, null, 2), "application/json");
}

function restore(ctx) {
  const input = el("input", { type: "file", accept: "application/json" });
  input.addEventListener("change", async () => {
    const file = input.files?.[0];
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text());
      const data = Array.isArray(parsed) ? { applications: parsed } : parsed;
      let restored = 0;
      for (const key of ["applications", "contacts", "documents", "interviews"]) {
        const incoming = data[key];
        if (!Array.isArray(incoming)) continue;
        if (incoming.some((item) => !item || typeof item.id !== "string")) throw new Error("This file is not an ApplyPilot backup.");
        await ctx.mutate(key, (current = []) => {
          const byId = new Map(current.map((item) => [item.id, item]));
          incoming.forEach((item) => byId.set(item.id, item));
          return [...byId.values()];
        });
        restored += incoming.length;
      }
      alert(`Restored ${restored} item(s).`);
      ctx.rerender();
    } catch (error) {
      alert(error.message);
    }
  });
  input.click();
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

export { header };
