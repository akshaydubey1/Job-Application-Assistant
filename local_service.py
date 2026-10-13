#!/usr/bin/env python3
"""ApplyPilot local service: resume extraction plus the Claude decision engine.

The browser extension talks to 127.0.0.1 only. Resume extraction runs fully
locally and never persists uploaded files. The optional AI agent (agent.py)
calls the Anthropic API with the key from ANTHROPIC_API_KEY, so the key never
lives in the browser; it is disabled when no key is set.
"""

import base64
import io
import json
import os
import re
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import PurePosixPath

import agent

MAX_UPLOAD_BYTES = 20 * 1024 * 1024


EMAIL = re.compile(r"\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b", re.I)
PHONE = re.compile(r"(?<!\d)(?:\+|00)?\d[\d\s().-]{6,}\d(?!\d)")
LINKEDIN = re.compile(r"https?://(?:www\.)?linkedin\.com/[^\s)]+", re.I)
GITHUB = re.compile(r"https?://(?:www\.)?github\.com/[^\s)]+", re.I)
LOCATION = re.compile(r"\b([A-Za-z .'-]+),\s*([A-Z]{2})(?:\s+(\d{5}(?:-\d{4})?))?\b")
LABELED_COUNTRY = re.compile(r"(?:country|país|pays|land|paese)\s*:\s*([^\n,|]+)", re.I)


def clean(value):
    return re.sub(r"\s+", " ", (value or "").replace("•", " ")).strip()


def first_phone(text):
    for candidate in PHONE.findall(text):
        digits = re.sub(r"\D", "", candidate)
        if 7 <= len(digits) <= 15 and not re.fullmatch(r"(?:\d{4}\s*[-–/.]\s*\d{1,2}\s*[-–/.]\s*\d{1,2}|\d{1,2}\s*[-–/.]\s*\d{1,2}\s*[-–/.]\s*\d{2,4})", candidate.strip()):
            return candidate
    return ""


def fact(path, value, source, confidence):
    return {
        "path": path,
        "value": clean(value),
        "source": clean(source)[:300],
        "confidence": confidence,
        "status": "proposed",
    }


