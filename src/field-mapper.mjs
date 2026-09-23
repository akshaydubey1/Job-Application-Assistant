const RULES = [
  { key: "identity.fullName", patterns: ["full name", "legal name", "applicant name", "your name", "nombre completo", "nom complet", "vollständiger name", "nome completo"], label: "Full name", sensitive: true },
  { key: "identity.firstName", patterns: ["first name", "given name", "forename", "nombre de pila", "prénom", "vorname", "nome próprio", "名"], label: "First name", sensitive: true },
  { key: "identity.middleName", patterns: ["middle name", "second name", "segundo nombre", "deuxième prénom", "zweiter vorname", "nome do meio"], label: "Middle name", sensitive: true },
  { key: "identity.lastName", patterns: ["last name", "surname", "family name", "apellido", "nom de famille", "nachname", "familienname", "cognome", "sobrenome", "姓"], label: "Last name", sensitive: true },
  { key: "identity.preferredName", patterns: ["preferred name", "name you go by", "chosen name", "nombre preferido", "nom d usage", "bevorzugter name"], label: "Preferred name", sensitive: true },
  { key: "contact.email", patterns: ["email", "e-mail", "correo electrónico", "courriel", "email address"], label: "Email", sensitive: true },
  { key: "contact.phone", patterns: ["phone", "mobile", "telephone", "tel", "telephone number", "número de teléfono", "téléphone", "telefon", "telefono", "telefone"], label: "Phone", sensitive: true },
  { key: "location.address", patterns: ["street address", "address line 1", "address1", "address 1", "mailing address", "home address", "street", "dirección", "adresse", "anschrift", "indirizzo", "endereço"], label: "Address", sensitive: true },
  { key: "location.addressLine2", patterns: ["address line 2", "address2", "address 2", "apartment", "suite", "unit", "secondary address", "apartamento", "complément d adresse", "adresszusatz"], label: "Address line 2", sensitive: true },
  { key: "location.city", patterns: ["city", "town", "municipality", "ciudad", "ville", "stadt", "città", "cidade"], label: "City", sensitive: true },
  { key: "location.state", patterns: ["state", "province", "region", "county", "estado", "état", "bundesland", "regione"], label: "State / region", sensitive: true },
  { key: "location.zip", patterns: ["zip", "zip code", "postal code", "postcode", "código postal", "code postal", "postleitzahl", "codice postale"], label: "ZIP / postal code", sensitive: true },
  { key: "location.country", patterns: ["country", "país", "pays", "land", "paese"], exclude: ["citizenship", "nationality", "birth"], label: "Country", sensitive: true },
  { key: "links.linkedin", patterns: ["linkedin"], label: "LinkedIn", sensitive: false },
  { key: "links.github", patterns: ["github"], label: "GitHub", sensitive: false },
  { key: "links.portfolio", patterns: ["portfolio", "personal website", "website", "site web", "webseite", "sito web"], label: "Portfolio", sensitive: false },
  { key: "workAuthorization.authorized", patterns: ["authorized to work", "legally authorized", "work authorization", "right to work", "eligible to work", "permit to work", "autorizado a trabajar", "autorisé à travailler", "arbeitsberechtigt"], label: "Work authorization", sensitive: true, manualOnly: true },
  { key: "workAuthorization.sponsorship", patterns: ["sponsorship", "sponsor", "visa sponsorship", "require sponsorship", "visa support", "patrocinio", "parrainage", "visumssponsoring"], label: "Sponsorship", sensitive: true, manualOnly: true },
  { key: null, patterns: ["citizenship", "nationality", "nationalité", "citizenship status", "ciudadanía", "staatsangehörigkeit", "cittadinanza"], label: "Citizenship / nationality", sensitive: true, manualOnly: true },
  { key: null, patterns: ["social security", "ssn", "national insurance", "tax id", "tax identification", "passport", "government id", "sin number", "número de identificación fiscal"], label: "Government identification", sensitive: true, manualOnly: true },
  { key: null, patterns: ["date of birth", "birth date", "dob", "birthday", "fecha de nacimiento", "date de naissance", "geburtsdatum", "data de nascimento"], label: "Date of birth", sensitive: true, manualOnly: true },
  { key: null, patterns: ["gender", "sex", "pronouns", "veteran", "military service", "race", "ethnicity", "disability", "reasonable accommodation", "gender identity", "género", "genre", "geschlecht", "raça", "ethnicité"], label: "Demographic or equal-opportunity question", sensitive: true, manualOnly: true },
  { key: null, patterns: ["criminal record", "criminal history", "background check", "conviction", "felony", "casier judiciaire", "vorstrafen"], label: "Background question", sensitive: true, manualOnly: true },
  { key: "preferences.relocate", patterns: ["relocate", "relocation", "willing to move", "willing to relocate", "relocación", "déménagement", "umzug"], label: "Relocation", sensitive: false, manualOnly: true },
  { key: "preferences.salary", patterns: ["desired salary", "salary expectation", "compensation", "pay expectation", "expected salary", "pretensión salarial", "salaire souhaité", "gehaltsvorstellung"], label: "Salary expectation", sensitive: true, manualOnly: true },
  { key: "preferences.noticePeriod", patterns: ["notice period", "availability to start", "available start date", "when can you start", "período de aviso", "préavis", "kündigungsfrist"], label: "Availability / notice period", sensitive: false, manualOnly: true },
  { key: "education.degree", patterns: ["degree", "highest education", "education level", "qualification", "diploma", "grado", "diplôme", "abschluss", "laurea"], label: "Degree", sensitive: false },
  { key: "education.school", patterns: ["school", "university", "college", "institution", "universidad", "université", "universität", "università"], label: "School", sensitive: false },
  { key: "education.fieldOfStudy", patterns: ["field of study", "major", "course of study", "área de estudio", "domaine d études", "studienfach", "corso di studi"], label: "Field of study", sensitive: false },
  { key: "education.graduationYear", patterns: ["graduation year", "year graduated", "completion year", "año de graduación", "année d obtention", "abschlussjahr"], label: "Graduation year", sensitive: false },
  { key: "experience.currentEmployer", patterns: ["current employer", "current company", "employer name", "company name", "present employer", "employeur actuel", "aktueller arbeitgeber"], label: "Current employer", sensitive: false },
  { key: "experience.currentTitle", patterns: ["current title", "job title", "position title", "current role", "professional title", "intitulé du poste", "berufsbezeichnung"], label: "Current job title", sensitive: false },
  { key: "experience.years", patterns: ["years of experience", "total experience", "professional experience", "years experience", "años de experiencia", "années d expérience", "berufserfahrung in jahren"], label: "Years of experience", sensitive: false },
  { key: "answers.coverLetter", patterns: ["cover letter", "coverletter", "lettre de motivation", "carta de presentación", "anschreiben"], label: "Cover letter", sensitive: false },
  { key: "answers.whyRole", patterns: ["why this role", "why do you want", "why interested", "motivation", "why this company", "por qué este puesto", "pourquoi ce poste", "warum diese stelle"], label: "Why this role", sensitive: false }
];

