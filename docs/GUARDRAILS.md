# Guardrails: how this repo stays hard to break

Design (Rahul, 2026-11-21): teammates push **directly to main**, no PRs, no approvals. Quality comes from **checks that run on your own laptop**, not from gates on GitHub. GitHub Actions is an optional extra that may be absent. Freeze: Sat Nov 21 2026 2:00 PM ET = `2026-11-21T19:00:00Z`.

## The 30-second version for teammates
- Make your change, then run `npm run ship -- "what you changed"`. It checks everything, commits, pulls your teammates' latest, re-checks, pushes, and marks the version `last-known-good`.
- Anything odd? `npm run health` (PASS/FAIL list with fixes). Broken demo? `npm run rollback`.
- Never use `--no-verify`, `--force`, or edit anything under `kit/`. Teammates must not bypass the hook.

## Layers (local first)
| # | Guard | Where it runs | What it stops |
|---|---|---|---|
| 1 | `.githooks/pre-push` (Node, tiny sh shim; installed by `npm ci` via `prepare`) | every `git push`, including main | pushing anything that fails `npm run check`; prints which protected areas you touched |
| 2 | `npm run ship` | you, on demand | all of layer 1 plus smoke test, e2e (if Chrome), freeze refusal, rebase on latest, last-known-good update |
| 3 | `npm run guard-repo` (inside `npm run check`) | check, hook, ship | forbidden tracked files, secrets, banned model id, Windows-unsafe scripts, missing docs, CI/ruleset/CODEOWNERS drift, test-weakening, hidden characters, dependency churn, new hosts, injection-style text in docs, kit leaks |
| 4 | `npm run guard` | you | guard-repo + docs check + the guardrail tests |
| 5 | `npm run health` / `npm run demo:check` | you, any time | node version, deps, hooks, branch freshness, check, production smoke, no-key fallback drill, display-law geometry |
| 6 | `.github/ci/ci.yml.template` (opt-in; copy to `.github/workflows/ci.yml` to enable) | GitHub, optional | same check, e2e, freeze, and moves `last-known-good` after a green push to main |
| 7 | Ruleset on main | GitHub, admin sets once | only force-push and deleting main (owner can bypass) |

Every guard has a negative test (`scripts/guardrails.test.ts`, `scripts/diffguards.test.ts`) that plants a violation and proves the guard fails. The geometry probe in `scripts/smoke.mjs` plants a 14px line in the clear zone on every run and fails if it is not detected.

## Guard details
- **Tracked files** (`checkTrackedFiles`): no `kit/`, `.env*` (except `.env.example`), `private-notes/`, `.claude/`, `node_modules/`, zip archives; nothing over 2 MB except images in `docs/img`, `docs/decks`, `public/`, and the prebuilt APK.
- **Secrets**: key shapes (Google, GitHub, AWS, OpenAI-style, Slack, private-key blocks), assigned `GEMINI_`/`DEEPGRAM_` keys, any `VITE_*KEY|SECRET|TOKEN` name (VITE_ variables are public in the browser bundle).
- **Model id**: the banned Gemini 2.5 flash id may not appear in code or config (docs may warn about it).
- **Package scripts**: required scripts present; no `rm`, `cp`, `export`, `VAR=x cmd`, single quotes, `$VAR`, backticks (cmd.exe on Windows).
- **Test weakening** (diff vs upstream, else origin/main, else last-known-good): added `.skip`/`.only`/`xit`/`it.todo`, `@ts-expect-error`/`@ts-ignore`/`eslint-disable`, deleted test files, net-removed `expect(` lines, lowered coverage thresholds in `vite.config.ts`, raised `BUDGET_*` in `scripts/check-budgets.mjs`. A line with `skip-reason: <why>` is allowed.
- **Hidden characters** in added lines: bidirectional controls U+202A to U+202E, U+2066 to U+2069, zero-width U+200B to U+200D, and U+FEFF.
- **Dependencies**: package.json and the lockfile must change together; a new dependency needs `DEPS_APPROVED=1` or the word `deps-approved` in the commit message; Firebase and CSS frameworks are banned.
- **New hosts**: a new `https://` host in `src/` or `shared/` must be added to `scripts/guard-allowlist.json` (lead only) and needs an offline fallback.
- **Instruction-file tripwire**: AI agents read `CLAUDE.md`, README and docs, so added lines there that look like instruction overrides, hidden HTML comments, pipe-to-shell commands or long base64 blobs fail until a human adds a reviewed entry to `scripts/guard-allowlist.json`. Write docs about this without quoting the trigger phrases.
- **Kit confidentiality** (local only, because `kit/` exists only on some machines): hashes every file and long line under `kit/` in memory (nothing stored in the repo) and fails if a changed file has a kit file name, identical bytes, or a pasted line. CI cannot run this check.
- **Protected paths** (`scripts/lib/protected.mjs`, advisory `.github/CODEOWNERS`): not blocked. Touching them prints which invariant tests matter, and the full suite must pass anyway. A test asserts every mapped test file exists.
- **Freeze**: `scripts/freeze-guard.mjs` (time injected in tests). `npm run ship` refuses after the freeze; CI job `freeze` fails. Exceptions: `FREEZE_EXCEPTION=1` locally, repository variable `FREEZE_EXCEPTION=1` or PR label `freeze-exception` in CI.
- **Production smoke + fallback drill + geometry** (`scripts/smoke.mjs`): builds, starts the production server on a random port with **no API keys**, checks `/api/health`, checks `/api/assess-wound` answers with the fallback within 3.5 s, loads `/phone` and `/glasses` at 390x844 touch and 640x480 and fails on console errors, page errors or failed requests, then audits the glasses canvas (clear zone empty, text at least 18px, nowrap with ellipsis, card width). Exit code 2 means no Chrome was found (set `CHROME_PATH`).
- **Golden FRD copy**: `src/apps/bedside-glance/glasses/copyAudit.test.ts` (existing) must stay; `guard-repo` fails if it is deleted or stops mentioning the FRD.
- **Not built (cheap enough only later)**: protocol contract fixtures and a `protocolVersion` field. Noted as a gap.

