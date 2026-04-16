# AGENTS

This file documents repository-specific guidance for coding agents.

## Repository overview

- Framework: Next.js
- Package manager: npm
- Main scripts:
  - `npm run dev` - local development server
  - `npm run build` - production build
  - `npm run start` - run built app
  - `npm run lint` - lint the codebase

## Cloud environment setup

- Cloud environment dependency setup is defined in `.cursor/environment.json`.
- Dependency install must be lockfile-first and idempotent:
  - Use `npm ci` when `package-lock.json` exists.
  - Fall back to `npm install` otherwise.
- Current install command:
  - `if [ -f package-lock.json ]; then npm ci --include=dev --no-audit; else npm install --include=dev --no-audit; fi`

## Dependency update rules

- If dependencies are changed, update `package-lock.json` in the same change.
- Keep install commands compatible with both fresh and cached environments.
- Prefer adding dependencies through npm commands instead of manual edits.

## Agent workflow expectations

- Make minimal, task-focused edits.
- Run relevant checks for changed code (at least lint when applicable).
- Keep changes on a feature branch and use clear commit messages.
