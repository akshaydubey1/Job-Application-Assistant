/*
 * The service worker brokers review-first scans, fills, job-description
 * extraction, and calls to the local ApplyPilot service (127.0.0.1).
 * Page data only leaves the browser through that local service, and only
 * when the person uses an AI agent action.
 */

const DEFAULT_SERVICE_URL = "http://127.0.0.1:8765";
const AGENT_TIMEOUT_MS = 180000;
const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);
const AGENT_ENDPOINTS = new Set(["/agent/answer", "/agent/analyze-job", "/agent/materials"]);

chrome.runtime.onInstalled.addListener(({ reason }) => {
  if (reason === "install") chrome.runtime.openOptionsPage();
});

if (chrome.storage.local.setAccessLevel) {
  chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" }).catch(() => {});
}

const HANDLERS = {
  scanActiveTab: () => scanActiveTab(),
  fillActiveTab: (message) => fillActiveTab(message.assignments || []),
  extractJob: () => extractJob(),
  agentCall: (message) => agentCall(message.endpoint, message.payload, message.cacheKey),
  agentHealth: () => agentHealth()
};

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Only the extension's own pages may drive these actions.
  if (sender.id !== chrome.runtime.id || !String(sender.url || "").startsWith(chrome.runtime.getURL(""))) return false;
  const handler = HANDLERS[message?.type];
  if (!handler) return false;
  handler(message)
    .then((data) => sendResponse({ ok: true, data }))
    .catch((error) => sendResponse({ ok: false, error: friendlyError(error) }));
  return true;
});

async function getActiveTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const tab = tabs[0];
  if (!tab?.id) throw new Error("No active browser tab was found.");
  if (!/^https?:\/\//i.test(tab.url || "")) {
    throw new Error("This browser page does not allow extensions to inspect it. Open a normal http or https page.");
  }
  return tab;
}

/* Run a function in every frame we are allowed to touch; fall back to the top frame. */
async function runInFrames(tabId, func, args = []) {
  try {
    return await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, func, args });
  } catch {
    return chrome.scripting.executeScript({ target: { tabId }, func, args });
  }
}

async function scanActiveTab() {
  await requireResponsibilityAcknowledgment();
  const tab = await getActiveTab();
  const frames = await runInFrames(tab.id, scanPage);
  const fields = [];
  let detectedForms = 0;
  for (const frame of frames) {
    if (!frame?.result) continue;
    detectedForms += frame.result.detectedForms || 0;
    for (const field of frame.result.fields || []) fields.push({ ...field, frameId: frame.frameId || 0, locator: { ...field.locator, frameId: frame.frameId || 0 } });
  }
  return { fields, detectedForms, frameCount: frames.length, url: tab.url || "", title: tab.title || "" };
}

async function fillActiveTab(assignments) {
  await requireResponsibilityAcknowledgment();
  const tab = await getActiveTab();
  const byFrame = new Map();
  for (const assignment of assignments) {
    const frameId = Number(assignment.frameId ?? assignment.locator?.frameId ?? 0) || 0;
    if (!byFrame.has(frameId)) byFrame.set(frameId, []);
    byFrame.get(frameId).push(assignment);
  }
  const results = [];
  for (const [frameId, group] of byFrame) {
    try {
      const [frame] = await chrome.scripting.executeScript({ target: { tabId: tab.id, frameIds: [frameId] }, func: fillPageFields, args: [group] });
      results.push(...(frame?.result?.results || []));
    } catch {
      group.forEach((assignment) => results.push({ index: assignment.index, status: "skipped", reason: "That part of the page is no longer available." }));
    }
  }
  return { results, filledCount: results.filter((item) => item.status === "filled").length };
}

async function extractJob() {
  const tab = await getActiveTab();
  const frames = await runInFrames(tab.id, extractJobPosting);
  const candidates = frames.map((frame) => frame?.result).filter(Boolean);
  const best = candidates.find((item) => item.source === "json-ld") ||
    candidates.sort((a, b) => (b.text?.length || 0) - (a.text?.length || 0))[0];
  if (!best) throw new Error("No job description text was found on this page.");
  return { ...best, url: tab.url || best.url || "", tabTitle: tab.title || "" };
}

