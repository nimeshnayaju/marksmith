import { describe, expect, it } from "vitest";
import { type InlineNode, unescapeString } from "../inline-parser";
import { type BlockNode, MarkdownParser } from "../markdown-parser";
import tests from "./commonmark-spec.json" with { type: "json" };

describe("Commonmark", () => {
	const sections: Map<
		string,
		Array<{ markdown: string; html: string; example: number }>
	> = new Map();
	for (const test of tests) {
		let details = sections.get(test.section);
		if (details === undefined) {
			details = [];
			sections.set(test.section, details);
		}
		details.push({
			markdown: test.markdown,
			html: test.html,
			example: test.example,
		});
	}

	for (const [section, details] of Array.from(sections.entries())) {
		describe(section, () => {
			for (const detail of details) {
				it(`Example ${detail.example}`, () => {
					const nodes = new MarkdownParser().parse(detail.markdown);
					expect(render(nodes)).toBe(detail.html);
				});
			}
		});
	}
});

describe("Github flavoured markdown", () => {
	describe("Tables", () => {
		it("parses a basic table with header and body", () => {
			const parser = new MarkdownParser();
			const nodes = parser.parse(
				"| foo | bar |\n| --- | --- |\n| baz | bim |\n",
			);
			expect(nodes).toEqual([
				{
					type: "table",
					head: {
						cells: [
							{ children: [{ type: "text", text: "foo" }], align: undefined },
							{ children: [{ type: "text", text: "bar" }], align: undefined },
						],
					},
					body: {
						rows: [
							{
								cells: [
									{
										children: [{ type: "text", text: "baz" }],
										align: undefined,
									},
									{
										children: [{ type: "text", text: "bim" }],
										align: undefined,
									},
								],
							},
						],
					},
				},
			]);
		});

		it("parses a table with alignment and uneven cell widths", () => {
			const parser = new MarkdownParser();
			const nodes = parser.parse(
				"| abc | defghi |\n:-: | -----------:\nbar | baz\n",
			);
			expect(nodes).toEqual([
				{
					type: "table",
					head: {
						cells: [
							{ children: [{ type: "text", text: "abc" }], align: "center" },
							{
								children: [{ type: "text", text: "defghi" }],
								align: "right",
							},
						],
					},
					body: {
						rows: [
							{
								cells: [
									{
										children: [{ type: "text", text: "bar" }],
										align: "center",
									},
									{
										children: [{ type: "text", text: "baz" }],
										align: "right",
									},
								],
							},
						],
					},
				},
			]);
		});

		it("parses a table with escaped pipes in cells", () => {
			const parser = new MarkdownParser();
			const nodes = parser.parse(
				"| f\\|oo  |\n| ------ |\n| b `\\|` az |\n| b **\\|** im |\n",
			);
			expect(nodes).toEqual([
				{
					type: "table",
					head: {
						cells: [
							{
								align: undefined,
								children: [{ type: "text", text: "f|oo" }],
							},
						],
					},
					body: {
						rows: [
							{
								cells: [
									{
										align: undefined,
										children: [
											{ type: "text", text: "b " },
											{ type: "code-span", text: "|" },
											{ type: "text", text: " az" },
										],
									},
								],
							},
							{
								cells: [
									{
										align: undefined,
										children: [
											{ type: "text", text: "b " },
											{
												type: "strong",
												children: [{ type: "text", text: "|" }],
											},
											{ type: "text", text: " im" },
										],
									},
								],
							},
						],
					},
				},
			]);
		});

		it("stops a table when a blockquote starts", () => {
			const parser = new MarkdownParser();
			const nodes = parser.parse(
				"| abc | def |\n| --- | --- |\n| bar | baz |\n> bar\n",
			);
			expect(nodes).toEqual([
				{
					type: "table",
					head: {
						cells: [
							{
								align: undefined,
								children: [{ type: "text", text: "abc" }],
							},
							{
								align: undefined,
								children: [{ type: "text", text: "def" }],
							},
						],
					},
					body: {
						rows: [
							{
								cells: [
									{
										align: undefined,
										children: [{ type: "text", text: "bar" }],
									},
									{
										align: undefined,
										children: [{ type: "text", text: "baz" }],
									},
								],
							},
						],
					},
				},
				{
					type: "blockquote",
					children: [
						{
							type: "paragraph",
							children: [{ type: "text", text: "bar" }],
						},
					],
				},
			]);
		});

		it("treats content after blank line as paragraph, not table row", () => {
			const parser = new MarkdownParser();
			const nodes = parser.parse(
				"| abc | def |\n| --- | --- |\n| bar | baz |\nbar\n\nbar\n",
			);
			expect(nodes).toEqual([
				{
					type: "table",
					head: {
						cells: [
							{
								align: undefined,
								children: [{ type: "text", text: "abc" }],
							},
							{
								align: undefined,
								children: [{ type: "text", text: "def" }],
							},
						],
					},
					body: {
						rows: [
							{
								cells: [
									{
										align: undefined,
										children: [{ type: "text", text: "bar" }],
									},
									{
										align: undefined,
										children: [{ type: "text", text: "baz" }],
									},
								],
							},
							{
								cells: [
									{
										align: undefined,
										children: [{ type: "text", text: "bar" }],
									},
									{ align: undefined, children: [] },
								],
							},
						],
					},
				},
				{ type: "paragraph", children: [{ type: "text", text: "bar" }] },
			]);
		});

		it("does not recognize a table when header and delimiter columns mismatch", () => {
			const parser = new MarkdownParser();
			const nodes = parser.parse("| abc | def |\n| --- |\n| bar |\n");
			expect(nodes).toEqual([
				{
					type: "paragraph",
					children: [
						{ type: "text", text: "| abc | def |" },
						{ type: "softbreak" },
						{ type: "text", text: "| --- |" },
						{ type: "softbreak" },
						{ type: "text", text: "| bar |" },
					],
				},
			]);
		});

		it("handles table rows with too few and too many cells", () => {
			const parser = new MarkdownParser();
			const nodes = parser.parse(
				"| abc | def |\n| --- | --- |\n| bar |\n| bar | baz | boo |\n",
			);
			expect(nodes).toEqual([
				{
					type: "table",
					head: {
						cells: [
							{
								align: undefined,
								children: [{ type: "text", text: "abc" }],
							},
							{
								align: undefined,
								children: [{ type: "text", text: "def" }],
							},
						],
					},
					body: {
						rows: [
							{
								cells: [
									{
										align: undefined,
										children: [{ type: "text", text: "bar" }],
									},
									{ align: undefined, children: [] },
								],
							},
							{
								cells: [
									{
										align: undefined,
										children: [{ type: "text", text: "bar" }],
									},
									{
										align: undefined,
										children: [{ type: "text", text: "baz" }],
									},
								],
							},
						],
					},
				},
			]);
		});

		it("renders a table with header only and no tbody", () => {
			const parser = new MarkdownParser();
			const nodes = parser.parse("| abc | def |\n| --- | --- |\n");
			expect(nodes).toEqual([
				{
					type: "table",
					head: {
						cells: [
							{
								align: undefined,
								children: [{ type: "text", text: "abc" }],
							},
							{
								align: undefined,
								children: [{ type: "text", text: "def" }],
							},
						],
					},
					body: { rows: [] },
				},
			]);
		});
	});
});

