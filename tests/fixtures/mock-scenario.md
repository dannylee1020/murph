# Mock Scenario: API Rate Limiting for Acme Corp Onboarding

All artifacts center on one initiative: the team needs to ship API rate
limiting before Acme Corp (enterprise customer) goes live on June 2.

---

## 1. Email Thread (Gmail)

Create as a 3-message thread between teammates.

**Subject:** Re: Acme Corp API rate limiting — timeline check

**Message 1 — From: PM (e.g., sarah@…)**

> Hey team — Acme Corp's enterprise onboarding is locked in for June 2.
> Their integration team flagged that they'll be pushing ~800 req/s during
> peak sync windows. We don't have any rate limiting today, so we need
> something in place before they go live.
>
> Can we get a rough scope by Thursday? I want to make sure we're not
> scrambling the week of launch.

**Message 2 — From: Eng lead (e.g., danny@…)**

> Looked at this today. Two options:
>
> 1. Token bucket at the API gateway (fast, covers all endpoints, but
>    coarse — same limit for every customer).
> 2. Per-tenant sliding window in Redis (more work, but lets us set
>    custom limits for Acme vs. free-tier users).
>
> I'd go with option 2. We already have a Redis cluster for session
> caching, and Acme is paying for higher limits — we shouldn't penalize
> them with a global cap. Rough estimate: 3–4 days of eng work, plus a
> day for load testing.
>
> One open question: do we return 429 with a Retry-After header, or do
> we queue and delay? I'd default to 429 + Retry-After since their
> client already handles backoff.

**Message 3 — From: PM**

> Option 2 makes sense. Let's go with 429 + Retry-After. I'll update
> the Acme onboarding doc with the rate limit tiers — can you create the
> GitHub issue and link the Notion spec?
>
> One thing to flag: their security team asked if we log which requests
> get throttled. Worth adding a structured log line so we can share
> reports with them post-launch.

---

## 2. Notion Document

Create as a page. Title and body below.

**Title:** API Rate Limiting — Design Spec

**Body:**

### Context

Acme Corp onboarding (June 2) requires per-tenant API rate limiting.
Current state: no rate limiting on any endpoint.

### Decision

Per-tenant sliding window using Redis, keyed by API key.

Rejected alternative: global token bucket at the API gateway — too
coarse for tiered pricing.

### Rate Limit Tiers

| Tier         | Requests/min | Burst |
|--------------|-------------|-------|
| Free         | 60          | 10    |
| Pro          | 600         | 50    |
| Enterprise   | 3000        | 200   |

Acme Corp is Enterprise tier.

### Behavior on Limit Exceeded

- Return HTTP 429 with `Retry-After` header (seconds until window reset).
- Log throttled requests as structured JSON: `{ event: "rate_limited", tenantId, endpoint, currentCount, limit }`.
- Do NOT queue or delay — client-side backoff is expected.

### Implementation Plan

1. Add `rate_limiter` module using `ioredis` with sliding window counter.
2. Middleware reads tenant tier from API key lookup (cached).
3. Wire middleware into all `/api/v1/*` routes.
4. Add `X-RateLimit-Remaining` and `X-RateLimit-Reset` response headers.
5. Load test at 2x Acme's expected peak (1600 req/s) to validate.

### Open Questions

- Should internal service-to-service calls bypass rate limiting? Leaning yes — use a separate key prefix.
- Alerting threshold: notify ops when a tenant sustains >80% of their limit for 5+ minutes?

---

## 3. GitHub Issue

Create in your test repo.

**Title:** API requests are unbounded — need per-tenant rate limiting before Acme launch

**Labels:** `bug`, `priority:high`

**Body:**

### Problem

We have no rate limiting on any API endpoint. A single tenant can
consume unlimited capacity, and there's no way to enforce tiered usage
for different pricing plans.

This is blocking Acme Corp's enterprise onboarding (June 2). Their
integration pushes ~800 req/s during peak sync windows. Without limits,
a misbehaving free-tier user could degrade Acme's experience — and we
have no visibility into who's consuming what.

### Business Context

- Acme is our first enterprise contract. They're expecting guaranteed
  capacity at their tier.
- Sales committed to per-tenant limits as part of the enterprise SLA.
- Their security team also asked for throttle logging so we can share
  usage reports post-launch.

### Requirements

- [ ] Per-tenant limits enforced on all `/api/v1/*` routes
- [ ] Tiered limits aligned to pricing (free / pro / enterprise)
- [ ] Callers receive clear signal when throttled (status code + retry guidance)
- [ ] Throttle events are logged for operational visibility

See Notion spec for design details: [link to your Notion page]

---

## 4. GitHub Pull Request

Create a PR against main (can be an empty or minimal diff — content is
what matters for retrieval testing).

**Title:** feat: add per-tenant API rate limiting middleware

**Body:**

## What changed

