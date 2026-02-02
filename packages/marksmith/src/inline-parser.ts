import { decodeHTMLStrict } from "entities";
export function parseInline(
	input: string,
	options: {
		referenceDefinitions: Map<string, { href: string; title?: string }>;
	},
): Array<InlineNode> {
	const nodes: Array<InternalInlineNode> = [];
	const brackets: Array<Bracket> = [];

	let characterCursor = 0;
	while (characterCursor < input.length) {
		const marker = input.charAt(characterCursor);
		if (marker === "\n") {
			const startIndex = characterCursor;

			let numOfPrecedingSpaces = 0;
			while (true) {
				const currentIndex = startIndex - numOfPrecedingSpaces - 1;
				if (currentIndex < 0) break;
				if (input.charAt(currentIndex) !== " ") break;
				numOfPrecedingSpaces++;
			}

			const lastNode = nodes[nodes.length - 1];
			if (lastNode?.type === "text") {
				const content = lastNode.text;
				lastNode.text = content.slice(0, content.length - numOfPrecedingSpaces);
			}

			if (numOfPrecedingSpaces >= 2) {
				nodes.push({ type: "hardbreak" });
			} else {
				nodes.push({ type: "softbreak" });
			}

			// Skip any leading spaces or tabs in the next line.
			const numOfSpaces = getNumOfConsecutiveCharacters(input, {
				characters: [" "],
				startIndex: startIndex + 1, // Skip the newline character
			});

			characterCursor += 1 /* Skip the newline character */ + numOfSpaces;
		} else if (marker === "\\") {
			// If "\" is followed by a newline, it is a forced hard line break.
			const nextCharacter = input.charAt(characterCursor + 1);
			if (nextCharacter === "\n") {
				nodes.push({ type: "hardbreak" });
				characterCursor += 2; // Skip the "\" and the following newline character

				// Skip any leading spaces or tabs in the next line.
				const numOfSpaces = getNumOfConsecutiveCharacters(input, {
					characters: [" ", "\t"],
					startIndex: characterCursor,
				});

				characterCursor += numOfSpaces;
				continue;
			}

			if (isAsciiPunctuationCharacter(nextCharacter)) {
				nodes.push({ type: "text", text: nextCharacter });
				characterCursor += 2;
				continue;
			}

			nodes.push({ type: "text", text: marker });
			characterCursor += 1;
		} else if (marker === "`") {
			const numOfOpeningBackticks = getNumOfConsecutiveCharacters(input, {
				characters: ["`"],
				startIndex: characterCursor,
			});
			let hasClosingBackticks = false;
			const openerIndex = characterCursor + numOfOpeningBackticks;
			let closerIndex = openerIndex;
			while (closerIndex < input.length) {
				closerIndex = input.indexOf("`", closerIndex);
				if (closerIndex === -1) break;
				const numOfClosingBackticks = getNumOfConsecutiveCharacters(input, {
					characters: ["`"],
					startIndex: closerIndex,
				});

				// If the number of consecutive backticks in the closing backticks is the same as the number of consecutive backticks at the start of the code span, it is a valid code span.
				if (numOfClosingBackticks === numOfOpeningBackticks) {
					hasClosingBackticks = true;
					break;
				}

				// Move the closer index to the next backtick.
				closerIndex += numOfClosingBackticks;
			}

			if (hasClosingBackticks) {
				let content = input.slice(openerIndex, closerIndex).replace(/\n/g, " "); // Replace newlines inside the captured text with a space as per CommonMark spec.
				if (content[0] === " " && content[content.length - 1] === " ") {
					if (content.trim().length > 0) {
						content = content.slice(1, content.length - 1);
					}
				}
				nodes.push({ type: "code-span", text: content });
				characterCursor = closerIndex + numOfOpeningBackticks;
			} else {
				nodes.push({
					type: "text",
					text: marker.repeat(numOfOpeningBackticks),
				});
				characterCursor += numOfOpeningBackticks;
			}
		} else if (marker === "*" || marker === "_") {
			const numOfMarkers = getNumOfConsecutiveCharacters(input, {
				characters: [marker],
				startIndex: characterCursor,
			});

			const previousCharacter = input[characterCursor - 1] ?? " ";
			const nextCharacter = input[characterCursor + numOfMarkers] ?? " ";

			const isPreviousCharacterPunctuation =
				isAsciiPunctuationCharacter(previousCharacter) ||
				isUnicodePunctuationCharacter(previousCharacter);
			const isNextCharacterPunctuation =
				isAsciiPunctuationCharacter(nextCharacter) ||
				isUnicodePunctuationCharacter(nextCharacter);

			const isPreviousCharacterWhitespace =
				isWhiteSpaceCharacter(previousCharacter);
			const isNextCharacterWhitespace = isWhiteSpaceCharacter(nextCharacter);

			/**
			 * A left-flanking delimiter run is a delimiter run that is:
			 * (1) not followed by Unicode whitespace, and either
			 * (2a) not followed by a Unicode punctuation character, or (2b) followed by a Unicode punctuation character and preceded by Unicode whitespace or a Unicode punctuation character.
			 * Read more: https://spec.commonmark.org/0.31.2/#left-flanking-delimiter-run
			 */
			const isLeftFlanking =
				!isNextCharacterWhitespace &&
				(!isNextCharacterPunctuation ||
					isPreviousCharacterWhitespace ||
					isPreviousCharacterPunctuation);

			/**
			 * A right-flanking delimiter run is a delimiter run that is
			 * (1) not preceded by Unicode whitespace, and either
			 * (2a) not preceded by a Unicode punctuation character, or (2b) preceded by a Unicode punctuation character and followed by Unicode whitespace or a Unicode punctuation character.
			 * Read more: https://spec.commonmark.org/0.31.2/#right-flanking-delimiter-run
			 */
			const isRightFlanking =
				!isPreviousCharacterWhitespace &&
				(!isPreviousCharacterPunctuation ||
					isNextCharacterWhitespace ||
					isNextCharacterPunctuation);

			// For emphasis characters, we create a special node that could evolve to emphasis nodes or become simple text nodes, depending on whether they have a matching opener/closer.
			if (marker === "*") {
				nodes.push({
					type: "emphasis-delimiter",
					marker,
					canOpen: isLeftFlanking,
					canClose: isRightFlanking,
					count: numOfMarkers,
					content: marker.repeat(numOfMarkers),
				});
			} else {
				nodes.push({
					type: "emphasis-delimiter",
					marker,
					canOpen:
						isLeftFlanking &&
						(!isRightFlanking || isPreviousCharacterPunctuation),
					canClose:
						isRightFlanking && (!isLeftFlanking || isNextCharacterPunctuation),
					count: numOfMarkers,
					content: marker.repeat(numOfMarkers),
				});
			}

			characterCursor += numOfMarkers;
		} else if (marker === "[") {
			const node: TextNode = { type: "text", text: marker };
			nodes.push(node);
			brackets.push({
				marker: "[",
				node,
				startIndex: characterCursor,
				isActive: true,
			});
			characterCursor += 1;
		} else if (marker === "!" && input.charAt(characterCursor + 1) === "[") {
			const node: TextNode = { type: "text", text: "![" };
			nodes.push(node);
			brackets.push({
				marker: "![",
				node,
				startIndex: characterCursor,
				isActive: true,
			});
			characterCursor += 2;
		} else if (marker === "]") {
			const startIndex = characterCursor;
			// Pop the last bracket from the bracket stack.
			const openerBracket = brackets.pop();
			// If the last bracket doesn't exist or is inactive, we render the closing bracket as text.
			if (openerBracket === undefined || !openerBracket.isActive) {
				nodes.push({ type: "text", text: marker });
				characterCursor += 1;
				continue;
			}

			const target = parseLinkTarget(input, {
				startIndex: characterCursor + 1, // Skip the closing bracket.
			});

			let href: string;
			let title: string | undefined;

			if (target !== null) {
				href = target.href;
				title = target.title;
				characterCursor = target.endIndex + 1;
			}
			// If inline link parsing failed, we try to parse the link as a reference link.
			else {
				let label: string | null;

				const referenceLabel = parseReferenceLinkLabel(input, {
					startIndex: characterCursor + 1,
				});
				if (referenceLabel !== null) {
					// If the reference label is a full label (e.g. [label]), we use the explicit label.
					if (referenceLabel.label.length > 0) {
						label = referenceLabel.label;
					}
					// If the reference label is collapsed (e.g. []), we use the link text as the label.
					else {
						label = extractLinkLabel(input, {
							startIndex:
								openerBracket.marker === "["
									? openerBracket.startIndex + 1
									: openerBracket.startIndex + 2,
							endIndex: startIndex,
						});
					}

					characterCursor = referenceLabel.endIndex + 1;
				}
				// If the reference label is invalid, we use the link text as the label.
				else {
					label = extractLinkLabel(input, {
						startIndex:
							openerBracket.marker === "["
								? openerBracket.startIndex + 1
								: openerBracket.startIndex + 2,
						endIndex: startIndex,
					});

					// Advance the character cursor by 1 to skip the closing bracket
					characterCursor = startIndex + 1;
				}

				const definition =
					label !== null
						? options.referenceDefinitions.get(normalizeReference(label))
						: undefined;

				if (definition === undefined) {
					nodes.push({ type: "text", text: marker });
					characterCursor = startIndex + 1;
					continue;
				}
				href = definition.href;
				title = definition.title;
			}

			const openerNodeIndex = nodes.indexOf(openerBracket.node);
			const children = parseEmphasisDelimiterNodes(
				nodes.splice(openerNodeIndex + 1),
			);

			nodes[openerNodeIndex] = {
				type: openerBracket.marker === "[" ? "link" : "image",
				href: encodeUnsafeChars(href),
				title,
				children,
			};

			// As per CommonMark specification, links cannot contain other links. When we form a link, we mark all the '[' brackets as inactive so that if a closing bracket ']' is encountered, it will be rendered as text instead of forming a link.
			if (openerBracket.marker === "[") {
				for (const bracket of brackets) {
					if (bracket.marker === "[") {
						bracket.isActive = false; // This bracket's '[' now requires its ']' to be rendered as text.
					}
				}
			}
		} else if (marker === "<") {
			// Attempt to parse the content as an autolink.
			const emailMatch = input.slice(characterCursor).match(EMAIL_REGEX);
			if (emailMatch !== null) {
				const email = emailMatch[0].slice(1, emailMatch[0].length - 1);
				let destination: string;
				try {
					destination = encodeUnsafeChars("mailto:" + email);
				} catch {
					destination = "mailto:" + email;
				}
				nodes.push({
					type: "link",
					href: destination,
					children: [{ type: "text", text: email }],
				});
				characterCursor += emailMatch[0].length;
				continue;
			}

			const uriMatch = input.slice(characterCursor).match(AUTOLINK_REGEX);
			if (uriMatch !== null) {
				const uri = uriMatch[0].slice(1, uriMatch[0].length - 1);
				let destination: string;
				try {
					destination = encodeUnsafeChars(uri);
				} catch {
					destination = uri;
				}
				nodes.push({
					type: "link",
					href: destination,
					children: [{ type: "text", text: uri }],
				});
				characterCursor += uriMatch[0].length;
				continue;
			}

			// If we failed to parse the content as an autolink, attempt to parse it as a raw HTML tag.
			const htmlTagMatch = input.slice(characterCursor).match(HTML_TAG_REGEX);
			if (htmlTagMatch !== null) {
				nodes.push({ type: "html", content: htmlTagMatch[0] });
				characterCursor += htmlTagMatch[0].length;
				continue;
			}

			nodes.push({ type: "text", text: marker });
			characterCursor += 1;
		} else if (marker === "&") {
			const match = input.slice(characterCursor).match(ENTITY_REGEX);
			if (match !== null) {
				const entity = match[0];
				nodes.push({ type: "text", text: decodeHTMLStrict(entity) });
				characterCursor += entity.length;
				continue;
			}

			nodes.push({ type: "text", text: marker });
			characterCursor += 1;
		} else {
			let endIndex = characterCursor;
			while (endIndex < input.length) {
				const character = input.charAt(endIndex);
				if (character === "\n") break;
				if (character === "\\") break;
				if (character === "`") break;
				if (character === "*") break;
				if (character === "_") break;
				if (character === "[") break;
				if (character === "]") break;
				if (character === "!") break;
				if (character === "<") break;
				if (character === "&") break;
				endIndex++;
			}

			// If no characters were consumed, consume at least one character. This handles standalone "!" character not followed by "[" (which falls through from the above checks since it's not an image opener)
			if (endIndex === characterCursor) {
				endIndex++;
			}

			nodes.push({
				type: "text",
				text: input.slice(characterCursor, endIndex),
			});

			characterCursor = endIndex;
		}
	}

	return mergeAdjacentTextNodes(parseEmphasisDelimiterNodes(nodes));
}

