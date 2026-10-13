import { atsCheck } from "../ats.mjs";
import { createDocument, gapInputs, gapTally } from "../crm.mjs";
import { button, card, chips, copyButton, el, exportButtons, field, list, scoreClass, select, setLine, shortDate, statusLine } from "../ui.mjs";
import { header } from "./apps.mjs";

const TOOLS = [
  ["ats", "ATS resume checker"],
  ["write", "Writing tools"],
  ["linkedin", "LinkedIn optimizer"],
  ["gaps", "Skill gap planner"]
];

const WRITERS = [
  ["bullets", "Resume bullets", "Describe what you did, roughly. Example: “moved 40 services from VMs to GKE, cut deploy time, set up Argo CD”"],
  ["summary", "Resume summary", "Optional: anything to emphasize."],
  ["pitch", "Elevator pitch", "Optional: the setting (career fair, recruiter call, networking event)."],
  ["headline", "LinkedIn headline", "Optional: specialties to highlight."],
  ["about", "LinkedIn About", "Optional: tone or what you want next."],
  ["linkedin_post", "LinkedIn post", "Topic, lesson, or project you want to post about."],
  ["follow_up", "Follow-up email", "Who you're following up with, when you applied or last spoke, anything new to add."],
  ["thank_you", "Thank-you note", "Who you met, what you discussed, one thing that stood out."],
  ["cold_email", "Cold outreach", "Who the person is and what you'd like from the conversation."],
  ["jd_summary", "Job description summary", "Optional: paste a posting here if you're not picking a tracked job."]
];

export function renderStudio(root, ctx, [tool = "ats", ...rest]) {
  root.append(header("AI Studio", "Resume, LinkedIn, and writing tools grounded in your real experience."));
  root.append(el("div", "tabs big", TOOLS.map(([id, label]) => el("a", { href: `#/studio/${id}`, class: `tab${tool === id ? " active" : ""}` }, label))));
  if (tool === "write") return renderWriter(root, ctx, rest);
  if (tool === "linkedin") return renderLinkedIn(root, ctx);
  if (tool === "gaps") return renderGaps(root, ctx);
  return renderAts(root, ctx, rest);
}

function jobPicker(ctx, selectedId) {
  return select([["", "Paste a job description instead"], ...ctx.data.applications.filter((app) => app.jobText).map((app) => [app.id, `${app.company || "?"} · ${app.role || "role"}`])], selectedId || "");
}

function resumePicker(ctx) {
  const docs = ctx.data.documents.filter((doc) => doc.kind === "resume" && doc.content);
  return select([["", "Master resume (Profile)"], ...docs.map((doc) => [doc.id, doc.name])], "");
}

/* ------------------------------------------------------------------ */
/* ATS checker                                                          */
/* ------------------------------------------------------------------ */

function renderAts(root, ctx, [appId]) {
  const jobSelect = jobPicker(ctx, appId);
  const resumeSelect = resumePicker(ctx);
  const pasted = el("textarea", { rows: 8, placeholder: "Paste the job description" });
  const pasteWrap = field("Job description", pasted);
  const toggle = () => pasteWrap.classList.toggle("hidden", Boolean(jobSelect.value));
  jobSelect.addEventListener("change", toggle);
  toggle();
  const results = el("div");
  const lineId = "atsStatus";

  const inputs = () => {
    const app = ctx.data.applications.find((item) => item.id === jobSelect.value);
    const doc = ctx.data.documents.find((item) => item.id === resumeSelect.value);
    return { app, resumeText: doc ? doc.content : ctx.data.resumeText, jobText: app ? app.jobText : pasted.value };
  };

  const runLocal = () => {
    const { resumeText, jobText } = inputs();
    if ((resumeText || "").length < 200) return setLine(lineId, "Add your master resume in Profile or Documents first.", true);
    if ((jobText || "").length < 80) return setLine(lineId, "Pick a tracked job or paste a job description.", true);
    setLine(lineId, "");
    const local = atsCheck(resumeText, jobText);
    results.replaceChildren(localResults(local));
    return local;
  };

  root.append(card("Check your resume against a job",
    el("p", "muted", "The keyword check runs instantly in your browser and is free. The deep review asks Claude for honest keyword placements and bullet rewrites."),
    el("div", "grid2", field("Resume", resumeSelect), field("Job", jobSelect)), pasteWrap,
    el("div", "button-row",
      button("Check keywords", runLocal, "primary"),
      button("Deep review with Claude", async () => {
        const local = runLocal();
        if (!local) return;
        const { app, resumeText, jobText } = inputs();
        setLine(lineId, "Claude is reviewing your resume…");
        try {
          const review = await ctx.call("/agent/ats-review", { resumeText, localCheck: { score: local.score, matched: local.matched, missing: local.missing.map((m) => m.term) }, job: { company: app?.company, role: app?.role, text: jobText } });
          results.append(aiResults(review));
          setLine(lineId, "");
        } catch (error) {
          setLine(lineId, error.message, true);
        }
      })),
    statusLine(lineId), results));
  if (appId) runLocal();
}

