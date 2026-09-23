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

## Release checks

```bash
npm test
npm run public-scan
python3 -m py_compile local_service.py
```
