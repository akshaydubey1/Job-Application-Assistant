import test from "node:test";
import assert from "node:assert/strict";
import { classifyField, suggestField } from "../src/field-mapper.mjs";
import { extractCandidateProfile } from "../src/resume-parser.mjs";
import { applySavedAnswers, discoverQuestions, isSensitivePrompt, mergeQuestionBank } from "../src/question-bank.mjs";

const profile = {
  identity: { fullName: "Jordan Example" },
  contact: { email: "jordan@example.com" },
  workAuthorization: { authorized: "Yes" }
};

test("maps an email field to the approved contact value", () => {
  const field = { label: "Email address", name: "email", id: "email", placeholder: "", autocomplete: "email" };
  const suggestion = suggestField(field, profile);
  assert.equal(suggestion.mapping.key, "contact.email");
  assert.equal(suggestion.value, "jordan@example.com");
  assert.equal(suggestion.status, "ready");
});

test("keeps high-risk mappings manual", () => {
  const suggestion = suggestField({ label: "Will you require visa sponsorship?", name: "sponsorship", id: "sponsorship", placeholder: "", autocomplete: "" }, profile);
  assert.equal(suggestion.mapping.manualOnly, true);
});

test("maps international labels and autocomplete tokens", () => {
  const profileWithGlobalFields = {
    identity: { firstName: "Élodie" },
    location: { country: "France" }
  };
  const firstName = suggestField({ label: "Prénom", name: "given-name", id: "given-name", placeholder: "", autocomplete: "given-name" }, profileWithGlobalFields);
  const country = suggestField({ label: "Country / Pays", name: "country", id: "country", placeholder: "", autocomplete: "country-name" }, profileWithGlobalFields);
  assert.equal(firstName.mapping.key, "identity.firstName");
  assert.equal(firstName.value, "Élodie");
  assert.equal(country.mapping.key, "location.country");
  assert.equal(country.value, "France");
});

test("does not treat citizenship as a mailing country", () => {
  const classification = classifyField({ label: "Country of citizenship", name: "citizenship", id: "citizenship", placeholder: "", autocomplete: "" });
  assert.equal(classification.key, null);
  assert.equal(classification.manualOnly, true);
  assert.equal(classification.sensitive, true);
});

test("marks an unknown field for manual review", () => {
  const classification = classifyField({ label: "Explain a difficult technical problem", name: "answer", id: "answer", placeholder: "", autocomplete: "" });
  assert.equal(classification.key, null);
  assert.equal(classification.confidence, 0);
});

test("does not invent a missing profile value", () => {
  const suggestion = suggestField({ label: "Phone number", name: "phone", id: "phone", placeholder: "", autocomplete: "tel" }, profile);
  assert.equal(suggestion.value, "");
  assert.equal(suggestion.status, "missing-profile-value");
});

test("extracts basic resume facts without inferring authorization", () => {
  const result = extractCandidateProfile(`
Jordan Example
Austin, TX 78701 | jordan@example.com | 512-555-0100
https://www.linkedin.com/in/jordan-example
Education
Master's in Computer Science, Example University
Technical Skills
Java, Python, Kubernetes, Terraform
`);
  assert.equal(result.profile.identity.fullName, "Jordan Example");
  assert.equal(result.profile.contact.email, "jordan@example.com");
  assert.equal(result.profile.location.city, "Austin");
  assert.equal(result.profile.location.state, "TX");
  assert.equal(result.profile.education.degree, "Master's in Computer Science");
  assert.equal(result.profile.workAuthorization, undefined);
  assert.equal(result.facts.every((item) => item.status === "proposed"), true);
});

test("extracts Unicode names, international phone numbers, and labeled country", () => {
  const result = extractCandidateProfile(`
Élodie Durand
+33 1 44 55 66 77 | elodie@example.fr
Country: France
`);
  assert.equal(result.profile.identity.fullName, "Élodie Durand");
  assert.equal(result.profile.contact.phone, "+33 1 44 55 66 77");
  assert.equal(result.profile.location.country, "France");
});

test("stores unfamiliar questions and flags sensitive prompts", () => {
  const discovered = discoverQuestions([
    { label: "Describe a production incident you resolved", tag: "textarea", type: "textarea", required: true },
    { label: "Will you now or in the future require visa sponsorship?", tag: "select", type: "select", required: true, options: [{ value: "yes", text: "Yes" }, { value: "no", text: "No" }] }
  ], { url: "https://jobs.example.com/apply" });
  assert.equal(discovered.length, 2);
  assert.equal(discovered[0].site, "jobs.example.com");
  assert.equal(isSensitivePrompt(discovered[1].prompt), true);
  assert.equal(discovered[1].choices.length, 2);
  const merged = mergeQuestionBank([], discovered);
  assert.equal(merged[0].answer, "");
  assert.equal(merged[1].occurrences, 1);
});

test("keeps saved sensitive answers manual", () => {
  const [suggestion] = applySavedAnswers([
    { index: 0, label: "Will you require visa sponsorship?", name: "sponsorship", value: "", status: "needs-review", mapping: { key: null, sensitive: false } }
  ], [{ id: "will you require visa sponsorship", prompt: "Will you require visa sponsorship?", answer: "No", sensitive: true }]);
  assert.equal(suggestion.value, "No");
  assert.equal(suggestion.mapping.manualOnly, true);
});
