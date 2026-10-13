import { APPROVABLE_SENSITIVE_KEYS, defaultProfile, suggestFields } from "./src/field-mapper.mjs";
import { applySavedAnswers, discoverQuestions, fieldPrompt, mergeQuestionBank, questionId } from "./src/question-bank.mjs";
import {
  applyAgentAnswers, buildAgentQuestions, createApplication, findApplicationForUrl, isAgentSensitive,
  pageKey, toAgentPayloadQuestions, updateApplication, upsertApplication
} from "./src/agent.mjs";
import { getAgentSettings, getApplications, loadAgentContext, mutateApplications, sendToBackground } from "./src/store.mjs";
import { createContact, dueItems } from "./src/crm.mjs";

const DRAFT_CACHE_MS = 2 * 60 * 60 * 1000;
const state = {
  profile: defaultProfile,
  suggestions: [],
  scan: null,
  questionBank: [],
  acknowledged: false,
  settings: { autoAssist: true, fillApprovedSensitive: false },
  agentSettings: { autoDraft: false, minConfidence: 0.7 },
  agent: { running: false, agent: { configured: false } },
  agentQuestions: [],
  busy: false
};
const $ = (id) => document.getElementById(id);

document.addEventListener("DOMContentLoaded", async () => {
  const saved = await chrome.storage.local.get(["profile", "questionBank", "responsibilityAck", "automationSettings"]);
  state.profile = { ...defaultProfile, ...(saved.profile || {}) };
  state.questionBank = saved.questionBank || [];
  state.settings = { autoAssist: true, fillApprovedSensitive: false, ...(saved.automationSettings || {}) };
  state.agentSettings = await getAgentSettings();
  state.acknowledged = Boolean(saved.responsibilityAck?.acknowledged && saved.responsibilityAck?.signature);
  const hasProfileValue = hasAnyProfileValue(state.profile);
  $("profileState").textContent = !state.acknowledged ? "Sign responsibility acknowledgment in Profile" : hasProfileValue ? "Profile: loaded locally" : "Profile: not configured";
  $("scanButton").addEventListener("click", () => scan({ automatic: state.settings.autoAssist }));
  $("fillButton").addEventListener("click", fillSelected);
  $("selectReadyButton").addEventListener("click", selectReady);
  $("optionsButton").addEventListener("click", () => chrome.runtime.openOptionsPage());
  $("analyzeButton").addEventListener("click", analyzeFit);
  $("draftButton").addEventListener("click", () => draftAnswers());
  $("appliedButton").addEventListener("click", markApplied);
  $("workspaceButton").addEventListener("click", () => openWorkspace());
  $("saveJobButton").addEventListener("click", saveJob);
  $("interviewButton").addEventListener("click", interviewPrep);
  $("linkedinOptimizeButton").addEventListener("click", optimizeLinkedIn);
  $("linkedinContactButton").addEventListener("click", saveLinkedInContact);
  $("dueLink").addEventListener("click", () => { chrome.tabs.create({ url: chrome.runtime.getURL("workspace.html#/today") }); window.close(); });
  $("scanButton").disabled = !state.acknowledged;
  $("scanButton").textContent = state.settings.autoAssist ? "Scan & fill approved fields" : "Scan current page";

  checkAgent();
  showJobCardForActiveTab();
  showDueReminders();
  const onLinkedInProfile = /^https:\/\/([a-z]+\.)?linkedin\.com\/in\//i.test((await activeTabInfo()).url);
  $("linkedinBar").classList.toggle("hidden", !onLinkedInProfile);
  if (!state.acknowledged) setStatus("Complete the installer responsibility acknowledgment in Profile before scanning or filling.", true);
  else if (hasProfileValue && state.settings.autoAssist) setTimeout(() => scan({ automatic: true }), 120);
});

/* ------------------------------------------------------------------ */
/* Agent status and job card                                            */
/* ------------------------------------------------------------------ */

async function checkAgent() {
  try {
    state.agent = await sendToBackground({ type: "agentHealth" });
  } catch {
    state.agent = { running: false, agent: { configured: false } };
  }
  const chip = $("agentChip");
  if (state.agent.running && state.agent.agent?.configured) {
    chip.textContent = "Claude ready";
    chip.title = `Decision engine: ${state.agent.agent.model}`;
    chip.className = "chip ready";
  } else if (state.agent.running) {
    chip.textContent = "AI key missing";
    chip.title = "Set ANTHROPIC_API_KEY and restart the local service to enable Claude.";
    chip.className = "chip off";
  } else {
    chip.textContent = "Agent offline";
    chip.title = "Start the local service: python3 local_service.py";
    chip.className = "chip off";
  }
  updateDraftButton();
}

