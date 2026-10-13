import { loadAgentContext, sendToBackground } from "./src/store.mjs";
import { actionableCount, dueItems } from "./src/crm.mjs";
import { el } from "./src/ui.mjs";
import { renderApps, renderBoard, renderToday } from "./src/views/apps.mjs";
import { renderContacts } from "./src/views/contacts.mjs";
import { renderInterview } from "./src/views/interview.mjs";
import { renderStudio } from "./src/views/studio.mjs";
import { renderDocs } from "./src/views/docs.mjs";
import { renderInsights } from "./src/views/insights.mjs";

/** JSON with sorted keys: chrome.storage hands objects back with keys reordered. */
function stableJson(value) {
  return JSON.stringify(value, (_key, item) => (item && typeof item === "object" && !Array.isArray(item)
    ? Object.fromEntries(Object.keys(item).sort().map((k) => [k, item[k]]))
    : item));
}

const KEYS = ["applications", "contacts", "documents", "interviews", "resumeText", "reminderSettings", "linkedinSnapshot"];
const ROUTES = { today: renderToday, apps: renderApps, board: renderBoard, contacts: renderContacts, interview: renderInterview, studio: renderStudio, docs: renderDocs, insights: renderInsights };

export const ctx = {
  data: { applications: [], contacts: [], documents: [], interviews: [], resumeText: "", reminderSettings: {}, linkedinSnapshot: null },
  agent: { ready: false, running: false, model: "" },
  busy: new Set(),
  lastWrite: {},

  async load() {
    const saved = await chrome.storage.local.get(KEYS);
    for (const key of KEYS) ctx.data[key] = saved[key] ?? (key === "resumeText" ? "" : key === "reminderSettings" ? {} : key === "linkedinSnapshot" ? null : []);
  },

  async mutate(key, fn) {
    const saved = await chrome.storage.local.get([key]);
    const next = await fn(saved[key] ?? ctx.data[key]);
    ctx.data[key] = next;
    ctx.lastWrite[key] = stableJson(next); // our own write; the storage listener skips it
    await chrome.storage.local.set({ [key]: next });
    updateDueCount();
    return next;
  },

  /** Call a Claude tool through the local service with the candidate context attached. */
  async call(endpoint, payload = {}) {
    if (!ctx.agent.ready) {
      throw new Error(ctx.agent.running
        ? "Claude is not configured. Set ANTHROPIC_API_KEY for the local service and restart it."
        : "The local ApplyPilot service is not running. Start it with: python3 local_service.py");
    }
    const context = await loadAgentContext();
    return sendToBackground({ type: "agentCall", endpoint, payload: { ...context, ...payload } });
  },

  go(hash) {
    if (location.hash === hash) render(); else location.hash = hash;
  },

  rerender() { render(); },

  openDialog(build) {
    const dialog = document.getElementById("dialog");
    const body = document.getElementById("dialogBody");
    body.replaceChildren(build(() => dialog.close()));
    dialog.showModal();
  }
};

function parseRoute() {
  const raw = location.hash.replace(/^#\/?/, "");
  if (/^app_/.test(raw)) return { name: "apps", params: [raw] }; // links from older versions
  const [name, ...params] = raw.split("/").filter(Boolean).map(decodeURIComponent);
  return { name: ROUTES[name] ? name : "today", params };
}

async function render() {
  const { name, params } = parseRoute();
  document.querySelectorAll(".sidebar a[data-route]").forEach((link) => link.classList.toggle("active", link.dataset.route === name));
  const view = document.getElementById("view");
  const scroll = window.scrollY;
  const container = el("div", `view-${name}`);
  try {
    await ROUTES[name](container, ctx, params);
  } catch (error) {
    container.replaceChildren(el("div", "empty", `Something went wrong: ${error.message}`));
    console.error(error);
  }
  view.replaceChildren(container);
  if (ctx.keepScroll) window.scrollTo(0, scroll);
  ctx.keepScroll = false;
}

async function checkAgent() {
  const chip = document.getElementById("agentChip");
  try {
    const health = await sendToBackground({ type: "agentHealth" });
    ctx.agent = { running: health.running, ready: Boolean(health.running && health.agent?.configured), model: health.agent?.model || "" };
  } catch {
    ctx.agent = { running: false, ready: false, model: "" };
  }
  chip.textContent = ctx.agent.ready ? `Claude ready · ${ctx.agent.model}` : ctx.agent.running ? "AI key missing" : "Agent offline";
  chip.className = `chip ${ctx.agent.ready ? "ready" : "off"}`;
  chip.title = ctx.agent.ready ? "Decision engine online" : ctx.agent.running
    ? "Set ANTHROPIC_API_KEY and restart the local service."
    : "Start the local service: python3 local_service.py";
}

function updateDueCount() {
  const count = actionableCount(dueItems({ applications: ctx.data.applications, contacts: ctx.data.contacts }, new Date(), { staleAfterDays: ctx.data.reminderSettings?.staleAfterDays || 7 }));
  const badge = document.getElementById("dueCount");
  badge.textContent = String(count);
  badge.classList.toggle("hidden", !count);
}

document.addEventListener("DOMContentLoaded", async () => {
  await ctx.load();
  updateDueCount();
  await render();
  checkAgent().then(() => render());
  window.addEventListener("hashchange", () => { window.scrollTo(0, 0); render(); });
  chrome.storage.onChanged.addListener(async (changes, area) => {
    if (area !== "local") return;
    const relevant = KEYS.filter((key) => changes[key] && stableJson(changes[key].newValue) !== ctx.lastWrite[key]);
    if (!relevant.length) return;
    relevant.forEach((key) => { ctx.data[key] = changes[key].newValue ?? ctx.data[key]; });
    updateDueCount();
    // Don't wipe a field the person is typing in.
    if (!document.activeElement?.closest?.("#view") || ["BODY", "BUTTON", "A"].includes(document.activeElement.tagName)) {
      ctx.keepScroll = true;
      render();
    }
  });
});
