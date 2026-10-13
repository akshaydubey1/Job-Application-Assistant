import { markdownToHtml, PRINT_STYLE } from "./src/markdown.mjs";

const style = document.createElement("style");
style.textContent = PRINT_STYLE.replace(/body\{/, ".page{");
document.head.append(style);

const { printJob } = await chrome.storage.local.get(["printJob"]);
const page = document.getElementById("page");
if (!printJob?.markdown) {
  page.textContent = "Nothing to print. Use the PDF button on a document in the Workspace.";
} else {
  document.title = printJob.title || "Document";
  // markdownToHtml escapes all text and only emits a fixed set of tags.
  page.innerHTML = markdownToHtml(printJob.markdown);
  setTimeout(() => window.print(), 300);
}
document.getElementById("printButton").addEventListener("click", () => window.print());
