/*
 * The service worker only brokers user-initiated scans and fills.
 * No page data is sent to a remote service in this MVP.
 */

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "scanActiveTab") {
    scanActiveTab().then(sendResponse).catch((error) => {
      sendResponse({ ok: false, error: friendlyError(error) });
    });
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
  if (/^(chrome|edge|about|chrome-extension):\/\//i.test(tab.url || "")) {
    throw new Error("This browser page does not allow extensions to inspect it.");
  }
  return tab;
}

async function scanActiveTab() {
  await requireResponsibilityAcknowledgment();
  const tab = await getActiveTab();
  const [result] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: scanPage
  });
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
  const elements = Array.from(document.querySelectorAll("input, textarea, select"));
  const visible = (element) => {
    const style = window.getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
  };

  const labelFor = (element) => {
    const explicit = element.id ? document.querySelector(`label[for="${CSS.escape(element.id)}"]`) : null;
    const wrapped = element.closest("label");
    const parentText = element.parentElement?.innerText || "";
    return [explicit?.innerText, wrapped?.innerText, element.getAttribute("aria-label"), element.getAttribute("placeholder"), parentText]
      .filter(Boolean)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 500);
  };

  const fields = elements
    .map((element, index) => {
      const label = labelFor(element);
      return {
        index,
        tag: element.tagName.toLowerCase(),
        type: element.getAttribute("type") || element.tagName.toLowerCase(),
        name: element.getAttribute("name") || "",
        id: element.id || "",
        autocomplete: element.getAttribute("autocomplete") || "",
        placeholder: element.getAttribute("placeholder") || "",
        label,
        required: element.required || element.getAttribute("aria-required") === "true",
        options: element.tagName.toLowerCase() === "select"
          ? Array.from(element.options).slice(0, 30).map((option) => ({ value: option.value, text: option.textContent.trim() }))
          : [],
        visible: visible(element)
      };
    })
    .filter((field) => field.visible);

  return {
    fields,
    pageText: (document.body?.innerText || "").replace(/\s+/g, " ").trim().slice(0, 3000),
    detectedForms: document.forms.length
  };
}

function fillPageFields(assignments) {
  const elements = Array.from(document.querySelectorAll("input, textarea, select"));
  const results = [];

  for (const assignment of assignments) {
    const element = elements[assignment.index];
    if (!element || element.disabled || element.readOnly || element.type === "file") {
      results.push({ index: assignment.index, status: "skipped", reason: "Field is unavailable or is a file upload." });
      continue;
    }

    const value = assignment.value == null ? "" : String(assignment.value);
    if (element.tagName.toLowerCase() === "select") {
      const wanted = value.toLowerCase();
      const option = Array.from(element.options).find((candidate) =>
        candidate.value.toLowerCase() === wanted || candidate.textContent.trim().toLowerCase() === wanted || candidate.textContent.trim().toLowerCase().includes(wanted)
      );
      if (!option) {
        results.push({ index: assignment.index, status: "skipped", reason: "No matching option was found." });
        continue;
      }
      element.value = option.value;
    } else if (element.type === "checkbox" || element.type === "radio") {
      element.checked = /^(true|yes|1)$/i.test(value);
    } else {
      const setter = Object.getOwnPropertyDescriptor(element.__proto__, "value")?.set;
      if (setter) setter.call(element, value);
      else element.value = value;
    }

    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
    results.push({ index: assignment.index, status: "filled" });
  }

  return { results, filledCount: results.filter((item) => item.status === "filled").length };
}
