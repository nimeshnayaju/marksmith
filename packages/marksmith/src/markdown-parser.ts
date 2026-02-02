import {
	CLOSE_TAG,
	type InlineNode,
	normalizeReference,
	OPEN_TAG,
	parseInline,
	parseLinkDestination,
	unescapeString,
} from "./inline-parser";
import { LineSplitter } from "./line-splitter";

export class MarkdownParser {
	private splitter = new LineSplitter();
	private root: RootNode_internal = {
		type: "root",
		children: [],
		parent: null,
	};
	private nextLineIndex = 0;
	private nextNodeIndex = 0;
	#referenceDefinitions: Map<string, { href: string; title?: string }> =
		new Map();
	parse(input: string, options?: { stream?: boolean }): BlockNode[] {
		const stream = options?.stream ?? false;
		const lines = this.splitter.split(input, { stream });
		for (const line of lines) {
			this.parseLine(line.replace(/\0/g, "\uFFFD"));
			this.nextLineIndex++;
		}

		// If stream is false, we need to finalize all remaining open blocks before returning the nodes.
		if (!stream) {
			// Close the latest spine of the root node; this finalizes all remaining open blocks before returning the nodes.
			closeRightmostPath(this.root);
		}

		// Parse reference link definitions for finalized/closed blocks.
		this.parseReferenceLinkDefinitions(this.root);

		const nodes: BlockNode[] = [];

		let i = this.nextNodeIndex;
		for (; i < this.root.children.length; i++) {
			const node = this.root.children[i];
			if (node === undefined || !node.isClosed) break;
			nodes.push(this.convertInternalBlockToPublicBlock(node));
		}
		this.nextNodeIndex = i;

		return nodes;
	}