function agentReady() {
  return Boolean(state.agent.running && state.agent.agent?.configured);
}

function requireAgent() {
  if (agentReady()) return true;
  setStatus(state.agent.running
    ? "Claude is not configured. Set ANTHROPIC_API_KEY, restart the local service, and try again."
    : "The local ApplyPilot service is not running. Start it with: python3 local_service.py", true);
  return false;
}

async function activeTabInfo() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return { url: tab?.url || "", title: tab?.title || "" };
}

async function showJobCardForActiveTab() {
  const { url } = await activeTabInfo();
  if (!/^https?:/i.test(url)) return;
  const record = findApplicationForUrl(await getApplications(), url);
  if (record) renderJobCard(record);
}

function renderJobCard(record) {
  const card = $("jobCard");
  card.replaceChildren();
  card.classList.remove("hidden");
  const analysis = record.analysis;
  const row = el("div", "row");
  const titleBox = el("div");
  titleBox.append(el("div", "title", [record.role, record.company].filter(Boolean).join(" · ") || "This job"));
  titleBox.append(el("div", "muted", `${record.status}${record.appliedAt ? ` on ${new Date(record.appliedAt).toLocaleDateString()}` : ""}`));
  row.append(titleBox);
  if (analysis) {
    const score = Number(analysis.fit_score) || 0;
    row.append(el("div", `score ${score >= 80 ? "high" : score >= 60 ? "mid" : "low"}`, String(score)));
  }
  card.append(row);
  if (analysis) {
    card.append(el("div", "", `${capitalize(analysis.recommendation || "")}: ${analysis.decision_reasoning || analysis.summary || ""}`));
    const list = el("ul");
    (analysis.red_flags || []).slice(0, 3).forEach((flag) => list.append(el("li", "flag", flag)));
    (analysis.gaps || []).slice(0, 2).forEach((gap) => list.append(el("li", "", `Gap: ${gap.gap}`)));
    if (list.children.length) card.append(list);
  } else {
    card.append(el("div", "muted", "Tracked. Use Analyze fit for a score and gap analysis."));
  }
}

/* ------------------------------------------------------------------ */
/* Scan and fill                                                        */
/* ------------------------------------------------------------------ */

async function scan({ automatic = false } = {}) {
  setStatus("Reading visible fields from the current page…");
  try {
    state.scan = await sendToBackground({ type: "scanActiveTab" });
  } catch (error) {
    return setStatus(error.message || "The page could not be scanned.", true);
  }
  const initialSuggestions = suggestFields(state.scan.fields, state.profile);
  const unknownFields = state.scan.fields.filter((_field, index) => {
    const suggestion = initialSuggestions[index];
    return !suggestion.mapping.key || (suggestion.mapping.manualOnly && suggestion.status !== "ready");
  });
  const discovered = discoverQuestions(unknownFields.filter((field) => !["radio", "checkbox"].includes(field.type)), state.scan);
  const knownQuestionIds = new Set(state.questionBank.map((item) => item.id || questionId(item.prompt)));
  const newQuestionCount = discovered.filter((item) => !knownQuestionIds.has(item.id)).length;
  state.questionBank = mergeQuestionBank(state.questionBank, discovered);
  await chrome.storage.local.set({ questionBank: state.questionBank });
  state.suggestions = applySavedAnswers(initialSuggestions, state.questionBank);
  const reusedDrafts = await applyCachedDrafts();
  renderScan();
  let filledCount = 0;
  if (automatic && state.settings.autoAssist) filledCount = await fillApprovedFields();
  const prefix = filledCount ? `Automatically filled ${filledCount} approved field(s). ` : "";
  if (reusedDrafts) {
    setStatus(`${prefix}Restored ${reusedDrafts} Claude draft(s) for this page. Review them, then Fill selected.`);
  } else if (automatic && state.agentSettings.autoDraft && agentReady() && buildAgentQuestions(state.suggestions).length) {
    setStatus(`${prefix}Asking Claude to draft the remaining answers…`);
    await draftAnswers({ quiet: true, prefix });
  } else if (newQuestionCount) {
    setStatus(`${prefix}${newQuestionCount} new application question(s) were found. Use Draft answers or add answers in Profile.`);
  } else if (filledCount) {
    setStatus(`${prefix}Review the page before continuing.`);
  }
}