function parseEmphasisDelimiterNodes(
	nodes: Array<InternalInlineNode>,
): Array<InlineNode> {
	const result: Array<InternalInlineNode | EmphasisNode | StrongNode> = nodes;
	let closerIndex = 0;
	while (closerIndex < result.length) {
		const node = result[closerIndex];
		if (node === undefined) break;

		// Skip delimiters that cannot close an emphasis. E.g., in '*foo bar', the '*' is left-flanking only, so we skip it as it cannot close an emphasis.
		if (node.type !== "emphasis-delimiter" || !node.canClose) {
			closerIndex++;
			continue;
		}

		const closer = node;
		// Search backward from the closer to find the nearest matching opener.
		const openerInfo = findMatchingOpenerForCloser(result, {
			node: closer,
			index: closerIndex,
		});
		// If no matching opener is found, we continue to the next delimiter after handling the case where the closer cannot open emphasis either.
		if (openerInfo === null) {
			// If a matching opener isn't found for the closer and if the closer cannot open emphasis either, we replace the delimiter with a text node containing the delimiter's content.
			if (!closer.canOpen) {
				result[closerIndex] = {
					type: "text",
					text: closer.content,
				};
			}
			closerIndex++;
			continue;
		}

		const opener = openerInfo.node;
		const openerIndex = openerInfo.index;

		// If the opener and closer both have at least two marker characters, it is a strong emphasis.
		const isStrong = opener.content.length >= 2 && closer.content.length >= 2;

		// Depending on whether it is a strong emphasis or not, we remove the last two or one characters from the opener node text and the first two or one characters from the closer node text.
		opener.content = opener.content.slice(0, isStrong ? -2 : -1);
		closer.content = closer.content.slice(isStrong ? 2 : 1);

		// Collect the nodes between opener and closer to be wrapped in the emphasis node.
		// Any emphasis-delimiter nodes are replaced with text nodes containing the delimiter's content as they can't participate in future matches at this level.
		const children = result
			.slice(openerIndex + 1, closerIndex)
			.map<InlineNode>((node) => {
				if (node.type === "emphasis-delimiter") {
					return {
						type: "text",
						text: node.content,
					};
				}
				return node;
			});

		result.splice(openerIndex + 1, closerIndex - openerIndex - 1, {
			type: isStrong ? "strong" : "emphasis",
			children,
		});
		// If the opener is fully consumed (i.e., no remaining characters), we remove it from the result array.
		if (opener.content.length === 0) {
			result.splice(openerIndex, 1);
		}
		// If the closer is fully consumed (i.e., no remaining characters), we remove it from the result array.
		if (closer.content.length === 0) {
			result.splice(result.indexOf(closer), 1);
		}
		// Move the closer index to the node after the opener as we've collapsed the nodes between opener and closer into a single emphasis node.
		closerIndex = openerIndex + 1;
	}

	return result.map<InlineNode>((node) => {
		if (node.type === "emphasis-delimiter") {
			return {
				type: "text",
				text: node.content,
			};
		}
		return node;
	});
}