	private parseLine(line: string) {
		const lineIndex = this.nextLineIndex;

		// We start from the root node and descend through the rightmost path of the current node until we find the last open node that the current line continues.
		let lastMatchedNode:
			| RootNode_internal
			| BlockquoteNode_internal
			| ListItemNode_internal = this.root;

		while (true) {
			if (!("children" in lastMatchedNode)) break;

			// If there are no children in the current node or if the last/rightmost child of the current node is not open, we do not traverse any further, in which case the last matched node is the current node.
			const child: BlockNode_internal | undefined =
				lastMatchedNode.children.at(-1);
			if (child === undefined || child.isClosed) break;

			// We now match the current line against this child node and check if the line continues the child node or not.

			// If the child node is a blockquote node, we check if the current line continues the blockquote or not.
			if (child.type === "blockquote") {
				const blockquote = parseBlockquoteLine(line);
				// If the current line continues the blockquote, we update the line (by removing the blockquote marker and the optional space after it) and continue attempting to match the line with the rightmost child of the blockquote node and so on.
				if (blockquote !== null) {
					line = blockquote.content;
					lastMatchedNode = child;

					child.endLineIndex = lineIndex;

					continue;
				}
				// If the current line does not continue the blockquote, we break out of the loop and continue with the current node (i.e., the parent of the blockquote node) as the last matched node.
				else {
					break;
				}
			}

			if (child.type === "list") {
				const item = child.children.at(-1);
				if (item === undefined || item.isClosed) break;

				if (isLineEmpty(line)) {
					const lastItemChild = item.children.at(-1);
					// If the current line is empty and there are no children in the list item, we close the list item.
					if (lastItemChild === undefined) {
						closeRightmostPath(child);
						return;
					}
					// If the current line is empty and there are children in the list item, we continue attempting to match the line with the following nodes in the list item branch.
					else {
						lastMatchedNode = item;
						continue;
					}
				}

				// If the current line is not empty, we check if it's indented enough to continue the list item.
				// If it is, we update the line (by removing the leading indent) and continue attempting to match the line with the rightmost child of the list item node and so on.
				const numOfColumns = getLeadingNonspaceColumn(line);
				if (numOfColumns >= child.numOfColumns) {
					line = sliceLeadingIndent(line, child.numOfColumns);
					lastMatchedNode = item;
					continue;
				}
				// If the current line is not empty and not indented enough to continue the list item, this line doesn't continue the list item, so we break out of the loop.
				else {
					break;
				}
			}

			// If the child node is a fenced code block node, we check if the current line closes the fenced code block or continues it.
			if (child.type === "fenced-code-block") {
				const marker = child.marker;
				const numOfMarkers = child.numOfMarkers;

				// If the current line closes the fenced code block, we mark the fenced code block as closed and exit as the line has been fully processed and doesn't require any further processing.
				if (isCodeFenceEnd(line, { marker, numOfMarkers })) {
					child.endLineIndex = lineIndex;
					child.isClosed = true;
					return;
				}
				// If the current line does not close the fenced code block, we add the line content to the fenced code block content.
				else {
					child.endLineIndex = lineIndex;
					child.lines.push(sliceLeadingIndent(line, child.indentLevel));
					return;
				}
			}

			// If the child node is an indented code block node, we check if the current line closes the indented code block or continues it.
			if (child.type === "indented-code-block") {
				// We continue the indented code block if the current line is indented enough or if it's empty.
				if (isIndentedCodeLine(line)) {
					child.endLineIndex = lineIndex;
					child.lines.push(sliceLeadingIndent(line, 4));
					return;
				} else if (isLineEmpty(line)) {
					child.endLineIndex = lineIndex;
					child.lines.push("");
					return;
				}
				// If the current line is not indented enough to continue the indented code block, or if it's not empty, we mark the indented code block as closed and break out of the loop.
				else {
					child.isClosed = true;
					break;
				}
			}

			if (child.type === "html-block") {
				// If the HTML block can be interrupted by a blank line and the current line is empty, we mark the HTML block as closed.
				if (child.canBeInterruptedByBlankLine && isLineEmpty(line)) {
					child.isClosed = true;
					return;
				}

				child.endLineIndex = lineIndex;
				child.lines.push(line);

				// If the HTML block ends with the current line, we mark the HTML block as closed.
				if (child.endPattern?.test(line.trim())) {
					child.isClosed = true;
					return;
				}

				return;
			}

			// If the child node is a paragraph or table node, we check if the current line is empty or not
			if (child.type === "paragraph" || child.type === "table") {
				// If the current line is empty, we mark the paragraph or table node as closed and exit as the line has been fully processed and doesn't require any further processing.
				if (isLineEmpty(line)) {
					child.isClosed = true;
					return;
				}
				// If the current line is not empty, we cannot tell if the line continues the paragraph or starts a new paragraph, so we break out of the loop and continue with the current node (i.e., the parent of the paragraph node) as the last matched node.
				else {
					break;
				}
			}
		}

		// Represents the node where newly matched nodes are expected to be added. This may not always be true for exceptional cases, like paragraph continuation.
		let currentContainer:
			| RootNode_internal
			| BlockquoteNode_internal
			| ListItemNode_internal = lastMatchedNode;
		while (true) {
			// Blockquote
			const blockquote = parseBlockquoteLine(line);
			if (blockquote !== null) {
				const node: BlockquoteNode_internal = {
					type: "blockquote",
					children: [],
					isClosed: false,
					parent: currentContainer,
					startLineIndex: lineIndex,
					endLineIndex: lineIndex,
				};
				addNode(node);

				currentContainer = node;

				line = blockquote.content;
				continue;
			}

			// ATX heading
			const heading = parseATXHeading(line);
			if (heading !== null) {
				addNode({
					type: "heading",
					level: heading.level,
					content: heading.content,
					isClosed: true,
					parent: currentContainer,
					startLineIndex: lineIndex,
					endLineIndex: lineIndex,
				});
				// Exit from the loop as we've reached a leaf block node
				break;
			}

			// Fenced code block
			const fencedCode = parseCodeFenceStart(line);
			if (fencedCode !== null) {
				addNode({
					type: "fenced-code-block",
					indentLevel: fencedCode.indentLevel,
					numOfMarkers: fencedCode.numOfMarkers,
					marker: fencedCode.marker,
					info: fencedCode.info,
					lines: [],
					isClosed: false,
					parent: currentContainer,
					startLineIndex: lineIndex,
					endLineIndex: lineIndex,
				});
				// Exit from the loop as we've reached a leaf block node
				break;
			}

			// HTML block
			const htmlBlock = parseHTMLBlockStart(line);
			if (htmlBlock !== null) {
				const node: HtmlBlockNode_internal = {
					type: "html-block",
					endPattern: htmlBlock.endPattern,
					canBeInterruptedByBlankLine: htmlBlock.canBeInterruptedByBlankLine,
					lines: [line],
					isClosed: false,
					parent: currentContainer,
					startLineIndex: lineIndex,
					endLineIndex: lineIndex,
				};

				if (htmlBlock.canInterruptParagraph) {
					addNode(node);
					// If the HTML block also ends with the current line, we mark the HTML block as closed.
					if (node.endPattern?.test(line.trim())) {
						node.isClosed = true;
					}
					break;
				} else {
					const deepestOpenNode =
						getDeepestOpenNodeOnRightmostPath(currentContainer);
					if (
						deepestOpenNode === null ||
						deepestOpenNode.type !== "paragraph"
					) {
						addNode(node);
						// If the HTML block also ends with the current line, we mark the HTML block as closed.
						if (node.endPattern?.test(line.trim())) {
							node.isClosed = true;
						}
						break;
					}
				}
			}

			const lastChild = currentContainer.children.at(-1);
			if (lastChild?.type === "paragraph" && !lastChild.isClosed) {
				// Table
				const table = parseTableStartLine({
					firstLine: lastChild.lines.at(-1),
					secondLine: line,
				});
				if (table !== null) {
					// Remove the last line from the paragraph node as it'll be replaced by the table node
					lastChild.lines.pop();

					// If the paragraph node has no lines left, we remove the paragraph node from the container node
					if (lastChild.lines.length === 0) {
						currentContainer.children.pop();
					}

					addNode({
						type: "table",
						alignments: table.alignments,
						head: { cells: table.head.cells },
						body: { rows: [] },
						isClosed: false,
						parent: currentContainer,
						startLineIndex: lineIndex,
						endLineIndex: lineIndex,
					});
					break;
				}

				// Setext heading
				const heading = parseSetextHeading(line);
				if (heading !== null) {
					let lines = lastChild.lines;
					const originalNumOfLines = lines.length;

					// Parse link reference definitions (if any) from the paragraph lines
					let definition = parseLinkReferenceDefinition(lines);
					while (definition !== null) {
						const { label, href, title } = definition.definition;
						if (!this.#referenceDefinitions.has(label)) {
							this.#referenceDefinitions.set(label, { href, title });
						}
						lines = lines.slice(definition.nextLineIndex);
						definition = parseLinkReferenceDefinition(lines);
					}

					// If there are remaining lines after parsing link reference definitions, we create a new heading node with the remaining lines
					if (lines.length > 0) {
						// Remove the current paragraph node from the container node as it'll replaced by a heading node
						currentContainer.children.pop();

						addNode({
							type: "heading",
							level: heading.level,
							content: lines.join("\n").trim(),
							isClosed: true,
							parent: currentContainer,
							startLineIndex:
								lastChild.startLineIndex - (originalNumOfLines - lines.length),
							endLineIndex: lineIndex,
						});
						break;
					}
					// If there are no remaining lines after parsing link reference definitions, we keep the paragraph node as is and add the current line to it
					else {
						lastChild.lines.push(line);
						break;
					}
				}
			}

			// Thematic break
			if (isSeparator(line)) {
				addNode({
					type: "thematic-break",
					isClosed: true,
					parent: currentContainer,
					startLineIndex: lineIndex,
					endLineIndex: lineIndex,
				});
				break;
			}

			// List
			const list = parseListItem(line);
			if (list !== null) {
				// If the last child of the current container is a paragraph node and it's not closed, we check if the list can interrupt the paragraph or not.
				const lastChild = currentContainer.children.at(-1);
				if (lastChild?.type === "paragraph" && !lastChild.isClosed) {
					if (
						isLineEmpty(list.content) ||
						(list.kind === "ordered" && list.value !== 1)
					) {
						lastChild.endLineIndex = lineIndex;
						lastChild.lines.push(line);
						break;
					}
				}

				let parent: ListNode_internal;
				if (list.kind === "ordered") {
					const lastChild = currentContainer.children.at(-1);
					if (
						lastChild?.type === "list" &&
						!lastChild.isClosed &&
						lastChild.kind === "ordered" &&
						lastChild.delimiter === list.delimiter
					) {
						parent = lastChild;
					} else {
						parent = {
							type: "list",
							kind: "ordered",
							start: list.value,
							delimiter: list.delimiter,
							numOfColumns: list.numOfColumns,
							children: [],
							isClosed: false,
							parent: currentContainer,
							startLineIndex: lineIndex,
							endLineIndex: lineIndex,
							isTight: true,
						};
						addNode(parent);
					}
				} else {
					const lastChild = currentContainer.children.at(-1);
					if (
						lastChild?.type === "list" &&
						!lastChild.isClosed &&
						lastChild.kind === "unordered" &&
						lastChild.marker === list.marker
					) {
						parent = lastChild;
					} else {
						parent = {
							type: "list",
							kind: "unordered",
							marker: list.marker,
							children: [],
							isClosed: false,
							parent: currentContainer,
							numOfColumns: list.numOfColumns,
							startLineIndex: lineIndex,
							endLineIndex: lineIndex,
							isTight: true,
						};
						addNode(parent);
					}
				}

				parent.numOfColumns = list.numOfColumns;

				const item: ListItemNode_internal = {
					type: "list-item",
					children: [],
					isClosed: false,
					parent: parent,
					startLineIndex: lineIndex,
					endLineIndex: lineIndex,
				};
				addNode(item);

				currentContainer = item;
				line = list.content;
				continue;
			}

			const latestOpenNode =
				getDeepestOpenNodeOnRightmostPath(currentContainer);
			// If the latest open node is not a paragraph and the current line is indented, we create a new indented code block node
			if (
				isIndentedCodeLine(line) &&
				(latestOpenNode === null || latestOpenNode.type !== "paragraph")
			) {
				addNode({
					type: "indented-code-block",
					lines: [sliceLeadingIndent(line, 4)],
					isClosed: false,
					parent: currentContainer,
					startLineIndex: lineIndex,
					endLineIndex: lineIndex,
				});
				break;
			}

			if (isLineEmpty(line)) {
				closeRightmostPath(currentContainer);
				break;
			}

			// Table continuation
			if (lastChild?.type === "table" && !lastChild.isClosed) {
				lastChild.endLineIndex = lineIndex;
				const numOfColumns = lastChild.head.cells.length;
				let cells = parseTableRow(line);
				if (cells.length > numOfColumns) {
					// Trim to max allowed columns
					cells = cells.slice(0, numOfColumns);
				} else if (cells.length < numOfColumns) {
					// Fill the remainder with empty strings
					cells = [...cells, ...Array(numOfColumns - cells.length).fill("")];
				}
				lastChild.body.rows.push({ cells });
				break;
			}

			// Paragraph
			if (latestOpenNode?.type === "paragraph") {
				latestOpenNode.endLineIndex = lineIndex;
				latestOpenNode.lines.push(line);
				break;
			} else {
				addNode({
					type: "paragraph",
					lines: [line],
					isClosed: false,
					parent: currentContainer,
					startLineIndex: lineIndex,
					endLineIndex: lineIndex,
				});
				break;
			}
		}
	}

	private parseReferenceLinkDefinitions(
		parent: RootNode_internal | BlockquoteNode_internal | ListItemNode_internal,
	) {
		for (let i = 0; i < parent.children.length; i++) {
			const block = parent.children[i];
			if (block === undefined) break;

			// If a block is not closed/finalized yet, we do not parse reference link definitions for it
			if (!block.isClosed) break;

			if (block.type === "paragraph") {
				let lines = block.lines;
				let definition = parseLinkReferenceDefinition(lines);
				while (definition !== null) {
					const { label, href, title } = definition.definition;
					if (!this.#referenceDefinitions.has(label)) {
						this.#referenceDefinitions.set(label, { href, title });
					}
					lines = lines.slice(definition.nextLineIndex);
					definition = parseLinkReferenceDefinition(lines);
				}
				if (lines.length > 0) {
					block.lines = lines;
				} else {
					parent.children.splice(i, 1);
					i--;
				}
			} else if (block.type === "blockquote") {
				this.parseReferenceLinkDefinitions(block);
			} else if (block.type === "list") {
				for (const item of block.children) {
					this.parseReferenceLinkDefinitions(item);
				}
			}
		}
	}