function renderScan() {
  $("pageSummary").classList.remove("hidden");
  const frames = state.scan.frameCount > 1 ? ` across ${state.scan.frameCount} frames` : "";
  $("pageSummary").textContent = `${state.scan.title || "Current page"} · ${state.suggestions.length} visible fields${frames}`;
  $("fieldsSection").classList.remove("hidden");
  const container = $("fields");
  container.replaceChildren();

  state.suggestions.forEach((suggestion, i) => {
    const ai = Boolean(suggestion.mapping?.aiDraft);
    const wrapper = el("div", `field${suggestion.mapping.sensitive ? " sensitive" : ""}${ai ? " ai" : ""}`);
    const check = document.createElement("input");
    check.type = "checkbox";
    check.dataset.index = String(i);
    check.checked = ai ? Boolean(suggestion.preselect) : suggestion.status === "ready" && suggestion.mapping.confidence >= 0.9;
    check.disabled = !suggestion.value || suggestion.status !== "ready";
    const content = el("div");
    const label = document.createElement("label");
    label.textContent = suggestion.mapping.key ? suggestion.mapping.label : (suggestion.questionPrompt || suggestion.label || suggestion.name || "Unrecognized field");
    const meta = el("div", `meta${suggestion.status !== "ready" ? " warning" : ""}`);
    meta.textContent = metaText(suggestion);
    content.append(label, meta);
    if (ai && suggestion.mapping.reason) content.append(el("div", "reason", `Claude: ${suggestion.mapping.reason}`));
    if (!ai && suggestion.agentNote) content.append(el("div", "reason", `Claude: ${suggestion.agentNote}`));

    if (ai && ["radio", "checkbox"].includes(suggestion.type)) {
      content.append(el("div", "choice", suggestion.type === "radio" ? `Select: ${suggestion.aiAnswer}` : "Check this box"));
    } else {
      content.append(buildEditor(suggestion, i, check));
    }
    wrapper.append(check, content);
    container.append(wrapper);
  });
  $("fillButton").disabled = !state.suggestions.some((item) => item.value);
  updateDraftButton();
  if (!state.busy) {
    setStatus(state.settings.autoAssist ? "Approved fields are filled automatically. Review the page and any highlighted questions." : "Review the suggestions, then select the fields you want to fill.");
  }
}

function metaText(suggestion) {
  if (suggestion.mapping?.aiDraft) {
    const confidence = Math.round((suggestion.mapping.confidence || 0) * 100);
    return `Claude draft · ${confidence}% confidence${suggestion.mapping.source ? ` · ${suggestion.mapping.source}` : ""}`;
  }
  if (suggestion.status === "ready") {
    return `${suggestion.mapping.key ? `${Math.round(suggestion.mapping.confidence * 100)}% mapping confidence` : "Saved question-bank answer"}${suggestion.mapping.manualOnly ? " · review required" : ""}${suggestion.mapping.sensitive ? " · sensitive" : ""}`;
  }
  if (suggestion.status === "missing-profile-value") return suggestion.mapping.manualOnly ? "Sensitive: answer this yourself" : "Add this value in Profile before filling";
  return isAgentSensitive(fieldPrompt(suggestion)) ? "Sensitive: answer this yourself" : "No verified mapping; review manually";
}

