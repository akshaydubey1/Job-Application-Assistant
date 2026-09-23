const EMAIL = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;
const PHONE = /(?<!\d)(?:\+|00)?\d[\d\s().-]{6,}\d(?!\d)/g;
const LINKEDIN = /https?:\/\/(?:www\.)?linkedin\.com\/[^\s)]+/i;
const GITHUB = /https?:\/\/(?:www\.)?github\.com\/[^\s)]+/i;
const US_LOCATION = /\b([A-Za-z .'-]+),\s*([A-Z]{2})(?:\s+(\d{5}(?:-\d{4})?))?\b/;
const LABELED_COUNTRY = /(?:country|país|pays|land|paese)\s*:\s*([^\n,|]+)/i;

export function clean(value = "") {
  return value.replace(/[\u2022\u2023\u25CF]/g, " ").replace(/\s+/g, " ").trim();
}

function fact(path, value, source, confidence = 0.8) {
  return { path, value: clean(value), source: clean(source).slice(0, 300), confidence, status: "proposed" };
}

function put(profile, path, value) {
  const keys = path.split(".");
  let target = profile;
  keys.slice(0, -1).forEach((key) => { target[key] = target[key] || {}; target = target[key]; });
  target[keys.at(-1)] = value;
}

export function profileFromFacts(facts, base = {}) {
  const profile = structuredClone(base);
  facts.forEach((item) => put(profile, item.path, item.value));
  profile.metadata = { ...(profile.metadata || {}), source: "resume-extraction-proposal", lastReviewed: "" };
  return profile;
}

function firstLikelyName(lines) {
  return lines.find((line) => {
    const value = clean(line);
    return value && value.length <= 80 && /^[\p{L}][\p{L} .'’\-]+$/u.test(value) && value.split(/\s+/).length >= 2 && !/resume|curriculum|vitae|profile|summary|experience|education|skills/i.test(value);
  }) || "";
}

function firstLikelyPhone(text) {
  return String(text).match(PHONE)?.find((candidate) => {
    const digits = candidate.replace(/\D/g, "");
    return digits.length >= 7 && digits.length <= 15 &&
      !/^\d{4}\s*[-–/.]\s*\d{1,2}\s*[-–/.]\s*\d{1,2}$/.test(candidate.trim()) &&
      !/^\d{1,2}\s*[-–/.]\s*\d{1,2}\s*[-–/.]\s*\d{2,4}$/.test(candidate.trim());
  }) || "";
}

function findSectionLine(lines, names) {
  const index = lines.findIndex((line) => names.some((name) => {
    const value = clean(line).toLowerCase();
    const expected = name.toLowerCase();
    return value === expected || value.startsWith(`${expected}:`);
  }));
  return index >= 0 ? lines[index + 1] || "" : "";
}

export function extractCandidateProfile(text) {
  const sourceText = String(text || "");
  const lines = sourceText.split(/\r?\n/).map(clean).filter(Boolean);
  const facts = [];

  const name = firstLikelyName(lines);
  if (name) {
    const parts = name.split(/\s+/);
    facts.push(fact("identity.fullName", name, name, 0.76));
    if (parts.length >= 2) {
      facts.push(fact("identity.firstName", parts[0], name, 0.72));
      facts.push(fact("identity.lastName", parts.at(-1), name, 0.72));
    }
  }

  const email = sourceText.match(EMAIL)?.[0];
  if (email) facts.push(fact("contact.email", email, email, 0.99));
  const phone = firstLikelyPhone(sourceText);
  if (phone) facts.push(fact("contact.phone", phone, phone, 0.99));
  const linkedin = sourceText.match(LINKEDIN)?.[0]?.replace(/[.,;]+$/, "");
  if (linkedin) facts.push(fact("links.linkedin", linkedin, linkedin, 0.98));
  const github = sourceText.match(GITHUB)?.[0]?.replace(/[.,;]+$/, "");
  if (github) facts.push(fact("links.github", github, github, 0.98));

  const location = sourceText.match(US_LOCATION);
  if (location) {
    facts.push(fact("location.city", location[1], location[0], 0.74));
    facts.push(fact("location.state", location[2], location[0], 0.92));
    if (location[3]) facts.push(fact("location.zip", location[3], location[0], 0.96));
  }
  const country = sourceText.match(LABELED_COUNTRY)?.[1];
  if (country) facts.push(fact("location.country", country, country, 0.86));

  const educationLine = findSectionLine(lines, ["education", "academic background", "formación", "éducation", "ausbildung", "istruzione"]);
  const degree = sourceText.match(/\b((?:master|bachelor|doctor(?:ate)?|associate|máster|licenciatura|maîtrise|masterabschluss)[^\n,;|]{0,80})/i)?.[1];
  if (degree) facts.push(fact("education.degree", degree, degree, 0.78));
  if (educationLine && !/education|academic/i.test(educationLine)) facts.push(fact("education.school", educationLine, educationLine, 0.66));
  const graduationYear = sourceText.match(/(?:graduat(?:ed|ion)|class of|may|june|jun|december|dec)\s*(?:20)?(\d{2})\b/i)?.[1];
  if (graduationYear) facts.push(fact("education.graduationYear", graduationYear.length === 2 ? `20${graduationYear}` : graduationYear, graduationYear, 0.55));

  const skillsLine = findSectionLine(lines, ["skills", "technical skills", "core technologies", "technologies", "habilidades", "compétences", "fähigkeiten", "competenze"]);
  if (skillsLine) facts.push(fact("resume.skills", skillsLine, skillsLine, 0.62));

  const experienceIndex = lines.findIndex((line) => /^(professional )?(experience|work history|experiencia|expérience|berufserfahrung|esperienza)\b/i.test(line));
  if (experienceIndex >= 0) {
    const block = lines.slice(experienceIndex + 1, experienceIndex + 7).filter((line) => !/\b(?:19|20)\d{2}\b|present|current/i.test(line));
    if (block[0]) facts.push(fact("experience.currentTitle", block[0], block[0], 0.5));
    if (block[1]) facts.push(fact("experience.currentEmployer", block[1], block[1], 0.5));
  }
  const years = sourceText.match(/\b(\d{1,2}\+?)\s+years?\s+(?:of\s+)?(?:professional\s+)?experience\b/i);
  if (years) facts.push(fact("experience.years", years[1], years[0], 0.82));

  return {
    text: sourceText,
    profile: profileFromFacts(facts),
    facts,
    warnings: [
      "Resume extraction proposes facts only; review every value before saving.",
      "Work authorization, sponsorship, salary, relocation, demographic, and eligibility answers are intentionally not inferred from a resume."
    ]
  };
}

export function profileFromJson(text) {
  const parsed = JSON.parse(text);
  return { text, profile: parsed, facts: [], warnings: ["Imported JSON is treated as user-provided and still requires review."] };
}
