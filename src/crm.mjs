/*
 * Pure helpers for contacts (networking), follow-up reminders, interview
 * sessions, documents, and job-search insights.
 */

const DAY = 864e5;

export const CONTACT_STAGES = ["To contact", "Contacted", "Replied", "Meeting set", "Referral", "Cold"];

export function newId(prefix, now = new Date()) {
  return `${prefix}_${now.getTime().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function createContact(fields = {}, now = new Date()) {
  const at = now.toISOString();
  return {
    id: newId("ct", now),
    name: String(fields.name || "").trim(),
    title: String(fields.title || "").trim(),
    company: String(fields.company || "").trim(),
    relationship: String(fields.relationship || "Recruiter").trim(),
    email: String(fields.email || "").trim(),
    linkedin: String(fields.linkedin || "").trim(),
    stage: fields.stage && CONTACT_STAGES.includes(fields.stage) ? fields.stage : "To contact",
    applicationId: fields.applicationId || "",
    lastContactAt: fields.lastContactAt || "",
    followUpOn: fields.followUpOn || "",
    notes: String(fields.notes || ""),
    createdAt: at,
    updatedAt: at
  };
}

/** Search links that help find recruiters and hiring managers without scraping. */
export function peopleSearchLinks(company = "", role = "") {
  const c = String(company).trim();
  if (!c) return [];
  const r = String(role).trim();
  const enc = encodeURIComponent;
  const area = r.replace(/\b(senior|sr\.?|staff|principal|lead|junior|jr\.?|ii|iii|iv)\b/gi, "").trim();
  return [
    { label: `Recruiters at ${c}`, url: `https://www.linkedin.com/search/results/people/?keywords=${enc(`${c} recruiter OR "talent acquisition"`)}` },
    { label: `Hiring managers at ${c}`, url: `https://www.linkedin.com/search/results/people/?keywords=${enc(`${c} ${area ? `"${area}" ` : ""}manager OR director OR head`)}` },
    { label: `Your team's peers at ${c}`, url: `https://www.linkedin.com/search/results/people/?keywords=${enc(`${c} ${area || "engineer"}`)}` },
    { label: "Google search (LinkedIn profiles)", url: `https://www.google.com/search?q=${enc(`site:linkedin.com/in "${c}" (recruiter OR "talent acquisition" OR "hiring manager")${area ? ` "${area}"` : ""}`)}` },
    { label: `${c} on LinkedIn (company page)`, url: `https://www.linkedin.com/search/results/companies/?keywords=${enc(c)}` }
  ];
}

/** Everything that needs attention, newest-due first. */
export function dueItems({ applications = [], contacts = [] } = {}, now = new Date(), { staleAfterDays = 7 } = {}) {
  const items = [];
  const today = startOfDay(now);
  for (const app of applications) {
    if (app.nextActionOn && !["Rejected", "Withdrawn", "Skipped", "Offer"].includes(app.status)) {
      const due = startOfDay(parseDay(app.nextActionOn));
      if (due <= today + 7 * DAY) items.push({ kind: "application", id: app.id, title: `${app.nextAction || "Follow up"}: ${app.role || "role"} at ${app.company || "company"}`, due: new Date(due).toISOString(), overdue: due < today, today: due === today });
    } else if (app.status === "Applied" && app.appliedAt && now - new Date(app.appliedAt) > staleAfterDays * DAY) {
      const due = startOfDay(new Date(new Date(app.appliedAt).getTime() + staleAfterDays * DAY));
      items.push({ kind: "application", id: app.id, title: `No reply in ${staleAfterDays}+ days: follow up on ${app.role || "role"} at ${app.company || "company"}`, due: new Date(due).toISOString(), overdue: due < today, today: due === today, suggested: true });
    }
  }
  for (const contact of contacts) {
    if (!contact.followUpOn) continue;
    const due = startOfDay(parseDay(contact.followUpOn));
    if (due <= today + 7 * DAY) items.push({ kind: "contact", id: contact.id, title: `Follow up with ${contact.name || "contact"}${contact.company ? ` (${contact.company})` : ""}`, due: new Date(due).toISOString(), overdue: due < today, today: due === today });
  }
  return items.sort((a, b) => a.due.localeCompare(b.due));
}

export function actionableCount(items = []) {
  return items.filter((item) => item.overdue || item.today).length;
}

/** Date-only strings ("2026-10-13") are local calendar days, not UTC midnight. */
export function parseDay(value) {
  const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match ? new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])) : new Date(value);
}