function buildEditor(suggestion, i, check) {
  const longText = suggestion.tag === "textarea" || suggestion.contentEditable || String(suggestion.value || "").length > 90;
  const editor = suggestion.options?.length ? document.createElement("select") : document.createElement(longText ? "textarea" : "input");
  if (editor.tagName.toLowerCase() === "select") {
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = "Choose an answer";
    editor.append(placeholder);
    suggestion.options.forEach((option) => {
      const choice = document.createElement("option");
      choice.value = option.value;
      choice.textContent = option.text || option.value;
      editor.append(choice);
    });
    const matching = suggestion.options.find((option) => option.value === suggestion.value || option.text === suggestion.value);
    if (suggestion.value && !matching) {
      const custom = document.createElement("option");
      custom.value = suggestion.value;
      custom.textContent = suggestion.value;
      editor.append(custom);
    }
    editor.value = matching ? matching.value : suggestion.value;
  } else {
    if (editor.tagName.toLowerCase() === "input") editor.type = ["email", "tel", "url", "date", "number"].includes(suggestion.type) ? suggestion.type : "text";
    editor.placeholder = "Enter an approved answer if you want to review it manually";
    editor.value = suggestion.value;
  }
  editor.dataset.index = String(i);
  const sync = () => {
    state.suggestions[i].value = editor.value;
    if (editor.value && state.suggestions[i].status !== "ready") state.suggestions[i].status = "ready";
    check.checked = Boolean(editor.value);
    check.disabled = !editor.value;
  };
  editor.addEventListener("input", sync);
  editor.addEventListener("change", sync);
  return editor;
}

function selectReady() {
  document.querySelectorAll(".field input[type=checkbox]:not(:disabled)").forEach((checkbox) => {
    const suggestion = state.suggestions[Number(checkbox.dataset.index)];
    checkbox.checked = Boolean(suggestion?.value && !suggestion.mapping.manualOnly && (!suggestion.mapping.aiDraft || suggestion.preselect));
  });
}

async function fillApprovedFields() {
  const selected = state.suggestions
    .filter((item) => item?.value && item.status === "ready" && !item.mapping.aiDraft && canAutoFill(item))
    .map(toAssignment);
  if (!selected.length) return 0;
  setStatus(`Filling ${selected.length} approved field(s)…`);
  try {
    const result = await sendToBackground({ type: "fillActiveTab", assignments: selected });
    await logFillEvent(result.filledCount);
    return result.filledCount;
  } catch (error) {
    setStatus(error.message || "Approved fields could not be filled.", true);
    return 0;
  }
}

async function fillSelected() {
  const chosen = Array.from(document.querySelectorAll(".field input[type=checkbox]:checked"))
    .map((checkbox) => state.suggestions[Number(checkbox.dataset.index)])
    .filter((item) => item?.value);
  if (!chosen.length) return setStatus("Select at least one ready field.", true);
  const drafts = chosen.filter((item) => item.mapping?.aiDraft).length;
  const note = drafts ? ` ${drafts} of them are Claude drafts you have reviewed.` : "";
  if (!window.confirm(`Fill ${chosen.length} selected field(s) on the current page?${note}`)) return;
  setStatus("Filling selected fields…");
  let result;
  try {
    result = await sendToBackground({ type: "fillActiveTab", assignments: chosen.map(toAssignment) });
  } catch (error) {
    return setStatus(error.message || "Fields could not be filled.", true);
  }
  const filledIndexes = new Set(result.results.filter((item) => item.status === "filled").map((item) => item.index));
  const learned = await learnApprovedDrafts(chosen.filter((item) => filledIndexes.has(item.index)));
  await logFillEvent(result.filledCount);
  const skipped = result.results.length - result.filledCount;
  setStatus(`Filled ${result.filledCount} field(s)${skipped ? `, skipped ${skipped}` : ""}.${learned ? ` Saved ${learned} answer(s) for reuse.` : ""} Review the page, then submit it yourself.`);
}

/* Reusable factual answers you approved are saved to the question bank, so the
 * next form fills them without another AI call. Job-specific prose is not saved. */
async function learnApprovedDrafts(filled) {
  const jobSpecific = /\b(why|interest|interested|motivat|excite|cover letter|about us|this role|this company|this position|our mission|tell us|describe)\b/i;
  const reusable = filled.filter((item) => item.mapping?.aiDraft && !["radio", "checkbox"].includes(item.type) && item.tag !== "textarea" &&
    String(item.value).length <= 150 && !jobSpecific.test(fieldPrompt(item)) && !isAgentSensitive(fieldPrompt(item)));
  if (!reusable.length) return 0;
  const { questionBank = [] } = await chrome.storage.local.get(["questionBank"]);
  const now = new Date().toISOString();
  const byId = new Map(questionBank.map((item) => [item.id || questionId(item.prompt), item]));
  reusable.forEach((item) => {
    const prompt = fieldPrompt(item);
    const id = questionId(prompt);
    const existing = byId.get(id);
    byId.set(id, {
      ...(existing || { id, prompt, sensitive: false, site: hostOf(state.scan?.url), fieldType: item.type, required: Boolean(item.required), choices: [], firstSeen: now, occurrences: 1 }),
      answer: String(item.value),
      answerSource: "claude-draft-approved",
      lastSeen: now
    });
  });
  state.questionBank = [...byId.values()];
  await chrome.storage.local.set({ questionBank: state.questionBank });
  return reusable.length;
}

