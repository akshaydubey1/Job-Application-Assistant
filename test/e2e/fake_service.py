"""Local service with a fake Claude transport, for end-to-end tests only."""
import json, os, re, sys, threading
sys.path.insert(0, sys.argv[1])
os.environ["ANTHROPIC_API_KEY"] = "fake-for-e2e"
os.environ["APPLYPILOT_PORT"] = sys.argv[2]
import agent, local_service
LOG = []
def fake(body, key):
    content = body["messages"][0]["content"]
    LOG.append(content)
    name = body["tools"][0]["name"]
    if name == "submit_answers":
        qs = [json.loads(m) for m in re.findall(r"<question>(.*?)</question>", content)]
        out = []
        for q in qs:
            p = q["prompt"].lower()
            if "incident" in p: a = ("Our GKE ingress controllers ran out of memory during a traffic spike. I led the response, rolled back, and added HPA limits and load tests to CI.", 0.86)
            elif "kubernetes" in p: a = ("Yes", 0.93)
            elif "terraform" in p: a = ("3-5", 0.82)
            elif "hear" in p: a = ("Company careers page", 0.55)
            else: a = ("", 0)
            out.append({"id": q["id"], "answer": a[0], "confidence": a[1], "source": "resume", "reasoning": "From the resume" if a[0] else "Not in materials", "needs_human": not a[0]})
        return {"content": [{"type": "tool_use", "name": name, "input": {"answers": out}}]}
    if name == "submit_job_analysis":
        return {"content": [{"type": "tool_use", "name": name, "input": {"company": "Acme Cloud", "role": "Senior Platform Engineer", "location": "Dallas, TX", "work_model": "hybrid", "seniority": "Senior", "employment_type": "full-time",
          "summary": "Own the GKE-based platform.", "fit_score": 86, "recommendation": "strong apply", "decision_reasoning": "Deep GKE and Terraform match; Go is the main gap.",
          "requirements": [{"requirement": "5+ years Kubernetes", "importance": "must", "met": "yes", "evidence": "GKE platform work 2019-present"}, {"requirement": "Go", "importance": "nice", "met": "partial", "evidence": "Scripting only"}],
          "strengths": ["GKE at scale"], "gaps": [{"gap": "Go", "mitigation": "Mention Go tooling side project"}], "red_flags": ["Check hybrid days in Dallas"], "ats_keywords": ["GKE", "Terraform", "Argo CD"], "talking_points": ["Cluster migration"]}}]}
    T = lambda data: {"content": [{"type": "tool_use", "name": name, "input": data}]}
    if name == "submit_ats_review":
        return T({"score": 74, "summary": "Strong GKE match; add Istio context and quantify incident work.", "missing_keywords": [{"keyword": "Istio", "importance": "important", "truthful": False, "where_to_add": "Only after hands-on use"}, {"keyword": "incident response", "importance": "critical", "truthful": True, "where_to_add": "On-call bullet at Example Corp"}],
          "bullet_rewrites": [{"original": "Responsible for on-call rotation", "improved": "Led a 6-person on-call rotation and cut pages 40% with SLO-based alerting", "why": "Shows ownership and outcome"}], "summary_rewrite": "Platform engineer who runs production GKE for 40 services.", "formatting_issues": ["Dates lack months"]})
    if name == "submit_writing":
        return T({"variants": [{"label": "Option 1", "text": "Migrated 40 services from VMs to GKE, cutting deploy time from 45 to 8 minutes."}, {"label": "Option 2", "text": "Built Argo CD GitOps pipelines used by 12 teams."}], "notes": "Check the numbers."})
    if name == "submit_linkedin_review":
        return T({"score": 68, "summary": "Headline is generic; About lacks outcomes.", "checklist": [{"item": "Headline", "status": "improve", "tip": "Lead with Platform/SRE and GKE"}, {"item": "Custom URL", "status": "pass", "tip": ""}],
          "headline_options": ["Senior Platform Engineer | GKE, Terraform, GitOps | Reliability at scale"], "about_rewrite": "I build platforms teams trust.", "skills_to_add": ["Argo CD"], "experience_suggestions": [{"role": "Example Corp", "suggestion": "Add uptime numbers"}], "target_keywords": ["Platform Engineering", "SRE"]})
    if name == "submit_interview_plan":
        return T({"questions": [{"question": "Tell me about a production incident you led.", "type": "behavioral", "why_they_ask": "On-call leadership", "what_good_looks_like": "STAR with measurable result", "story_hint": "GKE ingress outage"},
          {"question": "How would you design multi-cluster GitOps?", "type": "system design", "why_they_ask": "Core of the role", "what_good_looks_like": "Tradeoffs", "story_hint": "Argo CD work"}],
          "prep_brief": {"likely_focus": ["GKE operations"], "stories_to_prepare": ["Ingress outage"], "questions_to_ask_them": ["How is on-call staffed?"], "risks_to_address": ["Limited Go"]}})
    if name == "submit_answer_feedback":
        return T({"score": 7, "verdict": "Solid story, result needs a number.", "strengths": ["Clear ownership"], "improvements": ["Quantify the impact"], "star": {"situation": True, "task": True, "action": True, "result": False}, "delivery": "Good length.", "improved_answer": "During a traffic spike our GKE ingress...", "follow_up_question": "What would you do differently?"})
    if name == "submit_skill_plan":
        return T({"summary": "Go is the recurring gap.", "gaps": [{"skill": "Go", "priority": "high", "seen_in": 1, "current_evidence": "Python tooling", "plan": ["Write a small Kubernetes operator in Go"], "time_estimate": "3 weeks", "how_to_position_now": "Mention Go reading of controller code"}], "quick_wins": ["Add Argo CD to LinkedIn skills"]})
    props = body["tools"][0]["input_schema"]["properties"]
    data = {"tailoring_notes": ["Led with GKE"], "honesty_flags": ["Service mesh not claimed"]}
    if "resume_markdown" in props: data["resume_markdown"] = "# Jordan Example\n\n## Summary\nPlatform engineer focused on GKE."
    if "cover_letter" in props: data["cover_letter"] = "Dear Hiring Manager, ..."
    if "outreach_message" in props: data["outreach_message"] = "Hi, I saw Acme is scaling its GKE platform..."
    return {"content": [{"type": "tool_use", "name": name, "input": data}]}
orig = agent.call_tool
agent.call_tool = lambda c, t, max_tokens=4096, transport=None: orig(c, t, max_tokens, transport=fake)
import functools
for route, fn in list(local_service.AGENT_ROUTES.items()):
    local_service.AGENT_ROUTES[route] = functools.partial(fn, transport=fake)
class H(local_service.Handler):
    def do_GET(self):
        if self.path == "/__log":
            self._json(200, {"log": LOG}); return
        super().do_GET()
from http.server import ThreadingHTTPServer
print("fake service up", flush=True)
ThreadingHTTPServer(("127.0.0.1", int(sys.argv[2])), H).serve_forever()
