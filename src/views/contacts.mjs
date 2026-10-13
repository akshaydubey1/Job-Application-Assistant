import { CONTACT_STAGES, createContact, peopleSearchLinks } from "../crm.mjs";
import { button, card, copyButton, dateInputValue, isPastDay, localDay, el, emptyState, field, select, setLine, shortDate, statusLine } from "../ui.mjs";
import { header } from "./apps.mjs";

const RELATIONSHIPS = ["Recruiter", "Hiring manager", "Referral", "Peer", "Founder", "Alumni", "Mentor", "Other"];

export function renderContacts(root, ctx, [id, appId]) {
  if (id === "new") return renderEditor(root, ctx, createContact({ applicationId: appId || "", company: ctx.data.applications.find((app) => app.id === appId)?.company || "" }), true);
  const contact = ctx.data.contacts.find((item) => item.id === id);
  if (contact) return renderEditor(root, ctx, contact, false);

  const head = header("Contacts", "Recruiters, hiring managers, referrals, and peers. Save people from LinkedIn with the popup.");
  head.append(button("Add contact", () => ctx.go("#/contacts/new"), "primary"));
  root.append(head);

  const filter = select([["", "All stages"], ...CONTACT_STAGES], ctx.contactStage || "", (value) => { ctx.contactStage = value; ctx.rerender(); });
  root.append(el("div", "filters-row", filter));
  const contacts = ctx.data.contacts.filter((item) => !ctx.contactStage || item.stage === ctx.contactStage);
  if (!contacts.length) {
    root.append(emptyState("No contacts yet. Open someone's LinkedIn profile and click Save contact in the popup, or add one here.", button("Add contact", () => ctx.go("#/contacts/new"), "primary")));
    return;
  }
  const table = el("table", "contacts-table", el("tr", {}, ["Name", "Company", "Relationship", "Stage", "Last contact", "Follow up", ""].map((name) => el("th", {}, name))));
  contacts.forEach((item) => {
    const overdue = isPastDay(item.followUpOn);
    table.append(el("tr", {},
      el("td", {}, el("a", { href: `#/contacts/${item.id}` }, item.name || "Unnamed"), el("div", "muted", item.title || "")),
      el("td", {}, item.company || ""),
      el("td", {}, item.relationship || ""),
      el("td", {}, select(CONTACT_STAGES, item.stage, (value) => ctx.mutate("contacts", (list) => list.map((c) => (c.id === item.id ? { ...c, stage: value, updatedAt: new Date().toISOString() } : c))), { "aria-label": "Stage" })),
      el("td", {}, item.lastContactAt ? shortDate(item.lastContactAt) : "—"),
      el("td", overdue ? "overdue-text" : "", item.followUpOn ? shortDate(item.followUpOn) : "—"),
      el("td", {}, button("Contacted today", () => markContacted(ctx, item), "secondary small"))));
  });
  root.append(el("div", "table-wrap", table));
}

async function markContacted(ctx, item) {
  const now = new Date();
  await ctx.mutate("contacts", (list) => list.map((c) => (c.id === item.id ? {
    ...c, lastContactAt: now.toISOString(), followUpOn: localDay(5),
    stage: c.stage === "To contact" ? "Contacted" : c.stage, updatedAt: now.toISOString()
  } : c)));
  ctx.keepScroll = true;
  ctx.rerender();
}