function canAutoFill(item) {
  if (!item.mapping.manualOnly) return true;
  return state.settings.fillApprovedSensitive === true && APPROVABLE_SENSITIVE_KEYS.has(item.mapping.key);
}

function toAssignment(item) {
  return { index: item.index, value: item.value, locator: item.locator, frameId: item.frameId || 0 };
}

/* ------------------------------------------------------------------ */
/* Claude actions                                                       */
/* ------------------------------------------------------------------ */

function updateDraftButton() {
  const remaining = state.suggestions.length ? buildAgentQuestions(state.suggestions).length : 0;
  $("draftButton").disabled = state.busy || !state.scan || !remaining;
  $("draftButton").textContent = remaining ? `Draft ${remaining} answer${remaining === 1 ? "" : "s"}` : "Draft answers";
}

async function jobContextFor(url) {
  const record = findApplicationForUrl(await getApplications(), url);
  if (record?.jobText) return { record, job: { company: record.company, role: record.role, url: record.url, location: record.location, text: record.jobText, analysis: record.analysis } };
  try {
    const posting = await sendToBackground({ type: "extractJob" });
    return { record, job: { company: posting.company, role: posting.title, url, location: posting.location, text: posting.text } };
  } catch {
    return { record, job: { url, role: state.scan?.title || "" } };
  }
}

async function draftAnswers({ quiet = false, prefix = "" } = {}) {
  if (!state.scan) return setStatus("Scan the page first.", true);
  if (!requireAgent()) return;
  const questions = buildAgentQuestions(state.suggestions);
  if (!questions.length) return setStatus("Nothing left for Claude to draft. Remaining fields are sensitive or already answered.");
  setBusy(true);
  setStatus(`${prefix}Claude is deciding ${questions.length} answer(s)… this can take up to a minute.`);
  try {
    const context = await loadAgentContext();
    const { job } = await jobContextFor(state.scan.url);
    const result = await sendToBackground({
      type: "agentCall",
      endpoint: "/agent/answer",
      cacheKey: `draft:${pageKey(state.scan.url)}`,
      payload: { ...context, job, questions: toAgentPayloadQuestions(questions) }
    });
    applyDraftResult(questions, result.answers || []);
    const drafted = state.suggestions.filter((item) => item.mapping?.aiDraft).length;
    const needs = state.suggestions.filter((item) => item.agentNote && !item.mapping?.aiDraft).length;
    setStatus(`${prefix}Claude drafted ${drafted} answer(s)${needs ? `; ${needs} need your decision` : ""}. Review the blue cards, then Fill selected.`);
  } catch (error) {
    setStatus(error.message, true);
  } finally {
    setBusy(false);
    if (!quiet) updateDraftButton();
  }
}

function applyDraftResult(questions, answers) {
  const result = applyAgentAnswers(state.suggestions, questions, answers, { minConfidence: state.agentSettings.minConfidence });
  state.suggestions = result.suggestions;
  state.agentQuestions = questions;
  state.busy = true;
  renderScan();
  state.busy = false;
  document.querySelector(".field.ai")?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  return result.drafted;
}

async function applyCachedDrafts() {
  if (!state.scan?.url) return 0;
  const { agentCache = {} } = await chrome.storage.local.get(["agentCache"]);
  const cached = agentCache[`draft:${pageKey(state.scan.url)}`];
  if (!cached || Date.now() - cached.at > DRAFT_CACHE_MS) return 0;
  const questions = buildAgentQuestions(state.suggestions);
  const ids = new Set(questions.map((item) => item.id));
  const answers = (cached.result?.answers || []).filter((item) => ids.has(item.id));
  if (!answers.length) return 0;
  const result = applyAgentAnswers(state.suggestions, questions, answers, { minConfidence: state.agentSettings.minConfidence });
  state.suggestions = result.suggestions;
  return result.drafted;
}