function localResults(local) {
  return card(null,
    el("div", "fit", el("div", { class: `fit-score ${scoreClass(local.score, 75, 55)}`, title: "Local ATS keyword score out of 100" }, String(local.score)),
      el("div", {}, el("strong", {}, `Keyword coverage ${local.coverage}%`), el("div", "muted", `${local.stats.words} words · ${local.stats.bullets} bullets · ${local.stats.quantified} with numbers`))),
    el("h4", {}, `Found (${local.matched.length})`), chips(local.matched, "keyword ok"),
    el("h4", {}, `Missing (${local.missing.length})`), chips(local.missing.map((m) => `${m.term}${m.critical ? " ★" : ""}`), "keyword miss"),
    local.missing.some((m) => m.critical) ? el("p", "muted", "★ appears in the requirements. Add it only where your experience supports it.") : null,
    el("h4", {}, "Structure"),
    el("ul", "checklist", local.checks.map((check) => el("li", { class: check.pass ? "pass" : "fail" }, el("span", "mark", check.pass ? "✓" : "!"), el("span", {}, check.label), check.pass ? null : el("div", "muted", check.tip)))));
}

function aiResults(review) {
  const node = card("Claude's review",
    el("div", "fit", el("div", { class: `fit-score ${scoreClass(review.score, 75, 55)}` }, String(review.score)), el("p", {}, review.summary)));
  if (review.missing_keywords?.length) {
    const table = el("table", {}, el("tr", {}, ["Keyword", "Importance", "Can you claim it?", "Where"].map((name) => el("th", {}, name))));
    review.missing_keywords.forEach((item) => table.append(el("tr", {}, el("td", {}, item.keyword), el("td", {}, item.importance), el("td", item.truthful ? "met-yes" : "met-no", item.truthful ? "Yes" : "Not yet"), el("td", {}, item.where_to_add))));
    node.append(el("h4", {}, "Keywords"), el("div", "table-wrap", table));
  }
  if (review.summary_rewrite) node.append(el("h4", {}, "Tailored summary"), el("div", "variant", el("pre", {}, review.summary_rewrite), copyButton(review.summary_rewrite)));
  if (review.bullet_rewrites?.length) {
    node.append(el("h4", {}, "Bullet rewrites"));
    review.bullet_rewrites.forEach((item) => node.append(el("div", "rewrite", el("div", "before", item.original), el("div", "after", item.improved, " ", copyButton(item.improved)), el("div", "muted", item.why))));
  }
  if (review.formatting_issues?.length) node.append(el("h4", {}, "Formatting risks"), list(review.formatting_issues, "flags"));
  return node;
}

/* ------------------------------------------------------------------ */
/* Writing tools                                                        */
/* ------------------------------------------------------------------ */

