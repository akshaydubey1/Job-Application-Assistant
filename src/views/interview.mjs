import { createInterviewSession, sessionScore } from "../crm.mjs";
import { button, card, chips, copyButton, el, emptyState, field, list, scoreClass, select, setLine, shortDate, statusLine } from "../ui.mjs";
import { header } from "./apps.mjs";

const FOCUS = ["behavioral", "technical", "system design", "role fit", "company", "manager"];

export function renderInterview(root, ctx, [first, second]) {
  const session = ctx.data.interviews.find((item) => item.id === first || item.id === second);
  if (session) return renderSession(root, ctx, session);
  const presetApp = ctx.data.applications.find((app) => app.id === first);

  root.append(header("Interview prep", "Likely questions for a specific job, a prep brief, and scored feedback on your answers."));
  const appSelect = select([["", "No specific job (use target role)"], ...ctx.data.applications.map((app) => [app.id, `${app.company || "?"} · ${app.role || "role"}`])], presetApp?.id || "");
  const role = el("input", { placeholder: "e.g. Senior Platform Engineer", value: presetApp?.role || "" });
  const count = select([[5, "5 questions"], [8, "8 questions"], [12, "12 questions"]], 8);
  const focusBoxes = FOCUS.map((name) => el("label", "check", el("input", { type: "checkbox", value: name }), name));
  const lineId = "interviewStatus";
  root.append(card("Start a practice session",
    el("div", "grid2", field("Job", appSelect), field("Target role", role, "Used when no job is selected.")),
    field("How many", count),
    el("div", "field", el("span", "field-label", "Focus (optional)"), el("div", "check-row", focusBoxes)),
    el("div", "button-row", button("Generate questions", async () => {
      const app = ctx.data.applications.find((item) => item.id === appSelect.value);
      setLine(lineId, "Claude is building your interview plan…");
      try {
        const result = await ctx.call("/agent/interview-questions", {
          count: Number(count.value),
          focus: focusBoxes.map((label) => label.querySelector("input")).filter((input) => input.checked).map((input) => input.value),
          targetRole: role.value.trim(),
          job: app ? { company: app.company, role: app.role, text: app.jobText, analysis: app.analysis } : { role: role.value.trim() }
        });
        const next = createInterviewSession({ applicationId: app?.id || "", company: app?.company || "", role: app?.role || role.value.trim(), questions: result.questions, prepBrief: result.prep_brief });
        await ctx.mutate("interviews", (items) => [next, ...(items || [])]);
        ctx.go(`#/interview/${next.id}`);
      } catch (error) {
        setLine(lineId, error.message, true);
      }
    }, "primary")),
    statusLine(lineId)));

  const sessions = ctx.data.interviews;
  const past = card("Past sessions");
  if (!sessions.length) past.append(el("p", "muted", "No sessions yet."));
  sessions.forEach((item) => {
    const score = sessionScore(item);
    const answered = Object.values(item.answers || {}).filter((answer) => answer.evaluation).length;
    past.append(el("div", "due-row",
      el("div", {}, el("a", { href: `#/interview/${item.id}` }, `${item.role || "Practice"}${item.company ? ` · ${item.company}` : ""}`),
        el("div", "muted", `${shortDate(item.createdAt)} · ${answered}/${item.questions.length} answered`)),
      el("span", { class: `badge ${scoreClass(score, 8, 6)}`, title: "Average score out of 10" }, score == null ? "–" : String(score))));
  });
  root.append(past);
}

function renderSession(root, ctx, session) {
  const score = sessionScore(session);
  const head = header(`${session.role || "Practice"}${session.company ? ` · ${session.company}` : ""}`, `${session.questions.length} questions${score != null ? ` · average ${score}/10` : ""}`);
  head.append(el("div", "button-row",
    button("All sessions", () => ctx.go("#/interview")),
    button("Delete session", async () => {
      if (!confirm("Delete this practice session?")) return;
      await ctx.mutate("interviews", (items) => items.filter((item) => item.id !== session.id));
      ctx.go("#/interview");
    }, "danger")));
  root.append(head);

  const brief = session.prepBrief;
  if (brief) {
    root.append(card("Prep brief", el("div", "cols",
      brief.likely_focus?.length ? el("div", {}, el("h4", {}, "They'll likely focus on"), list(brief.likely_focus)) : null,
      brief.stories_to_prepare?.length ? el("div", {}, el("h4", {}, "Stories to prepare"), list(brief.stories_to_prepare)) : null,
      brief.risks_to_address?.length ? el("div", {}, el("h4", {}, "Risks to address"), list(brief.risks_to_address, "flags")) : null,
      brief.questions_to_ask_them?.length ? el("div", {}, el("h4", {}, "Questions to ask them"), list(brief.questions_to_ask_them)) : null)));
  }

  const app = ctx.data.applications.find((item) => item.id === session.applicationId);
  session.questions.forEach((question, index) => root.append(questionCard(ctx, session, question, index, app)));
}

