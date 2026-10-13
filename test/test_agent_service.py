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


class StudioToolTests(unittest.TestCase):
    def setUp(self):
        os.environ["ANTHROPIC_API_KEY"] = "test-placeholder"

    def tearDown(self):
        os.environ.pop("ANTHROPIC_API_KEY", None)

    JOB = {"text": "Platform engineer running Kubernetes and Terraform. " * 10}
    RESUME = "Jordan Example. Senior cloud engineer. Ran GKE clusters, Terraform, Argo CD. " * 10

    def test_ats_review_requires_inputs_and_clamps(self):
        with self.assertRaises(agent.AgentError):
            agent.ats_review({"resumeText": "short", "job": self.JOB})
        send = fake_transport({"score": 150, "summary": "s", "missing_keywords": [], "bullet_rewrites": [], "summary_rewrite": "x", "formatting_issues": []})
        result = agent.ats_review({"resumeText": self.RESUME, "job": self.JOB, "localCheck": {"score": 60}}, transport=send)
        self.assertEqual(result["score"], 100)
        self.assertIn("<local_keyword_check>", send.calls[0]["messages"][0]["content"])

    def test_write_kinds(self):
        with self.assertRaises(agent.AgentError):
            agent.write({"kind": "nonsense"})
        with self.assertRaises(agent.AgentError):
            agent.write({"kind": "bullets", "input": ""})
        send = fake_transport({"variants": [{"label": "A", "text": "Cut deploy time 60%"}, {"label": "B", "text": ""}], "notes": "Verify numbers"})
        result = agent.write({"kind": "bullets", "input": "moved services to GKE"}, transport=send)
        self.assertEqual(len(result["variants"]), 1)
        self.assertEqual(result["title"], "Resume bullets")
        self.assertIn("<input>", send.calls[0]["messages"][0]["content"])
        empty = fake_transport({"variants": [], "notes": ""})
        with self.assertRaises(agent.AgentError):
            agent.write({"kind": "summary"}, transport=empty)

    def test_linkedin_review(self):
        with self.assertRaises(agent.AgentError):
            agent.linkedin_review({"linkedin": "too short"})
        send = fake_transport({"score": -5, "summary": "s", "checklist": [], "headline_options": [], "about_rewrite": "", "skills_to_add": [], "experience_suggestions": [], "target_keywords": []})
        result = agent.linkedin_review({"linkedin": "Headline: Cloud engineer\n" * 20, "targetRole": "SRE"}, transport=send)
        self.assertEqual(result["score"], 0)
        self.assertIn("<linkedin_profile>", send.calls[0]["messages"][0]["content"])

    def test_interview_questions_and_evaluation(self):
        send = fake_transport({"questions": [{"question": "Tell me about an outage", "type": "behavioral", "why_they_ask": "", "what_good_looks_like": "", "story_hint": ""}, {"question": ""}],
                               "prep_brief": {"likely_focus": [], "stories_to_prepare": [], "questions_to_ask_them": [], "risks_to_address": []}})
        result = agent.interview_questions({"job": self.JOB, "count": 50}, transport=send)
        self.assertEqual([q["id"] for q in result["questions"]], ["q1"])
        self.assertIn("Create 15", send.calls[0]["messages"][0]["content"])
        with self.assertRaises(agent.AgentError):
            agent.interview_evaluate({"question": "Q", "answer": "short"})
        ev = fake_transport({"score": 42, "verdict": "v", "strengths": [], "improvements": [], "star": {"situation": True, "task": True, "action": True, "result": False}, "delivery": "", "improved_answer": "", "follow_up_question": ""})
        self.assertEqual(agent.interview_evaluate({"question": "Q", "answer": "I led the incident response and we restored service."}, transport=ev)["score"], 10)

    def test_skill_gaps(self):
        with self.assertRaises(agent.AgentError):
            agent.skill_gaps({"jobs": []})
        send = fake_transport({"summary": "s", "gaps": [], "quick_wins": []})
        agent.skill_gaps({"jobs": [{"role": "SRE", "unmet": ["Go"], "gaps": ["Go"]}]}, transport=send)
        self.assertIn("<target_jobs>", send.calls[0]["messages"][0]["content"])

    def test_all_routes_registered(self):
        for route in ["/agent/ats-review", "/agent/write", "/agent/linkedin-review", "/agent/interview-questions", "/agent/interview-evaluate", "/agent/skill-gaps"]:
            self.assertIn(route, local_service.AGENT_ROUTES)