function findMatchingOpenerForCloser(
	nodes: Array<InternalInlineNode | EmphasisNode | StrongNode>,
	closer: {
		node: EmphasisDelimiterNode;
		index: number;
	},
): { node: EmphasisDelimiterNode; index: number } | null {
	for (let i = closer.index - 1; i >= 0; i--) {
		const node = nodes[i];
		if (node?.type !== "emphasis-delimiter") continue;

		// Skip delimiters that cannot open an emphasis or are not the same marker as the closer.
		if (!node.canOpen) continue;
		if (node.marker !== closer.node.marker) continue;

		/**
		 * Check if the delimiter pair violates the rule of three.
		 * In the CommonMark emphasis rules, when a delimiter run can both open and close, a special constraint applies to decide whether a pair of runs should match:
		 * If the sum of the run lengths of the opener and closer is a multiple of 3, then they do not match unless both run lengths are themselves multiples of 3.
		 */
		if (
			(node.canClose || closer.node.canOpen) &&
			(node.count + closer.node.count) % 3 === 0 &&
			(node.count % 3 !== 0 || closer.node.count % 3 !== 0)
		) {
			continue;
		}

		return { node, index: i };
	}
	return null;
}

interface Bracket {
	marker: "[" | "!["; // "[" for link, "![" for image
	node: TextNode; // The text node containing the bracket (replaced if link or image is successfully parsed)
	startIndex: number; // The start index of the bracket in the input string
	isActive: boolean; // Whether the bracket can still form a link (inactive brackets need their closing bracket (]) rendered as text)
}

interface CodeSpanNode {
	type: "code-span";
	text: string;
}

interface TextNode {
	type: "text";
	text: string;
}

interface HardBreakNode {
	type: "hardbreak";
}

interface SoftBreakNode {
	type: "softbreak";
}

interface StrongNode {
	type: "strong";
	children: Array<InlineNode>;
}

interface EmphasisNode {
	type: "emphasis";
	children: Array<InlineNode>;
}

interface LinkNode {
	type: "link";
	href: string;
	title?: string;
	children: Array<InlineNode>; // Link nodes cannot contain other link nodes as children but we declare the children as InlineNode for simplicity.
}

interface ImageNode {
	type: "image";
	href: string;
	title?: string;
	children: Array<InlineNode>;
}

interface HtmlTagNode {
	type: "html";
	content: string;
}

interface EmphasisDelimiterNode {
	type: "emphasis-delimiter";
	marker: "*" | "_"; // "*" for emphasis, "_" for strong emphasis
	content: string;
	canOpen: boolean;
	canClose: boolean;
	count: number;
}

type InternalInlineNode =
	| TextNode
	| CodeSpanNode
	| HardBreakNode
	| SoftBreakNode
	| LinkNode
	| ImageNode
	| HtmlTagNode
	| EmphasisDelimiterNode;

export type InlineNode =
	| TextNode
	| CodeSpanNode
	| HardBreakNode
	| SoftBreakNode
	| StrongNode
	| EmphasisNode
	| LinkNode
	| ImageNode
	| HtmlTagNode;

/**
 * Counts the number of consecutive characters from a set starting at a given position.
 *
 * @param input - The string to search within.
 * @param options.characters - Array of characters to match (any character in the array counts).
 * @param options.startIndex - The position in the input to start counting from.
 * @returns The count of consecutive matching characters (0 if none match).
 *
 * @example
 * getNumOfConsecutiveCharacters("```ts", { characters: ["`"], startIndex: 0 })  // 3
 * getNumOfConsecutiveCharacters("  \thello", { characters: [" ", "\t"], startIndex: 0 })  // 3
 */
function getNumOfConsecutiveCharacters(
	input: string,
	{ characters, startIndex }: { characters: string[]; startIndex: number },
) {
	let numOfConsecutiveCharacters = 0;
	while (true) {
		if (startIndex + numOfConsecutiveCharacters >= input.length) break;
		if (
			!characters.includes(
				input.charAt(startIndex + numOfConsecutiveCharacters),
			)
		) {
			break;
		}
		numOfConsecutiveCharacters++;
	}
	return numOfConsecutiveCharacters;
}

