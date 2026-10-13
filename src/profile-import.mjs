// Converts a Career Atelier applicant-profile.json (Application Autofill skill)
// into ApplyPilot's profile shape. Pure function: no I/O, no network.

const yesNo = (value) => (value === true ? "Yes" : value === false ? "No" : "");
const clean = (value) => (value == null || value === "user enters" || value === "user answers on form" ? "" : String(value));

export function isCareerAtelierProfile(json) {
  return Boolean(json && typeof json === "object" && json.personal && json.workAuthorization && json.preferences);
}

export function fromCareerAtelier(json) {
  const p = json.personal || {};
  const a = p.address || {};
  const wa = json.workAuthorization || {};
  const pref = json.preferences || {};
  const cur = json.currentRole || {};
  const edu = (json.education || [])[0] || {};
  const self = json.voluntarySelfId || {};
  const reusable = json.reusableAnswers || {};
  const first = clean(p.legalFirstName);
  const last = clean(p.legalLastName);
  const middle = clean(p.legalMiddleName);

  return {
    identity: {
      fullName: [first, middle, last].filter(Boolean).join(" "),
      firstName: first,
      middleName: middle,
      lastName: last,
      preferredName: clean(p.preferredName)
    },
    contact: { email: clean(p.email), phone: clean(p.phone), phoneCountryCode: a.country === "United States" ? "+1" : "" },
    location: {
      address: clean(a.street),
      addressLine2: clean(a.unit),
      city: clean(a.city),
      state: clean(a.state),
      zip: clean(a.postalCode),
      country: clean(a.country)
    },
    links: { linkedin: clean(p.links?.linkedin), github: clean(p.links?.github), portfolio: clean(p.links?.portfolio || p.links?.website) },
    workAuthorization: {
      authorized: yesNo(wa.legallyAuthorizedToWork),
      sponsorship: yesNo(wa.requiresSponsorshipNow === true || wa.requiresSponsorshipInFuture === true ? true : wa.requiresSponsorshipNow)
    },
    preferences: {
      relocate: yesNo(pref.willingToRelocate),
      salary: "",
      noticePeriod: clean(pref.earliestStartDate || pref.noticePeriod)
    },
    education: {
      degree: [clean(edu.degree), clean(edu.field)].filter(Boolean).join(" in "),
      school: clean(edu.school),
      fieldOfStudy: clean(edu.field),
      graduationYear: clean(edu.graduationYear)
    },
    experience: {
      currentEmployer: clean(cur.employer),
      currentTitle: clean(cur.title),
      years: clean(json.experience?.totalYears)
    },
    answers: { coverLetter: "", whyRole: clean(reusable.whyThisTypeOfRole) },
    selfId: {
      hispanicOrLatino: clean(self.hispanicOrLatino),
      race: clean(self.race),
      veteranStatus: clean(self.veteranStatus),
      disabilityStatus: clean(self.disabilityStatus),
      gender: clean(self.gender)
    },
    metadata: { source: "career-atelier-import", lastReviewed: clean(json.updated), schemaVersion: 2 }
  };
}
