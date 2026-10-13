"""Tests for the local agent: guardrails, validation, and request guards.

No network: the Claude call is replaced with a fake transport.
"""

import os
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import agent  # noqa: E402
import local_service  # noqa: E402


def fake_transport(tool_input):
    calls = []

    def send(body, key):
        calls.append(body)
        return {"content": [{"type": "tool_use", "name": body["tools"][0]["name"], "input": tool_input}]}

    send.calls = calls
    return send


class AgentTests(unittest.TestCase):
    def setUp(self):
        self._key = os.environ.get("ANTHROPIC_API_KEY")
        os.environ["ANTHROPIC_API_KEY"] = "test-placeholder"

    def tearDown(self):
        if self._key is None:
            os.environ.pop("ANTHROPIC_API_KEY", None)
        else:
            os.environ["ANTHROPIC_API_KEY"] = self._key

    def test_sensitive_terms(self):
        for prompt in ["Do you require visa sponsorship?", "Expected salary", "What is your age?", "I certify the above is true", "Race / ethnicity"]:
            self.assertTrue(agent.is_sensitive(prompt), prompt)
        for prompt in ["How do you manage incidents?", "Describe your Terraform experience", "Image registry used"]:
            self.assertFalse(agent.is_sensitive(prompt), prompt)

    def test_sensitive_questions_are_never_sent_or_answered(self):
        send = fake_transport({"answers": [{"id": "q2", "answer": "Six years", "confidence": 0.9, "source": "resume", "reasoning": "r", "needs_human": False}]})
        result = agent.answer_questions({
            "questions": [
                {"id": "q1", "prompt": "Will you require sponsorship?", "choices": ["Yes", "No"]},
                {"id": "q2", "prompt": "Years of Kubernetes experience", "kind": "text"},
            ],
            "profile": {"identity": {"fullName": "Jordan"}, "workAuthorization": {"sponsorship": "No"}, "preferences": {"salary": "1", "relocate": "Yes"}},
        }, transport=send)
        sent = send.calls[0]["messages"][0]["content"]
        self.assertNotIn("sponsorship?", sent)
        self.assertNotIn("workAuthorization", sent, "sensitive profile sections are not shared")
        self.assertNotIn('"salary"', sent)
        answers = {a["id"]: a for a in result["answers"]}
        self.assertTrue(answers["q1"]["needsHuman"])
        self.assertEqual(answers["q1"]["answer"], "")
        self.assertEqual(answers["q2"]["answer"], "Six years")
        self.assertEqual(send.calls[0]["tool_choice"], {"type": "tool", "name": "submit_answers"})

    def test_choice_answers_must_match_and_lengths_are_enforced(self):
        send = fake_transport({"answers": [
            {"id": "a", "answer": "yes", "confidence": 0.9, "source": "", "reasoning": "", "needs_human": False},
            {"id": "b", "answer": "Probably", "confidence": 0.9, "source": "", "reasoning": "", "needs_human": False},
            {"id": "c", "answer": "word " * 100, "confidence": 2, "source": "", "reasoning": "", "needs_human": False},
        ]})
        result = agent.answer_questions({"questions": [
            {"id": "a", "prompt": "Have you used GCP?", "choices": ["Yes", "No"]},
            {"id": "b", "prompt": "Have you used Azure?", "choices": ["Yes", "No"]},
            {"id": "c", "prompt": "Short summary", "maxLength": 40},
        ]}, transport=send)
        answers = {a["id"]: a for a in result["answers"]}
        self.assertEqual(answers["a"]["answer"], "Yes")
        self.assertEqual(answers["b"]["answer"], "")
        self.assertTrue(answers["b"]["needsHuman"])
        self.assertLessEqual(len(answers["c"]["answer"]), 40)
        self.assertEqual(answers["c"]["confidence"], 1.0)

    def test_missing_decision_becomes_needs_human(self):
        send = fake_transport({"answers": []})
        result = agent.answer_questions({"questions": [{"id": "x", "prompt": "Favorite deployment tool"}]}, transport=send)
        self.assertTrue(result["answers"][0]["needsHuman"])

    def test_analysis_clamps_score_and_requires_text(self):
        with self.assertRaises(agent.AgentError):
            agent.analyze_job({"job": {"text": "too short"}})
        send = fake_transport({"company": "Acme", "role": "SRE", "summary": "s", "fit_score": 140, "recommendation": "apply",
                               "decision_reasoning": "r", "requirements": [], "strengths": [], "gaps": [], "red_flags": [],
                               "ats_keywords": [], "talking_points": []})
        result = agent.analyze_job({"job": {"text": "Platform engineer " * 20}}, transport=send)
        self.assertEqual(result["fit_score"], 100)
        self.assertIn("<job_posting>", send.calls[0]["messages"][0]["content"])

    def test_materials_only_requested_kinds(self):
        send = fake_transport({"outreach_message": "Hi", "tailoring_notes": [], "honesty_flags": ["No Rust"]})
        result = agent.generate_materials({"kinds": ["outreach"], "job": {"text": "Platform engineer " * 20}}, transport=send)
        schema = send.calls[0]["tools"][0]["input_schema"]["properties"]
        self.assertIn("outreach_message", schema)
        self.assertNotIn("resume_markdown", schema)
        self.assertEqual(result["outreach"], "Hi")
        self.assertNotIn("resume", result)
        self.assertEqual(result["honestyFlags"], ["No Rust"])

    def test_resume_generation_needs_master_resume(self):
        with self.assertRaises(agent.AgentError):
            agent.generate_materials({"kinds": ["resume"], "job": {"text": "Platform engineer " * 20}, "resumeText": "short"})

    def test_missing_key_is_a_clear_error(self):
        os.environ.pop("ANTHROPIC_API_KEY", None)
        with self.assertRaises(agent.AgentError) as ctx:
            agent.call_tool("x", agent.ANSWER_TOOL)
        self.assertEqual(ctx.exception.status, 503)
        self.assertFalse(agent.status()["configured"])

    def test_retries_transient_errors(self):
        attempts = []

        def flaky(body, key):
            attempts.append(1)
            if len(attempts) < 2:
                raise agent.AgentError("busy", status=529)
            return {"content": [{"type": "tool_use", "name": "submit_answers", "input": {"answers": []}}]}

        original = agent.time.sleep
        agent.time.sleep = lambda _s: None
        try:
            self.assertEqual(agent.call_tool("x", agent.ANSWER_TOOL, transport=flaky), {"answers": []})
        finally:
            agent.time.sleep = original
        self.assertEqual(len(attempts), 2)


class RequestGuardTests(unittest.TestCase):
    def test_extension_and_local_tools_allowed(self):
        self.assertTrue(local_service.request_allowed({"Host": "127.0.0.1:8765", "Origin": "chrome-extension://abc"})[0])
        self.assertTrue(local_service.request_allowed({"Host": "localhost:8765"})[0])

    def test_web_pages_and_rebinding_blocked(self):
        self.assertFalse(local_service.request_allowed({"Host": "127.0.0.1:8765", "Origin": "https://evil.example"})[0])
        self.assertFalse(local_service.request_allowed({"Host": "evil.example:8765", "Origin": "chrome-extension://abc"})[0])

    def test_pinned_extension_id(self):
        os.environ["APPLYPILOT_EXTENSION_ID"] = "goodid"
        try:
            self.assertFalse(local_service.request_allowed({"Host": "127.0.0.1", "Origin": "chrome-extension://otherid"})[0])
            self.assertTrue(local_service.request_allowed({"Host": "127.0.0.1", "Origin": "chrome-extension://goodid"})[0])
        finally:
            os.environ.pop("APPLYPILOT_EXTENSION_ID")


if __name__ == "__main__":
    unittest.main()
