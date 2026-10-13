"""End-to-end test: loads the unpacked extension in Chromium, serves a synthetic
application form, and runs the local service with a fake Claude transport.

    pip install playwright && python -m playwright install chromium
    python3 test/e2e/run_e2e.py            # from the repo root

No API key or network access is needed. Screenshots go to test/e2e/shots/.
"""
import json, os, subprocess, sys, time, tempfile, datetime, pathlib, atexit
from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parents[2]
HERE = pathlib.Path(__file__).resolve().parent
EXT = str(ROOT); OUT = str(HERE / "shots"); os.makedirs(OUT, exist_ok=True)
procs = [subprocess.Popen([sys.executable, "-m", "http.server", "8765", "--bind", "127.0.0.1"], cwd=HERE / "site", stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL),
         subprocess.Popen([sys.executable, str(HERE / "fake_service.py"), str(ROOT), "8766"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)]
atexit.register(lambda: [proc.terminate() for proc in procs])
time.sleep(1.5)
FORM = "http://127.0.0.1:8765/apply.html"
RESUME = ("Jordan Example\njordan@example.com | 512-555-0100 | linkedin.com/in/jordan-example\nSummary\nPlatform engineer.\nExperience\nSenior Cloud Engineer, Example Corp, 2019-present\n"
          "- Ran production GKE clusters (k8s) for 40 services at 99.95% uptime\n- Built Terraform modules and ArgoCD GitOps pipelines\n- Responsible for on-call rotation\nSkills\nPython, Terraform\nEducation\nMS Computer Science\n") * 2
errors = []
def check(cond, msg):
    if not cond: raise AssertionError(msg)
    print("  ok:", msg)

with sync_playwright() as p:
    ctx = p.chromium.launch_persistent_context(tempfile.mkdtemp(), headless=True, channel="chromium", args=[f"--disable-extensions-except={EXT}", f"--load-extension={EXT}"], viewport={"width": 1360, "height": 900})
    sw = ctx.service_workers[0] if ctx.service_workers else ctx.wait_for_event("serviceworker")
    ext = sw.url.split("/")[2]
    form = ctx.new_page(); form.goto(FORM)
    sw.evaluate("""(resume) => chrome.storage.local.set({
      profile: { identity: { firstName: "Jordan", lastName: "Example", fullName: "Jordan Example" }, contact: { email: "jordan@example.com" },
                 links: { linkedin: "https://www.linkedin.com/in/jordan-example", github: "https://github.com/jordan-example" }, metadata: { schemaVersion: 2 } },
      responsibilityAck: { acknowledged: true, signature: "Jordan Example", signedAt: new Date().toISOString() },
      automationSettings: { autoAssist: true }, parserSettings: { url: "http://127.0.0.1:8766" },
      resumeText: resume, agentSettings: { autoDraft: false, minConfidence: 0.7 } })""", RESUME)
    tab = sw.evaluate("async (u) => (await chrome.tabs.query({url: u}))[0]", FORM)
    sw.evaluate("(tab) => { chrome.tabs.query = async () => [tab]; }", tab)
    ctx.add_init_script("if (location.protocol === 'chrome-extension:') { const t = %s; chrome.tabs.query = async () => [t]; }" % json.dumps(tab))

    def page(path, w=1360):
        pg = ctx.new_page(); pg.set_viewport_size({"width": w, "height": 900})
        pg.on("dialog", lambda d: d.accept())
        pg.on("pageerror", lambda e: errors.append(f"{path}: {e}"))
        pg.on("console", lambda m: errors.append(f"{path}: {m.text}") if m.type == "error" else None)
        pg.goto(f"chrome-extension://{ext}/{path}")
        return pg
    def status_has(pg, text, sel="#status", t=20):
        end = time.time() + t
        while time.time() < end:
            if text in pg.locator(sel).inner_text(): return
            time.sleep(0.2)
        raise AssertionError(f"'{text}' not in {sel}: {pg.locator(sel).inner_text()}")

    print("POPUP")
    pop = page("popup.html", 430)
    pop.locator("#agentChip:has-text('Claude ready')").wait_for()
    status_has(pop, "filled")
    pop.click("#draftButton"); status_has(pop, "Claude drafted")
    pop.click("#fillButton"); status_has(pop, "Filled")
    pop.click("#saveJobButton"); status_has(pop, "Senior Platform Engineer at Acme Cloud")
    pop.click("#analyzeButton"); status_has(pop, "Fit 86")
    pop.click("#appliedButton"); status_has(pop, "Logged")
    v = form.evaluate("() => ({inc: inc.value, k8s: document.querySelector('[name=k8s][value=yes]').checked, visa: visa.value, privacy: privacy.checked, submitted: !!window.__submitted})")
    check(v["inc"] and v["k8s"] and not v["visa"] and not v["privacy"] and not v["submitted"], "popup fill flow (drafts filled; sensitive/consent untouched; no submit)")
    apps = sw.evaluate("async () => (await chrome.storage.local.get('applications')).applications")
    check(len(apps) == 1 and apps[0]["status"] == "Applied", "Save job + analyze + applied reuse one tracker record")
    app_id = apps[0]["id"]
    pop.close()

    print("WORKSPACE")
    ws = page(f"workspace.html#/apps/{app_id}")
    ws.locator("#agentChip:has-text('Claude ready')").wait_for()
    ws.locator(".fit-score").first.wait_for()
    check("ATS keyword match" in ws.inner_text(".view"), "quick ATS score on application detail")
    today = datetime.date.today().isoformat()
    ws.locator("input[placeholder^='e.g. Follow up']").fill("Email the recruiter")
    ws.locator("input[type=date]").first.fill(today)
    ws.click("text=Save next step")
    ws.click("text=Generate all three")
    ws.locator(".doc-editor").wait_for()
    end = time.time() + 20
    while time.time() < end and "Jordan Example" not in ws.locator(".doc-editor").input_value(): time.sleep(0.2)
    check("Jordan Example" in ws.locator(".doc-editor").input_value(), "tailored materials generated")
    ws.click("text=Save to Documents")
    ws.screenshot(path=f"{OUT}/ws-app.png", full_page=True)

    ws.goto(f"chrome-extension://{ext}/workspace.html#/today"); time.sleep(0.6)
    check("Email the recruiter" in ws.inner_text(".view") and "Due today" in ws.inner_text(".view"), "Today shows the follow-up as due today (local date)")
    check(ws.locator("#dueCount").inner_text() == "1", "sidebar due badge")
    badge = sw.evaluate("async () => chrome.action.getBadgeText({})")
    check(badge == "1", f"toolbar badge shows due count ({badge!r})")
    ws.screenshot(path=f"{OUT}/ws-today.png", full_page=True)

    ws.goto(f"chrome-extension://{ext}/workspace.html#/board"); time.sleep(0.6)
    ws.locator(".kcard").first.drag_to(ws.locator(".column[data-status='Interviewing']"))
    time.sleep(0.6)
    st = sw.evaluate("async () => (await chrome.storage.local.get('applications')).applications[0].status")
    check(st == "Interviewing", "Kanban drag-and-drop moves status")
    ws.screenshot(path=f"{OUT}/ws-board.png", full_page=True)

    ws.goto(f"chrome-extension://{ext}/workspace.html#/studio/ats/{app_id}"); time.sleep(0.6)
    check("Keyword coverage" in ws.inner_text(".view"), "local ATS check auto-runs for the job")
    ws.click("text=Deep review with Claude"); ws.locator("text=Claude's review").wait_for()
    check("Led a 6-person on-call rotation" in ws.inner_text(".view"), "ATS deep review with bullet rewrites")
    ws.screenshot(path=f"{OUT}/ws-ats.png", full_page=True)

    ws.goto(f"chrome-extension://{ext}/workspace.html#/studio/write/bullets"); time.sleep(0.5)
    ws.locator("textarea").fill("moved 40 services from VMs to GKE")
    ws.click("text=Write with Claude"); ws.locator(".variant").first.wait_for()
    ws.locator(".variant button:has-text('Save to Documents')").first.click()
    time.sleep(0.5)
    check(ws.locator(".variant").count() == 2, "writing tool returns variants")

    ws.goto(f"chrome-extension://{ext}/workspace.html#/studio/linkedin"); time.sleep(0.5)
    ws.locator("textarea").fill("Name: Jordan Example\nHeadline: Cloud Engineer\n## about\nI run GKE clusters and Terraform.\n" * 4)
    ws.click("text=Review with Claude"); ws.locator("text=Headline options").wait_for()
    ws.screenshot(path=f"{OUT}/ws-linkedin.png", full_page=True)
    ws.click("text=Convert to resume"); ws.locator("text=Resume from LinkedIn").wait_for()
    ws.locator("button:has-text('Save to Documents')").first.click(); time.sleep(0.4)
    check(True, "LinkedIn review + convert to resume")

    ws.goto(f"chrome-extension://{ext}/workspace.html#/studio/gaps"); time.sleep(0.5)
    ws.click("text=Build a plan with Claude"); ws.locator("text=Quick wins").wait_for()
    check("Write a small Kubernetes operator" in ws.inner_text(".view"), "skill gap plan")

    ws.goto(f"chrome-extension://{ext}/workspace.html#/interview/{app_id}"); time.sleep(0.5)
    ws.click("text=Generate questions"); ws.locator("text=Prep brief").wait_for()
    ws.locator("textarea").first.fill("During a traffic spike our ingress controllers ran out of memory. I led the response and rolled back.")
    ws.locator("button:has-text('Get feedback')").first.click(); ws.locator("text=Likely follow-up").wait_for()
    check("Quantify the impact" in ws.inner_text(".view"), "mock interview feedback with STAR check")
    ws.screenshot(path=f"{OUT}/ws-interview.png", full_page=True)

    ws.goto(f"chrome-extension://{ext}/workspace.html#/contacts/new/{app_id}"); time.sleep(0.5)
    ws.locator("form input").first.fill("Sam Recruiter")
    ws.click("button:has-text('Add contact')"); ws.locator("text=Write a message").wait_for()
    ws.click("text=Draft with Claude"); ws.locator(".variant").first.wait_for()
    ws.goto(f"chrome-extension://{ext}/workspace.html#/contacts"); time.sleep(0.5)
    ws.click("text=Contacted today"); time.sleep(0.5)
    c = sw.evaluate("async () => (await chrome.storage.local.get('contacts')).contacts[0]")
    check(c["stage"] == "Contacted" and c["followUpOn"] and c["company"] == "Acme Cloud", "contact saved, linked to company, follow-up scheduled")
    ws.screenshot(path=f"{OUT}/ws-contacts.png", full_page=True)

    ws.goto(f"chrome-extension://{ext}/workspace.html#/docs"); time.sleep(0.5)
    docs = sw.evaluate("async () => (await chrome.storage.local.get('documents')).documents")
    check(len(docs) == 3, f"documents saved from materials, writer, LinkedIn ({len(docs)})")
    ws.locator(".app-item").nth(1).click(); time.sleep(0.4)
    with ctx.expect_page() as newp:
        ws.click("button:has-text('PDF')")
    pr = newp.value; pr.wait_for_load_state(); time.sleep(0.5)
    check(pr.locator("#page").inner_text().strip() != "" and "<" not in pr.locator("#page").inner_text()[:1], "PDF print view renders the document")
    pr.screenshot(path=f"{OUT}/print.png", full_page=False)
    ws.screenshot(path=f"{OUT}/ws-docs.png", full_page=True)

    ws.goto(f"chrome-extension://{ext}/workspace.html#/insights"); time.sleep(0.6)
    check(ws.locator(".hbar-row").count() >= 4, "insights charts render")
    ws.screenshot(path=f"{OUT}/ws-insights.png", full_page=True)

    real = [e for e in errors if "Failed to load resource" not in e]
    print("CONSOLE ERRORS:", real or "none")
    check(not real, "no console or page errors")
    print("ALL E2E2 ASSERTIONS PASSED")
    ctx.close()
