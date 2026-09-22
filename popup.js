import { defaultProfile, suggestFields } from "./src/field-mapper.mjs";
import { applySavedAnswers, discoverQuestions, mergeQuestionBank } from "./src/question-bank.mjs";

const state = { profile: defaultProfile, suggestions: [], scan: null, questionBank: [], acknowledged: false, settings: { autoAssist: true } };
const $ = (id) => document.getElementById(id);

document.addEventListener("DOMContentLoaded", async () => {
  const saved = await chrome.storage.local.get(["profile", "questionBank", "responsibilityAck", "automationSettings"]);
  state.profile = { ...defaultProfile, ...(saved.profile || {}) };
  state.questionBank = saved.questionBank || [];
  state.settings = { autoAssist: true, ...(saved.automationSettings || {}) };
  state.acknowledged = Boolean(saved.responsibilityAck?.acknowledged && saved.responsibilityAck?.signature);
  const hasProfileValue = Object.values(state.profile.identity || {}).some(Boolean) || Object.values(state.profile.contact || {}).some(Boolean);
  $("profileState").textContent = !state.acknowledged ? "Sign responsibility acknowledgment in Profile" : hasProfileValue ? "Profile: loaded locally" : "Profile: not configured";
  $("scanButton").addEventListener("click", () => scan({ automatic: state.settings.autoAssist }));
  $("fillButton").addEventListener("click", fillSelected);
  $("selectReadyButton").addEventListener("click", selectReady);
  $("optionsButton").addEventListener("click", () => chrome.runtime.openOptionsPage());
  $("scanButton").disabled = !state.acknowledged;
  $("scanButton").textContent = state.settings.autoAssist ? "Scan & fill approved fields" : "Scan current page";
  if (!state.acknowledged) setStatus("Complete the installer responsibility acknowledgment in Profile before scanning or filling.", true);
  else if (hasProfileValue && state.settings.autoAssist) setTimeout(() => scan({ automatic: true }), 120);
});

async function scan({ automatic = false } = {}) {
  setStatus("Reading visible fields from the current page…");
  let response;
  try {
    response = await chrome.runtime.sendMessage({ type: "scanActiveTab" });
  } catch (error) {
    return setStatus(error.message || "The page could not be scanned.", true);
  }
  if (!response?.ok) return setStatus(response?.error || "The page could not be scanned.", true);
  state.scan = response.data;
  const initialSuggestions = suggestFields(state.scan.fields, state.profile);
  const unknownFields = state.scan.fields.filter((_field, index) => initialSuggestions[index].status !== "ready");
  const discovered = discoverQuestions(unknownFields, state.scan);
  const knownQuestionIds = new Set(state.questionBank.map((item) => item.id));
  const newQuestionCount = discovered.filter((item) => !knownQuestionIds.has(item.id)).length;
  state.questionBank = mergeQuestionBank(state.questionBank, discovered);
  await chrome.storage.local.set({ questionBank: state.questionBank });
  state.suggestions = applySavedAnswers(initialSuggestions, state.questionBank);
  renderScan();
  let filledCount = 0;
  if (automatic && state.settings.autoAssist) filledCount = await fillApprovedFields();
  if (newQuestionCount) {
    setStatus(`${filledCount ? `Automatically filled ${filledCount} approved field(s). ` : ""}${newQuestionCount} new application question(s) were found. Add missing answers in Profile.`);
  } else if (discovered.some((item) => !item.answer)) {
    setStatus(`${filledCount ? `Automatically filled ${filledCount} approved field(s). ` : ""}Tracked application questions are still missing answers. Add them in Profile.`);
  } else if (filledCount) {
    setStatus(`Automatically filled ${filledCount} approved field(s). Review the page before continuing.`);
  }
}

