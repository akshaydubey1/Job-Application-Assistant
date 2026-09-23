import { defaultProfile } from "./src/field-mapper.mjs";
import { extractCandidateProfile, profileFromJson } from "./src/resume-parser.mjs";
import { isSensitivePrompt } from "./src/question-bank.mjs";

const editor = document.getElementById("profileEditor");
const status = document.getElementById("status");
const proposalEditor = document.getElementById("proposalEditor");
const extractStatus = document.getElementById("extractStatus");
const proposalSummary = document.getElementById("proposalSummary");
const autoAssistCheckbox = document.getElementById("autoAssistCheckbox");
const automationStatus = document.getElementById("automationStatus");
const parserUrl = document.getElementById("parserUrl");
const parserStatus = document.getElementById("parserStatus");
let questionBank = [];

document.addEventListener("DOMContentLoaded", async () => {
  const saved = await chrome.storage.local.get(["profile", "questionBank", "responsibilityAck", "automationSettings", "parserSettings"]);
  editor.value = JSON.stringify(saved.profile || defaultProfile, null, 2);
  questionBank = saved.questionBank || [];
  parserUrl.value = saved.parserSettings?.url || "http://127.0.0.1:8765";
  autoAssistCheckbox.checked = saved.automationSettings?.autoAssist !== false;
  setAutomationStatus(autoAssistCheckbox.checked
    ? "Automatic scan and filling is on for approved, non-high-risk fields."
    : "Automatic scan and filling is off. You can still scan manually from the extension popup.");
  renderQuestionBank();
  if (saved.responsibilityAck?.acknowledged) {
    document.getElementById("ackCheckbox").checked = true;
    document.getElementById("signatureInput").value = saved.responsibilityAck.signature || "";
    setAckStatus(`Acknowledged on ${new Date(saved.responsibilityAck.signedAt).toLocaleString()}.`);
  }
});

autoAssistCheckbox.addEventListener("change", async () => {
  const autoAssist = autoAssistCheckbox.checked;
  await chrome.storage.local.set({ automationSettings: { autoAssist } });
  setAutomationStatus(autoAssist
    ? "Automatic scan and filling is on for approved, non-high-risk fields."
    : "Automatic scan and filling is off. You can still scan manually from the extension popup.");
});

parserUrl.addEventListener("change", async () => {
  try {
    const url = getLocalParserUrl();
    parserUrl.value = url;
    await chrome.storage.local.set({ parserSettings: { url } });
    setParserStatus("Parser address saved locally.");
  } catch (error) {
    setParserStatus(error.message, true);
  }
});

document.getElementById("saveButton").addEventListener("click", async () => {
  try {
    const profile = JSON.parse(editor.value);
    await chrome.storage.local.set({ profile });
    status.textContent = "Saved locally. Review it whenever your facts change.";
    status.style.color = "#207547";
  } catch (error) {
    status.textContent = `Invalid JSON: ${error.message}`;
    status.style.color = "#b42318";
  }
});

document.getElementById("importButton").addEventListener("click", () => document.getElementById("fileInput").click());
document.getElementById("fileInput").addEventListener("change", async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  editor.value = await file.text();
  status.textContent = "Imported into the editor. Click Save locally to activate it.";
  status.style.color = "#667085";
});

document.getElementById("extractButton").addEventListener("click", extractResume);
document.getElementById("checkParserButton").addEventListener("click", checkLocalParser);
document.getElementById("approveProposalButton").addEventListener("click", approveProposal);
document.getElementById("saveQuestionsButton").addEventListener("click", saveQuestions);
document.getElementById("saveAckButton").addEventListener("click", saveAcknowledgment);
document.getElementById("clearAckButton").addEventListener("click", clearAcknowledgment);