	private convertInternalBlockToPublicBlock(
		block: BlockNode_internal,
	): BlockNode {
		switch (block.type) {
			case "blockquote":
				return {
					type: "blockquote",
					children: block.children.map((child) =>
						this.convertInternalBlockToPublicBlock(child),
					),
				};
			case "heading":
				return {
					type: "heading",
					level: block.level,
					children: parseInline(block.content, {
						referenceDefinitions: this.#referenceDefinitions,
					}),
				};
			case "paragraph": {
				return {
					type: "paragraph",
					children: parseInline(block.lines.join("\n").trim(), {
						referenceDefinitions: this.#referenceDefinitions,
					}),
				};
			}
			case "thematic-break":
				return {
					type: "thematic-break",
				};
			case "fenced-code-block":
				return {
					type: "code-block",
					content: block.lines.length > 0 ? block.lines.join("\n") + "\n" : "",
					info: block.info,
				};
			case "indented-code-block": {
				let startIndex = 0;
				let endIndex = block.lines.length - 1;

				while (startIndex < endIndex) {
					const line = block.lines[startIndex];
					if (line === undefined) break;
					if (!isLineEmpty(line)) break;
					startIndex++;
				}
				while (endIndex > startIndex) {
					const line = block.lines[endIndex];
					if (line === undefined) break;
					if (!isLineEmpty(line)) break;
					endIndex--;
				}
				return {
					type: "code-block",
					content:
						block.lines.slice(startIndex, endIndex + 1).join("\n") + "\n",
				};
			}
			case "html-block":
				return {
					type: "html-block",
					content: block.lines.join("\n"),
				};
			case "list": {
				const items = block.children.map((item) => ({
					children: item.children.map((child) =>
						this.convertInternalBlockToPublicBlock(child),
					),
				}));

				if (block.kind === "ordered") {
					return {
						type: "list",
						kind: "ordered",
						start: block.start,
						tight: block.isTight,
						items: items,
					};
				} else {
					return {
						type: "list",
						kind: "unordered",
						marker: block.marker,
						tight: block.isTight,
						items: items,
					};
				}
			}
			case "table": {
				return {
					type: "table",
					head: {
						cells: block.head.cells.map((cell, index) => ({
							align: block.alignments[index],
							children: parseInline(cell, {
								referenceDefinitions: this.#referenceDefinitions,
							}),
						})),
					},
					body: {
						rows: block.body.rows.map((row) => ({
							cells: row.cells.map((cell, index) => ({
								align: block.alignments[index],
								children: parseInline(cell, {
									referenceDefinitions: this.#referenceDefinitions,
								}),
							})),
						})),
					},
				};
			}
		}
	}
}

function addNode(node: BlockNode_internal | ListItemNode_internal): void {
	// Ensure we don't have any dangling "open" nodes on the last-child chain before inserting a new sibling at this level.
	closeRightmostPath(node.parent);
	// Insert the new node as the next child of the parent.
	if (node.type === "list-item") {
		// This 'if' condition exists only for TypeScript's type narrowing purposes.
		node.parent.children.push(node);
	} else {
		node.parent.children.push(node);
	}
}

/**
 * Closes any currently-open nodes along the parent's "rightmost path" (i.e., repeatedly following the last child) until it reaches:
 * - a closed node, or
 * - the end of the chain (no children).
 *
 * This is used to "seal" any unfinished blocks before adding a new sibling block to the parent node.
 *
 * @param parent The parent/container node whose last-child chain will be traversed and closed.
 * @param options.endLineIndex The end line index to update the nodes with.
 */
function closeRightmostPath(
	parent:
		| RootNode_internal
		| BlockquoteNode_internal
		| ListNode_internal
		| ListItemNode_internal,
): void {
	let currentNode = getDeepestOpenNodeOnRightmostPath(parent);

	while (currentNode !== parent) {
		if (currentNode === null) break;

		currentNode.isClosed = true;

		if (currentNode.type === "list") {
			currentNode.isTight = isListTight(currentNode);
		}

		switch (currentNode.type) {
			case "blockquote":
			case "list":
			case "list-item": {
				const firstChild = currentNode.children.at(0);
				const lastChild = currentNode.children.at(-1);
				if (firstChild !== undefined) {
					currentNode.startLineIndex = Math.min(
						currentNode.startLineIndex,
						firstChild.startLineIndex,
					);
				}
				if (lastChild !== undefined) {
					currentNode.endLineIndex = Math.max(
						currentNode.endLineIndex,
						lastChild.endLineIndex,
					);
				}
				break;
			}
			default:
				break;
		}

		if (currentNode.parent?.type === "root") break;
		currentNode = currentNode.parent;
	}

	// Walk down the rightmost/last-child chain and close any still-open nodes until we hit a closed one (or run out).

	// Start at the last child of the parent; we'll keep descending into the last child of certain container nodes (e.g., blockquotes).
	let child = parent.children.at(-1);
	while (child !== undefined) {
		// If we've hit a node that is already closed, everything below it on this rightmost chain is assumed to be closed too, so we can stop early.
		if (child.isClosed) break;
		child.isClosed = true;

		// If the child is a container node, we continue descending into the last child of the container node.
		if (
			child.type === "blockquote" ||
			child.type === "list" ||
			child.type === "list-item"
		) {
			child = child.children.at(-1);
		}
		// If the child is a leaf node, we stop descending and break out of the loop.
		else {
			break;
		}
	}
}

function isListTight(list: ListNode_internal): boolean {
	// 1) Check if there are gaps between list items
	const items = list.children;
	for (let i = 0; i < items.length - 1; i++) {
		const a = items[i];
		const b = items[i + 1];
		if (a === undefined || b === undefined) break;
		if (a.endLineIndex < b.startLineIndex - 1) {
			return false;
		}
	}
	// 2) Check if there are gaps between block children inside each item
	for (const item of items) {
		const blocks = item.children;
		for (let j = 0; j < blocks.length - 1; j++) {
			const a = blocks[j];
			const b = blocks[j + 1];
			if (a === undefined || b === undefined) break;
			if (a.endLineIndex < b.startLineIndex - 1) {
				return false;
			}
		}
	}
	return true;
}

function getDeepestOpenNodeOnRightmostPath(
	node:
		| RootNode_internal
		| BlockquoteNode_internal
		| ListNode_internal
		| ListItemNode_internal,
): BlockNode_internal | ListItemNode_internal | null {
	const child = node.children.at(-1);

	// If the last child of the current node is undefined or closed, we return null to indicate that there is no latest open node.
	if (child === undefined || child.isClosed) return null;

	// At this point, the last child is guaranteed to be open, so depending on whether the node can contain more nodes, we traverse deeper into the spine or return the last child as is.
	switch (child.type) {
		case "blockquote":
		case "list":
		case "list-item": {
			const deepestOpenNode = getDeepestOpenNodeOnRightmostPath(child);
			if (deepestOpenNode !== null) return deepestOpenNode;
			return child;
		}
		default:
			return child;
	}
}

type LineRange = {
	startLineIndex: number;
	endLineIndex: number;
};
type ParagraphNode_internal = LineRange & {
	type: "paragraph";
	lines: string[];
	isClosed: boolean;
	parent: RootNode_internal | BlockquoteNode_internal | ListItemNode_internal;
};

type HeadingNode_internal = LineRange & {
	type: "heading";
	level: 1 | 2 | 3 | 4 | 5 | 6;
	content: string;
	isClosed: true; // Heading nodes are closed as soon as they are parsed, so they always remain in closed state.
	parent: RootNode_internal | BlockquoteNode_internal | ListItemNode_internal;
};

type FencedCodeBlockNode_internal = LineRange & {
	type: "fenced-code-block";
	indentLevel: number;
	info?: string;
	numOfMarkers: number;
	marker: "~" | "`";
	lines: string[];
	isClosed: boolean;
	parent: RootNode_internal | BlockquoteNode_internal | ListItemNode_internal;
};

type IndentedCodeNode_internal = LineRange & {
	type: "indented-code-block";
	lines: string[];
	isClosed: boolean;
	parent: RootNode_internal | BlockquoteNode_internal | ListItemNode_internal;
};

type ThematicBreakNode_internal = LineRange & {
	type: "thematic-break";
	isClosed: true;
	parent: RootNode_internal | BlockquoteNode_internal | ListItemNode_internal;
};

type HtmlBlockNode_internal = LineRange & {
	type: "html-block";
	endPattern?: RegExp;
	canBeInterruptedByBlankLine: boolean;
	lines: string[];
	isClosed: boolean;
	parent: RootNode_internal | BlockquoteNode_internal | ListItemNode_internal;
};

