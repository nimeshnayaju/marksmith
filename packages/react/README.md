# `react-markdown-parser`

A React server component to render markdown content.

## Installation

```bash
npm install react-markdown-parser
```

## Usage

```tsx
import { Markdown } from "react-markdown-parser";

export function Article({ content }: { content: string }) {
	return (
		<div className="prose">
			<Markdown content={content} />
		</div>
	);
}
```

It is possible to customize how markdown nodes are rendered by through the `components` property. In this example, we're modifying the rendering logic of code blocks and links.


```tsx
import { Markdown } from "react-markdown-parser";

export function Article({ content }: { content: string }) {
	return (
		<div className="prose">
			<Markdown
				content={content}
				components={{
					CodeBlock: ({ content, info }) => {
						// Highlight the content using a syntax highlighting library, etc.
						return (
							<pre data-lang={info}>
								<code>{content}</code>
							</pre>
						);
					},
					Link: ({ href, children }) => {
						// Validate the link destination, etc.
						return (
							<a href={href} rel="noreferrer">
								{children}
							</a>
						);
					},
				}}
			/>
		</div>
	);
}
```