# downagain.dev

- Next.js 16: APIs differ from older versions. Check `node_modules/next/dist/docs/` before using caching or routing APIs.
- Site copy follows `docs/voice.md`: terse, numbers first, no explaining the UI. Read it before writing any user-facing text.
- Workflows for providers, severity, grading and local dev: `.claude/skills/downagain/SKILL.md`.
- Before finishing a change: `bun run lint && bun run test && bun run build`.
