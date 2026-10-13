# ApplyPilot — Job Application Assistant

A local-first Manifest V3 extension and job-application agent. It reads visible application fields from the active page, fills them from an approved profile, and, with the optional Claude decision engine, drafts answers to new questions, scores your fit for the job, writes a tailored resume, cover letter, and outreach message, and tracks every application. It never clicks Submit, and sensitive questions always stay with you.

## The agent at a glance

| Capability | Where | What happens |
| --- | --- | --- |
| Fill approved fields | Popup → **Scan & fill** | Rule-based mapping of name, contact, links, education, and saved answers. Works in embedded ATS frames too. |
| Draft answers | Popup → **Draft answers** | Claude decides answers for the remaining questions from your profile, master resume, notes, approved answers, and the job posting. Drafts show confidence and source; high-confidence drafts are pre-selected; nothing fills until you click **Fill selected**. Approved short factual answers are saved for reuse. |
| Analyze fit | Popup → **Analyze fit**, or Workspace | Reads the posting (JSON-LD when available), checks each requirement against your materials with evidence, gives a 0–100 score, a recommendation, gaps with mitigations, knockout risks to check yourself, and ATS keywords. |
| Tailored materials | Workspace | Tailored resume (same format as your master resume), cover letter, and a short human outreach message. Claude lists what it changed and what it refused to claim. Copy or download. |
| Track applications | Automatic + Workspace | Every job you analyze, fill, or mark applied is logged with status, dates, fit, materials, and notes. Filter, search, export CSV, back up and restore JSON. |

### Decision guardrails

- Claude only uses facts from your approved profile, master resume, notes, and approved answers. Unsupported questions come back blank and marked for you.
- Work authorization, sponsorship, citizenship, salary, demographic, disability, veteran, criminal-history, government-ID, date-of-birth, and legal-consent questions are never sent for drafting and never answered. This is enforced in both the extension and the local service, regardless of model output.
- Choice answers must exactly match an option on the page; text answers respect the field's maximum length.
- Job-page text is treated as untrusted data, so instructions hidden in a posting are ignored.
- Your Anthropic API key lives only in the local service on your computer. The browser never holds it.

## What it does

- Opens the Profile page on first install so setup starts immediately.
- When automatic assistance is enabled, opening the extension scans the current page and fills approved, non-high-risk values automatically.
- Scans native controls plus common custom combobox and content-editable controls in the current page after the extension has active-tab access.
- Matches common application labels to profile facts such as name, contact details, links, work authorization, education, and approved answers.
- Recognizes common field labels and autocomplete tokens used in English, Spanish, French, German, Italian, and Portuguese forms, while preserving unknown fields for review.
- Imports a PDF, DOCX, TXT, Markdown, or JSON resume/profile and creates a friendly, reviewable profile proposal with source facts, confidence, and warnings. JSON remains available only under Advanced settings.
- Stores only unfamiliar application question prompts, choices, and limited metadata in a local question bank so the installer can add approved answers for later reuse. It does not save the entire page or a screen capture.
- Requires an installer responsibility acknowledgment before scanning or filling.
- Shows confidence, missing values, and sensitive fields before anything is filled, and lets the installer enter a manual answer for an unfamiliar field.
- Keeps sponsorship, work authorization, salary, relocation, demographic, and other high-risk fields manual even when automatic assistance is enabled.
- Lets the installer turn automatic assistance off from Profile and use the manual review flow instead.
- Keeps the profile in browser-local extension storage.

## One-click fill (v0.6)

