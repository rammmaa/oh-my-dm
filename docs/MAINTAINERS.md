# Maintainer guide

## Triage

- Confirm reproduction and remove accidental personal data immediately.
- Replace `status: needs-triage` with `status: confirmed`, `status: blocked`, or close with a clear reason.
- Use `priority: high` only for data exposure, message corruption, widespread connector failure, or release blockers.
- Redirect usage questions to Discussions and security reports to private advisories.
- Ask for a minimal sanitized fixture instead of real conversation content.

## Pull requests

- Require CI, conventional title, and review before merge.
- Prefer squash merge so the PR title becomes the release commit.
- Confirm user-facing copy exists in Korean and English.
- Treat connector automation, session handling, shell execution, and filesystem changes as security-sensitive.
- Do not accept bulk messaging, stealth escalation, rate-limit bypasses, or persisted message archives.

## Repository settings

The checked-in rules are the source of truth for workflows and templates. GitHub branch/ruleset settings should require CI, PR titles, CodeQL, dependency review, conversation resolution, linear history, and at least one approving review. Keep Discussions and private vulnerability reporting enabled.