def extract_profile(text):
    lines = [clean(line) for line in text.splitlines() if clean(line)]
    facts = []
    name = next(
        (
            line
            for line in lines
            if 2 <= len(line.split()) <= 6
            and len(line) <= 80
            and re.fullmatch(r"[^\W\d_][\w .'-]+", line, re.UNICODE)
            and not re.search(r"resume|curriculum|vitae|profile|summary|experience|education|skills", line, re.I)
        ),
        "",
    )
    if name:
        parts = name.split()
        facts.append(fact("identity.fullName", name, name, 0.76))
        if len(parts) >= 2:
            facts.append(fact("identity.firstName", parts[0], name, 0.72))
            facts.append(fact("identity.lastName", parts[-1], name, 0.72))

    for match, path, confidence in [
        (EMAIL.search(text), "contact.email", 0.99),
        (LINKEDIN.search(text), "links.linkedin", 0.98),
        (GITHUB.search(text), "links.github", 0.98),
    ]:
        if match:
            facts.append(fact(path, match.group(0).rstrip(".,;"), match.group(0), confidence))

    phone = first_phone(text)
    if phone:
        facts.append(fact("contact.phone", phone, phone, 0.99))

    location = LOCATION.search(text)
    if location:
        facts.append(fact("location.city", location.group(1), location.group(0), 0.74))
        facts.append(fact("location.state", location.group(2), location.group(0), 0.92))
        if location.group(3):
            facts.append(fact("location.zip", location.group(3), location.group(0), 0.96))
    country = LABELED_COUNTRY.search(text)
    if country:
        facts.append(fact("location.country", country.group(1), country.group(1), 0.86))

    degree = re.search(r"\b((?:master|bachelor|doctor(?:ate)?|associate)[^\n,;|]{0,80})", text, re.I)
    if degree:
        facts.append(fact("education.degree", degree.group(1), degree.group(1), 0.78))

    education_index = next((i for i, line in enumerate(lines) if re.match(r"^(education|academic background)\b", line, re.I)), None)
    if education_index is not None and education_index + 1 < len(lines):
        facts.append(fact("education.school", lines[education_index + 1], lines[education_index + 1], 0.66))

    skills_index = next((i for i, line in enumerate(lines) if re.match(r"^(skills|technical skills|core technologies|technologies)\b", line, re.I)), None)
    if skills_index is not None and skills_index + 1 < len(lines):
        facts.append(fact("resume.skills", lines[skills_index + 1], lines[skills_index + 1], 0.62))

    experience_index = next((i for i, line in enumerate(lines) if re.match(r"^(professional )?(experience|work history)\b", line, re.I)), None)
    if experience_index is not None:
        block = [line for line in lines[experience_index + 1:experience_index + 7] if not re.search(r"\b(?:19|20)\d{2}\b|present|current", line, re.I)]
        if block:
            facts.append(fact("experience.currentTitle", block[0], block[0], 0.5))
        if len(block) > 1:
            facts.append(fact("experience.currentEmployer", block[1], block[1], 0.5))
    years = re.search(r"\b(\d{1,2}\+?)\s+years?\s+(?:of\s+)?(?:professional\s+)?experience\b", text, re.I)
    if years:
        facts.append(fact("experience.years", years.group(1), years.group(0), 0.82))

    profile = {"identity": {}, "contact": {}, "location": {}, "links": {}, "education": {}, "experience": {}, "resume": {}}
    for item in facts:
        target = profile
        keys = item["path"].split(".")
        for key in keys[:-1]:
            target = target.setdefault(key, {})
        target[keys[-1]] = item["value"]
    profile["metadata"] = {"source": "resume-extraction-proposal", "lastReviewed": ""}
    return {
        "text": text,
        "profile": profile,
        "facts": facts,
        "warnings": [
            "Resume extraction proposes facts only; review every value before saving.",
            "Work authorization, sponsorship, salary, relocation, demographic, and eligibility answers are intentionally not inferred from a resume.",
        ],
    }


def extract_file(filename, data):
    suffix = PurePosixPath(filename).suffix.lower()
    if suffix in {".txt", ".md"}:
        return extract_profile(data.decode("utf-8", errors="replace"))
    if suffix == ".docx":
        try:
            from zipfile import ZipFile
            from xml.etree import ElementTree

            with ZipFile(io.BytesIO(data)) as archive:
                xml = archive.read("word/document.xml")
            root = ElementTree.fromstring(xml)
            text = "\n".join(node.text or "" for node in root.iter() if node.tag.endswith("}t"))
            return extract_profile(text)
        except Exception as exc:
            raise RuntimeError(f"DOCX extraction failed: {exc}") from exc
    if suffix == ".pdf":
        try:
            from pypdf import PdfReader
        except ImportError as exc:
            raise RuntimeError("PDF support requires pypdf. Run: python3 -m pip install -r requirements.txt") from exc
        reader = PdfReader(io.BytesIO(data))
        text = "\n".join(page.extract_text() or "" for page in reader.pages)
        return extract_profile(text)
    raise RuntimeError("Supported resume formats are PDF, DOCX, TXT, and MD.")


ALLOWED_HOSTS = {"127.0.0.1", "localhost", "[::1]", "::1"}
MAX_AGENT_BYTES = 2 * 1024 * 1024
AGENT_ROUTES = {
    "/agent/answer": agent.answer_questions,
    "/agent/analyze-job": agent.analyze_job,
    "/agent/materials": agent.generate_materials,
    "/agent/ats-review": agent.ats_review,
    "/agent/write": agent.write,
    "/agent/linkedin-review": agent.linkedin_review,
    "/agent/interview-questions": agent.interview_questions,
    "/agent/interview-evaluate": agent.interview_evaluate,
    "/agent/skill-gaps": agent.skill_gaps,
}