type BlockquoteNode_internal = LineRange & {
	type: "blockquote";
	children: Array<BlockNode_internal>;
	isClosed: boolean;
	parent: RootNode_internal | BlockquoteNode_internal | ListItemNode_internal;
};

type ListNode_internal = LineRange & {
	type: "list";
	children: Array<ListItemNode_internal>;
	numOfColumns: number;
	isClosed: boolean;
	parent: RootNode_internal | BlockquoteNode_internal | ListItemNode_internal;
	isTight: boolean;
} & (
		| {
				kind: "ordered";
				start: number;
				delimiter: "." | ")";
		  }
		| { kind: "unordered"; marker: string }
	);

type ListItemNode_internal = LineRange & {
	type: "list-item";
	children: Array<BlockNode_internal>;
	isClosed: boolean;
	parent: ListNode_internal;
};

type TableNode_internal = LineRange & {
	type: "table";
	alignments: Array<"left" | "right" | "center" | undefined>;
	head: { cells: string[] };
	body: { rows: Array<{ cells: string[] }> };
	isClosed: boolean;
	parent: RootNode_internal | BlockquoteNode_internal | ListItemNode_internal;
};

type RootNode_internal = {
	type: "root";
	children: Array<BlockNode_internal>;
	parent: null;
};

type BlockNode_internal =
	| ParagraphNode_internal
	| HeadingNode_internal
	| FencedCodeBlockNode_internal
	| IndentedCodeNode_internal
	| ThematicBreakNode_internal
	| HtmlBlockNode_internal
	| BlockquoteNode_internal
	| ListNode_internal
	| TableNode_internal;

/**
 * Determines if a line qualifies as an indented code block line.
 *
 * Per CommonMark spec, a line with 4 or more spaces of indentation (after tab expansion)
 * is considered part of an indented code block, unless it's within another block structure.
 *
 * @param line - The line to check.
 * @returns True if the line has 4+ columns of indentation, false otherwise.
 */
function isIndentedCodeLine(line: string): boolean {
	const column = getLeadingNonspaceColumn(line);
	return column >= 4;
}

/**
 * Attempts to parse a line as the opening of a fenced code block.
 *
 * Per CommonMark spec, a code fence opening consists of:
 * - Optional indentation (0-3 spaces)
 * - At least 3 consecutive backticks (`) or tildes (~)
 * - Optional info string (language identifier and metadata)
 *
 * For backtick fences, the info string cannot contain backticks.
 *
 * @param line - The line to parse.
 * @returns An object with fence details if valid, or null if not a fence opening.
 *   - indentLevel: The number of leading spaces (for content de-indentation)
 *   - numOfMarkers: The count of fence characters (must match or exceed for closing)
 *   - marker: The fence character used ("~" or "`")
 *   - info: The optional info string (language, etc.), or undefined if empty
 */
function parseCodeFenceStart(line: string): {
	indentLevel: number;
	numOfMarkers: number;
	marker: "~" | "`";
	info: string | undefined;
} | null {
	const indentColumns = getLeadingNonspaceColumn(line);
	if (indentColumns > 3) return null;

	line = line.trim();

	// Fences require at least 3 identical markers; if fewer than 3 characters remain in the line, it cannot be a fence.
	if (line.length < 3) return null;

	// Only ~ (tilde) or ` (backtick) can start a fence.
	const marker = line.charAt(0);
	if (marker !== "~" && marker !== "`") {
		return null;
	}

	/**
	 * Count the number of consecutive markers in the line. If the line does not contain at least 3 markers, it cannot be a fence.
	 * ┌───┬───┬───┬───┬───┐
	 * │ 0 | 1 | 2 | 3 | 4 |
	 * ├───┼───┼───┼───┼───┼
	 * │ ~ | ~ | ~ | t | s |
	 * └───┴───┴───┴───┴───┘
	 *   ▲       ▲
	 *   │       │
	 *   └───────┘
	 */
	let numOfMarkers = 1;
	while (true) {
		if (numOfMarkers >= line.length) break;
		if (line.charAt(numOfMarkers) !== marker) break;
		numOfMarkers++;
	}
	if (numOfMarkers < 3) return null;

	/**
	 * 'info string' is the text between the opening fence and the end of the line. It typically includes the language name and optional meta.
	 * ┌───┬───┬───┬───┬───┐
	 * │ 0 | 1 | 2 | 3 | 4 |
	 * ├───┼───┼───┼───┼───┼
	 * │ ~ | ~ | ~ | t | s |
	 * └───┴───┴───┴───┴───┘
	 *               ▲   ▲
	 *               │   │
	 *               └───┘
	 */
	const info = line.slice(numOfMarkers).trim();

	// For backtick fences only: if the info string itself contains a backtick, it is not a valid fence.
	if (marker === "`" && info.indexOf("`") >= 0) {
		return null;
	}

	return {
		indentLevel: indentColumns,
		numOfMarkers,
		marker,
		info: info === "" ? undefined : info,
	};
}

/**
 * Determines if a line is a valid closing fence for a code block.
 *
 * A valid closing fence must satisfy these conditions (per CommonMark):
 * 1. Indented by at most 3 spaces
 * 2. Consists of the same character as the opening fence (` or ~)
 * 3. Contains at least as many fence characters as the opening fence
 * 4. Contains only the fence characters (no info string allowed)
 *
 * @param line - The line to check.
 * @param options.marker - The fence character from the opening fence ('`' or '~').
 * @param options.numOfMarkers - The number of fence characters in the opening fence.
 * @returns `true` if the line is a valid closing fence, `false` otherwise.
 *
 * @example
 * ```typescript
 * // Opening fence was: ```
 * isCodeFenceEnd("```", { marker: '`', numOfMarkers: 3 });    // true
 * isCodeFenceEnd("````", { marker: '`', numOfMarkers: 3 });   // true (more markers OK)
 * isCodeFenceEnd("``", { marker: '`', numOfMarkers: 3 });     // false (too few)
 * isCodeFenceEnd("~~~", { marker: '`', numOfMarkers: 3 });    // false (wrong marker)
 * isCodeFenceEnd("``` ", { marker: '`', numOfMarkers: 3 });   // true (trailing space trimmed)
 * isCodeFenceEnd("```js", { marker: '`', numOfMarkers: 3 });  // false (has info string)
 * ```
 *
 * @see https://spec.commonmark.org/0.31.2/#fenced-code-blocks
 */
function isCodeFenceEnd(
	line: string,
	options: { marker: "~" | "`"; numOfMarkers: number },
): boolean {
	// The closing fence must be indented by at most 3 columns.
	const indent = getLeadingNonspaceColumn(line);
	if (indent > 3) return false;

	line = line.trim();

	// Line must start with the **same** marker character to qualify as a closing fence.
	if (line.charAt(0) !== options.marker) return false;

	// Count the number of consecutive markers in the line. If the line does not contain the same number of markers as the opening fence, it cannot be a closing fence.
	let numOfMarkers = 1;
	while (true) {
		if (numOfMarkers >= line.length) break;
		if (line.charAt(numOfMarkers) !== options.marker) break;
		numOfMarkers++;
	}
	if (numOfMarkers < options.numOfMarkers) return false;

	// The closing fence cannot contain any other characters (except spaces and tabs) after the sequence of markers. Since we trimmed the line, we only need to check if there are any characters left.
	if (line.length > numOfMarkers) return false;

	return true;
}

/**
 * Returns the index of the first non-whitespace character in the line. Tabs are not expanded and treated as a single space.
 * @param line - The line to get the index of the first non-whitespace character of.
 * @returns The index of the first non-whitespace character in the line.
 *
 * The index of the first non-whitespace character in the following example is 3.
 * ┌───┬───┬───┬───┬───┬───┬───┬───┬───┐
 * │ 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 |
 * ├───┼───┼───┼───┼───┼───┼───┼───┼───┤
 * │ ␣ | ␣ | ␣ | T | h | i | s | ␣ | ␣ |
 * └───┴───┴───┴───┴───┴───┴───┴───┴───┘
 *               ▲
 *
 * The index of the first non-whitespace character in the following example is 3.
 * ┌───┬───┬───┬───┬───┬───┬───┬───┬───┐
 * │ 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 |
 * ├───┼───┼───┼───┼───┼───┼───┼───┼───┤
 * │ ␣ | ␣ | ⇥ | T | h | i | s | ␣ | ␣ |
 * └───┴───┴───┴───┴───┴───┴───┴───┴───┘
 *               ▲
 */
