/*
 * The service worker brokers review-first scans and fills.
 * No page data is sent to a remote service in this MVP.
 */

chrome.runtime.onInstalled.addListener(({ reason }) => {
  if (reason === "install") chrome.runtime.openOptionsPage();
});

if (chrome.storage.local.setAccessLevel) {
  chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" }).catch(() => {});
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "scanActiveTab") {
    scanActiveTab().then(sendResponse).catch((error) => sendResponse({ ok: false, error: friendlyError(error) }));
    return true;
  }

  if (message?.type === "fillActiveTab") {
    fillActiveTab(message.assignments || [])
      .then(sendResponse)
      .catch((error) => sendResponse({ ok: false, error: friendlyError(error) }));
    return true;
  }
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

async function scanActiveTab() {
  await requireResponsibilityAcknowledgment();
  const tab = await getActiveTab();
  const [result] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: scanPage });
  return { ok: true, data: { ...result.result, url: tab.url || "", title: tab.title || "" } };
}

async function fillActiveTab(assignments) {
  await requireResponsibilityAcknowledgment();
  const tab = await getActiveTab();
  const [result] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: fillPageFields,
    args: [assignments]
  });
  return { ok: true, data: result.result };
}

async function requireResponsibilityAcknowledgment() {
  const { responsibilityAck } = await chrome.storage.local.get(["responsibilityAck"]);
  if (!responsibilityAck?.acknowledged || !responsibilityAck.signature || !responsibilityAck.signedAt) {
    throw new Error("Complete the installer responsibility acknowledgment in Profile before scanning or filling.");
  }
}

function friendlyError(error) {
  return error?.message || "The active page could not be inspected.";
}

function scanPage() {
  const selector = 'input, textarea, select, [contenteditable="true"], [role="combobox"]';
  const elements = Array.from(document.querySelectorAll(selector));
  const text = (value) => String(value || "").replace(/\s+/g, " ").trim();
  const visible = (element) => {
    const style = window.getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    const type = String(element.getAttribute("type") || "").toLowerCase();
    return !element.hasAttribute("hidden") && element.getAttribute("aria-hidden") !== "true" &&
      style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0" &&
      rect.width > 0 && rect.height > 0 && !["hidden", "submit", "button", "reset", "image", "file", "password"].includes(type);
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
  const optionsFor = (element) => element.tagName.toLowerCase() === "select"
    ? Array.from(element.options).slice(0, 40).map((option) => ({ value: option.value, text: text(option.textContent) }))
    : [];

  const fields = elements.map((element, index) => {
    const tag = element.tagName.toLowerCase();
    const type = tag === "input" ? String(element.getAttribute("type") || "text").toLowerCase() : tag;
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
        value: ["radio", "checkbox"].includes(type) ? element.getAttribute("value") || "" : ""
      },
      visible: visible(element)
    };
  }).filter((field) => field.visible);

  return { fields, detectedForms: document.forms.length };
}

function fillPageFields(assignments) {
  const selector = 'input, textarea, select, [contenteditable="true"], [role="combobox"]';
  const elements = Array.from(document.querySelectorAll(selector));
  const normalize = (value) => String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  const text = (value) => String(value || "").replace(/\s+/g, " ").trim();
  const visible = (element) => {
    const style = window.getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0" && rect.width > 0 && rect.height > 0;
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
    } else if (type === "checkbox" || type === "radio") {
      const wanted = normalize(value);
      const label = normalize(labelFor(element));
      const bool = booleanValue(value);
      const matchesChoice = wanted === normalize(element.value) || wanted === label || label.includes(wanted);
      if (bool === null && !matchesChoice) {
        results.push({ index: assignment.index, status: "skipped", reason: "The answer did not uniquely match this option." });
        continue;
      }
      element.checked = bool === null ? true : bool;
    } else if (element.isContentEditable) {
      element.textContent = value;
    } else {
      const setter = nativeSetter(element);
      if (setter) setter.call(element, value); else element.value = value;
    }

    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
    element.dispatchEvent(new Event("blur", { bubbles: true }));
    results.push({ index: assignment.index, status: "filled" });
  }

  return { results, filledCount: results.filter((item) => item.status === "filled").length };
}
