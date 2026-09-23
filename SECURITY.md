# Security and privacy

Please do not report security issues in a public issue. Use a private GitHub Security Advisory for this repository when available.

## Privacy boundaries

- Do not commit resumes, profile JSON files, question-bank exports, application screenshots, browser storage, cookies, tokens, or employer-confidential data.
- The extension stores approved profile data and question answers in browser-local extension storage.
- PDF/DOCX extraction uses the optional local parser at `127.0.0.1`; it does not persist uploaded files.
- The public repository contains only synthetic fixtures and generic examples.
- Browser-local extension storage is not encrypted; never place passwords, SSNs, passport numbers, bank details, authentication codes, or similar secrets in the profile or question bank.
- The extension does not submit applications, bypass CAPTCHA, or make eligibility decisions.

Before opening a pull request, run:

```bash
npm test
npm run public-scan
```
