import { Markdown } from "@marksmith/react";

export default function Home() {
	return (
		<div className="max-w-4xl mx-auto py-10 px-8">
			<Markdown
				components={{
					Heading: ({ children, level }) => {
						const Heading = `h${level}` as const;
						return (
							<Heading
								className={`mt-6 mb-1.5 font-semibold text-balance ${level === 1 ? "text-3xl leading-10" : level === 2 ? "text-2xl leading-9" : level === 3 ? "text-xl leading-8" : level === 4 ? "text-lg leading-7" : level === 5 ? "text-base leading-6" : "text-sm leading-5"}`}
							>
								{children}
							</Heading>
						);
					},
					Paragraph: ({ children }) => {
						return (
							<p className="my-3 leading-relaxed text-pretty">{children}</p>
						);
					},
					Table: ({ head, body }) => {
						return (
							<table className="w-full my-4 border-collapse table-auto wrap-break-word">
								<thead className="border-b-2 border-neutral-200">
									<tr>
										{head.cells.map((heading, index) => {
											return (
												<th
													align={heading.align}
													className="px-3 py-2 text-left align-bottom first:pl-0 last:pr-0"
													key={index}
												>
													{heading.children}
												</th>
											);
										})}
									</tr>
								</thead>
								<tbody className="align-baseline">
									{body.rows.map((row, index) => {
										return (
											<tr
												className="not-last:border-b not-last:border-neutral-200"
												key={index}
											>
												{row.cells.map((cell, index) => {
													return (
														<td
															align={cell.align}
															className="px-3 py-2 text-left align-baseline first:pl-0 last:pr-0"
															key={index}
														>
															{cell.children}
														</td>
													);
												})}
											</tr>
										);
									})}
								</tbody>
							</table>
						);
					},
					ThematicBreak: () => {
						return <hr className="my-6 border-0 border-t border-neutral-200" />;
					},
					CodeBlock: ({ content }) => {
						return (
							<pre className="min-w-0 m-0 px-4 text-[85%] leading-relaxed overflow-x-auto rounded-md border border-neutral-200 isolate py-3">
								<code className="font-mono">{content}</code>
							</pre>
						);
					},
					Blockquote: ({ children }) => {
						return (
							<blockquote className="my-4 border-l-4 border-neutral-200 pl-4">
								{children}
							</blockquote>
						);
					},
					List: (props) => {
						if (props.type === "ordered") {
							return (
								<ol
									className="my-3 pl-5 list-decimal list-outside flex flex-col gap-1"
									start={props.start}
								>
									{props.items.map((item, index) => {
										return (
											<li
												className="my-0 text-pretty [&>p]:my-1 [&>p:first-child]:mt-0 [&>p:last-child]:mb-0 [&_ol]:my-1 [&_ul]:my-1"
												key={index}
											>
												{item.children}
											</li>
										);
									})}
								</ol>
							);
						}
						return (
							<ul className="my-3 pl-5 list-disc list-outside flex flex-col gap-1">
								{props.items.map((item, index) => {
									return (
										<li
											className="my-0 text-pretty [&>p]:my-1 [&>p:first-child]:mt-0 [&>p:last-child]:mb-0 [&_ol]:my-1 [&_ul]:my-1"
											key={index}
										>
											{item.children}
										</li>
									);
								})}
							</ul>
						);
					},
					Strong: ({ children }) => {
						return <strong className="font-semibold">{children}</strong>;
					},
					CodeSpan: ({ text }) => {
						return (
							<code className="bg-neutral-100 text-[85%] px-1 py-1.5 rounded-sm box-decoration-clone leading-4">
								{text}
							</code>
						);
					},
					Emphasis: ({ children }) => {
						return <em className="font-italic">{children}</em>;
					},
					Link: ({ href, title, children }) => {
						return (
							<a className="text-blue-500 underline" href={href} title={title}>
								{children}
							</a>
						);
					},
					Text: ({ text }) => {
						return text;
					},
				}}
				content={`# Heading 1
## Heading 2
### Heading 3
#### Heading 4
##### Heading 5
###### Heading 6
---
This is a paragraph with a [link](https://www.google.com), _emphasis_, **strong**, and \`code\`.
> lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat. Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur. Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum.
1. This is a list item
   - This is a nested list item
2. This is a list item

| foo | bar |
| --- | --- |
| baz | bim |
| boo | bim |
\`\`\`
console.log("Hello, world!"); 
\`\`\`
`}
			/>
		</div>
	);
}
