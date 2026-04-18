# AI Tavern

A private guild for AI builders at Network School.

## What it is

AI Tavern is a small, contribution-gated group for people who have already built something real with AI — not people learning, exploring, or collecting prompts. Every member arrives with a production-grade AI system that they open up to the rest of the club.

The core rule: **every new member must 10x every existing member.** If what you've built wouldn't make every person in the room meaningfully more powerful, it's not a fit.

## How membership works

There's no application form in the traditional sense. You submit what you've built, an AI agent vets it, and the room votes.

### The process

1. **Apply** — [Open a new application](https://github.com/aitavern/aitavern.github.io/issues/new?template=application.yml). Submit a link to your repo, describe what it does, and explain how it 10x's every existing member. You must invite `jinglescore` as a read-only collaborator on your repo before submitting.

2. **Automated pre-filter** — The Chief of Staff agent picks up your issue, parses your submission, and — if you opted into code screening — clones your repo. It then runs a two-phase assessment:
   - **Reconnaissance** — language, framework, commit history, test coverage, originality signals, build quality.
   - **Leverage & verdict** — scores your submission on ten quality dimensions, evaluates it against every current member's contribution using the 10x-everyone test, checks for overlap, and identifies combination opportunities.

3. **Assessment report** — The agent posts a detailed report on your issue with a verdict (`tentative-accept`, `tentative-reject`, `needs-discussion`), a 10x member-by-member breakdown, and a concrete next-step block so the council knows what to do.

4. **Live demo** — If the verdict is tentative-accept, you present live to existing members. They vote.

5. **Champion** — If the council votes yes, one existing member volunteers as your Champion. They commit to installing your tool so you have at least one person genuinely using it before you're onboarded.

6. **Code vetting** — Once a Champion is secured, the agent performs a deep code review against the code you demoed. This step is skipped if the code was already screened during step 2 and hasn't changed since.

7. **Onboarding** — If the code check is clean, the agent invites you to the GitHub org and asks you to transfer your repo to `aitavern`. Once the transfer lands, you're added to `members.json`, your contribution is added to the leverage map, and you're listed on the site. You do laptop-to-laptop installs with every member so everyone actually has your tool running.

No contribution, no membership. No exceptions.

### How the automation works

Everything in steps 2, 3, 6, and 7 runs as a polling agent on a 30-minute GitHub Actions cron. The whole pipeline is label-driven, auditable, and open-source — see [`chief-of-staff/README.md`](chief-of-staff/README.md) for the full architecture, the state machine, and how to run it locally.

## What members get

- Every other member's production AI system, installed by the person who built it
- A peer group operating at the same level — no explaining basics
- A weekly digest of what's working across the room
- A trust network for hiring, collabs, and referrals

## What the club gets from you

- One production system, open to all members
- Willingness to do installs on request
- Showing up — inactive members get removed
- A handoff note so your contribution survives if you leave
