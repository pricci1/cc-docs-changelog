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
- Use headings (##, ###) to organize your analysis into named sections — don't write unbroken prose blocks
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

// Parse --stat output to get all non-changelog changed doc files
function getAllChangedFiles(stat: string): string[] {
  return stat
    .split("\n")
    .filter(l => l.includes("|") && l.includes("docs/") && !l.includes("changelog.md"))
    .map(l => l.split("|")[0].trim().replace(/^docs\//, ""))
}

const SUBAGENT_SYSTEM = `You analyze a single Claude Code documentation file diff.
Extract key insights: what was added or changed, what it means for users.
Be concise — 1-3 bullet points or sentences per diff block. No preamble.

Ignore the following — they carry no signal for users:
- Wording or copy tweaks that don't change meaning (rephrasing, grammar fixes, tone adjustments)
- Content moved between sections without modification
- Formatting-only changes (whitespace, punctuation, heading levels)

If a diff contains only the above, output nothing. Remember, no preamble.`

const SUBAGENT_MODEL = process.env.SUBAGENT_MODEL || "google/gemini-3.1-flash-lite-preview"
const SYNTHESIS_MODEL = process.env.SYNTHESIS_MODEL || "google/gemini-3.1-pro-preview"

// Uses flash-lite for cheap parallel extraction; pro model handles synthesis
async function analyzeFileDiff(file: string, diff: string): Promise<string> {
  const { text } = await generateText({
    model: openrouter(SUBAGENT_MODEL),
    system: SUBAGENT_SYSTEM,
    messages: [{ role: "user", content: `File: docs/${file}\n\n${diff}` }],
    maxOutputTokens: 512,
  })
  return `### docs/${file}\n${text.trim()}`
}

async function main() {
  const commit = process.argv[2]
  if (!commit) {
    console.error("Usage: bun run blog-writer.ts <commit-sha>")
    process.exit(1)
  }

  // Derive output filename from commit timestamp — serves as idempotency key
  const timestamp = (await Bun.$`git log -1 --format="%cd" --date=format:"%Y-%m-%d-%H%M%S" ${commit}`.text()).trim()
  const outputPath = `blog/posts/${timestamp}.md`

  // Gather diffs
  const stat = await Bun.$`git diff --stat ${commit}^ ${commit} -- docs/`.text()
  const changelogDiff = await Bun.$`git show ${commit} -- docs/changelog.md`.text()

  const updateBlocks = parseNewUpdateBlocks(changelogDiff)

  // Dispatch all changed files to subagents in parallel for insight extraction
  const changedFiles = getAllChangedFiles(stat)
  const subagentInsights = await Promise.all(
    changedFiles.map(async file => {
      const fileDiff = await Bun.$`git show ${commit} --unified=0 -- docs/${file}`.text()
      const fullDiff = extractAddedLines(fileDiff, 300)
      if (!fullDiff.trim()) return null
      return analyzeFileDiff(file, fullDiff)
    })
  ).then(results => results.filter(Boolean) as string[])

  const sha = (await Bun.$`git rev-parse ${commit}`.text()).trim()
  const commitUrl = `https://github.com/pricci1/cc-docs-changelog/commit/${sha}`

  // Human-readable datetime for the post title
  const displayDate = timestamp.slice(0, 10)
  const displayTime = timestamp.slice(11).replace(/(\d{2})(\d{2})(\d{2})/, "$1:$2:$3")
  const displayDatetime = `${displayDate} ${displayTime}`

  const versionsSection = updateBlocks.length > 0
    ? `## New version releases\n${updateBlocks.map(b => `- **${b.version}** (${b.description}): ${b.content.replace(/\n/g, " ").slice(0, 300)}`).join("\n")}`
    : ""

  const fileContext = subagentInsights.length > 0
    ? `## Subagent insights (per changed file)\n${subagentInsights.join("\n\n")}`
    : ""

  const userMessage = `Today is ${displayDatetime}. Write "Claude Code Digest — ${displayDatetime}".

${versionsSection}

${fileContext}

Structure the post as:
# Claude Code Digest — ${displayDatetime}
${updateBlocks.length > 0 ? "## Version updates" : ""}
## What the docs reveal

If there are no version updates, omit the "Version updates" section entirely.
Output only the markdown post, no preamble or explanation.`

  const { text: rawPost } = await generateText({
    model: openrouter(SYNTHESIS_MODEL),
    maxOutputTokens: 8192,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: userMessage }],
  })
  if (!rawPost?.trim()) {
    console.error("Claude returned empty response")
    process.exit(1)
  }

  const versions = updateBlocks.map(b => b.version)
  const frontmatter = `---
title: "Claude Code Digest — ${displayDatetime}"
date: "${displayDate}"
versions: [${versions.join(", ")}]
sha: ${sha}
---

`

  await Bun.write(outputPath, frontmatter + rawPost)
  console.log(`Written: ${outputPath}`)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