function questionCard(ctx, session, question, index, app) {
  const saved = session.answers?.[question.id] || {};
  const lineId = `iv-${session.id}-${question.id}`;
  const answer = el("textarea", { rows: 6, placeholder: "Answer as you would out loud. Aim for 60–120 seconds: situation, what you did, and the result." });
  answer.value = saved.text || "";
  const persist = () => ctx.mutate("interviews", (items) => items.map((item) => (item.id === session.id ? { ...item, answers: { ...item.answers, [question.id]: { ...(item.answers?.[question.id] || {}), text: answer.value } } } : item)));
  answer.addEventListener("change", persist);

  const node = card(null,
    el("div", "section-title", el("h3", {}, `${index + 1}. ${question.question}`), el("span", "pill", question.type)),
    el("details", {}, el("summary", {}, "Why they ask and what good looks like"),
      el("p", {}, question.why_they_ask), el("p", {}, el("strong", {}, "Strong answer: "), question.what_good_looks_like),
      question.story_hint ? el("p", "muted", `Story to use: ${question.story_hint}`) : null),
    answer,
    el("div", "button-row",
      dictateButton(answer, persist),
      button("Get feedback", async () => {
        await persist();
        setLine(lineId, "Claude is scoring your answer…");
        try {
          const evaluation = await ctx.call("/agent/interview-evaluate", {
            question: question.question, answer: answer.value, whatGoodLooksLike: question.what_good_looks_like,
            job: app ? { company: app.company, role: app.role, text: app.jobText } : {}
          });
          await ctx.mutate("interviews", (items) => items.map((item) => (item.id === session.id ? { ...item, answers: { ...item.answers, [question.id]: { text: answer.value, evaluation, at: new Date().toISOString() } } } : item)));
          ctx.keepScroll = true;
          ctx.rerender();
        } catch (error) {
          setLine(lineId, error.message, true);
        }
      }, "primary")),
    statusLine(lineId));

  const evaluation = saved.evaluation;
  if (evaluation) {
    const star = evaluation.star || {};
    node.append(el("div", "feedback",
      el("div", "fit", el("div", { class: `fit-score small ${scoreClass(evaluation.score, 8, 6)}`, title: "Score out of 10" }, String(evaluation.score)),
        el("div", {}, el("strong", {}, evaluation.verdict), el("div", "star", ["situation", "task", "action", "result"].map((part) => el("span", { class: `star-chip ${star[part] ? "yes" : "no"}` }, `${star[part] ? "✓" : "✗"} ${part}`))))),
      el("div", "cols",
        el("div", {}, el("h4", {}, "What worked"), list(evaluation.strengths)),
        el("div", {}, el("h4", {}, "Improve"), list(evaluation.improvements))),
      evaluation.delivery ? el("p", "muted", evaluation.delivery) : null,
      el("details", {}, el("summary", {}, "Stronger version"), el("pre", {}, evaluation.improved_answer), copyButton(evaluation.improved_answer)),
      evaluation.follow_up_question ? el("p", {}, el("strong", {}, "Likely follow-up: "), evaluation.follow_up_question) : null));
  }
  return node;
}

/** Dictation through the browser's speech recognition, when available. */
function dictateButton(textarea, onDone) {
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!Recognition) return null;
  let recognizer = null;
  const node = button("🎤 Dictate", () => {
    if (recognizer) { recognizer.stop(); return; }
    recognizer = new Recognition();
    recognizer.continuous = true;
    recognizer.interimResults = false;
    recognizer.lang = navigator.language || "en-US";
    const base = textarea.value ? `${textarea.value.trim()} ` : "";
    let spoken = "";
    recognizer.onresult = (event) => {
      for (let i = event.resultIndex; i < event.results.length; i += 1) if (event.results[i].isFinal) spoken += `${event.results[i][0].transcript.trim()} `;
      textarea.value = base + spoken;
    };
    recognizer.onend = () => { recognizer = null; node.textContent = "🎤 Dictate"; onDone(); };
    recognizer.onerror = (event) => { node.textContent = event.error === "not-allowed" ? "Mic blocked" : "🎤 Dictate"; };
    recognizer.start();
    node.textContent = "■ Stop";
  });
  return node;
}

export { chips, emptyState };