async function analyzeFit() {
  if (!requireAgent()) return;
  setBusy(true);
  setStatus("Reading the job description on this page…");
  try {
    const posting = await sendToBackground({ type: "extractJob" });
    if ((posting.text || "").length < 200) throw new Error("This page has very little job-description text. Open the posting itself, or paste it in the Workspace.");
    const record = await ensureApplication({ url: posting.url, title: posting.title, company: posting.company, location: posting.location, text: posting.text });
    setStatus("Claude is scoring your fit…");
    const context = await loadAgentContext();
    const analysis = await sendToBackground({
      type: "agentCall",
      endpoint: "/agent/analyze-job",
      payload: { ...context, job: { company: record.company, role: record.role, url: record.url, location: record.location, text: record.jobText } }
    });
    const apps = await mutateApplications((list) => updateApplication(list, record.id, {
      analysis: { ...analysis, analyzedAt: new Date().toISOString() },
      // The analysis reads the posting itself, so it beats a role guessed from the tab title.
      company: analysis.company || record.company || "",
      role: analysis.role || record.role || "",
      location: analysis.location || record.location || ""
    }, "analyzed"));
    renderJobCard(apps.find((item) => item.id === record.id));
    setStatus(`Fit ${analysis.fit_score}/100 · ${analysis.recommendation}. Open Workspace for the full breakdown and tailored materials.`);
  } catch (error) {
    setStatus(error.message, true);
  } finally {
    setBusy(false);
  }
}

async function ensureApplication(details) {
  const url = details.url || (await activeTabInfo()).url;
  let record;
  await mutateApplications((list) => {
    const existing = findApplicationForUrl(list, url);
    if (existing) {
      record = {
        ...existing,
        jobText: details.text && details.text.length > (existing.jobText || "").length ? details.text.slice(0, 20000) : existing.jobText,
        company: existing.company || details.company || "",
        role: existing.role || details.title || "",
        location: existing.location || details.location || ""
      };
    } else {
      record = createApplication({ ...details, url });
    }
    return upsertApplication(list, record);
  });
  return record;
}

async function logFillEvent(count) {
  if (!count || !state.scan?.url) return;
  const record = await ensureApplication({ url: state.scan.url, title: cleanTitle(state.scan.title) });
  const apps = await mutateApplications((list) => updateApplication(list, record.id, {
    status: ["Interested", "Skipped"].includes(record.status) ? "In progress" : record.status
  }, `filled ${count} field(s)`));
  renderJobCard(apps.find((item) => item.id === record.id));
}

async function markApplied() {
  setBusy(true);
  try {
    const tab = await activeTabInfo();
    if (!/^https?:/i.test(tab.url)) throw new Error("Open the application page first.");
    let details = { url: tab.url, title: cleanTitle(tab.title) };
    const existing = findApplicationForUrl(await getApplications(), tab.url);
    if (!existing?.jobText) {
      try {
        const posting = await sendToBackground({ type: "extractJob" });
        details = { url: tab.url, title: posting.title || details.title, company: posting.company, location: posting.location, text: posting.text };
      } catch { /* logging still works without the posting text */ }
    }
    const record = await ensureApplication(details);
    const apps = await mutateApplications((list) => updateApplication(list, record.id, { status: "Applied", appliedAt: new Date().toISOString() }, "applied"));
    renderJobCard(apps.find((item) => item.id === record.id));
    setStatus("Logged as applied. Edit details or notes in the Workspace.");
  } catch (error) {
    setStatus(error.message, true);
  } finally {
    setBusy(false);
  }
}

async function showDueReminders() {
  const { applications = [], contacts = [] } = await chrome.storage.local.get(["applications", "contacts"]);
  const items = dueItems({ applications, contacts }).filter((item) => item.overdue || item.today);
  if (!items.length) return;
  $("dueLink").textContent = `${items.length} follow-up${items.length === 1 ? "" : "s"} due: ${items[0].title}${items.length > 1 ? " …" : ""}`;
  $("dueLink").classList.remove("hidden");
}

async function saveJob() {
  setBusy(true);
  setStatus("Saving this job to your tracker…");
  try {
    const { record, existed } = await sendToBackground({ type: "saveJob" });
    renderJobCard(record);
    setStatus(`${existed ? "Updated" : "Saved"} ${[record.role, record.company].filter(Boolean).join(" at ") || "this job"}. Analyze fit when you're ready, or open the Workspace.`);
  } catch (error) {
    setStatus(error.message, true);
  } finally {
    setBusy(false);
  }
}

