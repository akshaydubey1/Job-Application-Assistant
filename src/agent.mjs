/*
 * Pure helpers for the Claude decision layer. No browser APIs here so the
 * logic can be unit tested with `node --test`.
 */
import { normalize } from "./field-mapper.mjs";

// Mirrors SENSITIVE_TERMS in agent.py. Matching questions are never sent for
// drafting and never receive an AI answer, whatever the model says.
const AGENT_SENSITIVE_TERMS = [
  "social security", "ssn", "national insurance", "tax id", "passport", "government id",
  "visa", "sponsorship", "sponsor", "authorized to work", "authorised to work", "work authorization",
  "work authorisation", "right to work", "eligible to work", "legally authorized", "citizenship",
  "citizen", "nationality", "immigration", "work permit", "green card", "security clearance",
  "disability", "disabled", "accommodation", "veteran", "military", "gender", "pronoun", "race",
  "racial", "ethnicity", "ethnic", "hispanic", "latino", "sexual orientation", "lgbt", "transgender",
  "salary", "compensation", "pay expectation", "pay range", "desired pay", "hourly rate", "criminal",
  "background check", "conviction", "felony", "arrest", "date of birth", "birth date", "dob", "age",
  "religion", "marital", "pregnan", "drug test", "credit check",
  "i agree", "i consent", "consent to", "i certify", "i acknowledge", "terms and conditions",
  "privacy policy", "privacy notice", "attest", "signature", "e signature",
  "número de identificación", "ciudadanía", "nationalité", "staatsangehörigkeit"
];

const PLACEHOLDER_CHOICE = /^(select|choose|please select|please choose|--|—|select one|select an option|choose one)\b/i;

export function isAgentSensitive(text = "") {
  const haystack = ` ${normalize(text)} `;
  return AGENT_SENSITIVE_TERMS.some((term) => {
    const needle = normalize(term);
    if (!needle) return false;
    return needle.length <= 4 ? haystack.includes(` ${needle} `) : haystack.includes(needle);
  });
}

function questionKey(prompt, kind) {
  return `${kind}:${normalize(prompt).slice(0, 160)}`;
}

function promptFor(suggestion) {
  return String(suggestion.groupLabel || suggestion.label || suggestion.ariaLabel || suggestion.placeholder || suggestion.name || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 600);
}

function optionText(suggestion) {
  return String(suggestion.optionLabel || suggestion.locator?.value || suggestion.label || "").replace(/\s+/g, " ").trim();
}

/**
 * Turn the popup's suggestions into questions the agent should decide.
 * Radio inputs are grouped into one question with their option labels as
 * choices. Fields that already have an approved value, sensitive fields, and
 * multi-checkbox groups are left out.
 */