function startOfDay(date) {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy.getTime();
}

/** Funnel and activity stats for the Insights view. */
export function insights(applications = [], now = new Date()) {
  const applied = applications.filter((app) => app.appliedAt || ["Applied", "Interviewing", "Offer", "Rejected"].includes(app.status));
  const interviewing = applications.filter((app) => ["Interviewing", "Offer"].includes(app.status) || (app.events || []).some((e) => /interview/i.test(e.type)));
  const offers = applications.filter((app) => app.status === "Offer");
  const rejected = applications.filter((app) => app.status === "Rejected");
  const weeks = [];
  for (let i = 7; i >= 0; i -= 1) {
    const end = startOfDay(now) + DAY - i * 7 * DAY;
    const start = end - 7 * DAY;
    const count = applied.filter((app) => {
      const at = Date.parse(app.appliedAt || app.createdAt);
      return at >= start && at < end;
    }).length;
    weeks.push({ label: new Date(start).toLocaleDateString(undefined, { month: "short", day: "numeric" }), count });
  }
  const scored = applications.filter((app) => app.analysis?.fit_score != null);
  const bucket = (min, max) => scored.filter((app) => app.analysis.fit_score >= min && app.analysis.fit_score <= max);
  const responseRate = applied.length ? Math.round((100 * interviewing.length) / applied.length) : 0;
  const strongFit = bucket(80, 100);
  const strongFitInterview = strongFit.filter((app) => interviewing.includes(app)).length;
  const sources = {};
  applications.forEach((app) => {
    let host = "manual";
    try { host = app.url ? new URL(app.url).hostname.replace(/^www\./, "") : "manual"; } catch { /* keep manual */ }
    sources[host] = (sources[host] || 0) + 1;
  });
  return {
    funnel: [
      { stage: "Tracked", count: applications.length },
      { stage: "Applied", count: applied.length },
      { stage: "Interviewing", count: interviewing.length },
      { stage: "Offer", count: offers.length }
    ],
    rejected: rejected.length,
    responseRate,
    weeks,
    fitBuckets: [
      { label: "80–100", count: strongFit.length },
      { label: "60–79", count: bucket(60, 79).length },
      { label: "0–59", count: bucket(0, 59).length }
    ],
    strongFitInterviewRate: strongFit.length ? Math.round((100 * strongFitInterview) / strongFit.length) : null,
    topSources: Object.entries(sources).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([source, count]) => ({ source, count }))
  };
}

/** Collect unmet requirements and gaps across analyzed jobs for the skill-gap planner. */
export function gapInputs(applications = []) {
  return applications
    .filter((app) => app.analysis && !["Skipped", "Withdrawn"].includes(app.status))
    .slice(0, 25)
    .map((app) => ({
      role: app.role,
      company: app.company,
      unmet: (app.analysis.requirements || []).filter((req) => req.met !== "yes").map((req) => `${req.requirement} (${req.importance}, ${req.met})`),
      gaps: (app.analysis.gaps || []).map((gap) => gap.gap)
    }));
}

/** Local tally of the most frequent unmet requirements, shown before asking Claude. */
export function gapTally(applications = []) {
  const counts = new Map();
  for (const job of gapInputs(applications)) {
    for (const item of [...job.unmet, ...job.gaps]) {
      const key = item.replace(/\s*\(.*\)$/, "").toLowerCase().trim();
      if (!key) continue;
      counts.set(key, (counts.get(key) || 0) + 1);
    }
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15).map(([skill, count]) => ({ skill, count }));
}

export function createDocument({ name = "Untitled", kind = "resume", content = "", applicationId = "" } = {}, now = new Date()) {
  const at = now.toISOString();
  return { id: newId("doc", now), name: String(name).slice(0, 120), kind, content: String(content), applicationId, createdAt: at, updatedAt: at };
}

export function createInterviewSession({ applicationId = "", company = "", role = "", questions = [], prepBrief = null } = {}, now = new Date()) {
  return { id: newId("iv", now), applicationId, company, role, questions, prepBrief, answers: {}, createdAt: now.toISOString() };
}

export function sessionScore(session) {
  const scores = Object.values(session?.answers || {}).map((answer) => answer.evaluation?.score).filter((score) => Number.isFinite(score));
  return scores.length ? Math.round((10 * scores.reduce((a, b) => a + b, 0)) / scores.length) / 10 : null;
}
