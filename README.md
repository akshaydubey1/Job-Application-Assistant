# Job Application Assistant — Chrome/Edge MVP

A local-first Manifest V3 extension that reads visible application fields from the active page, maps them to an approved profile, and fills only the fields you explicitly select.

## Quick install (Chrome or Edge)

You do **not** need to install Node.js or Python to use the basic extension.

1. Download this project: select **Code** → **Download ZIP** on GitHub.
2. Unzip the download. Keep the extracted `job-application-assistant` folder somewhere you will not delete or move.
3. In Chrome, open `chrome://extensions`; in Edge, open `edge://extensions`.
4. Turn on **Developer mode**.
5. Click **Load unpacked**, then select the extracted `job-application-assistant` folder — the folder that contains `manifest.json`.
6. Pin **Job Application Assistant** from the browser’s Extensions menu, open it, and choose **Open Profile** to add your approved information.

That’s it. The extension will appear in the browser toolbar. If the browser reports a problem, make sure you selected the extracted folder itself, not the ZIP file or its parent folder.

> **Important:** Chrome and Edge cannot load an extension directly from a ZIP file. Unzip it first, and keep the selected folder in place while you use the extension.

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

## Optional: resume PDF/DOCX extraction

The extension works without any local service. Only install the optional service if you want it to extract details from PDF or DOCX resumes.

1. Open a terminal in the extracted project folder.
2. Install and start the local parser:

   ```bash
   python3 -m pip install -r requirements.txt
   python3 local_service.py
   ```

3. In **Profile**, upload your resume, click **Extract details**, review the proposal, and click **Approve proposal into profile**.

## First-use checklist

1. In **Profile**, add only facts and answers you have approved.
2. Review discovered questions and add approved answers where appropriate.
3. Complete the responsibility acknowledgment by checking the box and typing your name.
4. On a job application page, open the extension, select **Scan current page**, review the suggestions, then select **Fill selected fields**.

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
