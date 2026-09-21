# Job Application Assistant — Chrome/Edge MVP

A local-first Manifest V3 extension that reads visible application fields from the active page, maps them to an approved profile, and fills only the fields you explicitly select.

## What it does

- Scans visible `input`, `textarea`, and `select` controls after you click **Scan current page**.
- Matches common application labels to profile facts such as name, contact details, links, work authorization, education, and approved answers.
- Imports a PDF, DOCX, TXT, or Markdown resume and creates a reviewable profile proposal with source facts, confidence, and warnings.
- Stores unfamiliar application questions in a local question bank so the installer can add approved answers for later reuse.
- Requires an installer responsibility acknowledgment before scanning or filling.
- Shows confidence, missing values, and sensitive fields before anything is filled.
- Fills selected fields only after a confirmation prompt.
- Keeps the profile in browser-local extension storage.

## What it deliberately does not do

- It does not submit applications or click Submit.
- It does not bypass CAPTCHA, bot checks, login controls, or file-upload restrictions.
- It does not request broad `<all_urls>` access.
- It does not send screen captures, resume data, or profile data to an API.
- It does not invent an answer when a fact is missing or unverified.
- It does not make the installer’s responsibility disappear: the installer must verify sensitive details and the final application.

## Install for local testing

1. Open Chrome or Edge extensions: `chrome://extensions` or `edge://extensions`.
2. Turn on **Developer mode**.
3. Choose **Load unpacked** and select this folder.
4. Open the extension’s **Profile** page and replace the example JSON with approved values.
5. For PDF/DOCX extraction, start the optional local parser from this folder:

   ```bash
   python3 -m pip install -r requirements.txt
   python3 local_service.py
   ```

6. In **Profile**, upload your resume, click **Extract details**, review the proposal, and click **Approve proposal into profile**.
7. In **Profile**, review discovered questions, add approved answers, then complete the installer responsibility acknowledgment by checking the box and typing your name.
8. Open a job application page, click the extension, choose **Scan current page**, review the suggestions, and select **Fill selected fields**.

## Profile integrity rules

Keep the profile limited to facts you have verified. For immigration, sponsorship, salary, relocation, demographic, disability, veteran, and other sensitive questions, leave the value blank or mark it for manual review until you decide the exact response.

PDF and DOCX files are sent only to the optional service at `127.0.0.1`. The service extracts text in memory and does not save the uploaded resume. TXT, Markdown, and JSON files can be processed directly in the extension.

The acknowledgment is a local product safeguard, not legal advice or a substitute for reviewing an employer’s application terms. The installer remains responsible for accuracy, sensitive information, eligibility answers, and submission.

If another person installs or takes ownership of the extension, use **Clear acknowledgment** and have that person sign again with their own name. The typed acknowledgment is stored locally with a timestamp.

The profile example is intentionally generic. Do not commit a real phone number, email address, resume, API key, cookie, session token, or immigration document to this project.

## Test

```bash
npm test
```

## Planned next phase

The extension can later connect to the existing job-search agent system through a user-configured model gateway. That integration should send only the minimum page context, use the existing model router when needed, log proposed changes, and preserve the default policy of preparing actions for approval rather than submitting them automatically.
