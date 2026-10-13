import { createDocument } from "../crm.mjs";
import { button, card, el, emptyState, exportButtons, field, select, setLine, shortDate, statusLine } from "../ui.mjs";
import { header } from "./apps.mjs";

const KINDS = ["resume", "cover letter", "message", "notes", "other"];

export function renderDocs(root, ctx, [docId]) {
  const head = header("Documents", "Resume versions, cover letters, and messages. Your master resume is what Claude tailors from.");
  head.append(el("div", "button-row",
    button("New document", async () => {
      const doc = createDocument({ name: "Untitled document", kind: "resume" });
      await ctx.mutate("documents", (docs) => [doc, ...(docs || [])]);
      ctx.go(`#/docs/${doc.id}`);
    }, "primary"),
    button("Upload file", () => upload(ctx))));
  root.append(head);

  const layout = el("div", "split");
  const pane = el("aside", "list-pane");
  const items = [el("button", { class: `app-item${!docId || docId === "master" ? " active" : ""}`, type: "button", onclick: () => ctx.go("#/docs/master") },
    el("div", {}, el("div", "name", "Master resume"), el("div", "sub", `Used by Claude · ${(ctx.data.resumeText || "").split(/\s+/).filter(Boolean).length} words`)), el("span", "badge mid", "★"))];
  ctx.data.documents.forEach((doc) => items.push(el("button", { class: `app-item${doc.id === docId ? " active" : ""}`, type: "button", onclick: () => ctx.go(`#/docs/${doc.id}`) },
    el("div", {}, el("div", "name", doc.name), el("div", "sub", `${doc.kind} · ${shortDate(doc.updatedAt)}`)))));
  pane.append(el("div", "app-list", items));

  const detail = el("section", "detail");
  const doc = ctx.data.documents.find((item) => item.id === docId);
  if (doc) renderEditor(detail, ctx, doc);
  else if (!docId || docId === "master") renderMaster(detail, ctx);
  else detail.append(emptyState("Document not found."));
  layout.append(pane, detail);
  root.append(layout);
}

function renderMaster(root, ctx) {
  const editor = el("textarea", { class: "doc-editor", placeholder: "Paste your full resume here. Claude tailors from this text and never adds experience that isn't in it." });
  editor.value = ctx.data.resumeText || "";
  const lineId = "masterStatus";
  root.append(card("Master resume",
    el("p", "muted", "Claude uses this for fit analysis, drafted answers, tailored resumes, ATS checks, and interview prep."),
    editor,
    el("div", "button-row",
      button("Save", async () => {
        await ctx.mutate("resumeText", () => editor.value.trim().slice(0, 60000));
        setLine(lineId, "Saved. Claude will use this from now on.");
      }, "primary"),
      exportButtons("Resume", () => editor.value)),
    statusLine(lineId)));
}

function renderEditor(root, ctx, doc) {
  const name = el("input", { value: doc.name, class: "title-input wide" });
  const kind = select(KINDS, doc.kind);
  const app = select([["", "Not linked"], ...ctx.data.applications.map((item) => [item.id, `${item.company || "?"} · ${item.role || "role"}`])], doc.applicationId || "");
  const editor = el("textarea", { class: "doc-editor" });
  editor.value = doc.content;
  const lineId = "docStatus";
  const save = async () => {
    await ctx.mutate("documents", (docs) => docs.map((item) => (item.id === doc.id ? { ...item, name: name.value.trim() || "Untitled", kind: kind.value, applicationId: app.value, content: editor.value, updatedAt: new Date().toISOString() } : item)));
    setLine(lineId, "Saved.");
  };
  [name, kind, app, editor].forEach((node) => node.addEventListener("change", save));
  root.append(card(null,
    field("Name", name),
    el("div", "grid2", field("Type", kind), field("For application", app)),
    editor,
    el("div", "button-row",
      button("Save", save, "primary"),
      doc.kind === "resume" ? button("Use as master resume", async () => {
        if (!confirm("Replace your master resume with this document? Claude will tailor from it.")) return;
        await ctx.mutate("resumeText", () => editor.value.trim());
        setLine(lineId, "This is now your master resume.");
      }) : null,
      exportButtons(() => name.value, () => editor.value),
      button("Delete", async () => {
        if (!confirm(`Delete “${doc.name}”?`)) return;
        await ctx.mutate("documents", (docs) => docs.filter((item) => item.id !== doc.id));
        ctx.go("#/docs");
      }, "danger")),
    statusLine(lineId)));
}

function upload(ctx) {
  const input = el("input", { type: "file", accept: ".txt,.md,.pdf,.docx,text/plain,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
  input.addEventListener("change", async () => {
    const file = input.files?.[0];
    if (!file) return;
    try {
      const ext = file.name.toLowerCase().split(".").pop();
      let text;
      if (["txt", "md"].includes(ext)) text = await file.text();
      else text = await extractWithService(file);
      const doc = createDocument({ name: file.name.replace(/\.[^.]+$/, ""), kind: /cover/i.test(file.name) ? "cover letter" : "resume", content: text });
      await ctx.mutate("documents", (docs) => [doc, ...(docs || [])]);
      ctx.go(`#/docs/${doc.id}`);
    } catch (error) {
      alert(error.message);
    }
  });
  input.click();
}

async function extractWithService(file) {
  if (file.size > 20 * 1024 * 1024) throw new Error("Files must be 20 MB or smaller.");
  const { parserSettings } = await chrome.storage.local.get(["parserSettings"]);
  const base = new URL(parserSettings?.url || "http://127.0.0.1:8765").origin;
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  let response;
  try {
    response = await fetch(`${base}/extract`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ filename: file.name, data_base64: btoa(binary) }) });
  } catch {
    throw new Error("PDF and Word files need the local service. Start it with: python3 local_service.py");
  }
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || "The file could not be read.");
  return String(body.text || "").trim();
}
