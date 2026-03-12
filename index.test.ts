import { test, expect } from "bun:test";
import { stripBoilerplate, discoverCategorySlugs, discoverPageSlugs } from "./index";

test("strips leading blockquote lines and blank lines", () => {
  const input = `> This is boilerplate.
> More boilerplate.

# Real Content

Some text here.`;

  const result = stripBoilerplate(input);
  expect(result).toBe("# Real Content\n\nSome text here.");
});

test("leaves content unchanged when no boilerplate present", () => {
  const input = `# Title

Body text.`;
  expect(stripBoilerplate(input)).toBe(input);
});

test("handles blank lines before blockquote", () => {
  const input = `
> Boilerplate line.

# Content`;
  const result = stripBoilerplate(input);
  expect(result).toBe("# Content");
});

test("discoverCategorySlugs extracts slugs from div.nav-tabs", () => {
  const html = `
<html><body>
  <div class="nav-tabs">
    <a href="/docs/en/overview">Getting started</a>
    <a href="/docs/en/sub-agents">Build with Claude Code</a>
    <a href="/docs/en/cli-reference">Reference</a>
  </div>
</body></html>`;

  const slugs = discoverCategorySlugs(html);
  expect(slugs).toEqual(["overview", "sub-agents", "cli-reference"]);
});

test("discoverCategorySlugs returns empty array when nav-tabs is absent", () => {
  const html = `<html><body><p>No nav tabs here</p></body></html>`;
  expect(discoverCategorySlugs(html)).toEqual([]);
});

test("discoverPageSlugs extracts slugs from #navigation-items li[id]", () => {
  const html = `
<html><body>
  <ul id="navigation-items">
    <li id="/en/cli-reference"><a href="/docs/en/cli-reference">CLI Reference</a></li>
    <li id="/en/hooks"><a href="/docs/en/hooks">Hooks</a></li>
    <li id="/en/checkpointing"><a href="/docs/en/checkpointing">Checkpointing</a></li>
  </ul>
</body></html>`;

  const slugs = discoverPageSlugs(html);
  expect(slugs).toEqual(["cli-reference", "hooks", "checkpointing"]);
});

test("discoverPageSlugs returns empty array when #navigation-items is absent", () => {
  const html = `<html><body><p>No nav items</p></body></html>`;
  expect(discoverPageSlugs(html)).toEqual([]);
});

test("discoverPageSlugs ignores li elements without /en/ id pattern", () => {
  const html = `
<html><body>
  <ul id="navigation-items">
    <li id="/en/valid-slug"><a>Valid</a></li>
    <li id="no-prefix"><a>No prefix</a></li>
    <li><a>No id at all</a></li>
  </ul>
</body></html>`;

  const slugs = discoverPageSlugs(html);
  expect(slugs).toEqual(["valid-slug"]);
});
