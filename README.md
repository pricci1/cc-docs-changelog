# Claude Code Docs Tracker

Scrapes **all** [Claude Code](https://code.claude.com) documentation pages (~56 pages across 7 categories) and tracks content changes over time using git history.

## How it works

1. Fetches `div.nav-tabs` from any docs page to discover all category entry slugs
2. Fetches each category's sidebar (`#navigation-items`) to discover all page slugs
3. Downloads each page as clean markdown via the `.md` URL variant (e.g. `/docs/en/cli-reference.md`)
4. Strips boilerplate headers and writes files to `docs/`
5. A GitHub Actions workflow runs daily at 06:00 UTC and commits any changes — git history is the changelog

## Usage

```bash
bun install
bun run index.ts   # fetches and writes docs/
bun test           # runs unit tests
```

## Structure

```
docs/
  overview.md
  quickstart.md
  cli-reference.md
  hooks.md
  ...                # ~56 files, one per documentation page
```
