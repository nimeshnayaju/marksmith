import "server-only";

import {
	type BlockNode,
	type InlineNode,
	MarkdownParser,
} from "markdown-parser";
import type { ComponentType, ReactNode } from "react";

export type MarkdownComponents = BlockNodeComponents & InlineNodeComponents;

interface BlockNodeComponents {
	Table: ComponentType<{
		head: {
			cells: {
				children: ReactNode;
				align: "left" | "right" | "center" | undefined;
			}[];
		};
		body: {
			rows: {
				cells: {
					children: ReactNode;
					align: "left" | "right" | "center" | undefined;
				}[];
			}[];
		};
	}>;
	CodeBlock: ComponentType<{ content: string; info?: string }>;
	Blockquote: ComponentType<{ children: ReactNode }>;
	List: ComponentType<
		| { type: "ordered"; items: { children: ReactNode }[]; start?: number }
		| { type: "unordered"; items: { children: ReactNode }[] }
	>;
	Heading: ComponentType<{ level: 1 | 2 | 3 | 4 | 5 | 6; children: ReactNode }>;
	Paragraph: ComponentType<{ children: ReactNode }>;
	ThematicBreak: ComponentType;
	HtmlBlock: ComponentType<{ content: string }>;
}

interface InlineNodeComponents {
	Text: ComponentType<{ text: string }>;
	CodeSpan: ComponentType<{ text: string }>;
	Emphasis: ComponentType<{ children: ReactNode }>;
	Strong: ComponentType<{ children: ReactNode }>;
	Link: ComponentType<{ href: string; title?: string; children: ReactNode }>;
	Image: ComponentType<{ href: string; title?: string; alt: string }>;
	HardBreak: ComponentType;
	SoftBreak: ComponentType;
	Html: ComponentType<{ content: string }>;
}

export function Markdown({
	content,
	components,
}: {
	content: string;
	components?: Partial<MarkdownComponents>;
}) {
	const nodes = new MarkdownParser().parse(content);

	const {
		Table = DefaultTable,
		CodeBlock = DefaultCodeBlock,
		Blockquote = DefaultBlockquote,
		List = DefaultList,
		Paragraph = DefaultParagraph,
		Heading = DefaultHeading,
		ThematicBreak = DefaultThematicBreak,
		Text = DefaultText,
		CodeSpan = DefaultCodeSpan,
		HardBreak = DefaultHardBreak,
		SoftBreak = DefaultSoftBreak,
		Emphasis = DefaultEmphasis,
		Strong = DefaultStrong,
		Link = DefaultLink,
		Image = DefaultImage,
		HtmlBlock = DefaultHtmlBlock,
		Html = DefaultHtml,
	} = components ?? {};

	return nodes.map((node, index) => (
		<BlockNodeComponent
			components={{
				Table,
				CodeBlock,
				Blockquote,
				List,
				Paragraph,
				Heading,
				HtmlBlock,
				ThematicBreak,
				Text,
				CodeSpan,
				HardBreak,
				SoftBreak,
				Emphasis,
				Strong,
				Link,
				Image,
				Html,
			}}
			key={index}
			node={node}
		/>
	));
}

export function BlockNodeComponent({
	node,
	components,
}: {
	node: BlockNode;
	components: MarkdownComponents;
}) {
	const {
		Table,
		CodeBlock,
		Paragraph,
		Heading,
		Blockquote,
		List,
		HtmlBlock,
		ThematicBreak,
	} = components;

	switch (node.type) {
		case "table": {
			return (
				<Table
					body={{
						rows: node.body.rows.map((row) => {
							return {
								cells: row.cells.map((cell) => {
									return {
										children: cell.children.map((child, index) => (
											<InlineNodeComponent
												components={components}
												key={index}
												node={child}
											/>
										)),
										align: cell.align,
									};
								}),
							};
						}),
					}}
					head={{
						cells: node.head.cells.map((cell) => {
							return {
								children: cell.children.map((child, index) => (
									<InlineNodeComponent
										components={components}
										key={index}
										node={child}
									/>
								)),
								align: cell.align,
							};
						}),
					}}
				/>
			);
		}
		case "blockquote": {
			return (
				<Blockquote>
					{node.children.map((child, index) => (
						<BlockNodeComponent
							components={components}
							key={index}
							node={child}
						/>
					))}
				</Blockquote>
			);
		}
		case "list": {
			if (node.kind === "ordered") {
				return (
					<List
						items={node.items.map((item) => {
							return {
								children: item.children.map((child, index) => (
									<BlockNodeComponent
										components={components}
										key={index}
										node={child}
									/>
								)),
							};
						})}
						start={node.start}
						type="ordered"
					/>
				);
			}
			return (
				<List
					items={node.items.map((item) => {
						return {
							children: item.children.map((child, index) => (
								<BlockNodeComponent
									components={components}
									key={index}
									node={child}
								/>
							)),
						};
					})}
					type="unordered"
				/>
			);
		}
		case "code-block": {
			return <CodeBlock content={node.content} info={node.info} />;
		}
		case "paragraph": {
			return (
				<Paragraph>
					{node.children.map((child, index) => (
						<InlineNodeComponent
							components={components}
							key={index}
							node={child}
						/>
					))}
				</Paragraph>
			);
		}
		case "heading": {
			return (
				<Heading level={node.level}>
					{node.children.map((child, index) => (
						<InlineNodeComponent
							components={components}
							key={index}
							node={child}
						/>
					))}
				</Heading>
			);
		}
		case "thematic-break": {
			return <ThematicBreak />;
		}
		case "html-block": {
			return <HtmlBlock content={node.content} />;
		}
		default:
			return null;
	}
}