def request_allowed(headers):
    """Block web pages and DNS-rebinding attempts; allow the extension and local tools."""
    host = (headers.get("Host") or "").strip().lower()
    hostname = host.rsplit(":", 1)[0] if not host.startswith("[") else host.split("]")[0] + "]"
    if hostname not in ALLOWED_HOSTS:
        return False, "Requests must target 127.0.0.1 or localhost."
    origin = (headers.get("Origin") or "").strip()
    if origin and not origin.startswith("chrome-extension://"):
        return False, "Only the ApplyPilot extension may call this service."
    pinned = os.environ.get("APPLYPILOT_EXTENSION_ID", "").strip()
    if pinned and origin and origin != f"chrome-extension://{pinned}":
        return False, "This service is pinned to a different extension ID."
    return True, ""


class Handler(BaseHTTPRequestHandler):
    def _headers(self, status=200):
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        origin = self.headers.get("Origin", "")
        if origin.startswith("chrome-extension://"):
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.end_headers()

    def _json(self, status, payload):
        self._headers(status)
        self.wfile.write(json.dumps(payload).encode())

    def do_GET(self):
        if self.path == "/health":
            self._json(200, {"status": "ok", "version": "2", "agent": agent.status()})
            return
        if self.path == "/agent/status":
            self._json(200, agent.status())
            return
        self._json(404, {"error": "Not found"})

    def do_OPTIONS(self):
        self._headers()

    def do_POST(self):
        allowed, reason = request_allowed(self.headers)
        if not allowed:
            self._json(403, {"error": reason})
            return
        if self.path == "/extract":
            self._extract()
            return
        handler = AGENT_ROUTES.get(self.path)
        if handler is None:
            self._json(404, {"error": "Not found"})
            return
        if "application/json" not in (self.headers.get("Content-Type") or ""):
            self._json(415, {"error": "Content-Type must be application/json."})
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if length <= 0 or length > MAX_AGENT_BYTES:
                raise agent.AgentError("Request body is empty or larger than 2 MB.")
            payload = json.loads(self.rfile.read(length))
            if not isinstance(payload, dict):
                raise agent.AgentError("Request body must be a JSON object.")
            self._json(200, handler(payload))
        except agent.AgentError as exc:
            self._json(exc.status if 400 <= exc.status < 600 else 400, {"error": str(exc)})
        except json.JSONDecodeError:
            self._json(400, {"error": "Request body is not valid JSON."})
        except Exception as exc:  # pragma: no cover - defensive
            self._json(500, {"error": f"Agent failure: {exc}"})

    def _extract(self):
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if length < 0 or length > MAX_UPLOAD_BYTES * 2:
                raise RuntimeError("Resume files must be 20 MB or smaller.")
            payload = json.loads(self.rfile.read(length))
            filename = payload["filename"]
            data = base64.b64decode(payload["data_base64"], validate=True)
            if len(data) > MAX_UPLOAD_BYTES:
                raise RuntimeError("Resume files must be 20 MB or smaller.")
            result = extract_file(filename, data)
            self._json(200, result)
        except Exception as exc:
            self._json(400, {"error": str(exc)})

    def log_message(self, *_args):
        return


def main():
    agent.load_env_file()
    port = int(os.environ.get("APPLYPILOT_PORT", "8765"))
    state = agent.status()
    print(f"ApplyPilot local service listening on http://127.0.0.1:{port}")
    if state["configured"]:
        print(f"AI agent: enabled (model {state['model']})")
    else:
        print("AI agent: disabled. Set ANTHROPIC_API_KEY (shell or .env next to this file) and restart to enable it.")
    ThreadingHTTPServer(("127.0.0.1", port), Handler).serve_forever()


if __name__ == "__main__":
    main()