export function buildAgentQuestions(suggestions = []) {
  const questions = [];
  const seen = new Map();
  const radioGroups = new Map();
  const checkboxGroups = new Map();

  suggestions.forEach((suggestion, index) => {
    if (suggestion.type !== "checkbox") return;
    const key = `${suggestion.frameId || 0}|${suggestion.locator?.name || suggestion.name || `solo-${index}`}`;
    checkboxGroups.set(key, (checkboxGroups.get(key) || 0) + 1);
  });

  suggestions.forEach((suggestion, index) => {
    if (suggestion.value && suggestion.status === "ready") return;
    if (suggestion.mapping?.manualOnly) return;
    if (["file", "password", "hidden", "submit", "button"].includes(suggestion.type)) return;
    const prompt = promptFor(suggestion);
    if (prompt.length < 2 || isAgentSensitive(prompt)) return;

    if (suggestion.type === "radio") {
      const groupKey = `${suggestion.frameId || 0}|${suggestion.locator?.name || suggestion.name || prompt}`;
      let question = radioGroups.get(groupKey);
      if (!question) {
        question = { id: "", prompt, kind: "radio", choices: [], required: false, maxLength: 0, targets: [] };
        radioGroups.set(groupKey, question);
        questions.push(question);
      }
      const choice = optionText(suggestion);
      if (choice && isAgentSensitive(choice)) return;
      if (choice) question.choices.push(choice);
      question.targets.push(index);
      question.required = question.required || Boolean(suggestion.required);
      return;
    }

    if (suggestion.type === "checkbox") {
      const key = `${suggestion.frameId || 0}|${suggestion.locator?.name || suggestion.name || `solo-${index}`}`;
      if ((checkboxGroups.get(key) || 0) > 1) return; // multi-select groups stay manual
      questions.push({ id: "", prompt, kind: "checkbox", choices: ["Yes", "No"], required: Boolean(suggestion.required), maxLength: 0, targets: [index] });
      return;
    }

    const choices = (suggestion.options || [])
      .map((option) => String(option.text || option.value || "").trim())
      .filter((text) => text && !PLACEHOLDER_CHOICE.test(text));
    if (suggestion.options?.length && !choices.length) return;
    questions.push({
      id: "",
      prompt,
      kind: suggestion.tag === "select" ? "select" : suggestion.tag === "textarea" || suggestion.contentEditable ? "textarea" : suggestion.role === "combobox" ? "combobox" : "text",
      choices,
      required: Boolean(suggestion.required),
      maxLength: Number(suggestion.maxLength) > 0 ? Number(suggestion.maxLength) : 0,
      targets: [index]
    });
  });

  return questions
    .filter((question) => question.kind !== "radio" || question.choices.length >= 2)
    .map((question) => {
      const base = questionKey(question.prompt, question.kind);
      const count = seen.get(base) || 0;
      seen.set(base, count + 1);
      return { ...question, id: count ? `${base}#${count}` : base };
    });
}

/** Strip the browser-only bits before sending questions to the local service. */
export function toAgentPayloadQuestions(questions = []) {
  return questions.map(({ id, prompt, kind, choices, required, maxLength }) => ({ id, prompt, kind, choices, required, maxLength }));
}

/**
 * Apply agent decisions to suggestions. Drafts become ready suggestions that
 * are pre-selected only when confidence clears the threshold; the person still
 * clicks Fill. Returns { suggestions, drafted, needsHuman }.
 */
export function applyAgentAnswers(suggestions = [], questions = [], answers = [], { minConfidence = 0.7 } = {}) {
  const next = suggestions.map((item) => ({ ...item }));
  const byId = new Map(answers.map((answer) => [answer.id, answer]));
  let drafted = 0;
  let needsHuman = 0;

  for (const question of questions) {
    const answer = byId.get(question.id);
    if (!answer) continue;
    const firstTarget = next[question.targets[0]];
    if (!firstTarget) continue;
    const prompt = question.prompt;
    if (answer.needsHuman || !answer.answer || isAgentSensitive(prompt)) {
      needsHuman += 1;
      question.targets.forEach((index) => {
        if (next[index]) next[index].agentNote = answer.reasoning || "Claude could not support an answer. Decide this one yourself.";
      });
      continue;
    }

    const mapping = (suggestion) => ({
      ...suggestion.mapping,
      label: suggestion.mapping?.key ? suggestion.mapping.label : prompt.slice(0, 120),
      aiDraft: true,
      confidence: Number(answer.confidence) || 0,
      manualOnly: false,
      reason: answer.reasoning || "",
      source: answer.source || ""
    });
    const preselect = (Number(answer.confidence) || 0) >= minConfidence;

    if (question.kind === "radio") {
      const wanted = normalize(answer.answer);
      const match = question.targets.find((index) => normalize(optionText(next[index])) === wanted);
      if (match === undefined) { needsHuman += 1; continue; }
      next[match] = { ...next[match], value: "true", status: "ready", mapping: mapping(next[match]), preselect, aiAnswer: answer.answer, questionId: question.id, questionPrompt: prompt };
      drafted += 1;
      continue;
    }

    if (question.kind === "checkbox") {
      const yes = normalize(answer.answer) === "yes";
      const index = question.targets[0];
      if (!yes) { next[index] = { ...next[index], agentNote: `Claude suggests leaving this unchecked. ${answer.reasoning || ""}`.trim() }; continue; }
      next[index] = { ...next[index], value: "true", status: "ready", mapping: mapping(next[index]), preselect, aiAnswer: answer.answer, questionId: question.id, questionPrompt: prompt };
      drafted += 1;
      continue;
    }

    const index = question.targets[0];
    let value = String(answer.answer);
    if (question.maxLength && value.length > question.maxLength) value = value.slice(0, question.maxLength);
    next[index] = { ...next[index], value, status: "ready", mapping: mapping(next[index]), preselect, aiAnswer: value, questionId: question.id, questionPrompt: prompt };
    drafted += 1;
  }

  return { suggestions: next, drafted, needsHuman };
}

