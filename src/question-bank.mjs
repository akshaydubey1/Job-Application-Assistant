const SENSITIVE_TERMS = [
  "social security", "ssn", "visa", "sponsorship", "authorized to work", "work authorization",
  "citizenship", "immigration", "disability", "veteran", "gender", "race", "ethnicity",
  "salary", "criminal", "background check", "date of birth", "dob"
];

export function normalizePrompt(prompt = "") {
  return String(prompt).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().slice(0, 240);
}

export function questionId(prompt = "") {
  return normalizePrompt(prompt);
}

export function isSensitivePrompt(prompt = "") {
  const normalized = normalizePrompt(prompt);
  return SENSITIVE_TERMS.some((term) => normalized.includes(normalizePrompt(term)));
}

export function fieldPrompt(field) {
  return String(field.label || field.placeholder || field.name || "").replace(/\s+/g, " ").trim().slice(0, 500);
}

export function isCandidateQuestion(field) {
  if (!field || ["hidden", "submit", "button", "file", "reset"].includes(String(field.type).toLowerCase())) return false;
  const prompt = fieldPrompt(field);
  if (prompt.length < 8) return false;
  return Boolean(field.required || field.tag === "textarea" || prompt.includes("?") || prompt.length >= 18);
}

export function discoverQuestions(fields, page = {}) {
  const site = getSite(page.url);
  const now = new Date().toISOString();
  return fields.filter(isCandidateQuestion).map((field) => {
    const prompt = fieldPrompt(field);
    return {
      id: questionId(prompt),
      prompt,
      answer: "",
      sensitive: isSensitivePrompt(prompt),
      site,
      firstSeen: now,
      lastSeen: now,
      occurrences: 1
    };
  });
}

export function mergeQuestionBank(existing = [], discovered = []) {
  const byId = new Map(existing.map((item) => [item.id || questionId(item.prompt), { ...item }]));
  for (const item of discovered) {
    const current = byId.get(item.id) || item;
    byId.set(item.id, {
      ...current,
      prompt: current.prompt || item.prompt,
      sensitive: Boolean(current.sensitive || item.sensitive),
      site: current.site || item.site,
      firstSeen: current.firstSeen || item.firstSeen,
      lastSeen: item.lastSeen,
      occurrences: Number(current.occurrences || 0) + (current === item ? 0 : 1)
    });
  }
  return [...byId.values()].sort((left, right) => String(right.lastSeen).localeCompare(String(left.lastSeen)));
}

export function applySavedAnswers(suggestions, questionBank = []) {
  const answers = new Map(questionBank.map((item) => [item.id || questionId(item.prompt), item]));
  return suggestions.map((suggestion) => {
    if (suggestion.value) return suggestion;
    const prompt = fieldPrompt(suggestion);
    const saved = answers.get(questionId(prompt));
    if (!saved?.answer) return { ...suggestion, questionId: questionId(prompt) };
    return {
      ...suggestion,
      questionId: saved.id,
      value: saved.answer,
      status: "ready",
      mapping: {
        ...suggestion.mapping,
        label: "Saved answer",
        confidence: 0.86,
        sensitive: Boolean(saved.sensitive),
        manualOnly: Boolean(saved.sensitive),
        reason: "Answer supplied in the local question bank."
      }
    };
  });
}

function getSite(url = "") {
  try { return new URL(url).hostname || "current page"; } catch { return "current page"; }
}