function getFirstNonspaceIndex(line: string): number {
	let index = 0; // The index of the first non-whitespace character in the line.
	for (let i = 0; i < line.length; i++) {
		const character = line.charAt(i);
		if (isSpaceOrTab(character)) {
			index++;
		} else {
			break;
		}
	}
	return index;
}

/**
 * Returns the indentation columns/width of the line. Tabs are expanded to the next multiple of 4 spaces.
 * The value is the effective cursor position before the first non-whitespace character. Spaces add one column each; tabs add a variable number to reach the next tab stop.
 *
 * @param line - The line to get the indentation columns/width of.
 * @returns The indentation columns/width of the line.
 *
 * The indentation width of the line in the following example is 3. The line begins with three spaces.
 * The three spaces move the cursor to column 3.
 * ┌───┬───┬───┬───┬───┬───┬───┬───┬───┐
 * │ 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 |
 * ├───┼───┼───┼───┼───┼───┼───┼───┼───┤
 * │ ␣ | ␣ | ␣ | T | h | i | s | ␣ | ␣ |
 * └───┴───┴───┴───┴───┴───┴───┴───┴───┘
 *
 * The indentation width of the line in the following example is 4. The line begins with a tab.
 * The tab advances to the next multiple of 4, which is column 4.
 * ┌───┬───┬───┬───┬───┬───┬───┬───┬───┐
 * │ 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 |
 * ├───┼───┼───┼───┼───┼───┼───┼───┼───┤
 * │ ⇥ | T | h | i | s | ␣ | ␣ | ␣ | ␣ |
 * └───┴───┴───┴───┴───┴───┴───┴───┴───┘
 *
 * The indentation width of the line in the following example is 4. The line begins with two spaces, then a tab.
 * The two spaces move the cursor to column 2. The tab then advances to the next multiple of 4, which is column 4.
 * ┌───┬───┬───┬───┬───┬───┬───┬───┬───┐
 * │ 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 |
 * ├───┼───┼───┼───┼───┼───┼───┼───┼───┤
 * │ ␣ | ␣ | ⇥ | T | h | i | s | ␣ | ␣ |
 * └───┴───┴───┴───┴───┴───┴───┴───┴───┘
 */
function getLeadingNonspaceColumn(line: string): number {
	let columns = 0;
	for (let i = 0; i < line.length; i++) {
		const ch = line.charAt(i);
		if (ch === " ") {
			columns += 1;
		} else if (ch === "\t") {
			columns += 4 - (columns % 4);
		} else {
			break;
		}
	}
	return columns;
}

/**
 * Removes up to the specified visual columns from the start of the line, expanding tabs at 4-space stops.
 * If we cut through a tab, we add the remaining spaces back (partial tab expansion).
 *
 * @param line - The line to remove the leading indent from.
 * @param width - The width of the leading indent to slice.
 * @returns The line with the leading indent removed.
 */
function sliceLeadingIndent(line: string, width: number): string {
	let indent = 0; // Indicates the indentation level of the line (tabs are expanded to the next multiple of 4 spaces)
	let startIndex = 0;

	while (startIndex < line.length) {
		if (line.charAt(startIndex) === " ") {
			indent++;
		} else if (line.charAt(startIndex) === "\t") {
			indent += 4 - (indent % 4);
		} else {
			break;
		}
		startIndex++;
	}

	/**
	 * Fix any partial tab expanstion: if a tab pushed the indentation level past the required indent, we cannot "slice half a tab",
	 * so we add the remaining spaces to the start of the line to preserve the intended remaining indentation.
	 *
	 * For example, if the line is indented by 2 spaces, and the width is 4, after consuming the 2 spaces, indent = 2 and startIndex = 0,
	 * so we need to add 4 - 2 = 2 spaces to the start of the line to preserve the intended remaining indentation.
	 */
	if (indent > width) {
		return " ".repeat(indent - width) + line.slice(startIndex);
	} else {
		return line.slice(startIndex);
	}
}

/**
 * Checks if the line is a separator. Must satisfy the following conditions:
 * - The first non-space character in the line must be a -, _, or * character.
 * - There must be at least 3 markers in the line. Spaces and tabs are allowed in the line. Any other character is not allowed.
 * @param line - The line to check.
 * @returns true if the line is a separator, false otherwise.
 */
function isSeparator(line: string): boolean {
	if (isIndentedCodeLine(line)) return false;

	line = line.trim();
	const marker = line.charAt(0);

	// Only -, _, and * can be used to create a separator.
	if (marker !== "-" && marker !== "_" && marker !== "*") {
		return false;
	}

	/**
	 * Count the number of markers in the line. If the line does not contain at least 3 markers, it is not a separator.
	 * ┌───┬───┬───┬───┬───┬───┬───┬───┬───┐
	 * │ 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 |
	 * ├───┼───┼───┼───┼───┼───┼───┼───┼───┤
	 * │ ␣ | * | ␣ | * | ␣ | * | ␣ | ␣ | ␣ |
	 * └───┴───┴───┴───┴───┴───┴───┴───┴───┘
	 *       ▲       ▲       ▲
	 */
	let markerCount = 1;
	for (let i = 1; i < line.length; i++) {
		const character = line.charAt(i);

		// Markers can be mixed with spaces and tabs.
		if (isSpaceOrTab(character)) {
			continue;
		}

		if (character !== marker) {
			return false;
		}

		markerCount++;
	}

	if (markerCount < 3) return false;

	return true;
}

function parseBlockquoteLine(line: string): {
	content: string;
} | null {
	if (isIndentedCodeLine(line)) return null;

	const firstNonspaceIndex = getFirstNonspaceIndex(line);

	/**
	 * The first non-whitespace character in the line must be a > character.
	 * ┌───┬───┬───┬───┬───┬───┬───┬───┬───┐
	 * │ 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 |
	 * ├───┼───┼───┼───┼───┼───┼───┼───┼───┤
	 * │ ␣ | ␣ | ␣ | > | ␣ | T | h | i | s |
	 * └───┴───┴───┴───┴───┴───┴───┴───┴───┘
	 *               ▲
	 */
	if (line.charAt(firstNonspaceIndex) !== ">") return null;

	let characterIndex = firstNonspaceIndex + 1; // Skip the blockquote marker.
	// Count the number of columns (tabs are expanded to the next multiple of 4 spaces) from the beginning of the line to the start of the content of the blockquote line.
	let numOfColumns = characterIndex;
	while (characterIndex < line.length) {
		if (line.charAt(characterIndex) === "\t") {
			numOfColumns += 4 - (numOfColumns % 4);
			characterIndex++;
		} else if (line.charAt(characterIndex) === " ") {
			numOfColumns++;
			characterIndex++;
		} else {
			break;
		}
	}

	// Append the leading spaces to the content of the blockquote line.
	const content =
		" ".repeat(numOfColumns - firstNonspaceIndex - 1) +
		line.slice(characterIndex);

	// Consume the first space after the blockquote marker (if it exists)
	if (content.charAt(0) === " ") {
		return { content: content.slice(1) };
	}

	return { content };
}

/**
 * Attempts to parse a line as an ATX-style heading.
 *
 * Per CommonMark spec, an ATX heading consists of:
 * - Optional indentation (0-3 spaces)
 * - 1-6 consecutive # characters
 * - Optional space/tab followed by heading content
 * - Optional closing sequence of # characters (preceded by space)
 *
 * Examples:
 *   "# Heading 1"     -> { level: 1, content: "Heading 1" }
 *   "## Title ##"     -> { level: 2, content: "Title" }
 *   "### Empty"       -> { level: 3, content: "Empty" }
 *   "#No space"       -> null (space required after #)
 *   "####### Too many" -> null (max 6 levels)
 *
 * @param line - The line to parse.
 * @returns An object with heading level and content if valid, or null if not a heading.
 */