function renderWriter(root, ctx, [kind = "bullets", appId]) {
  const writer = WRITERS.find(([id]) => id === kind) || WRITERS[0];
  const kindSelect = select(WRITERS.map(([id, label]) => [id, label]), writer[0], (value) => ctx.go(`#/studio/write/${value}${appId ? `/${appId}` : ""}`));
  const jobSelect = select([["", "None"], ...ctx.data.applications.map((app) => [app.id, `${app.company || "?"} · ${app.role || "role"}`])], appId || "");
  const target = el("input", { placeholder: "e.g. Staff Platform Engineer", value: ctx.data.applications.find((app) => app.id === appId)?.role || "" });
  const input = el("textarea", { rows: 6, placeholder: writer[2] });
  const out = el("div", "variants");
  const lineId = "writeStatus";
  root.append(card(null,
    el("div", "grid2", field("Tool", kindSelect), field("Job (optional)", jobSelect)),
    field("Target role (optional)", target),
    field("Details", input),
    el("div", "button-row", button("Write with Claude", async () => {
      const app = ctx.data.applications.find((item) => item.id === jobSelect.value);
      setLine(lineId, "Claude is writing…");
      try {
        const result = await ctx.call("/agent/write", {
          kind: writer[0], input: input.value, targetRole: target.value.trim(),
          job: app ? { company: app.company, role: app.role, text: app.jobText, analysis: app.analysis } : (writer[0] === "jd_summary" ? { text: input.value } : {})
        });
        out.replaceChildren(...result.variants.map((variant) => variantCard(ctx, variant, `${writer[1]}${app ? ` - ${app.company}` : ""}`, writer[0], app?.id)));
        setLine(lineId, result.notes || "");
      } catch (error) {
        setLine(lineId, error.message, true);
      }
    }, "primary")),
    statusLine(lineId), out));
}

function variantCard(ctx, variant, title, kind, applicationId = "") {
  return el("div", "variant",
    el("div", "variant-head", el("strong", {}, variant.label), el("div", "button-row",
      copyButton(variant.text),
      button("Save to Documents", async (event) => {
        await ctx.mutate("documents", (docs) => [createDocument({ name: `${title} (${variant.label})`, kind: ["bullets", "summary", "linkedin_to_resume"].includes(kind) ? "resume" : "message", content: variant.text, applicationId }), ...(docs || [])]);
        event.target.textContent = "Saved";
      }))),
    el("pre", {}, variant.text));
}

/* ------------------------------------------------------------------ */
/* LinkedIn optimizer                                                   */
/* ------------------------------------------------------------------ */

function renderLinkedIn(root, ctx) {
  const snapshot = ctx.data.linkedinSnapshot;
  const text = el("textarea", { rows: 10, placeholder: "Open your LinkedIn profile and click Optimize profile in the ApplyPilot popup, or paste your profile text here (headline, About, experience, skills)." });
  text.value = snapshot?.text || "";
  const target = el("input", { placeholder: "e.g. Senior Platform / DevOps Engineer" });
  const out = el("div");
  const lineId = "linkedinStatus";
  root.append(card("Optimize your LinkedIn profile",
    snapshot ? el("p", "muted", `Captured ${snapshot.name || "profile"} on ${shortDate(snapshot.capturedAt)}${snapshot.headline ? ` · “${snapshot.headline}”` : ""}.`) : null,
    field("Profile text", text), field("Target role", target),
    el("div", "button-row",
      button("Review with Claude", async () => {
        setLine(lineId, "Claude is reviewing your profile…");
        try {
          const review = await ctx.call("/agent/linkedin-review", { linkedin: text.value, targetRole: target.value.trim() });
          out.replaceChildren(linkedInResults(review));
          setLine(lineId, "");
        } catch (error) {
          setLine(lineId, error.message, true);
        }
      }, "primary"),
      button("Convert to resume", async () => {
        setLine(lineId, "Claude is turning your profile into a resume…");
        try {
          const result = await ctx.call("/agent/write", { kind: "linkedin_to_resume", input: text.value, targetRole: target.value.trim() });
          const content = result.variants[0].text;
          out.replaceChildren(card("Resume from LinkedIn",
            el("pre", "doc-preview", content),
            el("div", "button-row",
              button("Save to Documents", async (event) => {
                await ctx.mutate("documents", (docs) => [createDocument({ name: `Resume from LinkedIn (${new Date().toLocaleDateString()})`, kind: "resume", content }), ...(docs || [])]);
                event.target.textContent = "Saved";
              }, "primary"),
              exportButtons("Resume", content))));
          setLine(lineId, result.notes || "");
        } catch (error) {
          setLine(lineId, error.message, true);
        }
      })),
    statusLine(lineId), out));
}