export function normalize(text = "") {
  return String(text)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[\u2010-\u2015_\-/]+/g, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function getPath(object, path) {
  return path?.split(".").reduce((value, key) => value?.[key], object);
}

function matchesRule(rule, haystack) {
  const excluded = (rule.exclude || []).some((pattern) => haystack.includes(normalize(pattern)));
  return !excluded && rule.patterns.some((pattern) => haystack.includes(normalize(pattern)));
}

export function classifyField(field = {}) {
  const haystack = normalize([
    field.label,
    field.name,
    field.id,
    field.placeholder,
    field.autocomplete,
    field.ariaLabel,
    field.role
  ].filter(Boolean).join(" "));

  const match = RULES.find((rule) => matchesRule(rule, haystack));
  if (match) return { ...match, confidence: confidenceFor(match, field, haystack) };
  return { key: null, label: "Needs review", sensitive: false, confidence: 0, reason: "No verified profile mapping was found." };
}

function confidenceFor(rule, field, haystack) {
  const autocomplete = normalize(field.autocomplete || "");
  if (rule.patterns.some((pattern) => autocomplete === normalize(pattern))) return 0.99;
  if (rule.patterns.some((pattern) => haystack === normalize(pattern))) return 0.96;
  return 0.84;
}

export function suggestField(field, profile) {
  const mapping = classifyField(field);
  const value = mapping.key ? getPath(profile, mapping.key) : undefined;
  const hasValue = value !== undefined && value !== null && String(value).trim() !== "";
  return {
    ...field,
    mapping,
    value: hasValue ? String(value) : "",
    status: hasValue ? "ready" : mapping.key ? "missing-profile-value" : "needs-review",
    requiresReview: true
  };
}

export function suggestFields(fields, profile) {
  return fields.map((field) => suggestField(field, profile));
}

export const defaultProfile = {
  identity: { fullName: "", firstName: "", middleName: "", lastName: "", preferredName: "" },
  contact: { email: "", phone: "", phoneCountryCode: "" },
  location: { address: "", addressLine2: "", city: "", state: "", zip: "", country: "" },
  links: { linkedin: "", github: "", portfolio: "" },
  workAuthorization: { authorized: "", sponsorship: "" },
  preferences: { relocate: "", salary: "", noticePeriod: "" },
  education: { degree: "", school: "", fieldOfStudy: "", graduationYear: "" },
  experience: { currentEmployer: "", currentTitle: "", years: "" },
  answers: { coverLetter: "", whyRole: "" },
  metadata: { source: "user-entered", lastReviewed: "", schemaVersion: 2 }
};