function parseATXHeading(
	line: string,
): { level: 1 | 2 | 3 | 4 | 5 | 6; content: string } | null {
	if (isIndentedCodeLine(line)) return null;

	line = line.trim();

	// A heading must start with a # character.
	if (line.charAt(0) !== "#") return null;

	/**
	 * Count the number of consecutive # characters in the line.
	 * ┌───┬───┬───┬───┬───┬───┬───┬───┬───┐
	 * │ 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 |
	 * ├───┼───┼───┼───┼───┼───┼───┼───┼───┤
	 * │ # | # | # | # | ␣ | T | h | i | s |
	 * └───┴───┴───┴───┴───┴───┴───┴───┴───┘
	 *   ▲           ▲
	 *   │           │
	 *   └───────────┘
	 */
	let numOfOpeningHashes: 1 | 2 | 3 | 4 | 5 | 6 = 1 as 1 | 2 | 3 | 4 | 5 | 6; // The number of consecutive # characters in the line; initialized to 1 because the first character is a #.
	while (true) {
		if (numOfOpeningHashes >= line.length) break;
		if (line.charAt(numOfOpeningHashes) !== "#") break;

		numOfOpeningHashes++;
	}

	// A heading must have a level between 1 and 6. If the level is greater than 6, it is not a heading.
	if (numOfOpeningHashes > 6) return null;

	/**
	 * If there are more characters after the # characters and the character immediately after the # characters is not a space or a tab, it is not a heading.
	 *
	 * The following example is not a heading because the character immediately after the # characters is not a space or a tab.
	 * ┌───┬───┬───┬───┬───┬───┬───┬───┐
	 * │ # | # | # | # | T | h | i | s |
	 * └───┴───┴───┴───┴───┴───┴───┴───┘
	 *                   ▲
	 */
	if (
		numOfOpeningHashes < line.length &&
		line.charAt(numOfOpeningHashes) !== " " &&
		line.charAt(numOfOpeningHashes) !== "\t"
	) {
		return null;
	}

	/**
	 * Count the number of consecutive # characters at the end of the line.
	 * ┌───┬───┬───┬───┬───┬───┬───┬───┬───┬───┬────┬────┬────┐
	 * │ 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 |
	 * ├───┼───┼───┼───┼───┼───┼───┼───┼───┼───┼────┼────┼────┤
	 * │ # | # | # | # | ␣ | T | h | i | s | ␣ | #  | #  | #  |
	 * └───┴───┴───┴───┴───┴───┴───┴───┴───┴───┴────┴────┴────┘
	 *                                           ▲         ▲
	 *                                           │         │
	 *                                           └─────────┘
	 */
	let numOfClosingHashes = 0; // The number of consecutive # characters at the end of the line.
	while (true) {
		if (line.length - numOfClosingHashes - 1 <= numOfOpeningHashes) break;
		if (line.charAt(line.length - numOfClosingHashes - 1) !== "#") break;
		numOfClosingHashes++;
	}

	const contentEndIndex = isSpaceOrTab(
		line.charAt(line.length - numOfClosingHashes - 1),
	)
		? line.length - numOfClosingHashes
		: line.length;

	return {
		level: numOfOpeningHashes,
		content: line.slice(numOfOpeningHashes, contentEndIndex).trim(),
	};
}

/**
 * Checks if the line is a setext heading. Must satisfy the following conditions:
 * - The first non-whitespace character in the line must be a valid marker (minus or equals sign).
 * - All characters in the line after stripping leading and trailing whitespace must be the same as the marker.
 * @param line - The line to check.
 * @returns true if the line is a setext heading, false otherwise.
 */
function parseSetextHeading(line: string): { level: 1 | 2 } | null {
	if (isIndentedCodeLine(line)) return null;

	line = line.trim(); // Trim the line to remove leading and trailing whitespace.

	// A heading must start with a minus or equals sign.
	const marker = line.charAt(0);
	if (marker !== "=" && marker !== "-") return null;

	// Ensure that all other characters in the line are the same as the marker.
	for (const character of line) {
		if (character !== marker) return null;
	}

	if (marker === "=") return { level: 1 };

	return { level: 2 };
}

function parseTableStartLine({
	firstLine,
	secondLine,
}: {
	firstLine?: string;
	secondLine?: string;
}): {
	alignments: Array<"left" | "right" | "center" | undefined>;
	head: { cells: string[] };
} | null {
	if (firstLine === undefined || secondLine === undefined) return null;

	if (isIndentedCodeLine(secondLine)) return null;
	if (isLineEmpty(secondLine)) return null;

	firstLine = firstLine.trim();
	secondLine = secondLine.trim();

	// The first character in the second line must be a pipe, colon, or dash.
	if (
		secondLine.charAt(0) !== "|" &&
		secondLine.charAt(0) !== ":" &&
		secondLine.charAt(0) !== "-"
	) {
		return null;
	}

	// If the first character in the second line is a dash, it must not be followed by a space or tab.
	if (secondLine.charAt(0) === "-" && isSpaceOrTab(secondLine.charAt(1))) {
		return null;
	}

	// If the first line does not contain any pipe characters, it is not a table.
	if (firstLine.indexOf("|") === -1) {
		return null;
	}

	// The second line must not contain any other characters than pipes, colons, dashes, spaces, or tabs.
	for (let i = 1; i < secondLine.length; i++) {
		if (
			secondLine.charAt(i) === "|" ||
			secondLine.charAt(i) === ":" ||
			secondLine.charAt(i) === "-" ||
			isSpaceOrTab(secondLine.charAt(i))
		) {
			continue;
		}

		return null;
	}

	/**
	 * | foo  |  bar  |  baz  |      ← first line (header row)
	 * | :--- | :---: |  ---: |      ← second line (delimiter row)
	 *    ▲       ▲         ▲
	 *    │       │         └────── right alignment
	 *    │       │
	 *    │       └──────────────── center alignment
	 *    │
	 *    └──────────────────────── left alignment
	 */
	const delimiterCells = secondLine.split("|");
	const alignments: Array<"left" | "right" | "center" | undefined> = [];
	for (let i = 0; i < delimiterCells.length; i++) {
		const cell = delimiterCells[i]?.trim();
		// An empty cell is only allowed at the start or end of the line.
		if (!cell) {
			if (i === 0 || i === delimiterCells.length - 1) continue;
			return null;
		}

		// A delimiter cell must contain only dashes and optional colons at the start and end.
		if (!/^:?-+:?$/.test(cell)) return null;

		if (cell.charAt(cell.length - 1) === ":") {
			if (cell.charAt(0) === ":") {
				alignments.push("center");
			} else {
				alignments.push("right");
			}
		} else if (cell.charAt(0) === ":") {
			alignments.push("left");
		} else {
			alignments.push(undefined);
		}
	}

	const headerCells = parseTableRow(firstLine);

	if (headerCells.length === 0 || headerCells.length !== alignments.length) {
		return null;
	}

	return {
		head: {
			cells: headerCells,
		},
		alignments,
	};
}

function parseTableRow(line: string): Array<string> {
	/**
	 * Cell contents in table rows can include escaped pipe characters. We need to split the line on "|" but not on escaped "|" characters.
	 *
	 * "a|b|c"         → ["a","b","c"]
	 * "a\|b|c"        → ["a|b","c"]
	 * "\|a\|b\|c"     → ["|a|b|c"]
	 * "\\\|b"         → ["\|b"]   (only the "\" right before "|" is removed)
	 *
	 * foo \| bar | baz
	 *      ▲     ▲
	 *      │     └────── split here
	 *      │
	 *      └────── do not split here (escaped pipe character)
	 */
	const cells = line
		.trim()
		.split(/(?<!\\)\|/) // Split on unescaped pipe characters (i.e., pipe characters not preceded by "\")
		.map((cell) => cell.replace(/\\\|/g, "|")) // Unescape the remaining "\|" (i.e., replace "\|" with "|")
		.map((cell) => cell.trim());

	// Empty cells are only allowed at the start or end of the line. If there are any empty cells, we remove them.
	if (cells.length > 0) {
		if (cells[0] === "") cells.shift();
		if (cells[cells.length - 1] === "") cells.pop();
	}
	return cells;
}