/** A URL key that ties a job-description page to its application-form page. */
export function pageKey(url = "") {
  try {
    const parsed = new URL(url);
    let path = parsed.pathname.toLowerCase().replace(/\/+$/, "");
    path = path.replace(/\/(apply|application|applications|apply-now|applynow|form)(\/.*)?$/, "");
    const jobId = parsed.searchParams.get("gh_jid") || parsed.searchParams.get("jobId") || parsed.searchParams.get("jid") || "";
    return `${parsed.hostname.replace(/^www\./, "")}${path}${jobId ? `?job=${jobId}` : ""}`;
  } catch {
    return String(url || "").toLowerCase();
  }
}

export function findApplicationForUrl(applications = [], url = "") {
  const key = pageKey(url);
  if (!key) return null;
  const exact = applications.find((item) => item.pageKey === key);
  if (exact) return exact;
  // A deeper page of the same posting (e.g. /jobs/123/questions) still matches,
  // but only on a path boundary and never for a bare host or job-board index.
  const depth = (value) => value.split("?")[0].split("/").filter(Boolean).length;
  return applications.find((item) => item.pageKey && depth(item.pageKey) >= 3 && key.startsWith(`${item.pageKey}/`)) || null;
}

export const APPLICATION_STATUSES = ["Interested", "In progress", "Applied", "Interviewing", "Offer", "Rejected", "Withdrawn", "Skipped"];

export function createApplication({ url = "", title = "", company = "", role = "", location = "", text = "" } = {}, now = new Date()) {
  const at = now.toISOString();
  return {
    id: `app_${now.getTime().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    url,
    pageKey: url ? pageKey(url) : "",
    company: company || "",
    role: role || title || "",
    location: location || "",
    status: "Interested",
    createdAt: at,
    updatedAt: at,
    appliedAt: "",
    jobText: String(text || "").slice(0, 20000),
    analysis: null,
    materials: null,
    notes: "",
    events: [{ at, type: "created" }]
  };
}

export function updateApplication(applications = [], id, changes = {}, eventType = "", now = new Date()) {
  const at = now.toISOString();
  return applications.map((item) => {
    if (item.id !== id) return item;
    const events = eventType ? [...(item.events || []), { at, type: eventType }].slice(-50) : item.events || [];
    return { ...item, ...changes, updatedAt: at, events };
  });
}

export function upsertApplication(applications = [], record) {
  const exists = applications.some((item) => item.id === record.id);
  return exists ? applications.map((item) => (item.id === record.id ? record : item)) : [record, ...applications];
}

const CSV_COLUMNS = [
  ["Company", (item) => item.company],
  ["Role", (item) => item.role],
  ["Location", (item) => item.location || item.analysis?.location || ""],
  ["Status", (item) => item.status],
  ["Fit score", (item) => item.analysis?.fit_score ?? ""],
  ["Recommendation", (item) => item.analysis?.recommendation || ""],
  ["Applied on", (item) => (item.appliedAt || "").slice(0, 10)],
  ["Added on", (item) => (item.createdAt || "").slice(0, 10)],
  ["URL", (item) => item.url],
  ["Tailored resume", (item) => (item.materials?.resume ? "yes" : "no")],
  ["Notes", (item) => item.notes]
];

export function applicationsToCsv(applications = []) {
  const escape = (value) => {
    let text = String(value ?? "");
    if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`; // prevent spreadsheet formula injection
    return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const header = CSV_COLUMNS.map(([name]) => name).join(",");
  const rows = applications.map((item) => CSV_COLUMNS.map(([, get]) => escape(get(item))).join(","));
  return [header, ...rows].join("\r\n");
}