describe("MarkdownParser (stream: true)", () => {
	describe("fenced code blocks", () => {
		it("does not return incomplete fenced code block (backticks)", () => {
			const parser = new MarkdownParser();
			const result = parser.parse("```js\nconst x = 1;", { stream: true });
			expect(result).toEqual([]);
		});

		it("returns complete fenced code block", () => {
			const parser = new MarkdownParser();
			const result = parser.parse("```js\nconst x = 1;\n```\n", {
				stream: true,
			});
			expect(result).toHaveLength(1);
			expect(result[0]).toMatchObject({
				type: "code-block",
				info: "js",
				content: "const x = 1;\n",
			});
		});

		it("accumulates fenced code block across multiple calls", () => {
			const parser = new MarkdownParser();

			// First chunk: opening fence
			let result = parser.parse("```js\n", { stream: true });
			expect(result).toEqual([]);

			// Second chunk: code content
			result = parser.parse("const x = 1;\n", { stream: true });
			expect(result).toEqual([]);

			// Third chunk: closing fence
			result = parser.parse("```\n", { stream: true });
			expect(result).toHaveLength(1);
			expect(result[0]).toMatchObject({
				type: "code-block",
				info: "js",
				content: "const x = 1;\n",
			});
		});

		it("flushes incomplete fenced code block when switching to non-stream", () => {
			const parser = new MarkdownParser();

			// Start streaming with incomplete code block
			let result = parser.parse("```js\nconst x = 1;", { stream: true });
			expect(result).toEqual([]);

			// Flush by calling without stream option
			result = parser.parse("");
			expect(result).toHaveLength(1);
			expect(result[0]).toMatchObject({
				type: "code-block",
				info: "js",
			});
		});
	});

	describe("indented code blocks", () => {
		it("does not return incomplete indented code block", () => {
			const parser = new MarkdownParser();
			const result = parser.parse("    const x = 1;\n    const y = 2;", {
				stream: true,
			});
			expect(result).toEqual([]);
		});

		it("returns complete indented code block", () => {
			const parser = new MarkdownParser();
			const result = parser.parse("    const x = 1;\n\nParagraph\n\n", {
				stream: true,
			});
			expect(result).toHaveLength(2);
			expect(result[0]).toMatchObject({
				type: "code-block",
				content: "const x = 1;\n",
			});
			expect(result[1]).toMatchObject({
				type: "paragraph",
			});
		});

		it("flushes incomplete indented code block when switching to non-stream", () => {
			const parser = new MarkdownParser();

			// Start streaming with incomplete indented code block
			let result = parser.parse("    const x = 1;", { stream: true });
			expect(result).toEqual([]);

			// Flush by calling without stream option
			result = parser.parse("");
			expect(result).toHaveLength(1);
			expect(result[0]).toMatchObject({
				type: "code-block",
			});
		});
	});

	describe("paragraphs", () => {
		it("does not return incomplete paragraph", () => {
			const parser = new MarkdownParser();
			const result = parser.parse("This is a paragraph", { stream: true });
			expect(result).toEqual([]);
		});

		it("does not return incomplete paragraph with multiple lines", () => {
			const parser = new MarkdownParser();
			const result = parser.parse("Line 1\nLine 2\nLine 3", { stream: true });
			expect(result).toEqual([]);
		});

		it("returns paragraph followed by blank line", () => {
			const parser = new MarkdownParser();
			const result = parser.parse("This is a paragraph\n\n", { stream: true });
			expect(result).toHaveLength(1);
			expect(result[0]).toMatchObject({
				type: "paragraph",
			});
		});

		it("accumulates paragraph across multiple calls", () => {
			const parser = new MarkdownParser();

			// First chunk: start of paragraph
			let result = parser.parse("Hello ", { stream: true });
			expect(result).toEqual([]);

			// Second chunk: more text
			result = parser.parse("world", { stream: true });
			expect(result).toEqual([]);

			// Third chunk: blank line ends paragraph
			result = parser.parse("\n\n", { stream: true });
			expect(result).toHaveLength(1);
			expect(result[0]).toMatchObject({
				type: "paragraph",
			});
		});

		it("returns complete paragraph blocks while buffering incomplete ones", () => {
			const parser = new MarkdownParser();

			// Heading followed by incomplete paragraph
			let result = parser.parse("# Heading\n\nParagraph text", {
				stream: true,
			});
			expect(result).toHaveLength(1);
			expect(result[0]).toMatchObject({
				type: "heading",
				level: 1,
			});

			// Complete the paragraph
			result = parser.parse("\n\n", { stream: true });
			expect(result).toHaveLength(1);
			expect(result[0]).toMatchObject({
				type: "paragraph",
			});
		});

		it("flushes incomplete paragraph when switching to non-stream", () => {
			const parser = new MarkdownParser();

			// Start streaming with incomplete paragraph
			let result = parser.parse("Hello world", { stream: true });
			expect(result).toEqual([]);

			// Flush by calling without stream option
			result = parser.parse("");
			expect(result).toHaveLength(1);
			expect(result[0]).toMatchObject({
				type: "paragraph",
			});
		});
	});

	describe("ATX headings", () => {
		it("does not return incomplete heading", () => {
			const parser = new MarkdownParser();
			const result = parser.parse("# Heading", { stream: true });
			expect(result).toEqual([]);
		});

		it("returns complete heading (ATX)", () => {
			const parser = new MarkdownParser();
			const result = parser.parse("# Heading\n", { stream: true });
			expect(result).toHaveLength(1);
			expect(result[0]).toMatchObject({
				type: "heading",
				level: 1,
			});
		});

		it("flushes incomplete heading when switching to non-stream", () => {
			const parser = new MarkdownParser();
			let result = parser.parse("# Heading", { stream: true });
			expect(result).toEqual([]);

			result = parser.parse("");
			expect(result).toHaveLength(1);
			expect(result[0]).toMatchObject({ type: "heading", level: 1 });
		});

		it("accumulates heading across multiple calls", () => {
			const parser = new MarkdownParser();
			let result = parser.parse("# Heading", { stream: true });
			expect(result).toEqual([]);

			result = parser.parse("\n", { stream: true });
			expect(result).toHaveLength(1);
			expect(result[0]).toMatchObject({ type: "heading", level: 1 });
		});
	});

	describe("thematic breaks", () => {
		it("returns thematic break", () => {
			const parser = new MarkdownParser();
			const result = parser.parse("---\n", { stream: true });
			expect(result).toHaveLength(1);
			expect(result[0]).toMatchObject({
				type: "thematic-break",
			});
		});
	});

	describe("list", () => {
		it("does not return incomplete list item", () => {
			const parser = new MarkdownParser();
			const result = parser.parse("- List item", { stream: true });
			expect(result).toEqual([]);
		});

		it("returns complete list item", () => {
			const parser = new MarkdownParser();
			const result = parser.parse("- List item\n> Block quote\n", {
				stream: true,
			});
			expect(result).toHaveLength(1);
			expect(result[0]).toMatchObject({ type: "list" });
		});
	});

	it("handles multiple complete blocks in sequence", () => {
		const parser = new MarkdownParser();

		const result = parser.parse("# H1\n\n## H2\n\n---\n\n", { stream: true });
		expect(result).toHaveLength(3);
		expect(result[0]).toMatchObject({ type: "heading", level: 1 });
		expect(result[1]).toMatchObject({ type: "heading", level: 2 });
		expect(result[2]).toMatchObject({ type: "thematic-break" });
	});
});