document.getElementById("exportButton").addEventListener("click", () => {
  const blob = new Blob([editor.value], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "job-application-profile.json";
  link.click();
  URL.revokeObjectURL(url);
});

async function extractResume() {
  const file = document.getElementById("resumeInput").files?.[0];
  if (!file) return setExtractStatus("Choose a resume file first.", true);
  setExtractStatus(`Reading ${file.name}…`);
  try {
    const extension = file.name.toLowerCase().split(".").pop();
    let result;
    if (extension === "json") {
      result = profileFromJson(await file.text());
    } else if (["txt", "md"].includes(extension)) {
      result = extractCandidateProfile(await file.text());
    } else {
      result = await extractWithLocalParser(file);
    }
    proposalEditor.value = JSON.stringify(result.profile, null, 2);
    renderProposalSummary(result);
    const factCount = result.facts?.length || 0;
    setExtractStatus(factCount
      ? `Found ${factCount} detail(s). Review them below, then approve the details you want to keep.`
      : "The file was read. Review the proposed profile below before approving it.");
  } catch (error) {
    setExtractStatus(error.message, true);
  }
}

async function extractWithLocalParser(file) {
  if (file.size > 20 * 1024 * 1024) throw new Error("For safety, resume files must be 20 MB or smaller.");
  const baseUrl = getLocalParserUrl();
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  const response = await fetch(`${baseUrl}/extract`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ filename: file.name, data_base64: btoa(binary) })
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || "The local parser could not read this file.");
  return result;
}

async function checkLocalParser() {
  try {
    const baseUrl = getLocalParserUrl();
    setParserStatus("Checking local parser…");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4000);
    const response = await fetch(`${baseUrl}/health`, { signal: controller.signal });
    clearTimeout(timeout);
    const result = await response.json().catch(() => ({}));
    if (!response.ok || result.status !== "ok") throw new Error("The local parser did not return a healthy response.");
    setParserStatus(`Connected${result.version ? ` · ${result.version}` : ""}.`);
  } catch (error) {
    setParserStatus(error.name === "AbortError" ? "The parser check timed out." : error.message || "The local parser is not running.", true);
  }
}

function getLocalParserUrl() {
  let parsed;
  try {
    parsed = new URL(parserUrl.value.trim());
  } catch {
    throw new Error("Enter a valid local parser URL.");
  }
  const localHosts = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);
  if (!/^https?:$/.test(parsed.protocol) || !localHosts.has(parsed.hostname)) {
    throw new Error("For privacy, the resume parser must run on this computer at localhost.");
  }
  return parsed.origin;
}

async function approveProposal() {
  try {
    const proposal = JSON.parse(proposalEditor.value);
    const current = JSON.parse(editor.value || "{}");
    const merged = deepMerge(current, proposal);
    editor.value = JSON.stringify(merged, null, 2);
    await chrome.storage.local.set({ profile: merged });
    setExtractStatus("Approved details saved locally. You can now open ApplyPilot on an application page.");
  } catch (error) {
    setExtractStatus(`Proposal is not valid JSON: ${error.message}`, true);
  }
}

function renderProposalSummary(result) {
  proposalSummary.replaceChildren();
  const facts = result.facts?.length ? result.facts : flattenProfile(result.profile);
  if (!facts.length) {
    const empty = document.createElement("p");
    empty.textContent = "No profile details were found. You can add or edit them under Advanced settings.";
    proposalSummary.append(empty);
    return;
  }

  const heading = document.createElement("p");
  heading.innerHTML = `<strong>${facts.length} detail(s) found</strong> — these are suggestions until you approve them.`;
  proposalSummary.append(heading);
  facts.slice(0, 40).forEach((item) => {
    const row = document.createElement("div");
    row.className = "proposal-fact";
    const label = document.createElement("strong");
    label.textContent = friendlyLabel(item.path);
    const value = document.createElement("span");
    value.textContent = item.value || "Not found";
    row.append(label, value);
    proposalSummary.append(row);
  });
  if (facts.length > 40) {
    const more = document.createElement("p");
    more.textContent = `${facts.length - 40} more detail(s) are available in Advanced settings.`;
    proposalSummary.append(more);
  }
}

function flattenProfile(profile = {}, prefix = "") {
  return Object.entries(profile).flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === "object" && !Array.isArray(value)) return flattenProfile(value, path);
    return value === undefined || value === null || String(value).trim() === ""
      ? []
      : [{ path, value: String(value) }];
  });
}

function friendlyLabel(path = "") {
  const labels = {
    "identity.fullName": "Full name",
    "identity.firstName": "First name",
    "identity.lastName": "Last name",
    "contact.email": "Email",
    "contact.phone": "Phone",
    "location.address": "Address",
    "location.city": "City",
    "location.state": "State",
    "location.zip": "ZIP / postal code",
    "links.linkedin": "LinkedIn",
    "links.github": "GitHub",
    "links.portfolio": "Portfolio",
    "education.degree": "Degree",
    "education.school": "School",
    "education.graduationYear": "Graduation year",
    "experience.currentEmployer": "Current employer",
    "experience.currentTitle": "Current title",
    "experience.years": "Years of experience",
    "resume.skills": "Skills"
  };
  if (labels[path]) return labels[path];
  return path.split(".").at(-1).replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, (letter) => letter.toUpperCase());
}