function parseLinkReferenceDefinition(lines: string[]): {
	definition: {
		label: string;
		href: string;
		title?: string;
	};
	nextLineIndex: number;
} | null {
	const firstLine = lines[0];
	if (firstLine === undefined) return null;

	let nextLineIndex = 1;

	let content = firstLine.trim() + "\n";
	// A link reference definition must start with a left bracket '['
	if (content.charAt(0) !== "[") return null;

	let label = "";
	let characterCursor = 1; // Skip the opening bracket '['
	while (characterCursor < content.length) {
		const character = content.charAt(characterCursor);
		if (character === "\\") {
			const nextCharacter = content.charAt(characterCursor + 1);
			// Only ']', '[' and '\' need to be escaped within labels. Escaping them allows them to appear literally in the label
			if (["]", "[", "\\"].includes(nextCharacter)) {
				label += nextCharacter;
				characterCursor += 2;
			}
			// Preserve the backslash for other characters.
			else {
				label += character;
				characterCursor++;
			}
			continue;
		}

		// Unescaped `[` characters are not allowed in reference link labels. This prevents ambiguous nested bracket parsing.
		if (character === "[") return null;

		// If the current character is a closing bracket, we return the reference label.
		if (character === "]") break;

		if (character === "\n") {
			const nextLine = lines[nextLineIndex];
			if (nextLine === undefined) return null;

			content += nextLine.trim() + "\n";
			label += "\n";
			characterCursor++;

			nextLineIndex++;
			continue;
		}

		label += character;
		characterCursor++;
	}

	if (label.length === 0 || label.length > 999) return null;
	if (label.trim().length === 0) return null;

	characterCursor++; // Skip the closing bracket ']'

	if (content.charAt(characterCursor) !== ":") return null;

	characterCursor++; // Skip the colon ':'

	// Skip optional whitespaces after the colon ':'
	while (true) {
		const character = content.charAt(characterCursor);
		if (character === " " || character === "\t") {
			characterCursor++;
			continue;
		}

		if (character === "\n") {
			const nextLine = lines[nextLineIndex];
			if (nextLine === undefined) return null;

			content += nextLine.trim() + "\n";
			characterCursor++;

			nextLineIndex++;
			continue;
		}

		break;
	}

	const destination = parseLinkDestination(content, {
		startIndex: characterCursor,
	});
	// If the destination is invalid, the link reference definition is invalid (for both stream and non-stream parsing)
	if (destination === null) return null;

	characterCursor = destination.endIndex + 1;

	const characterCursorAfterDestination = characterCursor;
	const nextLineIndexAfterDestination = nextLineIndex;

	const destinationIsFollowedByNewline =
		content.charAt(characterCursor) === "\n";

	if (
		!destinationIsFollowedByNewline &&
		![" ", "\t"].includes(content.charAt(characterCursor))
	) {
		return null;
	}

	// Skip optional whitespaces after the destination
	while (true) {
		const character = content.charAt(characterCursor);
		if (character === " " || character === "\t") {
			characterCursor++;
			continue;
		}

		if (character === "\n") {
			const nextLine = lines[nextLineIndex];
			if (nextLine === undefined) break;

			content += nextLine.trim() + "\n";
			characterCursor++;

			nextLineIndex++;
			continue;
		}

		break;
	}

	let title: string | undefined;
	const openingQuoteCharacter = content.charAt(characterCursor);
	// Reference link title must start with ", ', or (
	if (['"', "'", "("].includes(openingQuoteCharacter)) {
		const closingQuoteCharacter =
			openingQuoteCharacter === "(" ? ")" : openingQuoteCharacter;
		characterCursor++; // Skip the opening quote character
		const titleStartIndex = characterCursor;
		while (true) {
			const character = content.charAt(characterCursor);
			if (character === closingQuoteCharacter) {
				title = unescapeString(content.slice(titleStartIndex, characterCursor));
				characterCursor++; // Skip the closing quote character
				break;
			}

			// For parenthesis-delimited titles, unescaped `(` is not allowed; this prevents ambiguity in parsing.
			if (character === "(" && openingQuoteCharacter === "(") {
				break;
			}

			// If the current character is a backslash and it is not the last character, it is an escaped character, so we skip the current character and the next character.
			if (character === "\\" && characterCursor + 1 < content.length) {
				characterCursor += 2;
				continue;
			}

			if (character === "\n") {
				const nextLine = lines[nextLineIndex];
				if (nextLine === undefined) break;

				content += nextLine.trim() + "\n";
				characterCursor++;
				nextLineIndex++;
				continue;
			}

			// Regular characters (including newlines) are allowed in the title.
			characterCursor++;
		}
	}

	// Title must noot be followed by any more content
	if (content.charAt(characterCursor) !== "\n") {
		title = undefined;
	}

	if (title === undefined) {
		// If the destination is not followed by a newline and the title is invalid, the link reference definition is invalid
		if (!destinationIsFollowedByNewline) {
			return null;
		}
		// If the destination is followed by a new line and the title is invalid, we ignore the title and only continue with the destination
		else {
			characterCursor = characterCursorAfterDestination + 1;
			nextLineIndex = nextLineIndexAfterDestination;
		}
	}

	return {
		definition: {
			label: normalizeReference(label),
			href: destination.href,
			title,
		},
		nextLineIndex,
	};
}

function parseListItem(line: string):
	| ({
			/**
			 * The content of the ordered list item.
			 */
			content: string;
			/**
			 * The number of columns (tabs are expanded to the next multiple of 4 spaces) from the beginning of the line to the start of the content of the ordered list item.
			 */
			numOfColumns: number;
	  } & (
			| {
					kind: "ordered";
					value: number;
					delimiter: "." | ")";
			  }
			| { kind: "unordered"; marker: string }
	  ))
	| null {
	let item: {
		numOfColumns: number;
		numOfColumnsAfterMarker: number;
		content: string;
	} & (
		| { kind: "ordered"; value: number; delimiter: "." | ")" }
		| { kind: "unordered"; marker: string }
	);

	const orderedListItem = parseOrderedListItem(line);
	if (orderedListItem !== null) {
		item = { kind: "ordered", ...orderedListItem };
	} else {
		const unorderedListItem = parseUnorderedListItem(line);
		if (unorderedListItem !== null) {
			item = { kind: "unordered", ...unorderedListItem };
		} else {
			return null;
		}
	}

	let content = item.content;
	let numOfColumns = item.numOfColumns;
	if (
		item.numOfColumnsAfterMarker >= 5 ||
		item.numOfColumnsAfterMarker <= 0 ||
		isLineEmpty(item.content)
	) {
		content = " ".repeat(item.numOfColumnsAfterMarker) + content;
		if (content.charAt(0) === " ") {
			content = content.slice(1);
		}
		// The baseline content indentation is one space past the marker
		numOfColumns = numOfColumns - item.numOfColumnsAfterMarker + 1;
	}

	if (item.kind === "ordered") {
		return {
			kind: "ordered",
			content,
			numOfColumns,
			value: item.value,
			delimiter: item.delimiter,
		};
	} else {
		return {
			kind: "unordered",
			content,
			numOfColumns,
			marker: item.marker,
		};
	}
}

/**
 * Checks if the line represents the start of an ordered list item. Must satisfy the following conditions:
 * - The first non-whitespace character in the line must be a digit (0-9). It can be followed by characters that are also digits (0-9).
 * - There must be at most 9 digits in the line.
 * - The character immediately after the digits must be a period '.' character or a closing parenthesis ')' character.
 * - The character immediately after the digits must be a space or a tab (if it exists).
 * @param line - The line to check.
 * @returns The value of the ordered list item and the number of digits in the line if the line is an ordered list item, null otherwise.
 */
