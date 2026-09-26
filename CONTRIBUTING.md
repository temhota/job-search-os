# Contributing

Use Node.js 24, install with `npm ci`, and copy `config/example.json` to the ignored `config/local.json` for local development. Before proposing changes, run `npm test`, `npm run lint`, `npm run build`, and `npm run privacy:audit`.

Use Conventional Commits in the form `type(scope): short imperative summary`. Scope is optional. Types include `feat`, `fix`, `docs`, `test`, `refactor`, `build`, `ci`, and `chore`. Use `!` and a `BREAKING CHANGE:` footer when a change breaks compatibility. Examples: `feat(search): add location filter` and `docs: explain local setup`.

Use a GitHub noreply email for both author and committer metadata. The audit checks all reachable history, so a subsequent deletion will not hide an accidental disclosure.

Use invented people, companies, messages, and example-domain contacts in fixtures, screenshots, demos, issues, and pull requests. Never include real personal data, local account names, user directory paths, credentials, private configuration, mail exports, generated resumes, databases, or backups. Keep private denylist files outside the repository. Inspect staged changes and run the private audit locally when preparing a public release.

Describe the behavior changed and how you verified it. Keep contributions focused. Report security incidents privately through the relevant host's support/security channel; do not paste sensitive material into public discussions.
