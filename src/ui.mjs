/* Small DOM helpers shared by the Workspace views. Text always goes through textContent. */
import { wordDocument } from "./markdown.mjs";
import { parseDay } from "./crm.mjs";

export function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  if (typeof props === "string") props = { class: props };
  for (const [key, value] of Object.entries(props || {})) {
    if (value === undefined || value === null || value === false) continue;
    if (key === "class") node.className = value;
    else if (key === "text") node.textContent = value;
    else if (key.startsWith("on") && typeof value === "function") node.addEventListener(key.slice(2).toLowerCase(), value);
    else if (key === "value") node.value = value;
    else if (key === "checked" || key === "disabled" || key === "selected" || key === "open") node[key] = Boolean(value);
    else node.setAttribute(key, value === true ? "" : String(value));
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

export function button(label, onClick, className = "secondary", props = {}) {
  return el("button", { class: className, type: "button", onclick: onClick, ...props }, label);
}

export function field(label, control, hint = "") {
  return el("label", "field", el("span", "field-label", label), control, hint ? el("small", "muted", hint) : null);
}

export function select(options, value, onChange, props = {}) {
  const node = el("select", props);
  options.forEach((option) => {
    const [optionValue, optionLabel] = Array.isArray(option) ? option : [option, option];
    node.append(new Option(optionLabel, optionValue, false, String(optionValue) === String(value ?? "")));
  });
  if (onChange) node.addEventListener("change", () => onChange(node.value));
  return node;
}

export function statusLine(id) {
  return el("div", { class: "status-line", id, role: "status", "aria-live": "polite" });
}

export function setLine(id, message, error = false) {
  const line = typeof id === "string" ? document.getElementById(id) : id;
  if (!line) return;
  line.textContent = message;
  line.className = `status-line${error ? " error" : ""}`;
}

export function list(items, className = "") {
  const node = el("ul", className);
  (items || []).forEach((item) => node.append(el("li", {}, String(item))));
  return node;
}

export function chips(items, className = "chip-item") {
  return el("div", "chips", (items || []).map((item) => el("span", className, String(item))));
}

export function scoreClass(score, high = 80, mid = 60) {
  if (score == null || score === "") return "";
  return score >= high ? "high" : score >= mid ? "mid" : "low";
}

export function shortDate(value) {
  if (!value) return "";
  return parseDay(value).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function dateInputValue(value) {
  if (!value) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const date = new Date(value);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function isPastDay(value) {
  return Boolean(value) && parseDay(value) < new Date(new Date().toDateString());
}

/** Today (or N days from now) as a local YYYY-MM-DD string. */
export function localDay(offsetDays = 0) {
  return dateInputValue(new Date(Date.now() + offsetDays * 864e5).toISOString());
}

export function slug(value = "") {
  return String(value || "doc").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 50) || "doc";
}

export function downloadText(filename, content, type = "text/markdown") {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = el("a", { href: url, download: filename });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

export function flash(node, text) {
  const original = node.textContent;
  node.textContent = text;
  setTimeout(() => { node.textContent = original; }, 1300);
}

export function copyButton(getText, label = "Copy") {
  const node = button(label, async () => {
    await navigator.clipboard.writeText(typeof getText === "function" ? getText() : getText);
    flash(node, "Copied");
  });
  return node;
}

/** PDF (via print view), Word, Markdown, and copy for any Markdown document. */
export function exportButtons(getTitle, getMarkdown) {
  const title = () => (typeof getTitle === "function" ? getTitle() : getTitle) || "document";
  const markdown = () => (typeof getMarkdown === "function" ? getMarkdown() : getMarkdown) || "";
  return el("div", "button-row",
    button("PDF", async () => {
      await chrome.storage.local.set({ printJob: { title: title(), markdown: markdown(), at: Date.now() } });
      chrome.tabs.create({ url: chrome.runtime.getURL("print.html") });
    }, "secondary", { title: "Open a clean, ATS-friendly print view and save as PDF" }),
    button("Word", () => downloadText(`${slug(title())}.doc`, wordDocument(title(), markdown()), "application/msword"), "secondary", { title: "Download a Word-compatible document" }),
    button("Markdown", () => downloadText(`${slug(title())}.md`, markdown())),
    copyButton(markdown));
}

export function emptyState(text, action) {
  return el("div", "empty", el("p", {}, text), action || null);
}

export function card(title, ...children) {
  return el("section", "card", title ? el("h3", {}, title) : null, ...children);
}