Sliding window rate limiter using `ioredis`, wired as middleware on all
`/api/v1/*` routes.

### Key implementation decisions

- **Sliding window vs. token bucket:** Sliding window gives more
  predictable behavior at window boundaries. Token bucket would allow
  larger bursts but makes SLA reporting harder to reason about.
- **Redis key schema:** `ratelimit:{tenantId}:{minuteSlot}` with 2-min
  TTL. Chose minute-granularity windows because Acme's peak is sustained
  over minutes, not seconds.
- **Tenant tier resolution:** Reads from the existing API key cache
  (`TenantKeyCache`). No new DB queries in the hot path.
- **Internal bypass:** Service-to-service calls use keys prefixed with
  `svc_` — these skip the limiter entirely to avoid cascading throttle
  failures between our own services.

### Response headers added

All `/api/v1/*` responses now include:
- `X-RateLimit-Limit` — tenant's max requests per window
- `X-RateLimit-Remaining` — requests left in current window
- `X-RateLimit-Reset` — epoch seconds when the window resets

On 429: `Retry-After` header with seconds until reset.

## Test plan

- Unit: window counter rollover, TTL expiry, tier lookup miss fallback
- Integration: exhaust limit → verify 429 + correct headers → wait for
  window reset → verify requests resume
- Load: 1600 req/s sustained 60s (2x Acme peak) — p99 < 5ms overhead

Closes #[issue number]

---

## 5. Slack Conversations

Post these in channels that are in Murph's session scope. Each thread
tests a different retrieval pattern. The session owner is the person
Murph is covering for (e.g., Danny).

---

### Thread A — Spec clarification (should retrieve: Notion, Email)

A teammate asks a question that only the design spec and email thread
can answer. Tests whether Murph grounds on Notion docs and email.

**Channel:** #product-eng

> **@sarah:** @danny quick question — what rate limit are we giving
> Acme? I'm updating the onboarding runbook and want to make sure
> I have the right numbers for their integration team.

Expected Murph behavior: search Notion for the rate limit tiers table,
possibly surface the email thread where tiers were discussed. Should
reply with Enterprise tier: 3000 req/min, 200 burst.

---

### Thread B — Status check (should retrieve: GitHub issue + PR)

Someone needs a progress update. The answer lives in the GitHub issue
and PR, not in docs or email.

**Channel:** #product-eng

> **@mike:** @danny are we on track to land the rate limiting work
> before the Acme deadline? Just want to know if there's anything
> blocking that I should escalate.

Expected Murph behavior: search GitHub for the rate limiting issue and
PR to assess status. Should summarize the issue requirements, mention
the PR if it exists, and flag any open checklist items.

---

### Thread C — Implementation detail (should retrieve: PR, Notion)

An engineer asks a technical question that lives in the PR description
and Notion spec. Tests retrieval of implementation-level content.

**Channel:** #product-eng

> **@alex:** @danny do internal services hit the rate limiter too? I'm
> working on the billing sync job and it does a burst of ~200 API calls
> every hour. Don't want it to get throttled once this ships.

Expected Murph behavior: find the PR's internal bypass detail (svc_
prefix) and/or the Notion open question about service-to-service bypass.
Should explain that internal calls are bypassed via svc_ key prefix.

---

### Thread D — Cross-cutting question (should retrieve: all sources)

A broad question where the full picture is spread across email, Notion,
GitHub issue, and PR.

**Channel:** #product-eng

> **@sarah:** @danny can you give me the full picture on the Acme rate
> limiting work? I need to brief the exec team — timeline, what we
> decided, where we are, and any risks.

Expected Murph behavior: retrieve broadly across all sources. Should
synthesize: the June 2 deadline (email/issue), the per-tenant sliding
window decision (email/Notion), the tier structure (Notion), current
implementation status (PR), and open risks like alerting threshold
(Notion open questions).

---

## Search Queries to Test

These queries should retrieve relevant artifacts across all three sources:

| Query | Expected hits |
|-------|--------------|
| `rate limiting` | All 4 artifacts |
| `acme onboarding` | Email, Notion doc, issue (business context) |
| `429 retry-after` | Email (msg 2), Notion spec, PR (response headers) |
| `redis sliding window` | Email (msg 2), Notion spec, PR (implementation) |
| `why do we need rate limiting` | Issue (problem statement), email (msg 1) |
| `service-to-service bypass` | Notion (open question), PR (svc_ key prefix) |

## Slack Thread → Retrieval Matrix

| Thread | Primary sources | What to verify |
|--------|----------------|----------------|
| A (spec clarification) | Notion, Email | Correct tier numbers (3000/min, 200 burst) |
| B (status check) | GitHub issue, PR | Issue checklist status, PR existence |
| C (implementation detail) | PR, Notion | svc_ prefix bypass, open question resolution |
| D (cross-cutting) | All sources | Synthesizes timeline + decision + status + risks |