function linkedInResults(review) {
  const node = card(null,
    el("div", "fit", el("div", { class: `fit-score ${scoreClass(review.score, 80, 60)}`, title: "Profile strength out of 100" }, String(review.score)), el("p", {}, review.summary)),
    el("h4", {}, "Checklist"),
    el("ul", "checklist", (review.checklist || []).map((item) => el("li", { class: item.status === "pass" ? "pass" : "fail" }, el("span", "mark", item.status === "pass" ? "✓" : item.status === "missing" ? "✗" : "!"), el("span", {}, item.item), item.status === "pass" ? null : el("div", "muted", item.tip)))));
  if (review.headline_options?.length) {
    node.append(el("h4", {}, "Headline options"));
    review.headline_options.forEach((line) => node.append(el("div", "variant compact", el("span", {}, line), copyButton(line))));
  }
  if (review.about_rewrite) node.append(el("h4", {}, "About section"), el("div", "variant", el("pre", {}, review.about_rewrite), copyButton(review.about_rewrite)));
  if (review.experience_suggestions?.length) node.append(el("h4", {}, "Experience"), list(review.experience_suggestions.map((item) => `${item.role}: ${item.suggestion}`)));
  if (review.skills_to_add?.length) node.append(el("h4", {}, "Skills to add"), chips(review.skills_to_add, "keyword"));
  if (review.target_keywords?.length) node.append(el("h4", {}, "Keywords recruiters search for"), chips(review.target_keywords, "keyword"));
  return node;
}

/* ------------------------------------------------------------------ */
/* Skill gaps                                                           */
/* ------------------------------------------------------------------ */

function renderGaps(root, ctx) {
  const tally = gapTally(ctx.data.applications);
  const analyzed = gapInputs(ctx.data.applications).length;
  const out = el("div");
  const lineId = "gapStatus";
  const tallyNode = tally.length
    ? el("table", {}, el("tr", {}, el("th", {}, "Requirement you don't fully meet"), el("th", {}, "Jobs asking")), tally.map((row) => el("tr", {}, el("td", {}, row.skill), el("td", {}, String(row.count)))))
    : el("p", "muted", "Analyze a few jobs (popup → Analyze fit) and the gaps that repeat across them show up here.");
  root.append(card("Skills holding you back",
    el("p", "muted", `Based on ${analyzed} analyzed job${analyzed === 1 ? "" : "s"}.`),
    el("div", "table-wrap", tallyNode),
    el("div", "button-row", button("Build a plan with Claude", async () => {
      setLine(lineId, "Claude is building your plan…");
      try {
        const plan = await ctx.call("/agent/skill-gaps", { jobs: gapInputs(ctx.data.applications) });
        out.replaceChildren(planCard(plan));
        await chrome.storage.local.set({ lastSkillPlan: { ...plan, at: new Date().toISOString() } });
        setLine(lineId, "");
      } catch (error) {
        setLine(lineId, error.message, true);
      }
    }, "primary", { disabled: !analyzed })),
    statusLine(lineId), out));
  chrome.storage.local.get(["lastSkillPlan"]).then(({ lastSkillPlan }) => {
    if (lastSkillPlan && !out.children.length) out.replaceChildren(el("p", "muted", `Last plan from ${shortDate(lastSkillPlan.at)}:`), planCard(lastSkillPlan));
  });
}

function planCard(plan) {
  return el("div", {},
    el("p", {}, plan.summary),
    plan.quick_wins?.length ? el("div", {}, el("h4", {}, "Quick wins"), list(plan.quick_wins)) : null,
    ...(plan.gaps || []).map((gap) => card(`${gap.skill} · ${gap.priority} priority · in ${gap.seen_in} job${gap.seen_in === 1 ? "" : "s"}`,
      el("p", "muted", `You have: ${gap.current_evidence}`),
      el("ol", {}, (gap.plan || []).map((step) => el("li", {}, step))),
      el("p", {}, el("strong", {}, "Time: "), gap.time_estimate),
      el("p", {}, el("strong", {}, "Position it now: "), gap.how_to_position_now))));
}
