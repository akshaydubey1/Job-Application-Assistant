/*
 * Minimal, safe Markdown → HTML for resumes and letters. All text is escaped
 * first; only headings, lists, emphasis, links, rules, and paragraphs are
 * produced. Used for the print/PDF view and Word export.
 */

export function escapeHtml(value = "") {
  return String(value).replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
}

function inline(text) {
  let out = escapeHtml(text);
  out = out.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+|mailto:[^\s)]+)\)/g, (_m, label, url) => `<a href="${url}">${label}</a>`);
  out = out.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>").replace(/__([^_]+)__/g, "<strong>$1</strong>");
  out = out.replace(/(^|[^*])\*([^*\s][^*]*)\*/g, "$1<em>$2</em>").replace(/(^|\W)_([^_\s][^_]*)_(?=\W|$)/g, "$1<em>$2</em>");
  return out;
}

export function markdownToHtml(markdown = "") {
  const lines = String(markdown).replace(/\r\n?/g, "\n").split("\n");
  const html = [];
  let list = null;
  let paragraph = [];
  const flushParagraph = () => {
    if (paragraph.length) html.push(`<p>${paragraph.map(inline).join("<br>")}</p>`);
    paragraph = [];
  };
  const closeList = () => {
    if (list) html.push(`</${list}>`);
    list = null;
  };
  for (const raw of lines) {
    const line = raw.trimEnd();
    const heading = line.match(/^(#{1,4})\s+(.*)$/);
    const bullet = line.match(/^\s*[-*•]\s+(.*)$/);
    const numbered = line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (!line.trim()) { flushParagraph(); closeList(); continue; }
    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) { flushParagraph(); closeList(); html.push("<hr>"); continue; }
    if (heading) { flushParagraph(); closeList(); html.push(`<h${heading[1].length}>${inline(heading[2])}</h${heading[1].length}>`); continue; }
    if (bullet || numbered) {
      flushParagraph();
      const tag = bullet ? "ul" : "ol";
      if (list !== tag) { closeList(); html.push(`<${tag}>`); list = tag; }
      html.push(`<li>${inline((bullet || numbered)[1])}</li>`);
      continue;
    }
    closeList();
    paragraph.push(line.trim());
  }
  flushParagraph();
  closeList();
  return html.join("\n");
}

const DOC_STYLE = `body{font-family:Calibri,Arial,Helvetica,sans-serif;font-size:10.5pt;line-height:1.35;color:#111;margin:0}
h1{font-size:20pt;margin:0 0 4pt}h2{font-size:12pt;margin:12pt 0 4pt;padding-bottom:2pt;border-bottom:1px solid #999;text-transform:uppercase;letter-spacing:.04em}
h3{font-size:11pt;margin:8pt 0 2pt}h4{font-size:10.5pt;margin:6pt 0 2pt}p{margin:0 0 6pt}ul,ol{margin:2pt 0 6pt 16pt;padding:0}li{margin:0 0 2pt}
a{color:#111;text-decoration:none}hr{border:0;border-top:1px solid #bbb;margin:8pt 0}`;

export function wordDocument(title, markdown) {
  return `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">
<head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>@page{margin:0.7in}${DOC_STYLE}</style></head>
<body>${markdownToHtml(markdown)}</body></html>`;
}

export const PRINT_STYLE = DOC_STYLE;