/**
 * Merges adjacent text nodes in an array of LeafNodes into a single text node, recursively processing any children arrays found in nodes with a "children" property.
 *
 * For example, the input:
 *   [
 *     { type: "text", text: "foo" },
 *     { type: "text", text: "bar" },
 *     { type: "emphasis", children: [
 *        { type: "text", text: "baz" },
 *        { type: "text", text: "qux" }
 *     ]}
 *   ]
 * will be transformed to:
 *   [
 *     { type: "text", text: "foobar" },
 *     { type: "emphasis", children: [
 *        { type: "text", text: "bazqux" }
 *     ]}
 *   ]
 *
 * @param nodes An array of LeafNode objects (e.g. text, link, emphasis, etc.).
 * @returns A new array of LeafNodes where no two adjacent nodes have type "text", including recursively merged children arrays.
 */
function mergeAdjacentTextNodes(nodes: Array<InlineNode>): Array<InlineNode> {
	const result: Array<InlineNode> = [];
	for (const node of nodes) {
		if (node.type === "text") {
			const lastNode = result[result.length - 1];
			if (lastNode?.type === "text") {
				lastNode.text += node.text;
			} else {
				result.push(node);
			}
		} else {
			// Recursively merge text nodes for any children.
			if ("children" in node) {
				node.children = mergeAdjacentTextNodes(node.children);
			}
			result.push(node);
		}
	}
	return result;
}

/**
 * Checks if the character is an ASCII punctuation character.
 * An ASCII punctuation character is !, ", #, $, %, &, ', (, ), *, +, ,, -, ., / (U+0021–2F), :, ;, <, =, >, ?, @ (U+003A–0040), [, \, ], ^, _, ` (U+005B–0060), {, |, }, or ~ (U+007B–007E).
 * @param character - The character to check.
 * @returns true if the character is an ASCII punctuation character, false otherwise.
 *
 * The following characters are considered ASCII punctuation characters:
 * - ! (U+0021)
 * - " (U+0022)
 * - # (U+0023)
 * - $ (U+0024)
 * - % (U+0025)
 * - & (U+0026)
 * - ' (U+0027)
 * - ( (U+0028)
 * - ) (U+0029)
 * - * (U+002A)
 * - + (U+002B)
 * - , (U+002C)
 * - - (U+002D)
 * - . (U+002E)
 * - / (U+002F)
 * - : (U+003A)
 * - ; (U+003B)
 * - < (U+003C)
 * - = (U+003D)
 * - > (U+003E)
 * - ? (U+003F)
 * - @ (U+0040)
 * - [ (U+005B)
 * - \ (U+005C)
 * - ] (U+005D)
 * - ^ (U+005E)
 * - _ (U+005F)
 * - ` (U+0060)
 * - { (U+007B)
 * - | (U+007C)
 * - } (U+007D)
 * - ~ (U+007E)
 *
 * https://spec.commonmark.org/0.31.2/#ascii-punctuation-character
 */
function isAsciiPunctuationCharacter(character: string): boolean {
	switch (character) {
		case "!":
		case '"':
		case "#":
		case "$":
		case "%":
		case "&":
		case "'":
		case "(":
		case ")":
		case "*":
		case "+":
		case ",":
		case "-":
		case ".":
		case "/":
		case ":":
		case ";":
		case "<":
		case "=":
		case ">":
		case "?":
		case "@":
		case "[":
		case "\\":
		case "]":
		case "^":
		case "_":
		case "`":
		case "{":
		case "|":
		case "}":
		case "~":
			return true;
		default:
			return false;
	}
}