async function requireResponsibilityAcknowledgment() {
  const { responsibilityAck } = await chrome.storage.local.get(["responsibilityAck"]);
  if (!responsibilityAck?.acknowledged || !responsibilityAck.signature || !responsibilityAck.signedAt) {
    throw new Error("Complete the installer responsibility acknowledgment in Profile before scanning or filling.");
  }
}

async function serviceUrl() {
  const { parserSettings } = await chrome.storage.local.get(["parserSettings"]);
  let parsed;
  try {
    parsed = new URL(parserSettings?.url || DEFAULT_SERVICE_URL);
  } catch {
    throw new Error("The local service address in Profile is not valid.");
  }
  if (!/^https?:$/.test(parsed.protocol) || !LOCAL_HOSTS.has(parsed.hostname)) {
    throw new Error("For privacy, the local service must run on this computer at localhost.");
  }
  return parsed.origin;
}

async function agentHealth() {
  const base = await serviceUrl();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4000);
  try {
    const response = await fetch(`${base}/health`, { signal: controller.signal });
    const body = await response.json().catch(() => ({}));
    return { running: response.ok && body.status === "ok", agent: body.agent || { configured: false } };
  } catch {
    return { running: false, agent: { configured: false } };
  } finally {
    clearTimeout(timer);
  }
}

