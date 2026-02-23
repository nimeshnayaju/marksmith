# `markdown-parser`

A markdown parser with streaming support, suitable for incrementally parsing LLM markdown streams. Parses markdown into a structured fully typed tree of nodes, following the [CommonMark](https://commonmark.org/) specification. It supports streaming/incremental parsing, so you can feed it growing input and emit only the blocks that have become finalized.

## Installation

```bash
npm install markdown-parser
```

## Usage

```typescript
import { MarkdownParser } from "markdown-parser";

const parser = new MarkdownParser();

// Parse complete markdown
const nodes = parser.parse("# Hello World\nThis is a paragraph.");
// [
//   { type: "heading", level: 1, children: [{ type: "text", text: "Hello World" }] },
//   { type: "paragraph", children: [{ type: "text", text: "This is a paragraph." }] }
// ]

// Parse with streaming mode (for incremental content)
const partialNodes = parser.parse("# Hello World\nThis", { stream: true });
// Emits heading, but not the paragraph (still open)
// [
//   { type: "heading", level: 1, children: [{ type: "text", text: "Hello World" }] },
// ]

// Continue parsing as more content arrives
const moreNodes = parser.parse(" is a paragraph\n\nThis is another paragraph.", { stream: true });
// Emits the paragraph
// [
//   { type: "paragraph", children: [{ type: "text", text: "This is a paragraph." }] }
// ]

const finalNodes = parse.parse("", { stream: false })
// Closes anything still open and emits remaining blocks
// [
//   { type: "paragraph", children: [{ type: "text", text: "This is another paragraph." }] }
// ]
```

When stream is false (default), the parser finalizes all open blocks at the end of the input and returns the full set of blocks (for that input). When you parse in streaming mode, the parser keeps internal state across calls and returns only blocks that have become closed and stable since the last call.

## API

### `MarkdownParser`

The main parser class that converts markdown text into a structured block AST (headings, paragraphs, lists, etc.).

#### `parse(text: string, options?: { stream: boolean }): BlockNode[]`

Parses markdown text and returns an array of block nodes.

- `text` - The markdown text to parse
- `options.stream` - When `true`, enables streaming mode which buffers incomplete blocks until they can be fully parsed. Defaults to `false`.

## Supported Nodes

The parser provides 100% support for the CommonMark specification, and includes full support for GitHub Flavored Markdown (GFM) tables.

### Block nodes

- [x] Heading (ATX and setext style)
- [x] Paragraph
- [x] Code block (fenced and indented)
- [x] Thematic break (horizontal rule)
- [x] HTML block
- [x] Blockquote
- [x] List (ordered and unordered)
- [x] Link reference definitions
- [x] Table (GFM)

### Inline nodes

- [x] Text
- [x] Code span
- [x] Hard break
- [x] Soft break
- [x] HTML (inline)
- [x] Autolink
- [x] Link
- [x] Image
- [x] Emphasis
- [x] Strong

## Some notes on the implementation

The implementation is inspired by various other markdown parsers, including [commonmark.js](https://github.com/commonmark/commonmark.js), [markdown-it](https://github.com/markdown-it/markdown-it), and [marked.js](https://github.com/markedjs/marked). In fact, the implementation is structurally very similar to how commonmark.js goes about parsing; the only major difference is how we decide which lines to parse when streaming is set to true. I started with a much simpler and a lot more readable implementation for the parser, but it became complex when adding block container (blockquote and lists) support, so I ended up going for a slightly complex solution but a more robust and extensible one.

Commonmark specification allows link reference definitions to appear after the links that use them. Therefore, when streaming is enabled, it is important to consider that a link reference might not resolve, since its definition could arrive in a later chunk of the input.

