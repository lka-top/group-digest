# Group Chat Summary Agent instructions

## Project intent

- This repository builds a group-centric assistant that collects, searches, summarizes, and delivers messages across multiple social platforms.
- QQ through OneBot 11 is the current production path. Keep platform, account, and group identities isolated in storage, APIs, background jobs, and UI state.
- Treat `DESIGN.md` as the current architecture description and `ROADMAP.md` as planned work. Update the relevant document when behavior or architecture changes materially.

## Safety and data rules

- Use only accounts and groups that the user has explicitly authorized. Never connect, switch, or operate an external account without an explicit request.
- Do not add local test groups or generated chat messages to a real user's database.
- Preserve authorization boundaries: realtime ingestion starts after group authorization; reading older messages requires an explicit backfill action and must respect the requested time range.
- Keep platform, account, and group identifiers attached to every message, summary, notification, and scheduled job. Never write data fetched from one account into another account's group.
- Do not print, commit, or expose NapCat WebUI tokens, OneBot tokens, AI API keys, session cookies, or chat content outside the requested local workflow.
- Prefer a dedicated test account for unofficial QQ clients such as NapCat or LLOneBot; never assume a personal account is safe to use.

## Development workflow

- Use the existing npm workflow. Do not introduce or switch package managers unless the user requests it.
- Run `npm run typecheck` after TypeScript changes. Run `npm run build` for changes that affect production behavior or UI integration.
- Preserve unrelated working-tree changes. Do not remove user data, SQLite databases, credentials, or deployment state unless the user explicitly asks.
- Keep adapters behind the platform adapter boundary instead of adding platform-specific assumptions to shared message, summary, or notification code.
- For UI changes, verify loading, empty, error, and narrow-viewport states as applicable.

## Repository-local skills

The skills under `.agents/skills` are intentionally scoped to this repository:

- `security-best-practices`: use only for an explicit security review, security guidance, or secure-by-default implementation request.
- `security-threat-model`: use only when the user asks for a repository-grounded threat model or abuse-path analysis.
- `playwright-interactive`: use for persistent browser-based UI testing and debugging when interactive verification is useful.
- `gh-fix-ci`: use when the user asks to investigate failing GitHub Actions checks; inspect and explain failures before implementing a fix that needs approval.
- `cli-creator`: use when the user asks to create a stable CLI for this project or one of its external integrations.

Read a selected skill's complete `SKILL.md` before following it. Do not apply these project-specific skills in unrelated repositories.
