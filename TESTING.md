# ApplyPilot testing checklist

Use a synthetic profile and a test page. Do not test with a real SSN,
passport number, password, bank detail, or employer-confidential application.

## Core flow

1. Install the unpacked extension and confirm the Profile page opens on first install.
2. Upload a TXT or Markdown resume, review the proposed details, and approve them.
3. Sign the installer responsibility acknowledgment.
4. Open a test form and click the extension. Confirm visible fields are scanned.
5. Confirm approved name/contact/location/link fields can fill automatically.
6. Confirm submit buttons, CAPTCHA controls, password fields, and file inputs are never filled.
7. Confirm unknown questions are stored locally with their choices and can be answered later.
8. Confirm saved sensitive answers remain marked for manual review.
9. Clear the acknowledgment and confirm scanning/filling stops.

## International field cases

Test synthetic labels and autocomplete values such as:

- `Prénom`, `Vorname`, `Nombre`, `Nome` with `given-name`
- `Nom de famille`, `Nachname`, `Apellido`, `Sobrenome` with `family-name`
- `Courriel`, `Correo electrónico`, `E-Mail` with `email`
- `Téléphone`, `Telefon`, `Teléfono`, `Telefone` with `tel`
- `Ville`, `Stadt`, `Ciudad`, `Cidade` with `address-level2`
- `Code postal`, `Postleitzahl`, `Código postal` with `postal-code`
- `Pays`, `Land`, `País`, `Paese` with `country-name`

Verify that “country of citizenship” is classified as a sensitive manual
question rather than as a mailing country.

## Dynamic-page cases

After scanning, change the page by adding or removing a field, then fill. The
extension should use the field locator when possible and skip unavailable or
ambiguous controls rather than filling the wrong field.

## Parser cases

- Use **Check local parser** before trying PDF/DOCX extraction.
- Confirm the parser accepts only localhost/127.0.0.1/::1 URLs.
- Confirm files larger than 20 MB are rejected.
- Confirm `/health` returns a local healthy response and no uploaded file is persisted.

## AI agent cases

Run the local service with a test API key (or the fake transport used in
`test/test_agent_service.py`) and a synthetic profile and resume.

1. **Check AI agent** in Profile reports the model. Without a key it explains how to set one.
2. On a test form, **Draft answers** returns blue Claude cards with confidence and source. Nothing fills until **Fill selected** is confirmed.
3. Questions about sponsorship, work authorization, salary, demographics, and consent checkboxes never receive a draft, and the service log shows they were never sent.
4. A styled radio group (hidden native inputs, visible labels) is drafted as one question and the matching option is checked on fill.
5. A posting containing "ignore previous instructions" text does not change the answers.
6. **Analyze fit** logs the job in the Workspace with a score; opening the separate `/apply` page for the same posting reuses that record.
7. **Mark applied** sets the status and date; Workspace CSV export opens cleanly in a spreadsheet (no formula execution).
8. Workspace **Generate all three** produces a resume, cover letter, and outreach message, plus "What Claude changed" and "Not claimed" lists.
9. A form embedded in a cross-origin frame fills after **Allow embedded application forms** is granted.

## Release checks

```bash
npm test
npm run public-scan
python3 -m py_compile local_service.py agent.py
```
