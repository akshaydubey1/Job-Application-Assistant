# ApplyPilot — Job Application Assistant

A local-first Manifest V3 extension that reads visible application fields from the active page, maps them to an approved profile, and helps fill application forms without sending profile data to a developer cloud service.

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

## What it deliberately does not do

- It does not submit applications or click Submit.
- It does not bypass CAPTCHA, bot checks, login controls, or file-upload restrictions.
- It does not request broad `<all_urls>` access or passively inspect every tab.
- It does not send screen captures, resume data, or profile data to an API.
- It does not invent an answer when a fact is missing or unverified.
- It does not make the installer’s responsibility disappear: the installer must verify sensitive details and the final application.

## Install for local testing

1. Open Chrome or Edge extensions: `chrome://extensions` or `edge://extensions`.
2. Turn on **Developer mode**.
3. Choose **Load unpacked** and select this folder.
4. Open the extension’s **Profile** page, upload your resume, and click **Extract details**. Review the friendly detail list and choose **Approve reviewed details**.
5. For PDF/DOCX extraction, start the optional local parser from this folder if it is not already running:

   ```bash
   python3 -m pip install -r requirements.txt
   python3 local_service.py
   ```

6. In **Profile**, review discovered questions, add approved answers, then complete the installer responsibility acknowledgment by checking the box and typing your name.
7. Leave **Automatic assistance** enabled if you want the extension popup to scan and fill approved fields when opened. High-risk questions remain highlighted for review.
8. Open a job application page and click the extension. It will scan the visible form and fill approved values. Review the page and use the manual controls for any remaining fields.

Chrome does not allow an extension to create a Python virtual environment, install packages, or launch a local process silently. The optional parser therefore remains a separate local process. A future native-messaging host or an entirely bundled JavaScript parser could remove that requirement, but either would need a separate security and packaging review.

## Profile integrity rules

Keep the profile limited to facts you have verified. For immigration, sponsorship, salary, relocation, demographic, disability, veteran, and other sensitive questions, leave the value blank or mark it for manual review until you decide the exact response.

Browser-local extension storage is not encrypted. Never store passwords, SSNs, passport numbers, bank details, authentication codes, or other secrets in the profile or question bank. Use the browser/device security controls and clear the profile when it is no longer needed.

PDF and DOCX files are sent only to the optional service at `127.0.0.1`. The service extracts text in memory and does not save the uploaded resume. TXT, Markdown, and JSON files can be processed directly in the extension.

The acknowledgment is a local product safeguard, not legal advice or a substitute for reviewing an employer’s application terms. The installer remains responsible for accuracy, sensitive information, eligibility answers, and submission.

If another person installs or takes ownership of the extension, use **Clear acknowledgment** and have that person sign again with their own name. The typed acknowledgment is stored locally with a timestamp.

The profile example is intentionally generic. Do not commit a real phone number, email address, resume, API key, cookie, session token, or immigration document to this project.

## Test

```bash
npm test
```

See [TESTING.md](TESTING.md) for the international, dynamic-page, privacy,
and local-parser test checklist.

## Planned next phase

The extension can later connect to the existing job-search agent system through a user-configured model gateway. That integration should send only the minimum page context, use the existing model router when needed, log proposed changes, and preserve the default policy of preparing actions for approval rather than submitting them automatically.
