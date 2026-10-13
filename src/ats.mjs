/*
 * Free, local ATS check: keyword coverage of a resume against a job
 * description plus structural checks. No network, no AI. The Claude review
 * builds on top of this for rewrites.
 */

const SKILL_TERMS = [
  // Cloud and infrastructure
  "aws", "amazon web services", "azure", "gcp", "google cloud", "gke", "eks", "aks", "kubernetes", "openshift", "docker", "containerd",
  "helm", "kustomize", "terraform", "terragrunt", "pulumi", "cloudformation", "ansible", "chef", "puppet", "packer", "vagrant",
  "argo cd", "argocd", "flux", "gitops", "jenkins", "github actions", "gitlab ci", "circleci", "tekton", "spinnaker", "ci/cd",
  "istio", "linkerd", "envoy", "service mesh", "nginx", "haproxy", "load balancing", "cdn", "dns", "vpc", "networking", "tcp/ip",
  "linux", "bash", "shell scripting", "powershell", "windows server", "vmware", "serverless", "lambda", "cloud run", "cloud functions",
  "iam", "rbac", "sso", "oauth", "okta", "vault", "secrets management", "kms", "security", "devsecops", "sast", "dast", "soc 2",
  "hipaa", "pci", "compliance", "zero trust", "sre", "site reliability", "slo", "sli", "error budgets", "incident response",
  "on-call", "postmortem", "observability", "monitoring", "logging", "tracing", "prometheus", "grafana", "datadog", "new relic",
  "splunk", "elk", "elasticsearch", "opentelemetry", "pagerduty", "cloudwatch", "stackdriver", "chaos engineering",
  "high availability", "disaster recovery", "scalability", "capacity planning", "cost optimization", "finops", "multi-cloud",
  "hybrid cloud", "migration", "landing zone", "platform engineering", "internal developer platform", "backstage",
  // Data
  "sql", "postgresql", "postgres", "mysql", "sql server", "oracle", "mongodb", "redis", "cassandra", "dynamodb", "bigquery",
  "snowflake", "redshift", "spark", "kafka", "pub/sub", "rabbitmq", "airflow", "dbt", "etl", "data pipelines",
  // Languages and frameworks
  "python", "go", "golang", "java", "javascript", "typescript", "node.js", "react", "angular", "vue", "c#", ".net", "c++", "rust",
  "ruby", "rails", "php", "scala", "kotlin", "swift", "spring boot", "django", "flask", "fastapi", "graphql", "rest", "grpc",
  "microservices", "distributed systems", "event-driven", "api design", "system design",
  // AI/ML
  "machine learning", "mlops", "llm", "generative ai", "pytorch", "tensorflow", "kubeflow", "vertex ai", "sagemaker", "gpu", "tpu",
  // Ways of working
  "agile", "scrum", "kanban", "jira", "confluence", "stakeholder management", "mentoring", "leadership", "cross-functional",
  "technical leadership", "architecture", "solution architecture", "consulting", "client-facing", "communication"
];

const SYNONYMS = {
  "kubernetes": ["k8s"], "gcp": ["google cloud", "google cloud platform"], "google cloud": ["gcp"], "aws": ["amazon web services"],
  "amazon web services": ["aws"], "ci/cd": ["cicd", "ci cd", "continuous integration", "continuous delivery", "continuous deployment"],
  "postgresql": ["postgres"], "postgres": ["postgresql"], "go": ["golang"], "golang": ["go"], "javascript": ["js"],
  "typescript": ["ts"], "argo cd": ["argocd"], "argocd": ["argo cd"], "sre": ["site reliability"], "site reliability": ["sre"],
  "node.js": ["nodejs", "node"], "gke": ["google kubernetes engine"],
  "eks": ["elastic kubernetes service"], "aks": ["azure kubernetes service"], "on-call": ["on call", "oncall"], "slo": ["slos", "service level objectives"]
};

const STOP = new Set(("a an and are as at be been but by can do does for from has have if in into is it its may more most must nice not of on " +
  "or our out over per should so such than that the their them then there these they this those to up us via was we were what when where which " +
  "who will with within without you your years year experience plus strong ability work working team teams including etc preferred required " +
  "requirements responsibilities qualifications about role job company benefits salary equal opportunity employer").split(" "));