function parseOrderedListItem(line: string): {
	value: number;
	delimiter: "." | ")";
	numOfColumns: number;
	numOfColumnsAfterMarker: number;
	content: string;
} | null {
	if (isIndentedCodeLine(line)) return null;
	const firstNonspaceIndex = getFirstNonspaceIndex(line);

	// The first character after whitespaces must be a digit.
	if (
		line.charCodeAt(firstNonspaceIndex) < 0x30 /* 0 */ ||
		line.charCodeAt(firstNonspaceIndex) > 0x39 /* 9 */
	) {
		return null;
	}

	/**
	 * Count the number of consecutive digits in the line (starting from the first non-whitespace character)
	 *
	 * In the following example, the number of digits is 1.
	 * ┌───┬───┬───┬───┬───┬───┬───┬───┬───┐
	 * │ 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 |
	 * ├───┼───┼───┼───┼───┼───┼───┼───┼───┤
	 * │ ␣ | 1 | ) | ␣ | T | h | i | s | ␣ |
	 * └───┴───┴───┴───┴───┴───┴───┴───┴───┘
	 *       ▲
	 *
	 * In the following example, the number of digits is 1.
	 * ┌───┬───┬───┬───┬───┬───┬───┬───┬───┐
	 * │ 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 |
	 * ├───┼───┼───┼───┼───┼───┼───┼───┼───┤
	 * │ ␣ | 1 | 2 | ) | ␣ | T | h | e | ␣ |
	 * └───┴───┴───┴───┴───┴───┴───┴───┴───┘
	 *       ▲   ▲
	 *       │   │
	 *       └───┘
	 */
	let numOfDigits = 1;
	while (true) {
		if (firstNonspaceIndex + numOfDigits >= line.length) break;

		if (
			line.charCodeAt(firstNonspaceIndex + numOfDigits) >= 0x30 /* 0 */ &&
			line.charCodeAt(firstNonspaceIndex + numOfDigits) <= 0x39 /* 9 */
		) {
			numOfDigits++;

			// A valid ordered list item cannot have more than 9 digits.
			if (numOfDigits > 9) return null;

			continue;
		}

		break;
	}

	const delimiter = line.charAt(firstNonspaceIndex + numOfDigits);
	// The character immediately after the digits (delimiter) must be a period '.' character or a closing parenthesis ')' character.
	if (delimiter !== "." && delimiter !== ")") return null;

	// The digits must be a valid number.
	const value = parseInt(
		line.slice(firstNonspaceIndex, firstNonspaceIndex + numOfDigits),
		10,
	);
	if (!Number.isFinite(value)) return null;

	// Skip the digits and the period or closing parenthesis.
	let characterIndex = firstNonspaceIndex + numOfDigits + 1;

	// The character immediately after the digits must be a space or a tab if the content is not empty
	if (
		characterIndex < line.length &&
		line.charAt(characterIndex) !== " " &&
		line.charAt(characterIndex) !== "\t"
	) {
		return null;
	}

	// Count the total number of columns (tabs are expanded to the next multiple of 4 spaces) from the beginning of the line to the start of the content of the ordered list item.
	let numOfColumns = characterIndex;
	while (characterIndex < line.length) {
		if (line.charAt(characterIndex) === "\t") {
			numOfColumns += 4 - (numOfColumns % 4);
			characterIndex++;
		} else if (line.charAt(characterIndex) === " ") {
			numOfColumns++;
			characterIndex++;
		} else {
			break;
		}
	}

	const numOfColumnsAfterMarker =
		numOfColumns - (firstNonspaceIndex + numOfDigits + 1);

	return {
		content: line.slice(characterIndex),
		numOfColumns,
		numOfColumnsAfterMarker,
		value,
		delimiter,
	};
}

function parseUnorderedListItem(line: string): {
	marker: "*" | "+" | "-";
	numOfColumns: number;
	numOfColumnsAfterMarker: number;
	content: string;
} | null {
	if (isIndentedCodeLine(line)) return null;
	const firstNonspaceIndex = getFirstNonspaceIndex(line);

	const marker = line.charAt(firstNonspaceIndex);
	if (marker !== "*" && marker !== "+" && marker !== "-") {
		return null;
	}

	let characterIndex = firstNonspaceIndex + 1;
	// The character immediately after the marker must be a space or a tab if the content is not empty
	if (
		characterIndex < line.length &&
		line.charAt(characterIndex) !== " " &&
		line.charAt(characterIndex) !== "\t"
	) {
		return null;
	}

	// Count the total number of columns (tabs are expanded to the next multiple of 4 spaces) from the beginning of the line to the start of the content of the ordered list item.
	let numOfColumns = characterIndex;
	while (characterIndex < line.length) {
		if (line.charAt(characterIndex) === "\t") {
			numOfColumns += 4 - (numOfColumns % 4);
			characterIndex++;
		} else if (line.charAt(characterIndex) === " ") {
			numOfColumns++;
			characterIndex++;
		} else {
			break;
		}
	}

	const numOfColumnsAfterMarker = numOfColumns - (firstNonspaceIndex + 1);

	return {
		content: line.slice(characterIndex),
		marker,
		numOfColumns,
		numOfColumnsAfterMarker,
	};
}

// List of HTML block detection sequences per CommonMark specification.
const HTML_SEQUENCES: {
	/** Pattern that must match at line start to begin the HTML block */
	startPattern: RegExp;
	/** Pattern that, when matched, ends the HTML block */
	endPattern?: RegExp;
	/** Whether the HTML block can interrupt a paragraph */
	canInterruptParagraph: boolean;
	/** Whether the HTML block can be interrupted by a blank line */
	canBeInterruptedByBlankLine: boolean;
}[] = [
	{
		startPattern: /^<(?:script|pre|textarea|style)(?:\s|>|$)/i,
		endPattern: /<\/(?:script|pre|textarea|style)>/i,
		canInterruptParagraph: true,
		canBeInterruptedByBlankLine: false,
	},
	{
		startPattern: /^<!--/,
		endPattern: /-->/,
		canInterruptParagraph: true,
		canBeInterruptedByBlankLine: false,
	},
	{
		startPattern: /^<\?/,
		endPattern: /\?>/,
		canInterruptParagraph: true,
		canBeInterruptedByBlankLine: false,
	},
	{
		startPattern: /^<![A-Za-z]/,
		endPattern: />/,
		canInterruptParagraph: true,
		canBeInterruptedByBlankLine: false,
	},
	{
		startPattern: /^<!\[CDATA\[/,
		endPattern: /\]\]>/,
		canInterruptParagraph: true,
		canBeInterruptedByBlankLine: false,
	},
	{
		startPattern:
			/^<[/]?(?:address|article|aside|base|basefont|blockquote|body|caption|center|col|colgroup|dd|details|dialog|dir|div|dl|dt|fieldset|figcaption|figure|footer|form|frame|frameset|h[123456]|head|header|hr|html|iframe|legend|li|link|main|menu|menuitem|nav|noframes|ol|optgroup|option|p|param|section|search|summary|table|tbody|td|tfoot|th|thead|title|tr|track|ul)(?:\s|[/]?[>]|$)/i,
		canInterruptParagraph: true,
		canBeInterruptedByBlankLine: true,
	},
	{
		startPattern: new RegExp(
			"^(?:" + OPEN_TAG + "|" + CLOSE_TAG + ")\\s*$",
			"i",
		),
		canInterruptParagraph: false,
		canBeInterruptedByBlankLine: true,
	},
];

/**
 * Attempts to parse a line as the opening of an HTML block.
 *
 * @param line - The line to parse.
 * @returns An object with the end pattern of the HTML block and whether it can interrupt a paragraph.
 */
function parseHTMLBlockStart(line: string): {
	endPattern?: RegExp;
	canInterruptParagraph: boolean;
	canBeInterruptedByBlankLine: boolean;
} | null {
	if (isIndentedCodeLine(line)) return null;

	const firstNonspaceIndex = getFirstNonspaceIndex(line);
	if (line.charAt(firstNonspaceIndex) !== "<") return null;

	const sequence = HTML_SEQUENCES.find((sequence) =>
		sequence.startPattern.test(line.slice(firstNonspaceIndex)),
	);
	if (sequence === undefined) return null;

	return {
		endPattern: sequence.endPattern,
		canInterruptParagraph: sequence.canInterruptParagraph,
		canBeInterruptedByBlankLine: sequence.canBeInterruptedByBlankLine,
	};
}

/**
 * Checks if a line is empty (contains only whitespace).
 *
 * @param line - The line to check.
 * @returns True if the line contains only whitespace characters, false otherwise.
 */
function isLineEmpty(line: string): boolean {
	return line.trim().length === 0;
}

function isSpaceOrTab(char: string): boolean {
	return char === " " || char === "\t";
}

export interface TableNode {
	type: "table";
	head: {
		cells: Array<{
			align: "left" | "right" | "center" | undefined;
			children: Array<InlineNode>;
		}>;
	};
	body: {
		rows: Array<{
			cells: Array<{
				align: "left" | "right" | "center" | undefined;
				children: Array<InlineNode>;
			}>;
		}>;
	};
}

export interface ThematicBreakNode {
	type: "thematic-break";
}

export interface CodeBlockNode {
	type: "code-block";
	info?: string;
	content: string;
}

export interface BlockquoteNode {
	type: "blockquote";
	children: Array<BlockNode>;
}

export type ListNode = {
	type: "list";
	tight: boolean;
	items: Array<{ children: Array<BlockNode> }>;
} & (
	| {
			kind: "ordered";
			start: number;
	  }
	| {
			kind: "unordered";
			marker: string;
	  }
);
export interface HtmlBlockNode {
	type: "html-block";
	content: string;
}

export interface HeadingNode {
	type: "heading";
	level: 1 | 2 | 3 | 4 | 5 | 6;
	children: Array<InlineNode>;
}

export interface ParagraphNode {
	type: "paragraph";
	children: Array<InlineNode>;
}

export type BlockNode =
	| TableNode
	| ThematicBreakNode
	| CodeBlockNode
	| HeadingNode
	| ParagraphNode
	| BlockquoteNode
	| ListNode
	| HtmlBlockNode;
