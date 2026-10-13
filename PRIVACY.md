# Privacy Policy — ApplyPilot

**Last updated:** October 13, 2026

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
- A master resume text and optional agent notes that the user enters for the
  optional AI agent.
- An application tracker: company, role, posting URL, job-description text,
  status, dates, fit analysis, tailored materials, and the user's notes.

Sensitive information, including work authorization, sponsorship, salary,
demographic information, disability, veteran status, and similar eligibility
responses, is not inferred or silently completed. The user must review and
approve those values.

## Where information is stored

Approved profile data, question-bank entries, parser settings, and
acknowledgment data are stored in the browser's local extension storage. The
extension does not send this information to a developer-operated cloud
service, advertising network, analytics provider, or data broker. Browser
local storage is not encrypted; users must not store passwords, SSNs,
passports, bank details, authentication codes, or other secrets in ApplyPilot.

If the user chooses PDF or DOCX resume extraction and runs the optional local
parser, the selected file is sent only to the local service on the user's own
computer at `127.0.0.1` or `localhost`. The local parser is not a hosted
service and does not transmit the file to the developer.

## Page access and form filling

The extension reads the visible form controls on the current page when the
user opens the extension with automatic assistance enabled or chooses a manual
scan. Chrome's `activeTab` model limits this access to the current tab after
the user invokes the extension; the extension does not passively inspect every
tab. It stores unfamiliar question prompts, visible choices, and limited
metadata locally so the user can add an approved answer later. It does not
save a screen capture, body text, or the entire page.

With automatic assistance enabled, only approved, non-high-risk profile
values are filled automatically. Sponsorship, work authorization, salary,
relocation, demographic, government-identification, and other sensitive
question-bank answers remain manual. Field matching for profile values uses local
rules and does not use an AI service. The extension does not submit applications, bypass
CAPTCHA, automate file uploads, or make employment-eligibility decisions.

## Optional AI agent

The AI agent is off unless the user runs the local service with their own
Anthropic API key (`ANTHROPIC_API_KEY`). The key stays in that local process
and is never stored in the browser. When the user chooses an AI action
(Analyze fit, Draft answers, or generating tailored materials), the extension
sends the minimum context for that action to the local service, which forwards
it to the Anthropic API under the user's own account:

- Analyze fit and materials: the job-description text, the approved profile,
  the master resume text, the agent notes, and non-sensitive approved answers.
- Draft answers: the same candidate context plus the prompts and visible
  choices of the remaining application questions on the page.

Work authorization, sponsorship, and salary values are removed from the profile
before it is sent. Questions about work authorization, sponsorship, citizenship,
salary, demographics, disability, veteran status, criminal history, government
identification, date of birth, and legal consents are never sent for drafting
and never receive an AI answer. Drafts are shown for review and only fill a page
after the user selects them and confirms. Anthropic's handling of API data is
governed by the user's agreement with Anthropic. The developer receives none of
this data.

## Sharing and selling

The developer does not sell, rent, or share extension profile data. Users are
responsible for reviewing information before submitting an application and for
protecting their own device, resume, browser profile, and exported files.

## Data deletion

Users can edit or clear the profile, question bank, and acknowledgment from
the extension's Profile page, and delete tracked applications from the
Workspace page. Uninstalling the extension removes its browser
storage according to the browser's extension-data behavior. Local parser files
and exported files are controlled by the user and must be deleted separately
if desired.

## Contact

For privacy questions or vulnerability reports, use the repository's support
page: <https://github.com/akshaydubey1/Job-Application-Assistant/issues>.
Please do not include resumes, passwords, immigration documents, or other
sensitive personal information in a public issue.