function render(nodes: BlockNode[]): string {
	let result = "";
	for (const node of nodes) {
		switch (node.type) {
			case "paragraph": {
				result += `<p>${renderInline(node.children)}</p>\n`;
				break;
			}
			case "heading": {
				result += `<h${node.level}>${renderInline(node.children)}</h${node.level}>\n`;
				break;
			}
			case "thematic-break": {
				result += "<hr />\n";
				break;
			}
			case "code-block": {
				const info = node.info ? unescapeString(node.info).trim() : undefined;

				let language: string | undefined;
				if (info !== undefined) {
					[language] = info.split(/(\s+)/g);
				}
				const content = escapeHTML(node.content);
				if (content.indexOf("<pre") === 0) {
					return content + "\n";
				}

				result += `<pre><code${language ? ` class="language-${language}"` : ""}>${content}</code></pre>\n`;
				break;
			}
			case "blockquote": {
				result += `<blockquote>\n${render(node.children)}</blockquote>\n`;
				break;
			}
			case "list": {
				let content = "";
				for (const item of node.items) {
					if (item.children.length === 0) {
						content += "<li></li>\n";
						continue;
					}

					if (node.tight) {
						const firstItem = item.children[0];
						// If the list is tight, and all the children of the list item are paragraphs, we render the list item inline without any <p> tags.
						if (item.children.every((child) => child.type === "paragraph")) {
							content += "<li>";
							for (const child of item.children) {
								content += renderInline(child.children);
							}
							content += "</li>\n";
						}
						// Otherwise, if the list is tight, and the first child of the list item is a paragraph, we render the first paragraph inline, followed by a newline, and then the rest of the children as blocks.
						else if (firstItem?.type === "paragraph") {
							content += "<li>";
							content += renderInline(firstItem.children);
							content += "\n";
							content += render(item.children.slice(1));
							content += "</li>\n";
						}
						// Otherwise, if the list is tight with mixed content, we render paragraphs inline and the rest of the children as blocks.
						else {
							content += "<li>\n";
							for (const child of item.children) {
								if (child.type === "paragraph") {
									content += renderInline(child.children);
								} else {
									content += render([child]);
								}
							}
							content += "</li>\n";
						}
					}
					// If the list is loose, we render all children as blocks
					else {
						content += "<li>\n";
						content += render(item.children);
						content += "</li>\n";
					}
				}

				if (node.kind === "ordered") {
					result += `<ol${node.start !== 1 ? ` start="${node.start}"` : ""}>\n${content}</ol>\n`;
				} else {
					result += `<ul>\n${content}</ul>\n`;
				}
				break;
			}
			case "table":
				break;
			case "html-block": {
				result += node.content + "\n";
				break;
			}
			default:
				break;
		}
	}
	return result;
}

