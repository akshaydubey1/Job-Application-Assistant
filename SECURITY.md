# Security and privacy

Please do not report security issues in a public issue. Use a private GitHub Security Advisory for this repository when available.

## Privacy boundaries

- Do not commit resumes, profile JSON files, question-bank exports, application screenshots, browser storage, cookies, tokens, or employer-confidential data.
- The extension stores approved profile data and question answers in browser-local extension storage.
- PDF/DOCX extraction uses the optional local parser at `127.0.0.1`; it does not persist uploaded files.
- The public repository contains only synthetic fixtures and generic examples.
- Browser-local extension storage is not encrypted; never place passwords, SSNs, passport numbers, bank details, authentication codes, or similar secrets in the profile or question bank.
- The extension does not submit applications, bypass CAPTCHA, or make eligibility decisions.
- The Anthropic API key lives only in the local service's environment or a git-ignored `.env` file. Never commit it.
- The local service binds to 127.0.0.1, rejects requests from web-page origins and non-local Host headers, and can be pinned to one extension ID with `APPLYPILOT_EXTENSION_ID`.
- Page text sent to Claude is wrapped as untrusted data, and sensitive-question guards run in both the extension and the service, independent of model output.

Before opening a pull request, run:

```bash
npm test            # JS + Python unit tests
npm run public-scan
```
