# Claude Code Docs Tracker

Scrapes all [Claude Code](https://code.claude.com) documentation pages (~56 pages) daily and tracks changes via git history. When docs change, an AI-written digest post is published to GitHub Pages.

## How it works

1. Fetches the docs nav to discover all page slugs
2. Downloads each page as clean markdown into `docs/`
3. A GitHub Actions workflow runs daily at 06:00 UTC, commits any changes, then calls Claude to write a digest post summarising what changed and why it matters
4. The blog is built as a static site and deployed to GitHub Pages

## Usage

```bash
bun install
bun run scrape       # fetch and write docs/
bun run blog:write   # generate AI digest post from latest commit
bun run blog:build   # build static site → blog/dist/
bun run blog         # write + build
bun test
```

## Structure

```
docs/                   # ~56 markdown files, one per docs page
blog/
  posts/                # generated digest posts (committed)
  dist/                 # built HTML (gitignored, deployed via Pages)
  templates/            # Eta v4 HTML templates
blog-writer.ts          # reads git diff, calls Claude, writes post
blog/build.ts           # static site generator
index.ts                # doc scraper
```

## Setup

- Add `OPENROUTER_API_KEY` secret: repo Settings → Secrets → Actions
- Enable GitHub Pages: Settings → Pages → Source = "GitHub Actions"