- **Keyboard shortcut:** press **Alt+Shift+F** on any application page to open ApplyPilot, scan the form and fill approved fields. Change it at `chrome://extensions/shortcuts`.
- **Yes/No buttons:** fills Yes/No questions built from buttons (as on Ashby forms), not only radio inputs.
- **Import from Career Atelier:** in **Profile**, upload the `applicant-profile.json` made by the [Application Autofill](https://github.com/akshaydubey1/Career-Atelier) skill. It is converted to ApplyPilot's format for review before you approve it.
- **Opt-in sensitive answers:** in **Profile**, you can choose to fill your saved answers for sponsorship, work authorization, relocation, start date and voluntary self-identification. They stay highlighted for review. Government ID, date of birth, citizenship and criminal-history questions are never filled.

## What it deliberately does not do

- It does not submit applications or click Submit.
- It does not bypass CAPTCHA, bot checks, login controls, or file-upload restrictions.
- It does not request broad `<all_urls>` access or passively inspect every tab.
- It does not send screen captures. Resume, profile, and job text go to the Anthropic API only through your local service, only when you use an AI action, and never to a developer service.
- It does not invent an answer when a fact is missing or unverified, and it never drafts sensitive or consent answers.
- It does not make the installer’s responsibility disappear: the installer must verify sensitive details and the final application.

## Install for local testing

1. Open Chrome or Edge extensions: `chrome://extensions` or `edge://extensions`.
2. Turn on **Developer mode**.
3. Choose **Load unpacked** and select this folder.
4. Open the extension’s **Profile** page, upload your resume, and click **Extract details**. Review the friendly detail list and choose **Approve reviewed details**.
5. Start the local service from this folder. It handles PDF/DOCX extraction and, with an API key, the Claude agent:

   ```bash
   python3 -m pip install -r requirements.txt
   cp .env.example .env        # then put your key after ANTHROPIC_API_KEY=
   python3 local_service.py
   ```

   The service prints whether the AI agent is enabled. Without a key, everything except the AI actions still works. Optional settings in `.env`: `APPLYPILOT_MODEL` (default `claude-opus-5-5`), `APPLYPILOT_EXTENSION_ID` to accept only your installed extension, and `APPLYPILOT_PORT`.

5a. On the **Profile** page, under **AI agent**, check that the master resume text looks right, add any facts the resume does not show (for example total years of experience or location preferences), click **Check AI agent**, then **Save agent settings**. Click **Allow embedded application forms** if you apply on company sites that embed Greenhouse, Lever, Workday, Ashby, and similar forms.

6. In **Profile**, review discovered questions, add approved answers, then complete the installer responsibility acknowledgment by checking the box and typing your name.
7. Leave **Automatic assistance** enabled if you want the extension popup to scan and fill approved fields when opened. High-risk questions remain highlighted for review.
8. Open a job application page and click the extension. It will scan the visible form and fill approved values. Click **Analyze fit** to score the job, then **Draft answers** to have Claude handle the remaining questions. Review the blue Claude cards, edit anything, and click **Fill selected**. Sensitive questions stay highlighted for you.
9. Click **Mark applied** after you submit. Open **Workspace** to generate the tailored resume, cover letter, and outreach message, and to manage your tracker.

Chrome does not allow an extension to create a Python virtual environment, install packages, or launch a local process silently. The optional parser therefore remains a separate local process. A future native-messaging host or an entirely bundled JavaScript parser could remove that requirement, but either would need a separate security and packaging review.

## Profile integrity rules

Keep the profile limited to facts you have verified. For immigration, sponsorship, salary, relocation, demographic, disability, veteran, and other sensitive questions, leave the value blank or mark it for manual review until you decide the exact response.

Browser-local extension storage is not encrypted. Never store passwords, SSNs, passport numbers, bank details, authentication codes, or other secrets in the profile or question bank. Use the browser/device security controls and clear the profile when it is no longer needed.

PDF and DOCX files are sent only to the local service at `127.0.0.1`. The service extracts text in memory and does not save the uploaded resume. TXT, Markdown, and JSON files can be processed directly in the extension. AI actions send the minimum context through the same local service to the Anthropic API; see [PRIVACY.md](PRIVACY.md).

The acknowledgment is a local product safeguard, not legal advice or a substitute for reviewing an employer’s application terms. The installer remains responsible for accuracy, sensitive information, eligibility answers, and submission.

If another person installs or takes ownership of the extension, use **Clear acknowledgment** and have that person sign again with their own name. The typed acknowledgment is stored locally with a timestamp.

The profile example is intentionally generic. Do not commit a real phone number, email address, resume, API key, cookie, session token, or immigration document to this project.

## Test

```bash
npm test             # JS unit tests + Python agent/service tests (no network)
npm run public-scan
```

See [TESTING.md](TESTING.md) for the international, dynamic-page, privacy,
and local-parser test checklist.

## Architecture

```
Popup / Profile / Workspace (extension pages)
        │ chrome.runtime messages
        ▼
background.js ── scans and fills pages (all permitted frames), extracts job postings
        │ fetch to 127.0.0.1 only
        ▼
local_service.py ── /extract (local resume parsing)
                 └─ /agent/answer, /agent/analyze-job, /agent/materials
                         │ agent.py: guardrails + structured tool calls
                         ▼
                    Anthropic Messages API (your key)
```

Pure logic lives in `src/` (field mapping, question bank, agent question building and answer application, tracker helpers) and is covered by `node --test`. The decision engine's guardrails are covered by `test/test_agent_service.py` with a fake transport.
