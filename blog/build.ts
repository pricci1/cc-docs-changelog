import { Eta } from "eta"

const eta = new Eta({ views: import.meta.dir + "/templates" })

interface PostMeta {
  slug: string
  title: string
  date: string
  versions: string[]
}

// Parse YAML-ish frontmatter block between the first two "---" lines
function parseFrontmatter(source: string): { meta: Record<string, string>; body: string } {
  const lines = source.split("\n")
  if (lines[0].trim() !== "---") return { meta: {}, body: source }

  const endIdx = lines.indexOf("---", 1)
  if (endIdx === -1) return { meta: {}, body: source }

  const meta: Record<string, string> = {}
  for (const line of lines.slice(1, endIdx)) {
    const colon = line.indexOf(":")
    if (colon === -1) continue
    const key = line.slice(0, colon).trim()
    const val = line.slice(colon + 1).trim().replace(/^["']|["']$/g, "")
    meta[key] = val
  }
  return { meta, body: lines.slice(endIdx + 1).join("\n").trimStart() }
}

// Parse the versions array from frontmatter string like "[2.1.76, 2.1.75]"
function parseVersions(raw: string | undefined): string[] {
  if (!raw) return []
  return raw
    .replace(/^\[|\]$/g, "")
    .split(",")
    .map(v => v.trim())
    .filter(Boolean)
}

async function main() {
  const postsDir = "blog/posts"
  const distDir = "blog/dist"
  const distPostsDir = `${distDir}/posts`

  await Bun.$`mkdir -p ${distPostsDir}`

  const postFiles = Array.from(new Bun.Glob("*.md").scanSync(postsDir)).sort().reverse()

  const allPosts: PostMeta[] = []

  for (const filename of postFiles) {
    const slug = filename.replace(/\.md$/, "")
    const source = await Bun.file(`${postsDir}/${filename}`).text()
    const { meta, body } = parseFrontmatter(source)

    const title = meta.title || slug
    const date = meta.date || slug.slice(0, 10)
    const versions = parseVersions(meta.versions)

    const htmlBody = Bun.markdown.html(body)
    const html = eta.render("./post", { title, htmlBody, versions, date })

    await Bun.write(`${distPostsDir}/${slug}.html`, html)
    allPosts.push({ slug, title, date, versions })
  }

  const indexHtml = eta.render("./index", { posts: allPosts })
  await Bun.write(`${distDir}/index.html`, indexHtml)

  console.log(`Built ${allPosts.length} post(s) → ${distDir}/`)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