function renderInline(nodes: InlineNode[]): string {
	let result = "";
	for (const node of nodes) {
		switch (node.type) {
			case "text":
				result += escapeHTML(node.text);
				break;
			case "code-span":
				result += `<code>${escapeHTML(node.text)}</code>`;
				break;
			case "softbreak":
				result += "\n";
				break;
			case "hardbreak":
				result += "<br />\n";
				break;
			case "link":
				result += `<a href=${node.href ? `"${escapeHTML(node.href)}"` : '""'}${node.title ? ` title="${escapeHTML(node.title)}"` : ""}>${renderInline(node.children)}</a>`;
				break;
			case "image":
				result += `<img src=${node.href ? `"${escapeHTML(node.href)}"` : '""'} alt=${node.children.length > 0 ? `"${renderInlineAsPlainText(node.children)}"` : '""'}${node.title ? ` title="${escapeHTML(node.title)}"` : ""} />`;
				break;
			case "html":
				result += node.content;
				break;
			case "emphasis":
				result += `<em>${renderInline(node.children)}</em>`;
				break;
			case "strong":
				result += `<strong>${renderInline(node.children)}</strong>`;
				break;
			default:
				break;
		}
	}
	return result;
}

function renderInlineAsPlainText(nodes: InlineNode[]): string {
	let result = "";
	for (const node of nodes) {
		switch (node.type) {
			case "text":
			case "code-span":
				result += node.text;
				break;
			case "image":
			case "link":
				result += renderInlineAsPlainText(node.children);
				break;
			case "strong":
			case "emphasis":
				result += renderInlineAsPlainText(node.children);
				break;
			case "html":
				result += node.content;
				break;
			case "hardbreak":
			case "softbreak":
				result += "\n";
				break;
			default:
				break;
		}
	}
	return result;
}

function escapeHTML(text: string): string {
	if (/[&<>"]/.test(text)) {
		return text.replace(/[&<>"]/g, (match) => {
			if (match === "&") return "&amp;";
			if (match === "<") return "&lt;";
			if (match === ">") return "&gt;";
			if (match === '"') return "&quot;";
			return match;
		});
	}
	return text;
}