function renderScan() {
  $("pageSummary").classList.remove("hidden");
  $("pageSummary").textContent = `${state.scan.title || "Current page"} · ${state.suggestions.length} visible fields · no page data uploaded`;
  $("fieldsSection").classList.remove("hidden");
  const container = $("fields");
  container.replaceChildren();

  state.suggestions.forEach((suggestion, i) => {
    const wrapper = document.createElement("div");
    wrapper.className = `field${suggestion.mapping.sensitive ? " sensitive" : ""}`;
    const check = document.createElement("input");
    check.type = "checkbox";
    check.dataset.index = String(i);
    check.checked = suggestion.status === "ready" && suggestion.mapping.confidence >= 0.9;
    check.disabled = !suggestion.value || suggestion.status !== "ready";
    const content = document.createElement("div");
    const label = document.createElement("label");
    label.textContent = suggestion.mapping.key ? suggestion.mapping.label : (suggestion.label || suggestion.name || "Unrecognized field");
    const meta = document.createElement("div");
    meta.className = `meta${suggestion.status !== "ready" ? " warning" : ""}`;
    meta.textContent = suggestion.status === "ready"
      ? `${suggestion.mapping.key ? `${Math.round(suggestion.mapping.confidence * 100)}% mapping confidence` : "Saved question-bank answer"}${suggestion.mapping.manualOnly ? " · review required" : ""}${suggestion.mapping.sensitive ? " · sensitive" : ""}`
      : suggestion.status === "missing-profile-value" ? "Add this value in Profile before filling" : "No verified mapping; review manually";
    const input = document.createElement("input");
    input.type = "text";
    input.value = suggestion.value;
    input.placeholder = "No value suggested";
    input.dataset.index = String(i);
    input.disabled = !suggestion.value;
    input.addEventListener("input", () => { state.suggestions[i].value = input.value; check.checked = Boolean(input.value); check.disabled = !input.value; });
    content.append(label, meta, input);
    wrapper.append(check, content);
    container.append(wrapper);
  });
  $("fillButton").disabled = !state.suggestions.some((item) => item.value);
  setStatus(state.settings.autoAssist ? "Approved fields are filled automatically. Review the page and any highlighted questions." : "Review the suggestions, then select the fields you want to fill.");
}

function selectReady() {
  document.querySelectorAll(".field input[type=checkbox]:not(:disabled)").forEach((checkbox) => {
    const suggestion = state.suggestions[Number(checkbox.dataset.index)];
    checkbox.checked = Boolean(suggestion?.value && !suggestion.mapping.manualOnly);
  });
}

async function fillApprovedFields() {
  const selected = state.suggestions
    .filter((item) => item?.value && item.status === "ready" && !item.mapping.manualOnly)
    .map((item) => ({ index: item.index, value: item.value }));
  if (!selected.length) return 0;
  setStatus(`Filling ${selected.length} approved field(s)…`);
  let response;
  try {
    response = await chrome.runtime.sendMessage({ type: "fillActiveTab", assignments: selected });
  } catch (error) {
    setStatus(error.message || "Approved fields could not be filled.", true);
    return 0;
  }
  if (!response?.ok) {
    setStatus(response?.error || "Approved fields could not be filled.", true);
    return 0;
  }
  return response.data.filledCount;
}

async function fillSelected() {
  const selected = Array.from(document.querySelectorAll(".field input[type=checkbox]:checked"))
    .map((checkbox) => state.suggestions[Number(checkbox.dataset.index)])
    .filter((item) => item?.value)
    .map((item) => ({ index: item.index, value: item.value }));
  if (!selected.length) return setStatus("Select at least one ready field.", true);
  if (!window.confirm(`Fill ${selected.length} selected field(s) on the current page?`)) return;
  setStatus("Filling selected fields…");
  const response = await chrome.runtime.sendMessage({ type: "fillActiveTab", assignments: selected });
  if (!response?.ok) return setStatus(response?.error || "Fields could not be filled.", true);
  setStatus(`Filled ${response.data.filledCount} field(s). Review the page before continuing.`);
}

function setStatus(message, error = false) {
  $("status").textContent = message;
  $("status").style.color = error ? "#b42318" : "#667085";
}