export function normalizeText(text = "") {
  return ` ${String(text).toLowerCase().replace(/[‐-―]/g, "-").replace(/[^a-z0-9+#./\- ]+/g, " ").replace(/\s+/g, " ")} `;
}

function contains(haystack, term) {
  const needle = normalizeText(term).trim();
  if (!needle) return false;
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^a-z0-9+#])${escaped}s?($|[^a-z0-9+#])`).test(haystack);
}

function countOf(haystack, term) {
  const needle = normalizeText(term).trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return (haystack.match(new RegExp(`(^|[^a-z0-9+#])${needle}s?(?=$|[^a-z0-9+#])`, "g")) || []).length;
}

/** Proper-noun-ish technical tokens the dictionary does not know (e.g. "Backstage", "Crossplane", "SOX"). */
function extraTerms(jobText) {
  const found = new Map();
  const pattern = /(?<![.!?]\s)(?<!^)\b([A-Z][a-z]*[A-Z0-9][A-Za-z0-9+#.]*|[A-Z]{2,6}[0-9]?)\b/gm;
  // Shouted text ("APPLY NOW", "IGNORE ALL PREVIOUS INSTRUCTIONS") is not a list of skills.
  const calm = String(jobText).replace(/\b[A-Z]{2,}(?:[\s,!.:-]+[A-Z]{2,}){2,}\b/g, (run) => run.toLowerCase());
  for (const match of calm.matchAll(pattern)) {
    let term = match[1].replace(/\.$/, "");
    if (/^[A-Z]{2,}s$/.test(term)) term = term.slice(0, -1); // SLOs -> SLO
    const lower = term.toLowerCase();
    if (term.length < 2 || STOP.has(lower) || /^(US|USA|EEO|EOE|LLC|INC|HR|PTO|CEO|CTO|VP|AM|PM|OK)$/.test(term)) continue;
    found.set(lower, (found.get(lower) || 0) + 1);
  }
  return [...found.entries()].filter(([, count]) => count >= 1).map(([term]) => term);
}

/** Lines under a requirements-style heading, plus any line that states a hard requirement. */
export function requirementLines(jobText = "") {
  const start = /^\W*(requirements?|qualifications?|minimum qualifications|basic qualifications|required|must[- ]haves?|what you('ll)? (need|bring)|you (have|bring|are)|who you are|about you|skills)\b/i;
  const stop = /^\W*(nice[- ]to[- ]haves?|preferred|bonus|benefits|perks|what we offer|about (us|the company)|compensation|salary|equal opportunity|why join|responsibilities|what you('ll)? do)\b/i;
  let inside = false;
  const lines = [];
  for (const line of String(jobText).split(/\r?\n/)) {
    if (stop.test(line)) { inside = false; continue; }
    if (start.test(line)) { inside = true; lines.push(line.replace(start, "")); continue; }
    if (inside || /\b(required|must|\d+\+?\s*years)\b/i.test(line)) lines.push(line);
  }
  return lines;
}

export function extractKeywords(jobText = "") {
  const haystack = normalizeText(jobText);
  const requirementBlock = normalizeText(requirementLines(jobText).join(" "));
  const terms = new Map();
  const add = (term) => {
    const key = term.toLowerCase();
    if (terms.has(key)) return;
    const count = countOf(haystack, term);
    if (!count) return;
    const inRequirements = contains(requirementBlock, term);
    terms.set(key, { term, count, weight: Math.min(3, count) + (inRequirements ? 2 : 0), inRequirements });
  };
  SKILL_TERMS.forEach(add);
  const known = [...terms.keys()];
  extraTerms(jobText)
    .filter((term) => !known.some((key) => key !== term && ` ${key} `.includes(` ${term} `))) // "cd" inside "argo cd"
    .forEach(add);
  // Drop "go" when it is almost certainly the English verb.
  const go = terms.get("go");
  if (go && !/\b(golang|go\s*(lang|developer|engineer|services|microservices)|in go|go,|go\/|python|java)\b/i.test(jobText)) terms.delete("go");
  // Collapse synonyms so "k8s" and "kubernetes" count once.
  for (const [key, value] of [...terms.entries()]) {
    for (const alias of SYNONYMS[key] || []) {
      const other = terms.get(alias);
      if (other && other !== value && other.weight <= value.weight) terms.delete(alias);
    }
  }
  return [...terms.values()].sort((a, b) => b.weight - a.weight || b.count - a.count).slice(0, 40);
}

export function resumeHas(resumeText, term) {
  const haystack = normalizeText(resumeText);
  return contains(haystack, term) || (SYNONYMS[term.toLowerCase()] || []).some((alias) => contains(haystack, alias));
}

const WEAK_OPENERS = /^(responsible for|worked on|helped|assisted|involved in|participated in|duties included|tasked with)\b/i;

export function structuralChecks(resumeText = "") {
  const text = String(resumeText);
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const bullets = lines.filter((line) => /^([-*•▪●◦]|\d+\.)\s+/.test(line) || (line.length > 40 && /^[A-Z][a-z]+ed\b/.test(line)));
  const words = text.split(/\s+/).filter(Boolean).length;
  const quantified = bullets.filter((line) => /\d/.test(line)).length;
  const weak = bullets.filter((line) => WEAK_OPENERS.test(line.replace(/^([-*•▪●◦]|\d+\.)\s+/, "")));
  const firstPerson = bullets.filter((line) => /\b(I|me|my)\b/.test(line));
  const longBullets = bullets.filter((line) => line.length > 260);
  const has = (re) => re.test(text);
  const checks = [
    { id: "contact", label: "Email and phone near the top", pass: has(/@[\w-]+\.[a-z]{2,}/i) && has(/\d{3}[\s.)-]*\d{3}[\s.-]*\d{4}/), tip: "Put email, phone, city, and LinkedIn in one plain-text line under your name." },
    { id: "linkedin", label: "LinkedIn URL", pass: has(/linkedin\.com\/in\//i), tip: "Add your linkedin.com/in/ URL to the contact line." },
    { id: "sections", label: "Standard section headings", pass: ["experience", "skills", "education"].every((name) => new RegExp(`^\\W*(professional |work )?${name}`, "im").test(text)), tip: "Use plain headings ATS parsers expect: Summary, Experience, Skills, Education, Certifications." },
    { id: "length", label: "Length 400–1,100 words", pass: words >= 400 && words <= 1100, tip: words < 400 ? "Add scope and outcomes; the resume reads thin." : "Trim older roles and repeated bullets; aim for two pages." },
    { id: "quantified", label: "At least a third of bullets have numbers", pass: bullets.length > 0 && quantified / bullets.length >= 0.33, tip: "Add scale (services, users, nodes), speed, cost, or reliability numbers you actually know." },
    { id: "weak", label: "No weak bullet openers", pass: weak.length === 0, tip: `Start bullets with a strong verb instead of "${weak[0]?.replace(/^([-*•▪●◦]|\d+\.)\s+/, "").split(" ").slice(0, 3).join(" ") || "responsible for"}".` },
    { id: "pronouns", label: "No first-person pronouns in bullets", pass: firstPerson.length === 0, tip: "Drop I/me/my from bullets." },
    { id: "bulletLength", label: "Bullets under ~2 lines", pass: longBullets.length === 0, tip: "Split bullets longer than about 260 characters." },
    { id: "dates", label: "Dates on roles", pass: has(/\b(19|20)\d{2}\b/), tip: "Add month and year ranges for each role." }
  ];
  return { checks, stats: { words, bullets: bullets.length, quantified, weak: weak.length } };
}

export function atsCheck(resumeText = "", jobText = "") {
  const keywords = extractKeywords(jobText);
  const matched = [];
  const missing = [];
  keywords.forEach((item) => (resumeHas(resumeText, item.term) ? matched : missing).push(item));
  const totalWeight = keywords.reduce((sum, item) => sum + item.weight, 0) || 1;
  const matchedWeight = matched.reduce((sum, item) => sum + item.weight, 0);
  const coverage = matchedWeight / totalWeight;
  const { checks, stats } = structuralChecks(resumeText);
  const checkRatio = checks.filter((item) => item.pass).length / checks.length;
  const score = Math.round(100 * (keywords.length ? 0.7 * coverage + 0.3 * checkRatio : checkRatio));
  return {
    score,
    coverage: Math.round(coverage * 100),
    matched: matched.map((item) => item.term),
    missing: missing.map((item) => ({ term: item.term, critical: item.inRequirements, mentions: item.count })),
    checks,
    stats
  };
}
