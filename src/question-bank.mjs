const SENSITIVE_TERMS = [
  "social security", "ssn", "national insurance", "tax id", "passport", "government id",
  "visa", "sponsorship", "authorized to work", "work authorization", "right to work",
  "citizenship", "nationality", "immigration", "work permit", "disability", "accommodation",
  "veteran", "military", "gender", "sex", "pronouns", "race", "ethnicity", "salary",
  "compensation", "criminal", "background check", "conviction", "date of birth", "birth date", "dob",
  "número de identificación", "ciudadanía", "nationalité", "staatsangehörigkeit"
];

export function normalizePrompt(prompt = "") {
  return String(prompt)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 240);
}

export function questionId(prompt = "") {
  return normalizePrompt(prompt);
}

export function isSensitivePrompt(prompt = "") {
  const normalized = normalizePrompt(prompt);
  return SENSITIVE_TERMS.some((term) => normalized.includes(normalizePrompt(term)));
}

export function fieldPrompt(field = {}) {
  return String(field.label || field.ariaLabel || field.placeholder || field.name || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 500);
}

export function isCandidateQuestion(field) {
  if (!field || ["hidden", "submit", "button", "file", "reset", "password"].includes(String(field.type).toLowerCase())) return false;
  const prompt = fieldPrompt(field);
  if (prompt.length < 8) return false;
  return Boolean(field.required || field.tag === "textarea" || field.role === "combobox" || prompt.includes("?") || prompt.length >= 18);
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
      fieldType: field.type || field.tag || "unknown",
      required: Boolean(field.required),
      choices: Array.isArray(field.options) ? field.options.slice(0, 25).map((option) => ({ value: String(option.value || ""), text: String(option.text || "") })) : [],
      firstSeen: now,
      lastSeen: now,
      occurrences: 1
    };
  });
}

export function mergeQuestionBank(existing = [], discovered = []) {
  const byId = new Map(existing.map((item) => [item.id || questionId(item.prompt), { ...item }]));
  for (const item of discovered) {
    const current = byId.get(item.id);
    byId.set(item.id, {
      ...(current || item),
      id: item.id,
      prompt: current?.prompt || item.prompt,
      answer: current?.answer || "",
      sensitive: Boolean(current?.sensitive || item.sensitive),
      site: current?.site || item.site,
      fieldType: current?.fieldType || item.fieldType,
      required: Boolean(current?.required || item.required),
      choices: mergeChoices(current?.choices, item.choices),
      firstSeen: current?.firstSeen || item.firstSeen,
      lastSeen: item.lastSeen,
      occurrences: current ? Number(current.occurrences || 0) + 1 : Number(item.occurrences || 1)
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
        manualOnly: Boolean(saved.sensitive || suggestion.mapping.manualOnly),
        reason: "Answer supplied in the local question bank."
      }
    };
  });
}

function mergeChoices(existing = [], incoming = []) {
  const choices = new Map([...(existing || []), ...(incoming || [])].map((item) => [String(item.value || item.text), item]));
  return [...choices.values()].slice(0, 25);
}

function getSite(url = "") {
  try { return new URL(url).hostname || "current page"; } catch { return "current page"; }
}
