# Privacy Policy — ApplyPilot

**Last updated:** September 22, 2026

ApplyPilot is a review-first browser extension that helps a user
map an approved profile to visible job-application fields. It is designed to
keep profile and application-question data on the user's device.

## Information handled

The extension can handle information that the user voluntarily provides or
approves, including:

- Basic resume and profile details such as name, email, phone, location,
  education, skills, LinkedIn, and GitHub.
- Answers that the user chooses to save for recurring application questions.
- The text and labels of visible form fields on the page the user explicitly
  asks the extension to scan.
- The installer responsibility acknowledgment and typed installer name.

Sensitive information, including work authorization, sponsorship, salary,
demographic information, disability, veteran status, and similar eligibility
responses, is not inferred or silently completed. The user must review and
approve those values.

## Where information is stored

Approved profile data, question-bank entries, and acknowledgment data are
stored in the browser's local extension storage. The extension does not send
this information to a developer-operated cloud service, advertising network,
analytics provider, or data broker.

If the user chooses PDF or DOCX resume extraction and runs the optional local
parser, the selected file is sent only to the local service on the user's own
computer at `127.0.0.1` or `localhost`. The local parser is not a hosted
service and does not transmit the file to the developer.

## Page access and form filling

The extension reads the visible form controls on the current page when the
user opens the extension with automatic assistance enabled or chooses a manual
scan. Chrome's `activeTab` model limits this access to the current tab after
the user invokes the extension; the extension does not passively inspect every
tab. It stores unfamiliar question prompts and limited metadata locally so the
user can add an approved answer later. It does not save a screen capture or
the entire page.

With automatic assistance enabled, only approved, non-high-risk profile
values are filled automatically. Sponsorship, work authorization, salary,
relocation, demographic, and other sensitive question-bank answers remain
manual. The extension does not submit applications, bypass CAPTCHA, automate
file uploads, or make employment-eligibility decisions.

## Sharing and selling

The developer does not sell, rent, or share extension profile data. Users are
responsible for reviewing information before submitting an application and for
protecting their own device, resume, browser profile, and exported files.

## Data deletion

Users can edit or clear the profile, question bank, and acknowledgment from
the extension's Profile page. Uninstalling the extension removes its browser
storage according to the browser's extension-data behavior. Local parser files
and exported files are controlled by the user and must be deleted separately
if desired.

## Contact

For privacy questions or vulnerability reports, use the repository's support
page: <https://github.com/akshaydubey1/Job-Application-Assistant/issues>.
Please do not include resumes, passwords, immigration documents, or other
sensitive personal information in a public issue.