async function agentCall(endpoint, payload, cacheKey) {
  if (!AGENT_ENDPOINTS.has(endpoint)) throw new Error("Unknown agent action.");
  const base = await serviceUrl();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), AGENT_TIMEOUT_MS);
  let response;
  try {
    response = await fetch(`${base}${endpoint}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload || {}),
      signal: controller.signal
    });
  } catch (error) {
    if (error.name === "AbortError") throw new Error("Claude took too long to respond. Try again.");
    throw new Error("The local ApplyPilot service is not running. Start it with: python3 local_service.py");
  } finally {
    clearTimeout(timer);
  }
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `The agent returned an error (${response.status}).`);
  // Keep the latest results so a popup that closed mid-request can pick them up.
  if (cacheKey) {
    const { agentCache = {} } = await chrome.storage.local.get(["agentCache"]);
    agentCache[cacheKey] = { at: Date.now(), result: body };
    const trimmed = Object.fromEntries(Object.entries(agentCache).sort((a, b) => b[1].at - a[1].at).slice(0, 12));
    await chrome.storage.local.set({ agentCache: trimmed });
  }
  return body;
}

function friendlyError(error) {
  return error?.message || "The active page could not be inspected.";
}

/* ---------------------------------------------------------------------- */
/* Functions below run inside the page (one copy per frame).               */
/* ---------------------------------------------------------------------- */

function scanPage() {
  const selector = 'input, textarea, select, [contenteditable="true"], [role="combobox"]';
  const elements = Array.from(document.querySelectorAll(selector));
  const text = (value) => String(value || "").replace(/\s+/g, " ").trim();
  const shown = (element) => {
    if (!element) return false;
    const style = window.getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return !element.hasAttribute("hidden") && element.getAttribute("aria-hidden") !== "true" &&
      style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0" && rect.width > 0 && rect.height > 0;
  };
  const labelElement = (element) => (element.id ? document.querySelector(`label[for="${CSS.escape(element.id)}"]`) : null) || element.closest("label");
  const visible = (element) => {
    const type = String(element.getAttribute("type") || "").toLowerCase();
    if (["hidden", "submit", "button", "reset", "image", "file", "password"].includes(type)) return false;
    if (shown(element)) return true;
    // Styled radios and checkboxes often hide the native input behind a visible label.
    return ["radio", "checkbox"].includes(type) && shown(labelElement(element));
  };
  const labelledText = (element) => {
    const explicit = element.id ? document.querySelector(`label[for="${CSS.escape(element.id)}"]`) : null;
    const wrapped = element.closest("label");
    const describedBy = (element.getAttribute("aria-labelledby") || "").split(/\s+/).filter(Boolean)
      .map((id) => document.getElementById(id)?.innerText || "").join(" ");
    const fieldset = element.closest("fieldset")?.querySelector("legend")?.innerText || "";
    const direct = [explicit?.innerText, wrapped?.innerText, describedBy, element.getAttribute("aria-label"), element.getAttribute("placeholder"), fieldset]
      .map(text).filter(Boolean);
    if (direct.length) return [...new Set(direct)].join(" ").slice(0, 500);
    const nearby = [element.previousElementSibling?.innerText, element.parentElement?.innerText].map(text).filter(Boolean);
    return [...new Set(nearby)].join(" ").slice(0, 500);
  };
  const optionLabel = (element) => text(labelElement(element)?.innerText || element.getAttribute("aria-label") || element.value).slice(0, 200);
  const groupLabel = (element) => {
    const type = String(element.getAttribute("type") || "").toLowerCase();
    if (!["radio", "checkbox"].includes(type)) return "";
    const legend = element.closest("fieldset")?.querySelector("legend")?.innerText;
    if (text(legend)) return text(legend).slice(0, 500);
    const group = element.closest('[role="radiogroup"], [role="group"]');
    if (group) {
      const byId = (group.getAttribute("aria-labelledby") || "").split(/\s+/).filter(Boolean).map((id) => document.getElementById(id)?.innerText || "").join(" ");
      const label = text(byId || group.getAttribute("aria-label"));
      if (label) return label.slice(0, 500);
    }
    const name = element.getAttribute("name");
    if (!name) return "";
    const siblings = Array.from(document.querySelectorAll(`input[name="${CSS.escape(name)}"]`));
    if (siblings.length < 2) return "";
    let container = element.parentElement;
    while (container && container !== document.body && siblings.some((item) => !container.contains(item))) container = container.parentElement;
    if (!container || container === document.body) return "";
    // The container may hold only the options; step up once to reach the question text.
    let source = container;
    const optionTexts = siblings.map(optionLabel).filter(Boolean);
    const remainder = (node) => {
      let value = text(node.innerText);
      optionTexts.forEach((option) => { value = value.replace(option, " "); });
      return text(value);
    };
    if (remainder(source).length < 6 && source.parentElement && source.parentElement !== document.body) source = source.parentElement;
    return remainder(source).slice(0, 300);
  };
  const optionsFor = (element) => element.tagName.toLowerCase() === "select"
    ? Array.from(element.options).slice(0, 60).map((option) => ({ value: option.value, text: text(option.textContent) }))
    : [];

  const fields = elements.map((element, index) => {
    const tag = element.tagName.toLowerCase();
    const type = tag === "input" ? String(element.getAttribute("type") || "text").toLowerCase() : tag;
    const isChoice = ["radio", "checkbox"].includes(type);
    return {
      index,
      tag,
      type,
      role: element.getAttribute("role") || "",
      name: element.getAttribute("name") || "",
      id: element.id || "",
      autocomplete: element.getAttribute("autocomplete") || "",
      placeholder: element.getAttribute("placeholder") || "",
      ariaLabel: element.getAttribute("aria-label") || "",
      label: labelledText(element),
      optionLabel: isChoice ? optionLabel(element) : "",
      groupLabel: isChoice ? groupLabel(element) : "",
      maxLength: Number(element.getAttribute("maxlength")) || 0,
      required: Boolean(element.required || element.getAttribute("aria-required") === "true"),
      contentEditable: element.isContentEditable === true,
      options: optionsFor(element),
      locator: {
        id: element.id || "",
        name: element.getAttribute("name") || "",
        tag,
        type,
        role: element.getAttribute("role") || "",
        autocomplete: element.getAttribute("autocomplete") || "",
        value: isChoice ? element.getAttribute("value") || "" : ""
      },
      visible: visible(element)
    };
  }).filter((field) => field.visible);

  return { fields, detectedForms: document.forms.length };
}

function fillPageFields(assignments) {
  const selector = 'input, textarea, select, [contenteditable="true"], [role="combobox"]';
  const elements = Array.from(document.querySelectorAll(selector));
  const normalize = (value) => String(value || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  const text = (value) => String(value || "").replace(/\s+/g, " ").trim();
  const shown = (element) => {
    if (!element) return false;
    const style = window.getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0" && rect.width > 0 && rect.height > 0;
  };
  const labelElement = (element) => (element.id ? document.querySelector(`label[for="${CSS.escape(element.id)}"]`) : null) || element.closest("label");
  const visible = (element) => {
    const type = String(element.getAttribute("type") || "").toLowerCase();
    return shown(element) || (["radio", "checkbox"].includes(type) && shown(labelElement(element)));
  };
  const labelFor = (element) => {
    const explicit = element.id ? document.querySelector(`label[for="${CSS.escape(element.id)}"]`) : null;
    const wrapped = element.closest("label");
    const direct = [explicit?.innerText, wrapped?.innerText, element.getAttribute("aria-label"), element.getAttribute("placeholder")].map(text).filter(Boolean);
    if (direct.length) return [...new Set(direct)].join(" ").slice(0, 500);
    return [...new Set([element.previousElementSibling?.innerText, element.parentElement?.innerText].map(text).filter(Boolean))].join(" ").slice(0, 500);
  };
  const matchesLocator = (element, locator = {}) => {
    if (locator.id && element.id === locator.id) return true;
    const tag = element.tagName.toLowerCase();
    const type = tag === "input" ? String(element.getAttribute("type") || "text").toLowerCase() : tag;
    if (locator.name && element.getAttribute("name") === locator.name && (!locator.type || type === locator.type) && (!locator.value || element.getAttribute("value") === locator.value)) return true;
    return false;
  };
  const findElement = (assignment) => {
    const locator = assignment.locator || {};
    if (locator.id) {
      const byId = document.getElementById(locator.id);
      if (byId && elements.includes(byId)) return byId;
    }
    const located = elements.find((element) => matchesLocator(element, locator));
    return located || (Number.isInteger(assignment.index) ? elements[assignment.index] : null);
  };
  const nativeSetter = (element) => {
    let current = element;
    while (current) {
      const descriptor = Object.getOwnPropertyDescriptor(current, "value");
      if (descriptor?.set) return descriptor.set;
      current = Object.getPrototypeOf(current);
    }
    return null;
  };
  const findOption = (element, value) => {
    const wanted = normalize(value);
    const options = Array.from(element.options);
    const exact = options.filter((option) => [option.value, option.textContent].some((candidate) => normalize(candidate) === wanted));
    if (exact.length === 1) return exact[0];
    const partial = options.filter((option) => [option.value, option.textContent].some((candidate) => {
      const candidateValue = normalize(candidate);
      return candidateValue && (candidateValue.includes(wanted) || wanted.includes(candidateValue));
    }));
    return partial.length === 1 ? partial[0] : null;
  };
  const booleanValue = (value) => {
    const normalized = normalize(value);
    if (["true", "yes", "1", "on", "y", "si", "oui", "ja"].includes(normalized)) return true;
    if (["false", "no", "0", "off", "n", "non", "nein"].includes(normalized)) return false;
    return null;
  };
  const fire = (element) => {
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
    element.dispatchEvent(new Event("blur", { bubbles: true }));
  };
  const results = [];

  for (const assignment of assignments) {
    const element = findElement(assignment);
    const type = String(element?.getAttribute?.("type") || "").toLowerCase();
    if (!element || !visible(element) || element.disabled || element.readOnly || ["hidden", "submit", "button", "reset", "image", "file", "password"].includes(type)) {
      results.push({ index: assignment.index, status: "skipped", reason: "Field is unavailable, sensitive, or is a file/password field." });
      continue;
    }

    const value = assignment.value == null ? "" : String(assignment.value);
    const tag = element.tagName.toLowerCase();
    if (tag === "select") {
      const option = findOption(element, value);
      if (!option) {
        results.push({ index: assignment.index, status: "skipped", reason: "No unique matching option was found." });
        continue;
      }
      const setter = nativeSetter(element);
      if (setter) setter.call(element, option.value); else element.value = option.value;
      fire(element);
    } else if (type === "checkbox" || type === "radio") {
      const wanted = normalize(value);
      const label = normalize(labelFor(element));
      const bool = booleanValue(value);
      const matchesChoice = wanted === normalize(element.value) || wanted === label || label.includes(wanted);
      if (bool === null && !matchesChoice) {
        results.push({ index: assignment.index, status: "skipped", reason: "The answer did not uniquely match this option." });
        continue;
      }
      const desired = bool === null ? true : bool;
      // A real click keeps React/Vue state in sync; fall back to setting the property.
      if (element.checked !== desired) element.click();
      if (element.checked !== desired) { element.checked = desired; fire(element); }
    } else if (element.isContentEditable) {
      element.focus();
      element.textContent = value;
      fire(element);
    } else {
      element.focus();
      const setter = nativeSetter(element);
      if (setter) setter.call(element, value); else element.value = value;
      fire(element);
    }
    results.push({ index: assignment.index, status: "filled" });
  }

  return { results, filledCount: results.filter((item) => item.status === "filled").length };
}

function extractJobPosting() {
  const text = (value) => String(value || "").replace(/[ \t\f\v ]+/g, " ").replace(/\n\s*\n\s*\n+/g, "\n\n").trim();
  const htmlToText = (html) => {
    const doc = new DOMParser().parseFromString(String(html || ""), "text/html");
    doc.querySelectorAll("br").forEach((node) => node.replaceWith("\n"));
    doc.querySelectorAll("p, li, h1, h2, h3, h4, div").forEach((node) => node.append("\n"));
    return text(doc.body?.textContent || "");
  };

  const postings = [];
  const visit = (node) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) return node.forEach(visit);
    const type = [].concat(node["@type"] || []);
    if (type.includes("JobPosting")) postings.push(node);
    if (node["@graph"]) visit(node["@graph"]);
  };
  document.querySelectorAll('script[type="application/ld+json"]').forEach((script) => {
    try { visit(JSON.parse(script.textContent)); } catch { /* ignore malformed JSON-LD */ }
  });

  if (postings.length) {
    const job = postings[0];
    const org = [].concat(job.hiringOrganization || [])[0] || {};
    const place = [].concat(job.jobLocation || [])[0]?.address || {};
    const where = [place.addressLocality, place.addressRegion, place.addressCountry?.name || place.addressCountry].filter((part) => typeof part === "string" && part).join(", ");
    const remote = job.jobLocationType === "TELECOMMUTE" ? "Remote" : "";
    const description = htmlToText(job.description);
    const extra = [job.qualifications, job.responsibilities, job.skills].filter((part) => typeof part === "string").map(htmlToText).join("\n\n");
    return {
      source: "json-ld",
      title: text(job.title),
      company: text(typeof org === "string" ? org : org.name),
      location: [where, remote].filter(Boolean).join(" · "),
      employmentType: [].concat(job.employmentType || []).join(", "),
      text: [description, extra].filter(Boolean).join("\n\n").slice(0, 24000),
      url: window.location.href
    };
  }

  const selectors = [
    '[data-automation-id="jobPostingDescription"]', ".job-description", "#job-description", '[class*="jobDescription"]',
    '[class*="job-description"]', '[class*="posting-page"]', ".section-wrapper", "#content", '[class*="description"]', "main", "article", "body"
  ];
  let node = null;
  for (const selectorText of selectors) {
    const candidate = document.querySelector(selectorText);
    if (candidate && text(candidate.innerText).length > 400) { node = candidate; break; }
  }
  node = node || document.body;
  const clone = node.cloneNode(true);
  clone.querySelectorAll("script, style, noscript, nav, footer, form, svg, iframe").forEach((item) => item.remove());
  const meta = (name) => document.querySelector(`meta[property="${name}"], meta[name="${name}"]`)?.content || "";
  return {
    source: "page",
    title: text(document.querySelector("h1")?.innerText || meta("og:title") || document.title),
    company: text(meta("og:site_name")),
    location: "",
    employmentType: "",
    text: text(clone.innerText || clone.textContent || "").slice(0, 24000),
    url: window.location.href
  };
}
