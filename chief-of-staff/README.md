# Chief of Staff

The automated vetting agent for the AI Tavern. It watches GitHub issues in this
repository and drives membership applications through a labelled state machine —
from "a stranger opened an issue" to "accepted member listed on the site."

Humans still do the judgement calls that matter (the live demo, the council
vote, the "do I trust this person" read). Chief of Staff does the mechanical
work around them: parsing submissions, cloning repos, running code review,
posting reports, inviting members, verifying transfers.

## What it does

Every run of the orchestrator is a poll over GitHub issues. For each issue it
reads the labels, picks the right pipeline, and runs it. State is stored on the
issue itself — in labels and comments — not in a database.

### The state machine

```
application
  └─ status:assessing
       ├─ status:tentative-accept ──► demo ──► status:demo-passed
       │                                          └─ status:champion-needed
       │                                               └─ status:champion-secured
       │                                                    └─ status:code-vetting
       │                                                         ├─ status:code-vetted
       │                                                         │    └─ status:accepted
       │                                                         │         └─ status:transfer-pending
       │                                                         │              └─ status:onboarded
       │                                                         ├─ status:conditions-pending
       │                                                         └─ status:rejected
       ├─ status:needs-discussion
       ├─ status:tentative-reject
       └─ status:awaiting-access  (private repo, bot not invited yet)
```

Any pipeline can also route to `status:needs-council-decision` if something
unexpected happens — that is the human escape hatch.

### The pipelines

| Folder | Trigger | What it does |
|---|---|---|
| `new-application/` | A new `application` issue with no `status:*` label, or `status:awaiting-access` | Parses the issue, checks repo access, optionally clones for code screening, runs the pre-filter agent, posts an assessment report with a verdict. |
| `champion/` | `status:demo-passed` | Posts a "find a champion" prompt on the issue; waits for a council member to commit. |
| `code-vetting/` | `status:champion-secured` | Re-clones the repo and runs a deep code review. Short-circuits if the code was already screened at the same HEAD. |
| `accept-member/` | `status:accepted` | Invites the applicant to the GitHub org, asks them to transfer their repo. |
| `transfer-pending/` | `status:transfer-pending` | Polls until the repo lands under the org, then updates `members.json` and the leverage map, and marks the issue `status:onboarded`. Nudges at 3d/7d, escalates at 14d. |

The `orchestrator.ts` entry point is the only thing you run — it handles
polling, dispatch, and a staleness sweep that dead-letters any issue stuck in a
transient state (`assessing`, `code-vetting`) for longer than its timeout.

### Supporting files

- `github.ts` — thin wrappers around the `gh` CLI (issues, labels, comments).
- `labels.json` — canonical list of labels this pipeline uses. Used when
  setting up a fresh repo: `gh label create` each entry.
- `new-application/agents/` — the prompt files loaded by `spawnAgent`.
- `new-application/rubric.ts` — the 10-dimension scoring rubric and
  anchor definitions, kept beside the prompt so they stay in sync.
- `new-application/leverageMap.json` — the running map of what every member
  contributes. The pre-filter agent reads this to score overlap and combination
  opportunities.

## What it's for

- **Keep the bar high without burning council time.** The pre-filter agent
  writes a structured 10x-member-by-member assessment for every applicant so
  council review starts from evidence, not a cold read of an issue.
- **Make the process auditable.** Every decision is a comment on the issue.
  No shadow DMs, no private spreadsheets.
- **Make "accepted" actually mean something.** Code vetting, repo transfer,
  member grid update, and leverage-map update all happen automatically once
  the humans sign off.

## How to run it

### Prerequisites

- `bun` (the orchestrator and pipelines are TypeScript run under Bun).
- `gh` CLI, authenticated against an account that can read/write issues on
  this repo and invite members to the `aitavern` org.
- `@anthropic-ai/claude-code` installed globally (pipelines spawn `claude -p`
  subprocesses for agent calls).
- `ANTHROPIC_API_KEY` in the environment.

### One-shot against a specific issue

```sh
bun chief-of-staff/orchestrator.ts --issue 42
# or a full URL
bun chief-of-staff/orchestrator.ts --issue https://github.com/aitavern/aitavern.github.io/issues/42
```

Only runs the new-application pipeline. Useful for re-running the pre-filter
after fixing a bug in the rubric.

### Full poll (all pipelines)

```sh
bun chief-of-staff/orchestrator.ts
```

Scans every pipeline's trigger label and processes whatever is there. Safe to
run repeatedly — pipelines are idempotent within a single state.

### Continuous local loop

```sh
./chief-of-staff/run-local.sh                # default 30-minute interval
INTERVAL=600 ./chief-of-staff/run-local.sh   # every 10 minutes
nohup ./chief-of-staff/run-local.sh > chief-of-staff.log 2>&1 &
```

Simple `while true` loop around the orchestrator. Use this on a dev box when
iterating on pipelines — the log output is easier to tail than Actions.

### GitHub Actions (production)

`.github/workflows/chief-of-staff.yml` runs the orchestrator every 30 minutes
on cron, plus on-demand via `workflow_dispatch`. Requires two repo secrets:

- `GH_TOKEN` — PAT with `repo` + `admin:org` scopes.
- `ANTHROPIC_API_KEY`.

This is the canonical way to run it. The local loop exists only for
development.

## First-time repo setup

```sh
# Create every label the pipeline expects
jq -r '.[] | [.name, .color, .description] | @tsv' chief-of-staff/labels.json | \
  while IFS=$'\t' read -r name color desc; do
    gh label create "$name" --color "$color" --description "$desc" --force
  done
```

Then add the two secrets to the repo and the cron will pick up the next new
application on its own.