const UNICODE_P_REGEX =
	/[!-#%-*,-/:;?@[-\]_{}\xA1\xA7\xAB\xB6\xB7\xBB\xBF\u037E\u0387\u055A-\u055F\u0589\u058A\u05BE\u05C0\u05C3\u05C6\u05F3\u05F4\u0609\u060A\u060C\u060D\u061B\u061D-\u061F\u066A-\u066D\u06D4\u0700-\u070D\u07F7-\u07F9\u0830-\u083E\u085E\u0964\u0965\u0970\u09FD\u0A76\u0AF0\u0C77\u0C84\u0DF4\u0E4F\u0E5A\u0E5B\u0F04-\u0F12\u0F14\u0F3A-\u0F3D\u0F85\u0FD0-\u0FD4\u0FD9\u0FDA\u104A-\u104F\u10FB\u1360-\u1368\u1400\u166E\u169B\u169C\u16EB-\u16ED\u1735\u1736\u17D4-\u17D6\u17D8-\u17DA\u1800-\u180A\u1944\u1945\u1A1E\u1A1F\u1AA0-\u1AA6\u1AA8-\u1AAD\u1B5A-\u1B60\u1B7D\u1B7E\u1BFC-\u1BFF\u1C3B-\u1C3F\u1C7E\u1C7F\u1CC0-\u1CC7\u1CD3\u2010-\u2027\u2030-\u2043\u2045-\u2051\u2053-\u205E\u207D\u207E\u208D\u208E\u2308-\u230B\u2329\u232A\u2768-\u2775\u27C5\u27C6\u27E6-\u27EF\u2983-\u2998\u29D8-\u29DB\u29FC\u29FD\u2CF9-\u2CFC\u2CFE\u2CFF\u2D70\u2E00-\u2E2E\u2E30-\u2E4F\u2E52-\u2E5D\u3001-\u3003\u3008-\u3011\u3014-\u301F\u3030\u303D\u30A0\u30FB\uA4FE\uA4FF\uA60D-\uA60F\uA673\uA67E\uA6F2-\uA6F7\uA874-\uA877\uA8CE\uA8CF\uA8F8-\uA8FA\uA8FC\uA92E\uA92F\uA95F\uA9C1-\uA9CD\uA9DE\uA9DF\uAA5C-\uAA5F\uAADE\uAADF\uAAF0\uAAF1\uABEB\uFD3E\uFD3F\uFE10-\uFE19\uFE30-\uFE52\uFE54-\uFE61\uFE63\uFE68\uFE6A\uFE6B\uFF01-\uFF03\uFF05-\uFF0A\uFF0C-\uFF0F\uFF1A\uFF1B\uFF1F\uFF20\uFF3B-\uFF3D\uFF3F\uFF5B\uFF5D\uFF5F-\uFF65]|\uD800[\uDD00-\uDD02\uDF9F\uDFD0]|\uD801\uDD6F|\uD802[\uDC57\uDD1F\uDD3F\uDE50-\uDE58\uDE7F\uDEF0-\uDEF6\uDF39-\uDF3F\uDF99-\uDF9C]|\uD803[\uDEAD\uDF55-\uDF59\uDF86-\uDF89]|\uD804[\uDC47-\uDC4D\uDCBB\uDCBC\uDCBE-\uDCC1\uDD40-\uDD43\uDD74\uDD75\uDDC5-\uDDC8\uDDCD\uDDDB\uDDDD-\uDDDF\uDE38-\uDE3D\uDEA9]|\uD805[\uDC4B-\uDC4F\uDC5A\uDC5B\uDC5D\uDCC6\uDDC1-\uDDD7\uDE41-\uDE43\uDE60-\uDE6C\uDEB9\uDF3C-\uDF3E]|\uD806[\uDC3B\uDD44-\uDD46\uDDE2\uDE3F-\uDE46\uDE9A-\uDE9C\uDE9E-\uDEA2\uDF00-\uDF09]|\uD807[\uDC41-\uDC45\uDC70\uDC71\uDEF7\uDEF8\uDF43-\uDF4F\uDFFF]|\uD809[\uDC70-\uDC74]|\uD80B[\uDFF1\uDFF2]|\uD81A[\uDE6E\uDE6F\uDEF5\uDF37-\uDF3B\uDF44]|\uD81B[\uDE97-\uDE9A\uDFE2]|\uD82F\uDC9F|\uD836[\uDE87-\uDE8B]|\uD83A[\uDD5E\uDD5F]/;

const UNICODE_S_REGEX =
	/[$+<->^`|~\xA2-\xA6\xA8\xA9\xAC\xAE-\xB1\xB4\xB8\xD7\xF7\u02C2-\u02C5\u02D2-\u02DF\u02E5-\u02EB\u02ED\u02EF-\u02FF\u0375\u0384\u0385\u03F6\u0482\u058D-\u058F\u0606-\u0608\u060B\u060E\u060F\u06DE\u06E9\u06FD\u06FE\u07F6\u07FE\u07FF\u0888\u09F2\u09F3\u09FA\u09FB\u0AF1\u0B70\u0BF3-\u0BFA\u0C7F\u0D4F\u0D79\u0E3F\u0F01-\u0F03\u0F13\u0F15-\u0F17\u0F1A-\u0F1F\u0F34\u0F36\u0F38\u0FBE-\u0FC5\u0FC7-\u0FCC\u0FCE\u0FCF\u0FD5-\u0FD8\u109E\u109F\u1390-\u1399\u166D\u17DB\u1940\u19DE-\u19FF\u1B61-\u1B6A\u1B74-\u1B7C\u1FBD\u1FBF-\u1FC1\u1FCD-\u1FCF\u1FDD-\u1FDF\u1FED-\u1FEF\u1FFD\u1FFE\u2044\u2052\u207A-\u207C\u208A-\u208C\u20A0-\u20C0\u2100\u2101\u2103-\u2106\u2108\u2109\u2114\u2116-\u2118\u211E-\u2123\u2125\u2127\u2129\u212E\u213A\u213B\u2140-\u2144\u214A-\u214D\u214F\u218A\u218B\u2190-\u2307\u230C-\u2328\u232B-\u2426\u2440-\u244A\u249C-\u24E9\u2500-\u2767\u2794-\u27C4\u27C7-\u27E5\u27F0-\u2982\u2999-\u29D7\u29DC-\u29FB\u29FE-\u2B73\u2B76-\u2B95\u2B97-\u2BFF\u2CE5-\u2CEA\u2E50\u2E51\u2E80-\u2E99\u2E9B-\u2EF3\u2F00-\u2FD5\u2FF0-\u2FFF\u3004\u3012\u3013\u3020\u3036\u3037\u303E\u303F\u309B\u309C\u3190\u3191\u3196-\u319F\u31C0-\u31E3\u31EF\u3200-\u321E\u322A-\u3247\u3250\u3260-\u327F\u328A-\u32B0\u32C0-\u33FF\u4DC0-\u4DFF\uA490-\uA4C6\uA700-\uA716\uA720\uA721\uA789\uA78A\uA828-\uA82B\uA836-\uA839\uAA77-\uAA79\uAB5B\uAB6A\uAB6B\uFB29\uFBB2-\uFBC2\uFD40-\uFD4F\uFDCF\uFDFC-\uFDFF\uFE62\uFE64-\uFE66\uFE69\uFF04\uFF0B\uFF1C-\uFF1E\uFF3E\uFF40\uFF5C\uFF5E\uFFE0-\uFFE6\uFFE8-\uFFEE\uFFFC\uFFFD]|\uD800[\uDD37-\uDD3F\uDD79-\uDD89\uDD8C-\uDD8E\uDD90-\uDD9C\uDDA0\uDDD0-\uDDFC]|\uD802[\uDC77\uDC78\uDEC8]|\uD805\uDF3F|\uD807[\uDFD5-\uDFF1]|\uD81A[\uDF3C-\uDF3F\uDF45]|\uD82F\uDC9C|\uD833[\uDF50-\uDFC3]|\uD834[\uDC00-\uDCF5\uDD00-\uDD26\uDD29-\uDD64\uDD6A-\uDD6C\uDD83\uDD84\uDD8C-\uDDA9\uDDAE-\uDDEA\uDE00-\uDE41\uDE45\uDF00-\uDF56]|\uD835[\uDEC1\uDEDB\uDEFB\uDF15\uDF35\uDF4F\uDF6F\uDF89\uDFA9\uDFC3]|\uD836[\uDC00-\uDDFF\uDE37-\uDE3A\uDE6D-\uDE74\uDE76-\uDE83\uDE85\uDE86]|\uD838[\uDD4F\uDEFF]|\uD83B[\uDCAC\uDCB0\uDD2E\uDEF0\uDEF1]|\uD83C[\uDC00-\uDC2B\uDC30-\uDC93\uDCA0-\uDCAE\uDCB1-\uDCBF\uDCC1-\uDCCF\uDCD1-\uDCF5\uDD0D-\uDDAD\uDDE6-\uDE02\uDE10-\uDE3B\uDE40-\uDE48\uDE50\uDE51\uDE60-\uDE65\uDF00-\uDFFF]|\uD83D[\uDC00-\uDED7\uDEDC-\uDEEC\uDEF0-\uDEFC\uDF00-\uDF76\uDF7B-\uDFD9\uDFE0-\uDFEB\uDFF0]|\uD83E[\uDC00-\uDC0B\uDC10-\uDC47\uDC50-\uDC59\uDC60-\uDC87\uDC90-\uDCAD\uDCB0\uDCB1\uDD00-\uDE53\uDE60-\uDE6D\uDE70-\uDE7C\uDE80-\uDE88\uDE90-\uDEBD\uDEBF-\uDEC5\uDECE-\uDEDB\uDEE0-\uDEE8\uDEF0-\uDEF8\uDF00-\uDF92\uDF94-\uDFCA]/;

/**
 * Checks if the character is a unicode punctuation character.
 * A Unicode punctuation character is a character in the Unicode P (puncuation) or S (symbol) general categories.
 * @param character - The character to check.
 * @returns true if the character is a punctuation character, false otherwise.
 *
 * https://spec.commonmark.org/0.31.2/#unicode-punctuation-character
 */
function isUnicodePunctuationCharacter(character: string): boolean {
	return UNICODE_P_REGEX.test(character) || UNICODE_S_REGEX.test(character);
}

function isWhiteSpaceCharacter(character: string): boolean {
	const code = character.charCodeAt(0);
	if (code >= 0x2000 && code <= 0x200a) {
		return true;
	}
	switch (code) {
		case 0x09: /* \t */
		case 0x0a: /* \n */
		case 0x0b: /* \v */
		case 0x0c: /* \f */
		case 0x0d: /* \r */
		case 0x20:
		case 0xa0:
		case 0x1680:
		case 0x202f:
		case 0x205f:
		case 0x3000:
			return true;
	}
	return false;
}

function parseLinkTarget(
	input: string,
	options: { startIndex: number },
): { href: string; title?: string; raw: string; endIndex: number } | null {
	const startIndex = options.startIndex;

	if (input.charAt(startIndex) !== "(") return null;

	// Count the number of whitespaces and newlines after the left parenthesis.
	const numOfWhitespacesAfterLeftParenthesis = getNumOfConsecutiveCharacters(
		input,
		{
			characters: [" ", "\t", "\n"],
			startIndex: startIndex + 1,
		},
	);

	const destinationStartIndex =
		startIndex + numOfWhitespacesAfterLeftParenthesis + 1; // Skip whitespaces and newlines after the left parenthesis

	const destination = parseLinkDestination(input, {
		startIndex: destinationStartIndex,
	});
	if (destination === null || destination.endIndex === destinationStartIndex) {
		return null;
	}

	const destinationEndIndex = destination.endIndex;

	const numOfWhitespacesAfterHref = getNumOfConsecutiveCharacters(input, {
		characters: [" ", "\t", "\n"],
		startIndex: destinationEndIndex + 1,
	});

	const titleStartIndex = destinationEndIndex + numOfWhitespacesAfterHref + 1;
	const title = parseLinkTitle(input, {
		startIndex: titleStartIndex,
	});

	let targetEndIndex = destination.endIndex;
	if (title !== null) {
		targetEndIndex = title.endIndex;
	}

	const numOfWhitespaces = getNumOfConsecutiveCharacters(input, {
		characters: [" ", "\t", "\n"],
		startIndex: targetEndIndex + 1,
	});

	targetEndIndex += numOfWhitespaces + 1;

	// Link target must end with a right parenthesis.
	if (input.charAt(targetEndIndex) !== ")") {
		return null;
	}

	return {
		href: destination.href,
		title: title?.title,
		raw: input.slice(startIndex, targetEndIndex + 1),
		endIndex: targetEndIndex,
	};
}

export function parseLinkDestination(
	input: string,
	options: { startIndex: number },
): { href: string; raw: string; endIndex: number } | null {
	const startIndex = options.startIndex;
	// If the destination start index is out of bounds, the link target is invalid.
	if (startIndex >= input.length) return null;

	if (input.charAt(startIndex) === "<") {
		const destinationStartIndex = startIndex + 1;
		let destinationEndIndex = destinationStartIndex;

		while (destinationEndIndex < input.length) {
			const character = input.charAt(destinationEndIndex);
			if (character === "\n") return null;
			if (character === "<") return null;

			if (character === ">") {
				return {
					href: unescapeString(
						input.slice(destinationStartIndex, destinationEndIndex),
					), // The unescaped link href without the "<" and the ">" characters.
					raw: input.slice(destinationStartIndex, destinationEndIndex + 1), // The raw content of the link href including the "<" and the ">" characters.
					endIndex: destinationEndIndex,
				};
			}

			// If the current character is a backslash and it is not the last character, it is an escaped character, so we skip the current character and the next character.
			if (character === "\\" && destinationEndIndex + 1 < input.length) {
				destinationEndIndex += 2;
				continue;
			}

			destinationEndIndex++;
		}

		return null;
	} else {
		const destinationStartIndex = startIndex;
		let destinationEndIndex = destinationStartIndex;

		let numOfLeftParentheses = 0;
		while (destinationEndIndex < input.length) {
			const characterCode = input.charCodeAt(destinationEndIndex);

			if (input.charCodeAt(destinationEndIndex) === 0x20 /* SPACE */) break;

			// Handle ASCII control characters
			if (characterCode < 0x20 || characterCode === 0x7f) {
				break;
			}

			if (
				characterCode === 0x5c /* BACKSLASH */ &&
				destinationEndIndex + 1 < input.length
			) {
				if (input.charCodeAt(destinationEndIndex + 1) === 0x20 /* SPACE */) {
					break;
				}
				destinationEndIndex += 2;
				continue;
			}

			if (characterCode === 0x28 /* LEFT_PARENTHESIS */) {
				numOfLeftParentheses++;
				if (numOfLeftParentheses > 32) return null;
			}

			if (characterCode === 0x29 /* RIGHT_PARENTHESIS */) {
				if (numOfLeftParentheses === 0) break;
				numOfLeftParentheses--;
			}

			destinationEndIndex++;
		}

		// Unbalanced parentheses make the destination invalid
		if (numOfLeftParentheses !== 0) return null;

		const raw = input.slice(destinationStartIndex, destinationEndIndex);
		return {
			href: unescapeString(raw),
			raw,
			endIndex: destinationEndIndex - 1,
		};
	}
}

function parseLinkTitle(
	input: string,
	options: { startIndex: number },
): { raw: string; title: string; endIndex: number } | null {
	const startIndex = options.startIndex;
	// If the title start index is out of bounds, the link title is invalid.
	if (startIndex >= input.length) return null;

	const openingQuoteCharacter = input.charAt(startIndex);
	// Link title must start with ", ', or (
	if (!['"', "'", "("].includes(openingQuoteCharacter)) {
		return null;
	}

	const closingQuoteCharacter =
		openingQuoteCharacter === "(" ? ")" : openingQuoteCharacter;
	let endIndex = startIndex + 1;
	while (endIndex < input.length) {
		const character = input.charAt(endIndex);
		if (character === closingQuoteCharacter) {
			return {
				raw: input.slice(startIndex, endIndex + 1),
				title: unescapeString(input.slice(startIndex + 1, endIndex)),
				endIndex: endIndex,
			};
		}

		// For parenthesis-delimited titles, unescaped `(` is not allowed; this prevents ambiguity in parsing.
		if (character === "(" && openingQuoteCharacter === "(") {
			return null;
		}

		// If the current character is a backslash and it is not the last character, it is an escaped character, so we skip the current character and the next character.
		if (character === "\\" && endIndex + 1 < input.length) {
			endIndex += 2;
			continue;
		}

		// Regular characters (including newlines) are allowed in the title.
		endIndex++;
	}

	return null;
}

function parseReferenceLinkLabel(
	input: string,
	options: { startIndex: number },
): { label: string; raw: string; endIndex: number } | null {
	const startIndex = options.startIndex;
	if (startIndex >= input.length) return null;

	if (input.charAt(startIndex) !== "[") return null;

	// Handle the special case of a collapsed reference '[]'. We return an empty label in this case.
	if (input.charAt(startIndex + 1) === "]") {
		return {
			label: "",
			raw: input.slice(startIndex, startIndex + 2),
			endIndex: startIndex + 1,
		};
	}

	let label = "";
	let endIndex = startIndex + 1;
	while (endIndex < input.length) {
		const character = input.charAt(endIndex);

		// A reference label that is too long is invalid.
		if (label.length > 999) return null;

		if (character === "\\") {
			const nextCharacter = input.charAt(endIndex + 1);
			// Only ']', '[' and '\' need to be escaped within labels. Other backslashes are preserved literally for label matching.
			if (["]", "[", "\\"].includes(nextCharacter)) {
				label += nextCharacter;
				endIndex += 2;
			}
			// Preserve the backslash for other characters.
			else {
				label += character;
				endIndex++;
			}
			continue;
		}

		// Unescaped `[` characters are not allowed in reference link labels. This prevents ambiguous nested bracket parsing.
		if (character === "[") return null;

		// If the current character is a closing bracket, we return the reference label.
		if (character === "]") {
			// An empty reference label is invalid.
			if (label.trim().length === 0) return null;

			return {
				label,
				raw: input.slice(startIndex, endIndex + 1),
				endIndex: endIndex,
			};
		}

		label += character;
		endIndex++;
	}

	// Reached the end of text without finding a closing bracket, so the reference label is invalid.
	return null;
}

function extractLinkLabel(
	input: string,
	options: { startIndex: number; endIndex: number },
): string | null {
	let label = "";
	let index = options.startIndex;
	while (index < options.endIndex) {
		if (index >= input.length) break;

		// A label that is too long is invalid.
		if (label.length > 999) return null;

		const character = input.charAt(index);
		if (character === "\\") {
			// Only ']', '[' and '\' can be escaped within labels. Other backslashes are preserved literally for label matching.
			if (["]", "[", "\\"].includes(input.charAt(index + 1))) {
				label += input.charAt(index + 1);
				index += 2;
			}
			// Preserve the backslash for other characters.
			else {
				label += character;
				index++;
			}
			continue;
		}

		label += character;
		index++;
	}

	// An empty label is invalid.
	if (label.trim().length === 0) return null;

	return label;
}

export function normalizeReference(reference: string): string {
	return reference.trim().replace(/\s+/g, " ").toLowerCase().toUpperCase();
}

const UNESCAPE_MD_RE = /\\([!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~])/g;
const ENTITY_RE = /&([a-z#][a-z0-9]{1,31});/gi;
const UNESCAPE_ALL_RE = new RegExp(
	UNESCAPE_MD_RE.source + "|" + ENTITY_RE.source,
	"gi",
);
const DIGITAL_ENTITY_TEST_RE = /^#((?:x[a-f0-9]{1,8}|[0-9]{1,8}))$/i;

export function unescapeString(text: string): string {
	if (text.indexOf("\\") < 0 && text.indexOf("&") < 0) return text;
	return text.replace(UNESCAPE_ALL_RE, (match, escaped, entity: string) => {
		if (escaped) return escaped;

		if (entity.charAt(0) === "#" && DIGITAL_ENTITY_TEST_RE.test(entity)) {
			const code =
				entity.charAt(1).toLowerCase() === "x"
					? parseInt(entity.slice(2), 16)
					: parseInt(entity.slice(1), 10);
			if (isValidEntityCode(code)) {
				return fromCodePoint(code);
			}
			return match;
		}

		const decoded = decodeHTMLStrict(match);
		if (decoded !== match) {
			return decoded;
		}
		return match;
	});
}

function isValidEntityCode(code: number): boolean {
	// Broken sequence
	if (code >= 0xd800 && code <= 0xdfff) return false;
	// Never used
	if (code >= 0xfdd0 && code <= 0xfdef) return false;
	if ((code & 0xffff) === 0xffff || (code & 0xffff) === 0xfffe) return false;
	// Control codes
	if (code >= 0x00 && code <= 0x08) return false;
	if (code === 0x0b) return false;
	if (code >= 0x0e && code <= 0x1f) return false;
	if (code >= 0x7f && code <= 0x9f) return false;
	// Out of range
	if (code > 0x10ffff) return false;
	return true;
}

function fromCodePoint(code: number): string {
	if (code > 0xffff) {
		code -= 0x10000;
		const surrogate1 = 0xd800 + (code >> 10);
		const surrogate2 = 0xdc00 + (code & 0x3ff);

		return String.fromCharCode(surrogate1, surrogate2);
	}
	return String.fromCharCode(code);
}

/**
 * A cached lookup table used to quickly percent-encode ASCII characters (0–127).
 *
 * Key: a string of "allowed" (unencoded) characters besides alphanumerics.
 * Value: an array of length 128 where:
 *   - table[code] is the literal character if it is allowed as-is
 *   - otherwise table[code] is the percent-encoded form (e.g., "%2F")
 */
const asciiEncodeTableCache: Record<string, string[]> = Object.create(null);

/**
 * Builds (or retrieves from cache) a lookup table for ASCII characters.
 *
 * Rules:
 * - Alphanumerics [0-9A-Za-z] are always left unencoded.
 * - Everything else is percent-encoded by default.
 * - Characters present in `allowedChars` are left unencoded as well.
 *
 * This table is only for ASCII 0–127. Non-ASCII characters are handled with
 * `encodeURIComponent` at runtime.
 */
function getAsciiEncodeTable(allowedChars: string): string[] {
	const cachedTable = asciiEncodeTableCache[allowedChars];
	if (cachedTable) return cachedTable;

	const table: string[] = [];
	asciiEncodeTableCache[allowedChars] = table;

	// Pre-fill for all ASCII codes.
	for (let code = 0; code < 128; code++) {
		const ch = String.fromCharCode(code);

		// Always allow unencoded alphanumeric characters.
		if (/^[0-9a-z]$/i.test(ch)) {
			table.push(ch);
			continue;
		}

		// Percent-encode any other ASCII character by default.
		const hex = code.toString(16).toUpperCase();
		table.push(`%${hex.padStart(2, "0")}`);
	}

	// Override: allow any characters provided in `allowedChars` to pass through.
	for (let i = 0; i < allowedChars.length; i++) {
		const allowedChar = allowedChars[i];
		if (allowedChar === undefined) continue;

		const code = allowedChars.charCodeAt(i);

		// Only affects ASCII entries; non-ASCII isn't in the table anyway.
		if (code < 128) {
			table[code] = allowedChar;
		}
	}

	return table;
}

/**
 * Characters allowed unencoded by default (in addition to alphanumerics).
 */
const DEFAULT_ALLOWED_CHARS = ";/?:@&=+$,-_.!~*'()#";

/**
 * Encodes "unsafe" characters using percent-encoding while optionally preserving
 * already-escaped sequences (e.g., "%2F").
 */
function encodeUnsafeChars(
	input: string,
	allowedChars?: string,
	keepExistingEscapes?: boolean,
): string {
	// If the second argument isn't a string, treat it as `keepExistingEscapes`.
	// This preserves the original API shape:
	//   encodeUnsafeChars(input, keepExistingEscapes)
	if (typeof allowedChars !== "string") {
		keepExistingEscapes = allowedChars;
		allowedChars = DEFAULT_ALLOWED_CHARS;
	}

	// Default behavior: preserve valid "%HH" sequences.
	if (typeof keepExistingEscapes === "undefined") {
		keepExistingEscapes = true;
	}

	const asciiTable = getAsciiEncodeTable(allowedChars);
	let encoded = "";

	for (let i = 0; i < input.length; i++) {
		const currentCharacter = input[i];
		if (currentCharacter === undefined) continue;

		const codeUnit = input.charCodeAt(i);

		// If requested, preserve correct percent-escape sequences: "%[0-9A-Fa-f]{2}"
		if (
			keepExistingEscapes &&
			codeUnit === 0x25 /* '%' */ &&
			i + 2 < input.length
		) {
			const maybeHex = input.slice(i + 1, i + 3);
			if (/^[0-9a-f]{2}$/i.test(maybeHex)) {
				encoded += input.slice(i, i + 3);
				i += 2; // skip the two hex digits as well
				continue;
			}
		}

		// Fast path: ASCII characters use our lookup table.
		if (codeUnit < 128) {
			encoded += asciiTable[codeUnit];
			continue;
		}

		// Handle UTF-16 surrogate pairs and invalid surrogate code units.
		// Surrogates range: 0xD800–0xDFFF
		if (codeUnit >= 0xd800 && codeUnit <= 0xdfff) {
			const isHighSurrogate = codeUnit >= 0xd800 && codeUnit <= 0xdbff;

			if (isHighSurrogate && i + 1 < input.length) {
				const nextCodeUnit = input.charCodeAt(i + 1);
				const isLowSurrogate = nextCodeUnit >= 0xdc00 && nextCodeUnit <= 0xdfff;

				// Valid surrogate pair: encode the combined code point.
				if (isLowSurrogate) {
					encoded += encodeURIComponent(currentCharacter + input[i + 1]);
					i++; // consume the low surrogate
					continue;
				}
			}

			// Invalid surrogate (unpaired): emit UTF-8 for U+FFFD replacement char.
			encoded += "%EF%BF%BD";
			continue;
		}

		// Non-ASCII, non-surrogate: rely on encodeURIComponent for correct UTF-8 encoding.
		encoded += encodeURIComponent(currentCharacter);
	}

	return encoded;
}

const ENTITY_REGEX = /^&(?:#x[a-f0-9]{1,6}|#[0-9]{1,7}|[a-z][a-z0-9]{1,31});/i;

// Pattern for valid HTML attribute names (starts with letter/underscore/colon).
const ATTRIBUTE_NAME = "[a-zA-Z_:][a-zA-Z0-9:._-]*";
// Pattern for unquoted attribute values (no quotes, spaces, or special chars).
const UNQUOTED = "[^\"'=<>`\\x00-\\x20]+";
// Pattern for single-quoted attribute values.
const SINGLE_QUOTED = "'[^']*'";
// Pattern for double-quoted attribute values.
const DOUBLE_QUOTED = '"[^"]*"';

// Combined pattern for any valid attribute value format.
const ATTRIBUTE_VALUE =
	"(?:" + UNQUOTED + "|" + SINGLE_QUOTED + "|" + DOUBLE_QUOTED + ")";

// Pattern for a complete HTML attribute (name with optional value).
const ATTRIBUTE =
	"(?:\\s+" + ATTRIBUTE_NAME + "(?:\\s*=\\s*" + ATTRIBUTE_VALUE + ")?)";
// Pattern for an opening HTML tag (e.g., `<div>`, `<img />`).
export const OPEN_TAG = "<[A-Za-z][A-Za-z0-9\\-]*" + ATTRIBUTE + "*\\s*\\/?>";

// Pattern for a closing HTML tag (e.g., `</div>`).
export const CLOSE_TAG = "<\\/[A-Za-z][A-Za-z0-9\\-]*\\s*>";
// Pattern for HTML comments (e.g., `<!-- comment -->`).
const COMMENT = "<!---?>|<!--(?:[^-]|-[^-]|--[^>])*-->";
// Pattern for processing instructions (e.g., `<?xml ... ?>`).
const PROCESSING = "<[?][\\s\\S]*?[?]>";
// Pattern for DOCTYPE and other declarations (e.g., `<!DOCTYPE html>`).
const DECLARATION = "<![A-Za-z][^>]*>";
// Pattern for CDATA sections (e.g., `<![CDATA[ ... ]]>`).
const CDATA = "<!\\[CDATA\\[[\\s\\S]*?\\]\\]>";

// Regex to match any inline HTML construct at the start of a string. Used for detecting HTML tags within inline content.
const HTML_TAG_REGEX = new RegExp(
	"^(?:" +
		OPEN_TAG +
		"|" +
		CLOSE_TAG +
		"|" +
		COMMENT +
		"|" +
		PROCESSING +
		"|" +
		DECLARATION +
		"|" +
		CDATA +
		")",
);

const EMAIL_REGEX =
	/^<([a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*)>/;

const AUTOLINK_REGEX = /^<[A-Za-z][A-Za-z0-9.+-]{1,31}:[^<>\x00-\x20]*>/i;
