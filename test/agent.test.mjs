import test from "node:test";
import assert from "node:assert/strict";
import { suggestFields } from "../src/field-mapper.mjs";
import {
  applicationsToCsv, applyAgentAnswers, buildAgentQuestions, createApplication, findApplicationForUrl,
  isAgentSensitive, pageKey, toAgentPayloadQuestions, updateApplication
} from "../src/agent.mjs";

const profile = { identity: { fullName: "Jordan Example" }, contact: { email: "jordan@example.com" } };

function field(overrides) {
  return { index: 0, tag: "input", type: "text", name: "", id: "", autocomplete: "", placeholder: "", ariaLabel: "", label: "", options: [], required: false, locator: {}, frameId: 0, ...overrides };
}

const fields = [
  field({ index: 0, label: "Full name", name: "name", autocomplete: "name" }),
  field({ index: 1, tag: "textarea", type: "textarea", label: "Describe a production incident you led", name: "incident", maxLength: 500 }),
  field({ index: 2, type: "radio", name: "k8s", label: "Yes", optionLabel: "Yes", groupLabel: "Do you have production Kubernetes experience?", locator: { name: "k8s", value: "yes" } }),
  field({ index: 3, type: "radio", name: "k8s", label: "No", optionLabel: "No", groupLabel: "Do you have production Kubernetes experience?", locator: { name: "k8s", value: "no" } }),
  field({ index: 4, tag: "select", type: "select", label: "Will you require visa sponsorship?", name: "visa", options: [{ value: "", text: "Select" }, { value: "y", text: "Yes" }, { value: "n", text: "No" }] }),
  field({ index: 5, tag: "select", type: "select", label: "Years with Terraform", name: "tf", options: [{ value: "", text: "Select..." }, { value: "1", text: "0-2" }, { value: "2", text: "3-5" }, { value: "3", text: "6+" }] }),
  field({ index: 6, type: "checkbox", name: "privacy", label: "I agree to the privacy policy" }),
  field({ index: 7, label: "Desired salary", name: "salary" })
];

test("sensitive detection covers eligibility, pay, demographics, and consents but not ordinary words", () => {
  for (const prompt of ["Will you require visa sponsorship?", "Desired salary", "Gender", "I agree to the privacy policy", "What is your age?"]) {
    assert.equal(isAgentSensitive(prompt), true, prompt);
  }
  for (const prompt of ["How do you manage a team?", "Describe a production incident", "Which page did you hear about us on?"]) {
    assert.equal(isAgentSensitive(prompt), false, prompt);
  }
});

test("builds agent questions: groups radios, drops sensitive and already-filled fields", () => {
  const suggestions = suggestFields(fields, profile);
  const questions = buildAgentQuestions(suggestions);
  const prompts = questions.map((q) => q.prompt);
  assert.ok(!prompts.some((p) => /full name/i.test(p)), "approved profile value is not re-asked");
  assert.ok(!prompts.some((p) => /visa|salary|privacy/i.test(p)), "sensitive prompts are excluded");
  const radio = questions.find((q) => q.kind === "radio");
  assert.deepEqual(radio.choices, ["Yes", "No"]);
  assert.deepEqual(radio.targets, [2, 3]);
  const select = questions.find((q) => q.kind === "select");
  assert.deepEqual(select.choices, ["0-2", "3-5", "6+"], "placeholder option removed");
  const textarea = questions.find((q) => q.kind === "textarea");
  assert.equal(textarea.maxLength, 500);
  const payload = toAgentPayloadQuestions(questions);
  assert.equal("targets" in payload[0], false);
  assert.equal(new Set(questions.map((q) => q.id)).size, questions.length, "ids are unique");
});