export function InlineNodeComponent({
	node,
	components,
}: {
	node: InlineNode;
	components: InlineNodeComponents;
}) {
	const {
		Text,
		CodeSpan,
		HardBreak,
		SoftBreak,
		Emphasis,
		Strong,
		Link,
		Image,
		Html,
	} = components;

	switch (node.type) {
		case "text": {
			return <Text text={node.text} />;
		}
		case "code-span": {
			return <CodeSpan text={node.text} />;
		}
		case "hardbreak": {
			return <HardBreak />;
		}
		case "softbreak": {
			return <SoftBreak />;
		}
		case "emphasis": {
			return (
				<Emphasis>
					{node.children.map((child, index) => (
						<InlineNodeComponent
							components={components}
							key={index}
							node={child}
						/>
					))}
				</Emphasis>
			);
		}
		case "strong": {
			return (
				<Strong>
					{node.children.map((child, index) => (
						<InlineNodeComponent
							components={components}
							key={index}
							node={child}
						/>
					))}
				</Strong>
			);
		}
		case "link": {
			return (
				<Link href={node.href} title={node.title}>
					{node.children.map((child, index) => (
						<InlineNodeComponent
							components={components}
							key={index}
							node={child}
						/>
					))}
				</Link>
			);
		}
		case "image": {
			return (
				<Image
					alt={renderInlineAsPlainText(node.children)}
					href={node.href}
					title={node.title}
				/>
			);
		}
		case "html": {
			return <Html content={node.content} />;
		}
		default:
			return null;
	}
}

function DefaultTable({
	head,
	body,
}: {
	head: {
		cells: {
			children: ReactNode;
			align: "left" | "right" | "center" | undefined;
		}[];
	};
	body: {
		rows: {
			cells: {
				children: ReactNode;
				align: "left" | "right" | "center" | undefined;
			}[];
		}[];
	};
}) {
	return (
		<table>
			<thead>
				<tr>
					{head.cells.map((cell, index) => (
						<th align={cell.align} key={index}>
							{cell.children}
						</th>
					))}
				</tr>
			</thead>
			<tbody>
				{body.rows.map((row, index) => (
					<tr key={index}>
						{row.cells.map((cell, index) => (
							<td align={cell.align} key={index}>
								{cell.children}
							</td>
						))}
					</tr>
				))}
			</tbody>
		</table>
	);
}

function DefaultCodeBlock({ content }: { content: string; info?: string }) {
	return <pre>{content}</pre>;
}

function DefaultBlockquote({ children }: { children: ReactNode }) {
	return <blockquote>{children}</blockquote>;
}

function DefaultList(
	props:
		| {
				type: "ordered";
				items: { children: ReactNode }[];
				start?: number;
		  }
		| {
				type: "unordered";
				items: { children: ReactNode }[];
		  },
) {
	if (props.type === "ordered") {
		return (
			<ol start={props.start}>
				{props.items.map((item, index) => (
					<li key={index}>{item.children}</li>
				))}
			</ol>
		);
	}

	return (
		<ul>
			{props.items.map((item, index) => (
				<li key={index}>{item.children}</li>
			))}
		</ul>
	);
}

function DefaultHeading({
	level,
	children,
}: {
	level: 1 | 2 | 3 | 4 | 5 | 6;
	children: ReactNode;
}) {
	const Heading = `h${level}` as const;
	return <Heading>{children}</Heading>;
}

function DefaultParagraph({ children }: { children: ReactNode }) {
	return <p>{children}</p>;
}

function DefaultThematicBreak() {
	return <hr />;
}

function DefaultHtmlBlock({ content }: { content: string }) {
	return content;
}

function DefaultText({ text }: { text: string }) {
	return text;
}

function DefaultCodeSpan({ text }: { text: string }) {
	return <code>{text}</code>;
}

function DefaultHardBreak() {
	return <br />;
}

function DefaultSoftBreak() {
	return null;
}

function DefaultEmphasis({ children }: { children: ReactNode }) {
	return <em>{children}</em>;
}

function DefaultStrong({ children }: { children: ReactNode }) {
	return <strong>{children}</strong>;
}

function DefaultLink({
	href,
	title,
	children,
}: {
	href: string;
	title?: string;
	children: ReactNode;
}) {
	return (
		<a href={isValidUrl(href) ? escapeHTML(href) : undefined} title={title}>
			{children}
		</a>
	);
}

function DefaultImage({
	href,
	title,
	alt,
}: {
	href: string;
	title?: string;
	alt: string;
}) {
	return (
		<img
			alt={alt}
			src={isValidUrl(href) ? escapeHTML(href) : undefined}
			title={title}
		/>
	);
}

function DefaultHtml({ content }: { content: string }) {
	return content;
}

/**
 * Checks if the provided URL starts with a bad protocol (vbscript:, javascript:, file:, or data:);
 * if so, it only allows data: URLs for safe image types (gif, png, jpeg, webp). Otherwise, it allows the URL.
 * @param url - The URL to check.
 * @returns true if the URL is valid, false otherwise.
 */
function isValidUrl(url: string): boolean {
	return /^(vbscript|javascript|file|data):/.test(url.trim().toLowerCase())
		? /^data:image\/(gif|png|jpeg|webp);/.test(url.trim().toLowerCase())
		: true;
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
