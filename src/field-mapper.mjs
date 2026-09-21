const RULES = [
  { key: "identity.fullName", patterns: ["full name", "legal name", "applicant name", "your name"], label: "Full name", sensitive: true },
  { key: "identity.firstName", patterns: ["first name", "given name"], label: "First name", sensitive: true },
  { key: "identity.lastName", patterns: ["last name", "surname", "family name"], label: "Last name", sensitive: true },
  { key: "contact.email", patterns: ["email", "e-mail"], label: "Email", sensitive: true },
  { key: "contact.phone", patterns: ["phone", "mobile", "telephone"], label: "Phone", sensitive: true },
  { key: "location.address", patterns: ["street address", "address line", "mailing address"], label: "Address", sensitive: true },
  { key: "location.city", patterns: ["city", "town"], label: "City", sensitive: true },
  { key: "location.state", patterns: ["state", "province", "region"], label: "State", sensitive: true },
  { key: "location.zip", patterns: ["zip", "postal code", "postcode"], label: "ZIP/postal code", sensitive: true },
  { key: "links.linkedin", patterns: ["linkedin"], label: "LinkedIn", sensitive: false },
  { key: "links.github", patterns: ["github"], label: "GitHub", sensitive: false },
  { key: "links.portfolio", patterns: ["portfolio", "personal website", "website"], label: "Portfolio", sensitive: false },
  { key: "workAuthorization.authorized", patterns: ["authorized to work", "legally authorized", "work authorization"], label: "Work authorization", sensitive: true },
  { key: "workAuthorization.sponsorship", patterns: ["sponsorship", "sponsor", "visa sponsorship"], label: "Sponsorship", sensitive: true },
  { key: "preferences.relocate", patterns: ["relocate", "relocation", "willing to move"], label: "Relocation", sensitive: false },
  { key: "preferences.salary", patterns: ["desired salary", "salary expectation", "compensation"], label: "Salary expectation", sensitive: true },
  { key: "education.degree", patterns: ["degree", "highest education", "education level"], label: "Degree", sensitive: false },
  { key: "education.school", patterns: ["school", "university", "college"], label: "School", sensitive: false },
  { key: "education.graduationYear", patterns: ["graduation year", "year graduated"], label: "Graduation year", sensitive: false },
  { key: "experience.currentEmployer", patterns: ["current employer", "current company", "employer name"], label: "Current employer", sensitive: false },
  { key: "experience.currentTitle", patterns: ["current title", "job title", "position title"], label: "Current job title", sensitive: false },
  { key: "experience.years", patterns: ["years of experience", "total experience", "professional experience"], label: "Years of experience", sensitive: false },
  { key: "answers.coverLetter", patterns: ["cover letter", "coverletter"], label: "Cover letter", sensitive: false },
  { key: "answers.whyRole", patterns: ["why this role", "why do you want", "why interested", "motivation"], label: "Why this role", sensitive: false }
];

export function normalize(text = "") {
  return text.toLowerCase().replace(/[\s_\-]+/g, " ").trim();
}

export function getPath(object, path) {
  return path.split(".").reduce((value, key) => value?.[key], object);
}

export function classifyField(field) {
  const haystack = normalize([
    field.label,
    field.name,
    field.id,
    field.placeholder,
    field.autocomplete
  ].join(" "));

  const match = RULES.find((rule) => rule.patterns.some((pattern) => haystack.includes(normalize(pattern))));
  if (match) return { ...match, confidence: confidenceFor(match, haystack) };
  return { key: null, label: "Needs review", sensitive: false, confidence: 0, reason: "No verified profile mapping was found." };
}

function confidenceFor(rule, haystack) {
  const exact = rule.patterns.some((pattern) => haystack === normalize(pattern));
  return exact ? 0.98 : 0.82;
}

export function suggestField(field, profile) {
  const classification = classifyField(field);
  const value = classification.key ? getPath(profile, classification.key) : undefined;
  const hasValue = value !== undefined && value !== null && String(value).trim() !== "";
  return {
    ...field,
    mapping: classification,
    value: hasValue ? String(value) : "",
    status: hasValue ? "ready" : classification.key ? "missing-profile-value" : "needs-review",
    requiresReview: true
  };
}

export function suggestFields(fields, profile) {
  return fields.map((field) => suggestField(field, profile));
}

export const defaultProfile = {
  identity: { fullName: "", firstName: "", lastName: "" },
  contact: { email: "", phone: "" },
  location: { address: "", city: "", state: "", zip: "" },
  links: { linkedin: "", github: "", portfolio: "" },
  workAuthorization: { authorized: "", sponsorship: "" },
  preferences: { relocate: "", salary: "" },
  education: { degree: "", school: "", graduationYear: "" },
  experience: { currentEmployer: "", currentTitle: "", years: "" },
  answers: { coverLetter: "", whyRole: "" },
  metadata: { source: "user-entered", lastReviewed: "" }
};