function deepMerge(base, update) {
  if (!update || typeof update !== "object" || Array.isArray(update)) return update;
  const output = { ...(base || {}) };
  for (const [key, value] of Object.entries(update)) output[key] = value && typeof value === "object" && !Array.isArray(value) ? deepMerge(output[key], value) : value;
  return output;
}

function setExtractStatus(message, error = false) {
  extractStatus.textContent = message;
  extractStatus.style.color = error ? "#b42318" : "#667085";
}

function setParserStatus(message, error = false) {
  parserStatus.textContent = message;
  parserStatus.style.color = error ? "#b42318" : "#207547";
}

function setAutomationStatus(message, error = false) {
  automationStatus.textContent = message;
  automationStatus.style.color = error ? "#b42318" : "#207547";
}

function renderQuestionBank() {
  const container = document.getElementById("questionList");
  container.replaceChildren();
  if (!questionBank.length) {
    const empty = document.createElement("p");
    empty.textContent = "No unfamiliar questions have been discovered yet.";
    container.append(empty);
    return;
  }
  questionBank.forEach((question, index) => {
    const wrapper = document.createElement("div");
    wrapper.className = `question-item${question.sensitive || isSensitivePrompt(question.prompt) ? " sensitive" : ""}`;
    const prompt = document.createElement("div");
    prompt.className = "question-prompt";
    prompt.textContent = question.prompt;
    const meta = document.createElement("div");
    meta.className = "question-meta";
    meta.textContent = `${question.site || "current page"} · seen ${question.occurrences || 1} time(s)${question.sensitive ? " · sensitive" : ""}`;
    const choices = document.createElement("div");
    choices.className = "question-choices";
    if (question.choices?.length) choices.textContent = `Choices: ${question.choices.map((choice) => choice.text || choice.value).filter(Boolean).join(" · ")}`;
    const answer = document.createElement("textarea");
    answer.value = question.answer || "";
    answer.placeholder = question.sensitive ? "Enter only after you decide the exact response" : "Add an approved answer or leave blank";
    answer.dataset.index = String(index);
    const actions = document.createElement("div");
    actions.className = "question-actions";
    const forget = document.createElement("button");
    forget.className = "forget-button";
    forget.textContent = "Forget this question";
    forget.addEventListener("click", () => {
      questionBank.splice(index, 1);
      renderQuestionBank();
    });
    actions.append(forget);
    wrapper.append(prompt, meta, choices, answer, actions);
    container.append(wrapper);
  });
}

async function saveQuestions() {
  document.querySelectorAll("#questionList textarea[data-index]").forEach((textarea) => {
    const item = questionBank[Number(textarea.dataset.index)];
    if (item) item.answer = textarea.value.trim();
  });
  await chrome.storage.local.set({ questionBank });
  document.getElementById("questionStatus").textContent = "Question answers saved locally.";
  document.getElementById("questionStatus").style.color = "#207547";
}

async function saveAcknowledgment() {
  const checked = document.getElementById("ackCheckbox").checked;
  const signature = document.getElementById("signatureInput").value.trim();
  if (!checked || !signature) return setAckStatus("Check the acknowledgment and type your name to enable scanning.", true);
  const responsibilityAck = { acknowledged: true, signature, signedAt: new Date().toISOString() };
  await chrome.storage.local.set({ responsibilityAck });
  setAckStatus(`Acknowledgment saved on ${new Date(responsibilityAck.signedAt).toLocaleString()}. Scanning is enabled.`);
}

async function clearAcknowledgment() {
  await chrome.storage.local.remove("responsibilityAck");
  document.getElementById("ackCheckbox").checked = false;
  document.getElementById("signatureInput").value = "";
  setAckStatus("Acknowledgment cleared. Scanning and filling are disabled until the installer signs again.", true);
}

function setAckStatus(message, error = false) {
  const element = document.getElementById("ackStatus");
  element.textContent = message;
  element.style.color = error ? "#b42318" : "#207547";
}
