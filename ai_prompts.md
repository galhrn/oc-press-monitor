# ai_prompts.md — AI Coding Assistant Prompt Log

> **Deliverable reference:** Task §5.6 — *"A copy of the full prompt used with AI coding assistants while building the solution."*
>
> **Project:** OurCrowd Press Mentions Monitoring & Dashboard
> **Author:** Gal Aharon
> **Assistant:** Claude (Opus) via Claude Cowork, operating under a persistent project instruction set
> **Last updated:** 2026-07-31

---

## How to read this document

This is a **complete, verbatim, chronological log** of the prompts used to build this
project with an AI coding assistant. Nothing has been retro-edited to look better.
Where a prompt produced a wrong or incomplete result, the follow-up correction is
logged too — the recovery is as much a part of the working method as the first attempt.

Each entry contains:

- **Context** — what stage of the project this was, and what already existed
- **The prompt** — verbatim, in a fenced block
- **Strategy** — the prompt-engineering intent behind it
- **Outcome** — what came back, and what needed correcting

### Two kinds of prompts, deliberately kept separate

| | `ai_prompts.md` (this file) | `prompts/*.md` |
|---|---|---|
| Audience | The AI coding assistant that helped **write** the code | The Ollama model invoked **by** the code at runtime |
| Lifecycle | Development-time, chronological | Production artifact, versioned and hash-tracked per classification |
| Deliverable | Task §5.6 | Task §4.1 ("how the model is invoked") |

Conflating the two is a common mistake; they are documented separately and cross-referenced.

---

## Working method: the prompting principles applied here

These are the rules I set for the collaboration up front, and they are visible in
every entry below.

1. **Persistent project instructions over repeated context.**
   A standing instruction set (Entry 000) defines the assistant's role, the source
   materials, and the deliverables — so no individual prompt has to re-establish them.

2. **A living context file instead of conversational memory.**
   `project_context.md` is the durable state. Any session can be resumed by reading one
   file. This is the single highest-leverage practice in AI-assisted development: it
   converts a stateless assistant into one with reliable long-term project memory, and
   it makes the assistant's understanding *auditable* rather than implicit.

3. **Plan before code, explicitly.**
   The first substantive prompt (Entry 001) forbids writing application code. Locking
   architecture before implementation prevents the most expensive failure mode of AI
   coding: a large volume of plausible code built on an unexamined premise.

4. **Assign a role that raises the bar.**
   "Software Architect and Senior Technical Mentor" rather than "write me a script."
   Role framing measurably changes the depth of trade-off analysis returned.

5. **Force trade-offs into the open.**
   Prompts ask for *2–3 options with trade-offs*, not a single answer. Where I already
   have a leaning (e.g. SQLite vs JSON files) I name both candidates so the assistant
   argues the case rather than agreeing with me.

6. **No silent assumptions — an explicit escalation rule.**
   The assistant is instructed to stop and ask rather than guess. Unflagged assumptions
   are what turn AI-generated code into rework.

7. **Structured, numbered requests.**
   Numbered sub-questions produce addressable, complete answers and make omissions obvious.

8. **Constraints stated as constraints.**
   Hard requirements (Node.js mandatory, local Ollama only, no cloud LLM) are repeated
   in-prompt rather than assumed to be remembered.

---

## Entry 000 — Persistent project instructions

**Context:** Configured once, before any conversation, as the standing system-level
instruction for every session in this project. Source materials attached: CV, job
description, task PDF, company list.

**Prompt:**

```
My goal is to formulate a comprehensive strategy, architectural design, and a
Senior-level execution plan for a take-home coding assignment I received during an
interview process.

I will provide you with the following resources:
1. My Resume / CV.
2. The Job Description for the role I am applying for.
3. The take-home task description document.
4. The supplementary data file provided for the task.

I want you to act as a Software Architect and a Senior Technical Mentor. Please review
all the provided materials and help me achieve the following objectives:

1. Reverse Engineer the Task: Analyze the documents and accurately distill exactly what
   the interviewers are trying to evaluate. Identify both explicit and implicit
   requirements, evaluation criteria, and potential pitfalls. Pay close attention to
   every single detail they wrote.

2. Architectural Design & Tool Selection: Design a robust, scalable, and logical
   architecture tailored to the project's requirements. Recommend the ideal tech stack
   and tools for this specific task (frameworks, libraries, databases, infrastructure,
   etc.).

3. Senior Developer Work Plan: Define a step-by-step workflow incorporating industry
   best practices that reflect the experience and maturity of a Senior Developer (e.g.,
   system design, proper error handling, testing strategies, and high-quality
   documentation).

4. The 'Extra Mile': Identify any additional skills, internal tools, third-party
   libraries, or methodologies that will streamline the development process and help my
   solution truly stand out among other candidates.

5. Prompt Documentation & Refinement (Requirement Compliance): The assignment explicitly
   requires me to submit a copy of the full prompt used with AI coding assistants.
   Throughout our collaboration, I want you to document our prompts in a dedicated
   Markdown file (e.g., ai_prompts.md). Continuously review and structure these prompts
   to demonstrate that I am utilizing AI at a Senior level — providing clear context,
   architectural constraints, step-by-step guidance, and professional prompt engineering
   techniques.
```