test("applies agent answers: radio picks the matching option, low confidence is not pre-selected", () => {
  const suggestions = suggestFields(fields, profile);
  const questions = buildAgentQuestions(suggestions);
  const byKind = Object.fromEntries(questions.map((q) => [q.kind, q]));
  const answers = [
    { id: byKind.radio.id, answer: "Yes", confidence: 0.92, source: "resume", reasoning: "GKE work", needsHuman: false },
    { id: byKind.select.id, answer: "3-5", confidence: 0.5, source: "resume", reasoning: "Unclear", needsHuman: false },
    { id: byKind.textarea.id, answer: "x".repeat(800), confidence: 0.8, source: "resume", reasoning: "", needsHuman: false }
  ];
  const result = applyAgentAnswers(suggestions, questions, answers, { minConfidence: 0.7 });
  assert.equal(result.drafted, 3);
  assert.equal(result.suggestions[2].value, "true");
  assert.equal(result.suggestions[2].preselect, true);
  assert.equal(result.suggestions[3].value, "");
  assert.equal(result.suggestions[5].value, "3-5");
  assert.equal(result.suggestions[5].preselect, false);
  assert.equal(result.suggestions[1].value.length, 500, "trimmed to maxlength");
  assert.equal(result.suggestions[1].mapping.aiDraft, true);
});

test("needs-human and unmatched choices never become fillable", () => {
  const suggestions = suggestFields(fields, profile);
  const questions = buildAgentQuestions(suggestions);
  const radio = questions.find((q) => q.kind === "radio");
  const textarea = questions.find((q) => q.kind === "textarea");
  const result = applyAgentAnswers(suggestions, questions, [
    { id: radio.id, answer: "Maybe", confidence: 0.9, needsHuman: false },
    { id: textarea.id, answer: "", confidence: 0, needsHuman: true, reasoning: "No incident in resume" }
  ]);
  assert.equal(result.drafted, 0);
  assert.equal(result.suggestions[2].value, "");
  assert.equal(result.suggestions[1].value, "");
  assert.match(result.suggestions[1].agentNote, /No incident/);
});

test("multi-checkbox groups stay manual", () => {
  const group = [
    field({ index: 0, type: "checkbox", name: "stack", label: "AWS", optionLabel: "AWS", groupLabel: "Which clouds have you used?" }),
    field({ index: 1, type: "checkbox", name: "stack", label: "GCP", optionLabel: "GCP", groupLabel: "Which clouds have you used?" })
  ];
  assert.equal(buildAgentQuestions(suggestFields(group, profile)).length, 0);
});

test("pageKey ties a posting to its application form", () => {
  assert.equal(pageKey("https://jobs.lever.co/acme/1234-abcd/apply?lever-source=x"), pageKey("https://jobs.lever.co/acme/1234-abcd"));
  assert.equal(pageKey("https://jobs.ashbyhq.com/acme/uuid/application"), "jobs.ashbyhq.com/acme/uuid");
  assert.equal(pageKey("https://acme.com/careers?gh_jid=42"), "acme.com/careers?job=42");
  assert.notEqual(pageKey("https://acme.com/careers?gh_jid=42"), pageKey("https://acme.com/careers?gh_jid=43"));
});

test("findApplicationForUrl matches exact and deeper pages but not job-board indexes", () => {
  const board = createApplication({ url: "https://boards.greenhouse.io/acme", role: "Board" });
  const job = createApplication({ url: "https://jobs.lever.co/acme/1234", role: "SRE" });
  const apps = [board, job];
  assert.equal(findApplicationForUrl(apps, "https://jobs.lever.co/acme/1234/apply").id, job.id);
  assert.equal(findApplicationForUrl(apps, "https://boards.greenhouse.io/acme/jobs/99"), null);
});

test("tracker updates append events and CSV escapes formulas", () => {
  const app = createApplication({ url: "https://example.com/job", company: "=HYPERLINK(\"x\")", role: "Platform, SRE" });
  const [updated] = updateApplication([app], app.id, { status: "Applied" }, "applied");
  assert.equal(updated.status, "Applied");
  assert.equal(updated.events.at(-1).type, "applied");
  const csv = applicationsToCsv([updated]);
  const row = csv.split("\r\n")[1];
  assert.match(row, /^"'=HYPERLINK\(""x""\)"/);
  assert.match(row, /"Platform, SRE"/);
});