async function interviewPrep() {
  const tab = await activeTabInfo();
  let record = /^https?:/i.test(tab.url) ? findApplicationForUrl(await getApplications(), tab.url) : null;
  if (!record && /^https?:/i.test(tab.url)) {
    try { record = (await sendToBackground({ type: "saveJob" })).record; } catch { /* open the interview view without a job */ }
  }
  chrome.tabs.create({ url: chrome.runtime.getURL(`workspace.html#/interview${record ? `/${record.id}` : ""}`) });
}

async function optimizeLinkedIn() {
  setStatus("Reading this LinkedIn profile…");
  try {
    const profile = await sendToBackground({ type: "extractLinkedIn" });
    await chrome.storage.local.set({ linkedinSnapshot: { ...profile, capturedAt: new Date().toISOString() } });
    chrome.tabs.create({ url: chrome.runtime.getURL("workspace.html#/studio/linkedin") });
  } catch (error) {
    setStatus(error.message, true);
  }
}

async function saveLinkedInContact() {
  setStatus("Reading this LinkedIn profile…");
  try {
    const profile = await sendToBackground({ type: "extractLinkedIn" });
    const [title, company] = splitHeadline(profile.headline, profile.sections?.experience);
    const { contacts = [] } = await chrome.storage.local.get(["contacts"]);
    const url = profile.url.split("?")[0];
    if (contacts.some((item) => item.linkedin && item.linkedin.split("?")[0] === url)) return setStatus(`${profile.name} is already in your contacts.`);
    const contact = createContact({ name: profile.name, title, company, linkedin: url, relationship: /recruit|talent/i.test(profile.headline) ? "Recruiter" : /manager|director|head|vp/i.test(profile.headline) ? "Hiring manager" : "Peer", notes: profile.headline });
    await chrome.storage.local.set({ contacts: [contact, ...contacts] });
    setStatus(`Saved ${profile.name} to Contacts. Set a follow-up date in the Workspace.`);
  } catch (error) {
    setStatus(error.message, true);
  }
}

function splitHeadline(headline = "", experience = "") {
  const match = String(headline).match(/^(.*?)\s+(?:at|@)\s+(.+?)(?:\s*[|·,-].*)?$/i);
  if (match) return [match[1].trim(), match[2].trim()];
  const lines = String(experience).split("\n").map((line) => line.trim()).filter(Boolean);
  const company = (lines[2] || "").split("·")[0].trim();
  return [String(headline).split("|")[0].trim(), company];
}

async function openWorkspace() {
  const tab = await activeTabInfo();
  const record = /^https?:/i.test(tab.url) ? findApplicationForUrl(await getApplications(), tab.url) : null;
  chrome.tabs.create({ url: chrome.runtime.getURL(`workspace.html#/apps${record ? `/${record.id}` : ""}`) });
}

/* ------------------------------------------------------------------ */
/* Utilities                                                            */
/* ------------------------------------------------------------------ */

function setBusy(busy) {
  state.busy = busy;
  ["analyzeButton", "appliedButton", "scanButton", "saveJobButton"].forEach((id) => { $(id).disabled = busy || (id === "scanButton" && !state.acknowledged); });
  updateDraftButton();
}

function el(tag, className = "", textContent = "") {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (textContent) node.textContent = textContent;
  return node;
}

function capitalize(value = "") {
  return value ? value[0].toUpperCase() + value.slice(1) : "";
}

function cleanTitle(title = "") {
  return String(title).replace(/\s*[|–-]\s*(greenhouse|lever|workday|ashby|linkedin|indeed).*$/i, "").trim();
}

function hostOf(url = "") {
  try { return new URL(url).hostname; } catch { return "current page"; }
}

function hasAnyProfileValue(value) {
  if (!value || typeof value !== "object") return Boolean(value);
  return Object.entries(value).some(([key, child]) => key !== "metadata" && (typeof child === "object" ? hasAnyProfileValue(child) : Boolean(String(child || "").trim())));
}

function setStatus(message, error = false) {
  $("status").textContent = message;
  $("status").style.color = error ? "#b42318" : "#667085";
}