## Rolling back
1. `npm run rollback` makes the files identical to the `last-known-good` tag as a NEW commit, after saving your current state on a `backup/before-rollback-...` branch. Works offline. Add `-- --push` to share it (the plain hook would complain that the rollback deletes later tests). `-- --to <commit>` picks any commit, `-- --yes` skips the question.
2. By hand: `git log --oneline`, then `git revert <sha>` for one bad commit.
3. Tagging by hand: `git tag -f last-known-good <sha>` then `git push origin refs/tags/last-known-good --force`.
4. `last-known-good` only moves forward and only after a fully green `ship` (or green CI push to main). It is deliberately NOT protected by any rule.

## What the admin configures on GitHub (once, Rahul)
1. Ruleset: `gh api -X POST repos/RahulModugula/worn-hackathon/rulesets --input .github/ruleset-main.json`. It has only `non_fast_forward` and `deletion` on the default branch, bypass for the repository admin role. `actor_id` 5 for the admin role is UNVERIFIED: read it from an existing ruleset, or add yourself as a bypass actor in the web UI. Rulesets on free-plan public repos: UNVERIFIED. Fallback, classic branch protection: `gh api -X PUT repos/RahulModugula/worn-hackathon/branches/main/protection` with `allow_force_pushes=false`, `allow_deletions=false`, `enforce_admins=false`, no required reviews, no required checks.
2. Do not add required status checks, required PRs, linear history or merge queue. Merge queue is not available for personal public repos (UNVERIFIED for 2026), and auto-merge is moot without PRs. Do not put `last-known-good` under tag protection; a tag ruleset, if wanted, should cover `refs/tags/v*` only.
3. Freeze enforcement flip: the CI `freeze` check, the `ship` refusal and the pre-push guard are the automation. Tightening the ruleset at 2:00 PM is a manual owner step; a `GITHUB_TOKEN` cannot edit rulesets and a personal token must not be stored in a public repo.
4. Optional: add repository variable `FREEZE_EXCEPTION` only when you want to allow late edits.
5. No Dependabot (noise).

## Enabling CI (optional)
The CI workflow is kept as a template at `.github/ci/ci.yml.template`, not as an active workflow. The token used to push had no `workflow` scope, and GitHub rejects any push that adds or changes `.github/workflows/*` without it.
1. Make sure your token has the `workflow` scope (a fine-grained token needs Workflows: write).
2. Copy the template: `.github/ci/ci.yml.template` to `.github/workflows/ci.yml`. Delete the three header comment lines if you want; they are harmless.
3. Commit and push it. Check the Actions tab. If Actions is off or out of minutes, stop: the local guards are the real enforcement.
`npm run guard` and `npm run check` validate the template at its current path, so it cannot rot while it sits unused.

## If GitHub Actions is disabled or out of minutes
Nothing requires it. Public-repo runners should be free, but billing problems on the account can still block runs (UNVERIFIED until a run happens). The template only has `push` to main, `pull_request` and manual `workflow_dispatch` triggers; if it never runs, the local hook, `ship` and `health` do all the work, and `last-known-good` is moved by `ship`. To check: GitHub repo > Actions tab, or run `npm run health`. To run by hand when it works again: Actions > CI > Run workflow (only after you have enabled it).

## Actions hardening in the CI template
Top-level `permissions: contents: read`; `contents: write` only in the tag-moving job; every action pinned to a full commit SHA (checkout v7.0.1 `3d3c42e`, setup-node v7.1.0 `949feb2`, verified through the GitHub API on 2026-11-21); `persist-credentials: false` except in the one job that pushes the tag; `pull_request` only, never `pull_request_target`; concurrency with cancel-in-progress; job timeouts; Node 22 pinned. `scripts/guardrails.test.ts` enforces each of these.

## Sources (read 2026-11-21 unless noted)
- GitHub docs, available rules for rulesets: https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/available-rules-for-rulesets (rule list: block force pushes, restrict deletions, required status checks, and so on).
- GitHub docs, security hardening for Actions: https://docs.github.com/en/actions/security-for-github-actions/security-guides/security-hardening-for-github-actions (pin to SHA, least-privilege token, avoid pull_request_target with untrusted code).
- GitHub REST rules and rulesets (`~DEFAULT_BRANCH`, `RepositoryRole` bypass, POST body): docs.github.com/en/rest/repos/rules and about-rulesets, as summarized by the lead on 2026-11-21; not re-read by the author of this file.
- Instruction-file injection against coding agents: GitInject, arXiv 2606.09935 (cited by the lead on 2026-11-21; not re-read here, treat the claim as UNVERIFIED by this file's author).
- Trojan Source, CVE-2021-42574 (bidirectional and invisible Unicode in source code): https://trojansource.codes (background knowledge; not re-fetched today).
- Git `core.hooksPath` and the pre-push hook contract (stdin lines of local ref, local sha, remote ref, remote sha): git-scm.com/docs/githooks (background knowledge; behavior verified by the tests and the clone drill below).

## Verified locally on 2026-11-21 (macOS, Node 26)
See the report in the commit or session for command output. Only provable on GitHub: the ruleset applying, Actions running, the `freeze` check on a real PR label, the CI-moved `last-known-good`, and Windows hook execution through Git for Windows (the shim and Node script avoid bash-only syntax, but no Windows machine was available).
