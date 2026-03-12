import { parse } from "node-html-parser";
import { mkdir } from "node:fs/promises";

const BASE_URL = "https://code.claude.com/docs";

// One entry-point slug per category — used as fallback if nav-tabs discovery fails
const SEED_CATEGORY_SLUGS = [
  "overview",
  "sub-agents",
  "third-party-integrations",
  "setup",
  "settings",
  "cli-reference",
  "legal-and-compliance",
];

export function stripBoilerplate(markdown: string): string {
  const lines = markdown.split("\n");
  let start = 0;

  // Skip leading blockquote lines and surrounding blank lines
  while (start < lines.length) {
    const line = lines[start];
    if (line.startsWith(">") || line.trim() === "") {
      start++;
    } else {
      break;
    }
  }

  return lines.slice(start).join("\n").trimEnd();
}

// Parses div.nav-tabs <a> hrefs to get one entry-point slug per category
export function discoverCategorySlugs(html: string): string[] {
  const root = parse(html);
  const navTabs = root.querySelector("div.nav-tabs");
  if (!navTabs) return [];

  const slugs: string[] = [];
  for (const a of navTabs.querySelectorAll("a")) {
    const href = a.getAttribute("href") ?? "";
    const match = href.match(/\/en\/([^/?#]+)/);
    if (match) slugs.push(match[1]);
  }
  return slugs;
}

// Parses #navigation-items li[id] to get all page slugs for a given category
export function discoverPageSlugs(html: string): string[] {
  const root = parse(html);
  const navItems = root.querySelector("#navigation-items");
  if (!navItems) return [];

  const slugs: string[] = [];
  for (const li of navItems.querySelectorAll("li[id]")) {
    const id = li.getAttribute("id") ?? "";
    const match = id.match(/^\/en\/(.+)$/);
    if (match) slugs.push(match[1]);
  }
  return slugs;
}

async function discoverAllSlugs(): Promise<string[]> {
  try {
    // Fetch any page to get nav-tabs (category links)
    const seedRes = await fetch(`${BASE_URL}/en/overview`);
    if (!seedRes.ok) throw new Error(`HTTP ${seedRes.status}`);
    const seedHtml = await seedRes.text();

    let categorySlugs = discoverCategorySlugs(seedHtml);
    if (categorySlugs.length === 0) {
      console.warn("nav-tabs discovery found no categories, using seed list");
      categorySlugs = SEED_CATEGORY_SLUGS;
    } else {
      console.log(`Discovered ${categorySlugs.length} categories from nav-tabs`);
    }

    // Fetch each category's entry page to harvest its sidebar page slugs
    const allSlugs = new Set<string>();
    await Promise.all(
      categorySlugs.map(async (catSlug) => {
        try {
          const res = await fetch(`${BASE_URL}/en/${catSlug}`);
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const html = await res.text();
          const pageSlugs = discoverPageSlugs(html);
          if (pageSlugs.length === 0) {
            // Sidebar not found — at least include the category entry page itself
            allSlugs.add(catSlug);
          } else {
            for (const s of pageSlugs) allSlugs.add(s);
          }
        } catch (err) {
          console.warn(`Failed to fetch category page ${catSlug}: ${err}`);
          allSlugs.add(catSlug);
        }
      })
    );

    if (allSlugs.size === 0) throw new Error("No page slugs discovered");
    console.log(`Discovered ${allSlugs.size} pages total across all categories`);
    return [...allSlugs];
  } catch (err) {
    console.warn(`Discovery failed: ${err}. Falling back to seed category list.`);
    return SEED_CATEGORY_SLUGS;
  }
}

async function fetchMarkdown(slug: string): Promise<string | null> {
  try {
    const res = await fetch(`${BASE_URL}/en/${slug}.md`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    return stripBoilerplate(text);
  } catch (err) {
    console.warn(`Failed to fetch ${slug}: ${err}`);
    return null;
  }
}

async function main() {
  const slugs = await discoverAllSlugs();

  await mkdir("docs", { recursive: true });

  let fetched = 0;
  for (const slug of slugs) {
    const content = await fetchMarkdown(slug);
    if (content === null) continue;
    await Bun.write(`docs/${slug}.md`, content + "\n");
    console.log(`  wrote docs/${slug}.md`);
    fetched++;
  }

  console.log(`\nDone: ${fetched}/${slugs.length} pages saved.`);
}

main();
