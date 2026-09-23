#!/usr/bin/env python3
"""Local resume extraction helper for PDF/DOCX files.

The browser extension sends the selected file to 127.0.0.1 only. This service
does not contact a remote AI provider or persist uploaded files.
"""

import base64
import io
import json
import re
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import PurePosixPath

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

    def do_GET(self):
        if self.path != "/health":
            self._headers(404)
            self.wfile.write(json.dumps({"error": "Not found"}).encode())
            return
        self._headers()
        self.wfile.write(json.dumps({"status": "ok", "version": "1"}).encode())

    def do_OPTIONS(self):
        self._headers()

    def do_POST(self):
        if self.path != "/extract":
            self._headers(404)
            self.wfile.write(json.dumps({"error": "Not found"}).encode())
            return
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
            self._headers()
            self.wfile.write(json.dumps(result).encode())
        except Exception as exc:
            self._headers(400)
            self.wfile.write(json.dumps({"error": str(exc)}).encode())

    def log_message(self, *_args):
        return


if __name__ == "__main__":
    print("Local resume parser listening on http://127.0.0.1:8765")
    HTTPServer(("127.0.0.1", 8765), Handler).serve_forever()
