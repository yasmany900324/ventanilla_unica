# AGENTS

## Cursor Cloud specific instructions

- This is a Next.js repository managed with npm.
- Cloud environment dependency setup is defined in `.cursor/environment.json`.
- The install command is idempotent and uses lockfile-first behavior:
  - `npm ci` when `package-lock.json` exists
  - fallback to `npm install` otherwise
- If dependencies change, update `package-lock.json` and keep install commands compatible with both fresh and cached states.
