import { openrouter } from "@openrouter/ai-sdk-provider"
import { generateText } from "ai"

const SYSTEM_PROMPT = `You are a technical writer for a blog aimed at developers who use Claude Code daily.

Your job is to analyze Claude Code documentation changes and write insightful digest posts. You:
- Speculate thoughtfully on *why* Anthropic made these changes (engineering trade-offs, user feedback, product direction)
- Explain the practical implications for developers using Claude Code
- Stay concise — under 800 words total
- Never just summarize what the changelog says — add analytical value and opinion
- Write in a direct, knowledgeable tone (not hype, not dry)
- Focus on what actually matters for day-to-day Claude Code usage
- Apply William Strunk's Elements of Style as your editorial standard:
  - Omit needless words. Every sentence should earn its place.
  - Use active voice unless passive is clearly better.
  - Write in definite, specific, concrete language. Prefer the function returns null over a null value may be returned.
  - Place emphasis at the end of the sentence. Save your strongest point for last.
  - Prefer the standard sentence structure: subject → verb → object.
  - Paragraphs are units of thought. One idea per paragraph; begin each with a topic sentence.
  - Avoid qualifiers like very, rather, somewhat — they weaken prose.
  - Use parallel structure in lists, headings, and comparisons.
`

// Parse new Update blocks from the changelog diff (lines starting with +)
// Returns array of { version, description, content } objects
function parseNewUpdateBlocks(diff: string): Array<{ version: string; description: string; content: string }> {
  const addedLines = diff.split("\n").filter(l => l.startsWith("+") && !l.startsWith("+++"))
  const joined = addedLines.map(l => l.slice(1)).join("\n")

  const blocks: Array<{ version: string; description: string; content: string }> = []
  const updateRe = /<Update\s+label="([^"]+)"\s+description="([^"]+)">([\s\S]*?)<\/Update>/g
  let m: RegExpExecArray | null
  while ((m = updateRe.exec(joined)) !== null) {
    blocks.push({ version: m[1], description: m[2], content: m[3].trim() })
  }
  return blocks
}

// Extract only added lines from a git show diff for a single file
function extractAddedLines(diff: string, maxLines = 200): string {
  return diff
    .split("\n")
    .filter(l => l.startsWith("+") && !l.startsWith("+++"))
    .map(l => l.slice(1))
    .slice(0, maxLines)
    .join("\n")
}

// Parse --stat output to find top N non-changelog files by insertion count
function topChangedFiles(stat: string, n = 5): string[] {
  return stat
    .split("\n")
    .filter(l => l.includes("|") && l.includes("docs/") && !l.includes("changelog.md"))
    .map(l => {
      const [path, rest] = l.split("|")
      const insertions = parseInt((rest ?? "").match(/(\d+)/)?.[1] ?? "0", 10)
      return { path: path.trim().replace(/^docs\//, ""), insertions }
    })
    .sort((a, b) => b.insertions - a.insertions)
    .slice(0, n)
    .map(f => f.path)
}

async function main() {
  // Derive output filename from commit timestamp — serves as idempotency key
  const timestamp = (await Bun.$`git log -1 --format="%cd" --date=format:"%Y-%m-%d-%H%M%S"`.text()).trim()
  const outputPath = `blog/posts/${timestamp}.md`

  // Idempotency: skip if post already exists for this commit
  const existing = Array.from(new Bun.Glob(outputPath).scanSync("."))
  if (existing.length > 0) {
    console.log(`Post already exists: ${outputPath}, skipping.`)
    process.exit(0)
  }

  // Gather diffs
  const stat = await Bun.$`git diff --stat HEAD^ HEAD -- docs/`.text()
  const changelogDiff = await Bun.$`git show HEAD -- docs/changelog.md`.text()

  // Parse new version blocks — bail if nothing meaningful changed in the changelog
  const updateBlocks = parseNewUpdateBlocks(changelogDiff)
  if (updateBlocks.length === 0) {
    console.log("No new Update blocks in changelog diff, skipping blog post.")
    process.exit(0)
  }

  // Gather context from top changed non-changelog files
  const changedFiles = topChangedFiles(stat)
  const fileContextSections: string[] = []
  for (const file of changedFiles) {
    const fileDiff = await Bun.$`git show HEAD --unified=0 -- docs/${file}`.text()
    const added = extractAddedLines(fileDiff, 200)
    if (added.trim()) {
      fileContextSections.push(`### docs/${file}\n${added}`)
    }
  }

  // Human-readable date for the post title
  const displayDate = timestamp.slice(0, 10)

  const versionsList = updateBlocks
    .map(b => `- **${b.version}** (${b.description}): ${b.content.replace(/\n/g, " ").slice(0, 300)}`)
    .join("\n")

  const fileContext = fileContextSections.length > 0
    ? `## Documentation changes (context)\n${fileContextSections.join("\n\n")}`
    : ""

  const userMessage = `Today is ${displayDate}. Write "Claude Code Digest — ${displayDate}".

## New version releases
${versionsList}

${fileContext}

Structure the post as:
# Claude Code Digest — ${displayDate}
## Version updates
## What the docs reveal

Output only the markdown post, no preamble or explanation.`

  const { text: post } = await generateText({
    model: openrouter("anthropic/claude-opus-4-6"),
    maxOutputTokens: 2048,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: userMessage }],
  })
  if (!post?.trim()) {
    console.error("Claude returned empty response")
    process.exit(1)
  }

  const versions = updateBlocks.map(b => b.version)
  const frontmatter = `---
title: "Claude Code Digest — ${displayDate}"
date: "${displayDate}"
versions: [${versions.join(", ")}]
---

`

  await Bun.write(outputPath, frontmatter + post)
  console.log(`Written: ${outputPath}`)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
