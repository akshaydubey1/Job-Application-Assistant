import test from "node:test";
import assert from "node:assert/strict";
import { APPROVABLE_SENSITIVE_KEYS, classifyField, suggestField } from "../src/field-mapper.mjs";
import { fromCareerAtelier, isCareerAtelierProfile } from "../src/profile-import.mjs";
import { profileFromJson } from "../src/resume-parser.mjs";

const careerAtelier = {
  personal: {
    legalFirstName: "Jordan", legalMiddleName: "", legalLastName: "Example", preferredName: "Jordan",
    email: "jordan@example.com", phone: "555-555-5555",
    address: { street: "Main St", unit: null, city: "Austin", state: "TX", postalCode: "73301", country: "United States" },
    links: { linkedin: "https://linkedin.com/in/example", github: "https://github.com/example" }
  },
  workAuthorization: { legallyAuthorizedToWork: true, requiresSponsorshipNow: true, requiresSponsorshipInFuture: true },
  currentRole: { employer: "Example Co", title: "Platform Engineer" },
  preferences: { willingToRelocate: true, earliestStartDate: "Immediately", desiredSalaryFullTime: "user enters" },
  experience: { totalYears: 10 },
  education: [{ degree: "Master of Science", field: "Computer Science", school: "Example University", graduationYear: 2018 }],
  voluntarySelfId: { hispanicOrLatino: "No", race: "Asian", veteranStatus: "I am not a protected veteran", disabilityStatus: "No", gender: "user answers on form" }
};

test("detects and converts a Career Atelier applicant profile", () => {
  assert.equal(isCareerAtelierProfile(careerAtelier), true);
  const profile = fromCareerAtelier(careerAtelier);
  assert.equal(profile.identity.fullName, "Jordan Example");
  assert.equal(profile.workAuthorization.authorized, "Yes");
  assert.equal(profile.workAuthorization.sponsorship, "Yes");
  assert.equal(profile.preferences.relocate, "Yes");
  assert.equal(profile.preferences.salary, "");
  assert.equal(profile.preferences.noticePeriod, "Immediately");
  assert.equal(profile.experience.years, "10");
  assert.equal(profile.selfId.race, "Asian");
  assert.equal(profile.selfId.gender, "");
});

test("JSON import routes Career Atelier profiles through the converter", () => {
  const result = profileFromJson(JSON.stringify(careerAtelier));
  assert.equal(result.profile.contact.email, "jordan@example.com");
  assert.match(result.warnings[0], /Career Atelier/);
});

test("self-identification questions map to approvable keys but stay manual by default", () => {
  const profile = fromCareerAtelier(careerAtelier);
  const veteran = suggestField({ label: "Veteran status" }, profile);
  assert.equal(veteran.mapping.key, "selfId.veteranStatus");
  assert.equal(veteran.mapping.manualOnly, true);
  assert.ok(APPROVABLE_SENSITIVE_KEYS.has(veteran.mapping.key));
  assert.equal(classifyField({ label: "Are you Hispanic or Latino?" }).key, "selfId.hispanicOrLatino");
});

test("government ID and date of birth are never approvable", () => {
  for (const label of ["Social Security Number", "Date of birth", "Country of citizenship"]) {
    const mapping = classifyField({ label });
    assert.equal(mapping.key, null);
    assert.equal(APPROVABLE_SENSITIVE_KEYS.has(mapping.key), false);
  }
});

test("sponsorship question maps to an approvable key", () => {
  const mapping = classifyField({ label: "Will you now or in the future require sponsorship to work in the United States?" });
  assert.equal(mapping.key, "workAuthorization.sponsorship");
  assert.ok(APPROVABLE_SENSITIVE_KEYS.has(mapping.key));
});