function renderEditor(root, ctx, contact, isNew) {
  root.append(header(isNew ? "New contact" : contact.name || "Contact", isNew ? "" : [contact.title, contact.company].filter(Boolean).join(" · ")));
  const inputs = {
    name: el("input", { value: contact.name, required: true }),
    title: el("input", { value: contact.title }),
    company: el("input", { value: contact.company }),
    email: el("input", { type: "email", value: contact.email }),
    linkedin: el("input", { type: "url", value: contact.linkedin, placeholder: "https://www.linkedin.com/in/…" }),
    relationship: select(RELATIONSHIPS, contact.relationship),
    stage: select(CONTACT_STAGES, contact.stage),
    applicationId: select([["", "Not linked"], ...ctx.data.applications.map((app) => [app.id, `${app.company || "?"} · ${app.role || "role"}`])], contact.applicationId),
    lastContactAt: el("input", { type: "date", value: dateInputValue(contact.lastContactAt) }),
    followUpOn: el("input", { type: "date", value: dateInputValue(contact.followUpOn) }),
    notes: el("textarea", { rows: 5 })
  };
  inputs.notes.value = contact.notes || "";
  const lineId = "contactStatus";
  const form = el("form", { class: "card form-grid", onsubmit: async (event) => {
    event.preventDefault();
    const values = Object.fromEntries(Object.entries(inputs).map(([key, node]) => [key, node.value.trim ? node.value.trim() : node.value]));
    const updated = { ...contact, ...values, updatedAt: new Date().toISOString() };
    await ctx.mutate("contacts", (list) => (isNew ? [updated, ...list] : list.map((c) => (c.id === contact.id ? updated : c))));
    ctx.go(`#/contacts/${updated.id}`);
    setTimeout(() => setLine(lineId, "Saved."), 50);
  } },
  el("div", "grid2", field("Name", inputs.name), field("Title", inputs.title), field("Company", inputs.company), field("Relationship", inputs.relationship),
    field("Email", inputs.email), field("LinkedIn", inputs.linkedin), field("Stage", inputs.stage), field("Linked application", inputs.applicationId),
    field("Last contact", inputs.lastContactAt), field("Follow up on", inputs.followUpOn)),
  field("Notes", inputs.notes),
  el("div", "button-row",
    el("button", { class: "primary", type: "submit" }, isNew ? "Add contact" : "Save"),
    button("Back to contacts", () => ctx.go("#/contacts")),
    !isNew && contact.linkedin ? el("a", { class: "button-link", href: contact.linkedin, target: "_blank", rel: "noopener noreferrer" }, "Open LinkedIn") : null,
    !isNew ? button("Delete", async () => {
      if (!confirm(`Delete ${contact.name || "this contact"}?`)) return;
      await ctx.mutate("contacts", (list) => list.filter((c) => c.id !== contact.id));
      ctx.go("#/contacts");
    }, "danger") : null),
  statusLine(lineId));
  root.append(form);

  if (isNew) return;

  // AI message writer for this person.
  const msgLine = "contactMsgStatus";
  const ask = el("textarea", { rows: 3, placeholder: "What do you want from this conversation? e.g. “Referral for the Platform Engineer role; we both worked on GKE migrations.”" });
  const out = el("div", "variants");
  const app = ctx.data.applications.find((item) => item.id === contact.applicationId);
  root.append(card("Write a message",
    el("p", "muted", "Claude drafts a LinkedIn connection note and a short email for this person, grounded in your real background."),
    ask,
    el("div", "button-row", button("Draft with Claude", async () => {
      setLine(msgLine, "Claude is writing…");
      try {
        const input = `Recipient: ${contact.name}, ${contact.title || contact.relationship} at ${contact.company}.\nRelationship: ${contact.relationship}. Stage: ${contact.stage}.\nNotes: ${contact.notes || "none"}\nGoal: ${ask.value || "Start a conversation about relevant roles."}`;
        const result = await ctx.call("/agent/write", { kind: "cold_email", input, job: app ? { company: app.company, role: app.role, text: app.jobText } : {} });
        out.replaceChildren(...result.variants.map((variant) => el("div", "variant", el("div", "variant-head", el("strong", {}, variant.label), copyButton(variant.text)), el("pre", {}, variant.text))));
        setLine(msgLine, result.notes || "");
      } catch (error) {
        setLine(msgLine, error.message, true);
      }
    }, "primary")),
    statusLine(msgLine), out));

  const links = peopleSearchLinks(contact.company, app?.role || "");
  if (links.length) root.append(card(`More people at ${contact.company}`, el("div", "link-list", links.map((link) => el("a", { href: link.url, target: "_blank", rel: "noopener noreferrer" }, link.label)))));
}
