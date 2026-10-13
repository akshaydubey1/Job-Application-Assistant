/*
 * Small helpers around chrome.storage.local shared by the popup and the
 * workspace page. Every mutation re-reads storage first so two open pages do
 * not overwrite each other's changes.
 */
import { isSensitivePrompt } from "./question-bank.mjs";

export const DEFAULT_AGENT_SETTINGS = { autoDraft: false, minConfidence: 0.7 };

export async function loadAgentContext() {
  const saved = await chrome.storage.local.get(["profile", "resumeText", "agentNotes", "questionBank"]);
  return {
    profile: saved.profile || {},
    resumeText: saved.resumeText || "",
    agentNotes: saved.agentNotes || "",
    approvedAnswers: (saved.questionBank || [])
      .filter((item) => item.answer && !item.sensitive && !isSensitivePrompt(item.prompt))
      .slice(0, 40)
      .map((item) => ({ prompt: item.prompt, answer: item.answer }))
  };
}

export async function getApplications() {
  const { applications = [] } = await chrome.storage.local.get(["applications"]);
  return applications;
}

export async function mutateApplications(mutator) {
  const current = await getApplications();
  const next = await mutator(current);
  await chrome.storage.local.set({ applications: next });
  return next;
}

export async function getAgentSettings() {
  const { agentSettings } = await chrome.storage.local.get(["agentSettings"]);
  return { ...DEFAULT_AGENT_SETTINGS, ...(agentSettings || {}) };
}

export async function sendToBackground(message) {
  let response;
  try {
    response = await chrome.runtime.sendMessage(message);
  } catch (error) {
    throw new Error(error.message || "The extension background worker did not respond.");
  }
  if (!response?.ok) throw new Error(response?.error || "The action failed.");
  return response.data;
}