**Strategy:**

- **Role assignment before task assignment.** "Software Architect and Senior Technical
  Mentor" establishes the register for every subsequent answer.
- **Complete context up front.** CV, JD, task and data are all supplied together so the
  assistant can reason about the intersection — what *this* task is testing given *this*
  job description — rather than answering generically.
- **Objectives, not instructions.** Five numbered outcomes, each with a clarifying
  parenthetical, define what "done" means without prescribing how.
- **"Pay close attention to every single detail they wrote"** is a deliberate
  instruction against skimming. Take-home tasks hide grading criteria in passing clauses
  (here: *"document your choice and its limitations"*, *"even informally"*, *"so we can
  review results without re-running everything ourselves"*).
- **Deliverable compliance is built into the instruction set**, so prompt logging is
  continuous rather than reconstructed from memory at the end.

**Outcome:** All subsequent sessions inherit this framing automatically. No prompt below
needs to restate the role or re-attach the source documents.

---

## Entry 001 — Planning phase: architecture, stack and documentation scaffolding

**Date:** 2026-07-31
**Stage:** Phase 0 — Planning. No repository yet, no code written.
**Attached materials:** `Gal Aharon - CV.pdf`, `Full Stack Developer position at OurCrowd.docx`, `OC FullStack Dev Task 2026.pdf`, `ourcrowd_companies.txt`

**Prompt:**

```
Now that you have reviewed my CV, the job description, the task requirements, and the
companies list, I want us to begin the planning phase.
Do not write any application code yet.
Please provide a detailed response covering the following:

1. Reverse Engineering: Briefly list the core technical challenges and what you believe
   the reviewers are really looking for in my solution, based on the JD and my CV.
2. Architecture & Tech Stack: Propose a high-level architecture. Note that Node.js is
   mandatory for the backend/data-collection. What should we use for the frontend,
   storage (e.g., SQLite vs. JSON files), and the scheduled cron job?
3. Ollama Integration: Suggest 2-3 suitable local Ollama models for sentiment analysis.
   Discuss the trade-offs of each regarding speed, resource consumption, and accuracy.
4. Living Context File (project_context.md): Outline the initial structure for a local
   project_context.md file. This file will serve as our continuously updated source of
   truth throughout the development process. It must contain the current project
   structure, the purpose of each file, our step-by-step work plan, and all
   architectural decisions, following best practices for AI-assisted development.
5. Prompt Documentation (ai_prompts.md): Create the first draft of our ai_prompts.md
   file. Document this very prompt as our first entry, explaining the strategy behind it
   as required by the assignment deliverables.

Crucial Rule for Our Collaboration: Throughout this entire project, please do not make
major architectural or logic assumptions silently. If you are debating between multiple
options, if you are unsure about a specific requirement, or if you need more details to
make an optimal Senior-level decision, pause and ask me clarifying questions. I want us
to maintain a continuous feedback loop.
Let's agree on the architecture and set up our Markdown files before we move on to
writing any code.
```

**Strategy:**

| Technique | Where it appears | Why it matters |
|---|---|---|
| **Explicit code embargo** | *"Do not write any application code yet"* | The dominant failure mode of AI-assisted development is premature, voluminous, plausible code. Separating design from implementation makes the design reviewable while it is still cheap to change. |
| **Sequenced deliverables** | 5 numbered items, analysis → design → tooling → documentation | Each answer feeds the next: reverse-engineering constrains the architecture, the architecture constrains the model choice, all of it lands in the context file. |
| **Hard constraints restated** | *"Node.js is mandatory for the backend/data-collection"* | Restating a non-negotiable in-prompt is cheap insurance against it being softened. |
| **Named the decisions, not the answers** | *"SQLite vs. JSON files"* | Naming both candidates forces a justified comparison instead of agreement with an implied preference. It also reveals whether the assistant understands *why* the boundary matters (unique constraints, date-range queries, watermarks). |
| **Bounded option count** | *"2-3 suitable local Ollama models"* | Prevents an unfiltered list. Forcing a shortlist forces a ranking, and a ranking forces stated criteria. |
| **Named the trade-off axes** | *"speed, resource consumption, and accuracy"* | Without specified axes, model comparisons drift into marketing summaries. With them, the answer must be operational. |
| **Persistent-memory artifact requested** | Item 4 | `project_context.md` is the durable state layer. It makes the assistant's understanding explicit and correctable, survives context loss, and doubles as reviewer-facing engineering documentation. |
| **Deliverable compliance folded into the work** | Item 5 | Task §5.6 is satisfied continuously rather than reconstructed at the end. |
| **Explicit escalation protocol** | *"Crucial Rule … pause and ask me clarifying questions"* | Converts the assistant from an answer generator into a collaborator. The most expensive AI errors are confident, unflagged assumptions. |
| **Explicit stage gate** | *"Let's agree on the architecture … before we move on to writing any code"* | Defines the exit condition for this phase. |

**Outcome:**

- Reverse-engineering surfaced one requirement that is not stated anywhere in the task
  document but dominates output quality: **entity disambiguation**. The seed list
  contains 258 companies, of which roughly 40 are common single words (`Shield`, `Peak`,
  `Wave`, `Near`, `Orchard`, `Silo`, `Guild`, `Astra`, `Casper`, `Overtime`,
  `Launchpad`, `Bites`). Naive keyword search returns predominantly false positives.
  This became architectural decision AD-05/§4.3 and a first-class pipeline stage.
- A second gap was found: the task document states the company list will include
  *"name + any identifying detail such as domain or sector"*, but the delivered file
  contains **names only**. Recorded as assumption A2 with a documented enrichment step
  rather than silently worked around.
- A third ambiguity: *"the last quarter"* — calendar quarter or trailing 90 days.
  Recorded as A1, resolved to a configurable rolling window.
- `project_context.md` v0.1.0 created with a 27-row requirements traceability matrix,
  16 architectural decisions, 8 documented assumptions and 7 open questions.
- This file created.
- **7 open questions escalated rather than assumed** — time budget, Ollama host
  hardware, TypeScript vs plain JS, alert channels, registry-enrichment scope, Slack
  availability, and whether to ship the optional n8n artifact.

---

## Entry 002 — Hardware constraints and deliberate right-sizing of the model

**Date:** 2026-07-31
**Stage:** Phase 0 — Planning (continued). Still no code written.
**Context:** Entry 001 produced an architecture that left the Ollama model choice open
(OQ-2) and proposed a small-model + large-arbiter cascade (AD-07) without evidence that
a cascade was needed.

**Prompt:**

```
Here are my local machine specifications: Windows 11, Intel Arc 140V GPU (16GB VRAM),
and 32GB RAM.
Please factor this into your Ollama model selection. However, beyond just hardware
constraints, I want us to demonstrate strong architectural judgment by 'right-sizing'
the solution.
The task primarily involves sentiment classification (positive/negative/neutral) for
short news mentions. Please do not recommend an unnecessarily large or resource-heavy
model if a smaller, more efficient one can achieve high accuracy for this specific use
case. It is crucial to show the reviewers that we know how to match the tool to the
problem efficiently, balancing speed, resource consumption, and accuracy without
over-engineering.
```

**Strategy:**

| Technique | Where it appears | Why it matters |
|---|---|---|
| **Resolve an open question with hard data** | The spec block | OQ-2 was raised rather than assumed in Entry 001. This closes it with real numbers instead of a guess, which is the whole point of the escalation protocol. |
| **State the principle, not just the constraint** | *"beyond just hardware constraints … 'right-sizing'"* | Hardware alone would produce "you have 32 GB, use a 7B." Naming the *principle* separates the capability ceiling from the correct choice — two different questions that are constantly conflated. |
| **Characterise the workload precisely** | *"sentiment classification … for short news mentions"* | Model sizing is a function of task difficulty, not task category. Stating that inputs are short and the label space is three classes is the fact that licenses a small model. |
| **Explicit anti-over-engineering instruction** | *"do not recommend an unnecessarily large or resource-heavy model"* | A direct counter to the default bias — of assistants and engineers alike — toward the more capable option. Over-engineering is the failure mode being guarded against. |
| **Name the three axes again** | *"speed, resource consumption, and accuracy"* | Consistent with Entry 001. Repeating the same evaluation axes across prompts keeps successive answers comparable. |
| **State the audience for the decision** | *"show the reviewers that we know how to match the tool to the problem"* | Reframes the output: not just a model name, but a *defensible, documented* selection. This is what turned the answer into a measurement protocol rather than a recommendation. |

**Outcome:**

- **A real infrastructure risk surfaced that was not visible before the hardware was
  known:** upstream Ollama has no official Intel Arc acceleration path. Vulkan support
  is opt-in and experimental (`OLLAMA_VULKAN=1`, introduced Oct 2025), Intel's IPEX-LLM
  ships a separate portable Ollama build, and Vulkan is reported to be *slower than CPU*
  on some integrated GPUs. Recorded as A9 / AD-19 with a Phase-1 benchmark rather than
  an assumed "runs on GPU."
- **A previous decision was reversed.** AD-07 (model cascade) was downgraded from
  `PROPOSED` to `CONDITIONAL — default OFF`. It had been proposed on general principle
  rather than evidence. Building a cascade the data doesn't call for is precisely the
  over-engineering this prompt targeted. Logged rather than quietly edited.
- **AD-17 established the protocol:** climb a model ladder from the smallest candidate
  and ship the smallest model within 2 points of macro-F1 of the best. Right-sizing
  becomes a measured result with a README table behind it, not a claim.
- **AD-18** extended right-sizing past parameter count — context window, output cap,
  quantization and parallelism are levers that are free and usually ignored.
- **AD-20** documented the encoder alternative (FinBERT/DistilBERT, ~110M params) as
  *considered and rejected because the task mandates Ollama* — the most direct available
  demonstration of knowing which tool the problem actually calls for.

**Reflection on the prompt itself:** this was the highest-leverage prompt of the
planning phase. It did not ask for an artifact; it supplied a constraint and a
principle, and let those regenerate a decision that had already been made — correctly
overturning it. Prompts that hand over an evaluation principle tend to outperform
prompts that request a deliverable.

---

## Entry 003 — Refining the work plan into phases, sub-tasks and measurable milestones

**Date:** 2026-07-31
**Stage:** Phase 0 — Planning (final). Still no code written.
**Context:** `project_context.md` v0.2.0 contained a work plan of nine phases with flat
checkbox lists. Adequate as a sketch; not adequate as a roadmap.

**Prompt:**

```
Looking at the work plan you proposed, I want to ensure it is structured appropriately
for a professional workflow.
Does your proposed execution plan break down the project into clear, high-level phases
(main sections) and specific, actionable sub-tasks within each phase?
If it doesn't already, please refine the work plan to follow this granular structure. As
a senior developer, I need to ensure we have a well-defined roadmap with measurable
milestones (e.g., Phase 1: Setup & Architecture, Phase 2: Data Collection, etc.) before
we start building or writing any code.
```

**Strategy:**

| Technique | Where it appears | Why it matters |
|---|---|---|
| **Audit before instruct** | *"Does your proposed execution plan break down…?"* | Asking the assistant to evaluate its own artifact against a named standard, *before* asking for changes, produces a diagnosis rather than a cosmetic rewrite. The gap it identifies is usually the real one. |
| **Conditional refinement** | *"If it doesn't already, please refine…"* | Prevents churn for its own sake. A well-formed prompt should allow the answer "it already does." |
| **Named the structural standard** | *"clear, high-level phases … specific, actionable sub-tasks within each"* | "Better plan" is unactionable. A two-level hierarchy with an explicit granularity target is a spec. |
| **Named the quality bar** | *"measurable milestones"* | The word that did the most work here. It forced every phase to end in a *demonstrable artifact* rather than a feeling of completion, and produced the exit-criteria blocks. |
| **Worked example of the format** | *"(e.g., Phase 1: Setup & Architecture, Phase 2: Data Collection)"* | Two examples of the intended shape remove ambiguity far faster than describing it. |
| **Re-stated the stage gate** | *"before we start building or writing any code"* | Third consecutive prompt holding the planning boundary. Consistency is what makes a stage gate real. |
| **Role framing as justification** | *"As a senior developer, I need to ensure…"* | Ties the request to a professional standard rather than a preference, which raises the register of the response. |

**Outcome:**

`project_context.md` §8 rewritten (v0.3.0). The audit found four gaps the original plan
had, all of which are the difference between a task list and a roadmap:

1. **No measurable milestones.** Phases ended when the checkboxes were ticked — a
   subjective judgement. Now every phase ends at `M0`–`M8`, each defined as an artifact
   that can be *run, shown or opened*, plus an explicit exit-criteria block of
   objectively-true-or-false statements.
2. **Sub-tasks were not addressable.** Now every task carries a stable ID (`P4.6`), a
   `Satisfies R#` column linking it back to the §2 requirements matrix, and an hour
   estimate. Any task with no `R#` is infrastructure and must justify its existence —
   which is a built-in scope-creep filter.
3. **No dependency model.** Added §8.2: critical path (~39 h of the ~51 h total) and the
   observation that **P4 (classification) can run in parallel with P2/P3 against
   fixtures** — the single biggest schedule win available, and the reason the
   `FixtureProvider` was promoted into Phase 1.
4. **No plan for running out of time.** Added §8.3, a pre-declared descope ladder with a
   strict cut order and an explicit *never-cut* list. Deciding the sacrifice order while
   calm is what prevents cutting the eval harness at 2am — and the task document states
   outright that a documented partial solution beats an undocumented complete one.

Two new tasks emerged directly from thinking in milestones rather than checkboxes:
**P1.8 (walking skeleton)** — one hardcoded company through stubbed stages, so integration
risk surfaces in Phase 1 where it is cheap rather than in Phase 5 where it is not — and
**P4.0 (backend benchmark)**, which turns the unresolved Intel Arc question from AD-19
into a scheduled, estimated task rather than a lurking unknown.

Also added a **global Definition of Done** applying to every task, including the rule
that `project_context.md` and `ai_prompts.md` are updated *in the same commit* as the
change they describe. Without that rule, living documents die by the third day.

---

## Entry 004 — Closing the open questions; data-quality reasoning drives registry scope

**Date:** 2026-07-31
**Stage:** Phase 0 → closing. Decisions frozen. Still no code written.
**Context:** Four open questions (OQ-1, OQ-3, OQ-4, OQ-5) were blocking milestone M0.

**Prompt (owner's answers, verbatim — OQ-5 quoted in full as it changed project scope):**

```
[OQ-1 deadline] I need to submit the assignment by Tuesday at 4:00 PM, but I want to
submit it earlier so I don't miss out on the position, as there are likely other
candidates who have already started working on it.

[OQ-3 language] TypeScript (Recommended)

[OQ-4 alerting] Console + JSON file (Recommended)

[OQ-5 enrichment] Let's go with Option 1. As a senior developer, I recognize that
feeding highly generic queries (like 'Ro', 'Peak', or 'Near') into a news API will
return a massive amount of noise. If we pass thousands of irrelevant articles to our
local Ollama model for sentiment analysis, it will cause severe performance bottlenecks
and waste local machine resources.

Data quality is critical here (preventing 'Garbage In, Garbage Out'). Please run the
automated LLM enrichment to generate precise search queries (e.g., appending context
like 'startup', industry, or 'OurCrowd' to the bare names).

Regarding the '~40 dangerously ambiguous' companies you mentioned: I understand this is
just an estimate. Please evaluate the entire list and flag all companies that you
consider highly generic or prone to false positives, even if the final count is higher
or lower than 40. Provide me with this flagged list so I can quickly hand-review and
approve the enriched queries before we proceed.
```

**Strategy:**

| Technique | Where it appears | Why it matters |
|---|---|---|
| **Answered a batched question set in one pass** | All four at once | The assistant had grouped the blocking questions rather than drip-feeding them. One decision round unblocked an entire phase. |
| **Justified the decision, not just stated it** | The GIGO paragraph | The reasoning — noise inflates the Ollama workload, which is the project's scarcest resource — is *itself* reusable context. It let the assistant connect registry quality to the throughput budget (assumption A4) without being told to. |
| **Rejected an estimate presented as fact** | *"I understand this is just an estimate… evaluate the entire list"* | The strongest correction in the log. "~40 ambiguous names" was an impression from skimming, offered with unearned precision. Demanding the full enumeration turned it into a measured result: **57**, not 40. |
| **Pre-authorised the answer to differ** | *"even if the final count is higher or lower"* | Removes any incentive to anchor on the earlier number. Without this clause an assistant tends to land suspiciously close to its own prior estimate. |
| **Specified the artifact and its use** | *"Provide me with this flagged list so I can quickly hand-review"* | Naming the consumer and the action determined the format — a filterable, editable review sheet with approval columns, rather than prose. |
| **Kept the human in the loop on data quality** | *"…and approve… before we proceed"* | Automated enrichment generates; a human ratifies. Exactly the division of labour that makes AI-generated data trustworthy enough to commit. |

**Outcome:**

- **The estimate was wrong, and materially so.** Full triage of all 258 names found
  **25 CRITICAL + 32 HIGH = 57** requiring hand-review — 43% more than estimated. Names
  the earlier skim missed: `Groq` (one character from Grok), `Air EV` (a Wuling
  production car), `AEYE Health` (near-identical to AEye, a public lidar company),
  `Arrow Global` (a large UK debt purchaser), `Ursa Major` (a constellation), `Fireblade`
  (a Honda motorcycle), `Clinch`, `Rewire`, `Oshi`, `MST`, `CB4`.
- **A second axis emerged that the original framing had conflated** (→ AD-22).
  Nineteen companies — SpaceX, Anthropic, Stripe, Databricks, xAI, Cerebras, Beyond Meat
  and others — are *not* ambiguous. They simply generate enough coverage to consume the
  entire inference budget. That is a **capping** problem (`MAX_ITEMS_PER_COMPANY`), not a
  **query-rewriting** problem. Treating them as ambiguous would have applied the wrong
  fix to 7% of the list.
- **A compliance question surfaced and was escalated rather than assumed** (→ OQ-10,
  AD-21). Task §4.1 mandates Ollama for *"any other text understanding step"*. Registry
  enrichment plausibly qualifies. Resolution: ship both an Ollama-backed enrichment
  script *and* the committed hand-reviewed output — compliant under either reading, at
  roughly 30 minutes of cost.
- Deliverable produced: `OurCrowd_Company_Query_Triage.xlsx` — 258 rows, tier, rationale,
  proposed query, negative keywords, and approval columns.
- Schedule built backwards from the deadline (§8.6) with hard checkpoints and a
  **cut-on-slip rule**: a missed checkpoint triggers a pre-declared descope immediately
  rather than being absorbed as optimism.

**Reflection:** the most valuable thing in this prompt was the instruction to *verify a
number the assistant had produced casually*. "~40" was an impression stated with the
cadence of a fact. Asking for the enumeration converted an anchor into evidence — and the
answer moved 43%. Worth treating any unenumerated quantity in an AI response as a
hypothesis until someone counts.

---

## Entry 005 — Freeze the architecture and scaffold Phase 1

**Date:** 2026-07-31
**Stage:** P0 → **M0 reached**. P1 built.
**Context:** All open questions resolved; the 57 flagged company queries approved.

**Prompt:**

```
I understand the strategy: we use this reviewed, high-quality list as our ground-truth
data for the current submission to ensure maximum dashboard quality, while our
`scripts/enrich-companies.ts` remains capable of processing new lists via Ollama to
ensure strict compliance.
Please freeze AD-01 through AD-22 and proceed to scaffold P1.
```

**Strategy:**

| Technique | Where it appears | Why it matters |
|---|---|---|
| **Played back the decision before acting on it** | The opening sentence | A one-line restatement of the agreed design is the cheapest possible check that both sides hold the same model. It caught nothing here — which is the point of a cheap check. |
| **Separated ground truth from mechanism** | "reviewed list as ground truth… script remains capable" | Names *why* both halves of AD-21 exist: the committed registry maximises quality for this submission, the Ollama script guarantees the pipeline generalises. Two artifacts, two distinct jobs. |
| **Explicit freeze instruction with a range** | *"freeze AD-01 through AD-22"* | Converts a set of proposals into a baseline. After this point, changing a decision means writing a changelog entry — which is exactly the friction a frozen architecture should have. |
| **Single unambiguous next action** | *"proceed to scaffold P1"* | No re-litigation, no ambiguity about scope. The plan already defined what P1 contains. |

**Outcome:**

- AD-01…AD-22 promoted to `ACCEPTED`; `project_context.md` → v0.6.0, status `BUILDING`.
- P1 scaffolded and verified: **46 tests passing**, typecheck clean, lint clean.
  Delivered P1.1–P1.9 including the walking skeleton and CI.
- **The `docs:check` gate caught two real defects on its first run**, before any human
  looked at the output: the changelog had drifted out of newest-first order, and every
  architectural decision was still marked `PROPOSED` moments after being declared frozen.
  A convention nobody enforces is a convention that decays — this one now fails the build.
- Design notes worth recording: `MentionRepository.upsert` returns whether the mention was
  genuinely new, because "new mention" is the daily alert's entire trigger condition and
  it should be decided by a UNIQUE constraint rather than by application logic.
  `canonicalizeUrl` strips tracking parameters so two providers linking the same article
  collapse to one row. Bucketing lives in pure TypeScript rather than in SQL specifically
  so its boundary cases are unit-testable — 20 of the 46 tests cover it.

**Reflection:** the tooling written to enforce the documentation contract found its first
violation within minutes, committed by the same agent that wrote the contract. Automate
the conventions you intend to keep.

---

## Entry 006 — A predicted risk materialises; unblock and continue

**Date:** 2026-07-31 (late)
**Stage:** P1 remediation, then P2.
**Context:** P1 was delivered with `better-sqlite3` and an explicit warning that it is a
native addon and might fail to install on Windows without C++ build tools.

**Prompt:**

```
You were absolutely right about the P1.6 risk. The `npm install` failed exactly where you
suspected, throwing a `node-gyp` error because it couldn't find Visual Studio C++ Build
Tools to compile `better-sqlite3` for Node v24.18.0.
Please go ahead and swap it out for `node:sqlite` as you suggested. Let me know what
commands to run once you're done updating the core package. Also, you have my green light
to continue working on P2 (the Ollama enrichment script) tonight.
```

**Strategy:**

| Technique | Where it appears | Why it matters |
|---|---|---|
| **Reported the error verbatim, with versions** | *"`node-gyp` error … Node v24.18.0"* | The exact runtime version changed the answer: `node:sqlite` is stable on Node 24 and only experimental on 22. A vaguer report ("install failed") would have produced a worse decision. |
| **Referred to the pre-agreed fallback** | *"swap it out for `node:sqlite` as you suggested"* | The contingency was recorded as a risk against task P1.6 before it happened, so the recovery was a decision already made rather than a decision made under pressure. |
| **Asked for the operator instructions explicitly** | *"Let me know what commands to run"* | Names the human's actual next action. Code that changes without telling its operator what to type is half-delivered. |
| **Batched the unblock with the next authorisation** | *"Also, you have my green light to continue with P2"* | One message resolves the blocker and authorises the following phase — no idle round-trip. Under a deadline this is the difference between a phase finishing tonight and finishing tomorrow. |

**Outcome:**

- **AD-23** — `node:sqlite` replaces `better-sqlite3`. No native compilation, no build
  tools, one fewer third-party dependency. The cost is `better-sqlite3`'s
  `db.transaction()` helper, replaced by a SAVEPOINT-based `withTransaction` that nests
  safely — which matters because a repository managing its own atomicity may still be
  called from inside a larger transaction.
- A toolchain snag worth recording: Vite derives its Node-builtin list from
  `module.builtinModules`, which omits `sqlite` on Node < 24, so it stripped the `node:`
  prefix and tried to resolve `sqlite` from disk. Fixed with a documented **test-only**
  shim, so application code keeps a plain static import and nothing leaks into production.
- **AD-24** — the Ollama client was pulled forward from P4.1 into P2, because registry
  enrichment needs it too. Building it once and sharing it beats a throwaway, and it
  de-risks the critical path by proving the LLM integration two days early.
- P2 delivered: `packages/ollama` (structured output, `temperature: 0` + fixed seed,
  jittered retry that never retries a schema violation, content-hash cache, concurrency
  limiter, health check that prints the exact `ollama pull` command) and
  `packages/registry`. **77 tests passing**, all against a fake Ollama daemon — the suite
  never touches the network or a real model.
- **A self-inflicted honesty bug, caught before delivery.** The first registry run
  reported all 258 rows as `human-approved` because they all came from the reviewed file.
  Only 57 were actually reviewed. Added a `triage-default` provenance tier: a row is not
  signed off merely because it shares a file with rows that were. Overstating provenance
  would have defeated the entire point of tracking it.

**Reflection:** the risk register earned its keep. P1.6 was written down as a risk with a
named fallback before any code existed, so when it fired the response was mechanical
rather than improvised. Naming your likely failures in advance converts an emergency into
a checklist item.

---

## Entry 007 — The first live model output, and what it was allowed to touch

**Date:** 2026-08-01
**Stage:** P2.3 verification, before P3.
**Context:** The enrichment script had never been run against a real model. A 10-company
smoke test on `llama3.2:3b` completed successfully, and the question was whether to
proceed to the full 258-company run or move on to Phase 3.

**Prompt:**

```
Hi. Please read @project_context.md to get fully up to speed on our current architecture
and state. We just successfully ran `npm run enrich -- --limit 10` with Ollama local model
(`llama3.2:3b`). Please verify our current status and let's discuss starting the full
enrichment run or proceeding to Phase 3.
```

**Strategy:**

| Technique | Where it appears | Why it matters |
|---|---|---|
| **Loaded the source of truth first** | *"read @project_context.md to get fully up to speed"* | The assistant starts each session with zero memory. Pointing at one authoritative document is the difference between advice grounded in the plan and advice invented from the file tree. |
| **Asked for verification, not agreement** | *"Please verify our current status"* | The prompt reported success (`we just successfully ran…`) but requested an independent check of it. That framing is what surfaced the failures: a claim of success is a hypothesis, not evidence. |
| **Named the decision, kept it open** | *"discuss starting the full enrichment run **or** proceeding to Phase 3"* | Presenting the real fork invites a recommendation with reasoning. Asking "should we start the full run?" would have invited a yes. |

**Outcome:** the smoke test had succeeded in the narrow sense — 10/10 responses were
schema-valid, the cache worked, the client behaved — and failed in every sense that
mattered.

- **`data/companies.json` had been truncated from 258 records to 10.** `--limit` did not
  change the output path, so a dev loop overwrote a graded deliverable (R8, R24). Fixed:
  a partial run now writes `data/companies.sample-<n>.json` and prints why.
- **The repository was not under git.** P1.1 was marked DONE, `.gitignore` and
  `.github/` existed, `git init` had never been run — which is also why the truncation had
  no undo.
- **The model's content was confidently wrong.** It returned `known: false` for 4 of 10
  companies while still supplying aliases, sectors and negative keywords for them. Among
  those it claimed to know: Stripe was aliased to **"PayPal"**, OncoHost's negative keyword
  was **its own name** — which would have made the P3.6 pre-filter reject 100% of its
  genuine coverage — and OpenEvidence's domain was invented outright.

**AD-26** was added in response: model output is filtered by `sanitizeEnrichment` before it
can influence the registry, and an enrichment that does not survive demotes the row to
`triage-default` rather than being recorded as a source that contributed nothing. Each rule
is a regression test named after the response that motivated it.

**Reflection:** §4.3 already said "enrichment is advisory, never authoritative" and A2/A3
already predicted invented facts. The gap was that this was written as an intention rather
than enforced as code — and an intention does not filter a negative keyword. The real
lesson is narrower than "LLMs hallucinate": a smoke test that only checks *shape* will pass
while every *value* is wrong, so structured-output validation is a floor, not a quality
bar. The 40% `known: false` rate is itself a finding worth publishing — it is a measured
statement about what a 3B model knows about a private VC portfolio, and it belongs in the
README next to the bake-off table.

---

## Entry template (for all subsequent entries)

```markdown
## Entry NNN — <short title>

**Date:**
**Stage:** <phase from project_context.md §8>
**Context:** <what already exists; what changed since the last entry>

**Prompt:**

​```
<verbatim>
​```

**Strategy:** <the prompt-engineering intent — what technique, and why here>

**Outcome:** <what was produced; what was wrong; what the correcting follow-up was>
```

---

## Appendix — Runtime LLM prompts

The prompts sent to the **Ollama** model at execution time are not development prompts
and are therefore versioned as code, not logged here. They live in `prompts/`, each
classification row stores the hash of the exact prompt version that produced it, and
their structure and expected output format are documented in the README as required by
task §4.1.

| File | Purpose | Status |
|---|---|---|
| `prompts/classify.v1.md` | Combined relevance + sentiment classification, structured JSON output | Planned (Phase 4) |
| `prompts/enrich-company.v1.md` | One-off company registry enrichment (aliases, sector, disambiguation hints) | Planned (Phase 2) |
