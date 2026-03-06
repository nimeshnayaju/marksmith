import { type BlockNode, MarkdownParser } from "markdown-parser";
import { array, object, string, ValidationError, validate } from "valleys";
import { LineSplitterStream } from "@/app/line-splitter-stream";
import { ServerSentEventParserStream } from "./sse-parser";
export async function POST(request: Request) {
	const apiKey = process.env.ANTHROPIC_API_KEY;
	validate(apiKey, string());

	try {
		const body = await request.json();
		validate(body, object({ messages: array() }));
		// For the demo, we only allow the last 3 messages to be sent to the server to prevent misuse of the API.
		if (body.messages.length > 3) {
			return new Response(null, { status: 422 });
		}
		const messages: Array<
			| {
					role: "user";
					content: Array<{ type: "text"; text: string }>;
			  }
			| {
					role: "assistant";
					content: Array<{ type: "text"; text: string }>;
			  }
		> = body.messages
			.map((message) => {
				validate(message, object({ role: string(), content: array() }));
				if (message.role === "user") {
					return {
						role: "user" as const,
						content: message.content
							.map((part) => {
								validate(part, object({ type: string(), text: string() }));
								if (part.type === "text") {
									const text = part.text.trim();
									validate(text, string({ minLength: 1 }));
									return {
										type: "text" as const,
										text: text,
									};
								} else {
									return null;
								}
							})
							.filter((part) => part !== null),
					};
				} else if (message.role === "assistant") {
					return {
						role: "assistant" as const,
						content: message.content
							.map((part) => {
								validate(part, object({ type: string(), text: string() }));
								if (part.type === "text") {
									const text = part.text.trim();
									validate(text, string({ minLength: 1 }));
									return {
										type: "text" as const,
										text: text,
									};
								} else {
									return null;
								}
							})
							.filter((part) => part !== null),
					};
				} else {
					return null;
				}
			})
			.filter((message) => message !== null);

		const response = await fetch(
			new URL("/v1/messages", "https://api.anthropic.com"),
			{
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"anthropic-version": "2023-06-01",
					"x-api-key": apiKey,
				},
				body: JSON.stringify({
					model: "claude-haiku-4-5",
					max_tokens: 1_024,
					stream: true,
					messages: messages,
				}),
				signal: request.signal,
			},
		);

		if (!response.ok || response.body === null) {
			console.error(await response.text());
			return new Response(null, { status: 500 });
		}

		const reader = response.body
			.pipeThrough(new TextDecoderStream())
			.pipeThrough(new LineSplitterStream())
			.pipeThrough(new ServerSentEventParserStream())
			.pipeThrough(new MessageEventDecoderStream())
			.pipeThrough(new MarkdownParserStream())
			.pipeThrough(
				new TransformStream({
					start(controller) {
						controller.enqueue({ type: "message-start" });
					},
					transform(event, controller) {
						controller.enqueue(event);
					},
					flush(controller) {
						controller.enqueue({ type: "message-stop" });
					},
				}),
			)
			.getReader();

		return new Response(
			new ReadableStream<SendMessageClientMessageStreamEvent>({
				async pull(controller) {
					try {
						const { done, value } = await reader.read();
						if (done) {
							controller.close();
							return;
						}
						controller.enqueue(value);
					} catch (error) {
						console.error(error);
						if (error instanceof MessageEventDecoderStreamError) {
							if (error.data.type === "overloaded_error") {
								controller.enqueue({
									type: "error",
									message:
										"The provider is overloaded. Please try again later.",
								});
								controller.close();
								return;
							}
						}
						controller.enqueue({
							type: "error",
							message:
								"An unexpected error happened while processing your request. Please try again later.",
						});
						controller.close();
					}
				},
				async cancel() {
					await reader.cancel();
				},
			})
				.pipeThrough(
					new TransformStream({
						transform(event, controller) {
							controller.enqueue(JSON.stringify(event) + "\n");
						},
					}),
				)
				.pipeThrough(new TextEncoderStream()),
			{
				headers: {
					"Content-Type": "application/octet-stream",
				},
			},
		);
	} catch (err) {
		console.error(err);
		if (err instanceof ValidationError) {
			return new Response(null, { status: 422 });
		} else {
			return new Response(null, { status: 500 });
		}
	}
}

export class MarkdownParserStream extends TransformStream<
	AnthropicMessageStreamEvent,
	| { type: "text-block-start" }
	| {
			type: "text-block-delta";
			delta: BlockNode;
	  }
	| { type: "text-block-stop" }
> {
	constructor() {
		let parser: MarkdownParser;
		super({
			transform(event, controller) {
				switch (event.type) {
					case "message_start":
					case "message_delta":
					case "message_stop":
						break;
					case "content_block_start": {
						if (event.content_block.type === "text") {
							parser = new MarkdownParser();
							controller.enqueue({ type: "text-block-start" });
						} else {
							throw new Error(
								"Unsupported content block type: " + event.content_block.type,
							);
						}
						break;
					}
					case "content_block_delta": {
						if (event.delta.type === "text_delta") {
							if (parser !== undefined) {
								const nodes = parser.parse(event.delta.text, { stream: true });
								for (const node of nodes) {
									controller.enqueue({ type: "text-block-delta", delta: node });
								}
							} else {
								throw new Error(
									"Markdown parser not initialized for text block",
								);
							}
						} else {
							throw new Error(
								"Unsupported content block delta type: " + event.delta.type,
							);
						}
						break;
					}
					case "content_block_stop": {
						if (parser !== undefined) {
							const nodes = parser.parse("", { stream: false });
							for (const node of nodes) {
								controller.enqueue({ type: "text-block-delta", delta: node });
							}
							controller.enqueue({ type: "text-block-stop" });
						} else {
							throw new Error("Markdown parser not initialized for text block");
						}
						break;
					}
				}
			},
		});
	}
}

export type StopReason =
	| "end_turn"
	| "max_tokens"
	| "stop_sequence"
	| "tool_use"
	| "pause_turn"
	| "refusal";

export type TextBlock = {
	text: string;
	type: "text";
};

export type MessageStartEvent = {
	type: "message_start";
};

export type MessageDeltaEvent = {
	type: "message_delta";
};

export type MessageStopEvent = {
	type: "message_stop";
	stop_reason: StopReason | null;
};

export type ContentBlockStartEvent = {
	type: "content_block_start";
	index: number;
	content_block: TextBlock;
};

type TextDelta = {
	type: "text_delta";
	text: string;
};

export type ContentBlockDeltaEvent = {
	type: "content_block_delta";
	index: number;
	delta: TextDelta;
};

export type ContentBlockStopEvent = {
	type: "content_block_stop";
	index: number;
};

type AnthropicMessageStreamEvent =
	| MessageStartEvent
	| MessageDeltaEvent
	| MessageStopEvent
	| ContentBlockStartEvent
	| ContentBlockDeltaEvent
	| ContentBlockStopEvent;

export class MessageEventDecoderStreamError extends Error {
	data: { type: string; message: string };
	constructor(data: { type: string; message: string }) {
		super(data.message);
		this.data = data;
	}
}

export class MessageEventDecoderStream extends TransformStream<
	{ event: string; data: string },
	AnthropicMessageStreamEvent
> {
	constructor() {
		super({
			transform(chunk, controller) {
				if (chunk.event === "ping") return;

				if (chunk.event === "error") {
					const data = JSON.parse(chunk.data);
					throw new MessageEventDecoderStreamError(
						data as { type: string; message: string },
					);
				}

				if (
					chunk.event === "message_start" ||
					chunk.event === "message_delta" ||
					chunk.event === "message_stop" ||
					chunk.event === "content_block_start" ||
					chunk.event === "content_block_delta" ||
					chunk.event === "content_block_stop"
				) {
					let data: unknown;
					try {
						data = JSON.parse(chunk.data);
						controller.enqueue(data as AnthropicMessageStreamEvent);
					} catch (err) {
						controller.error(err);
					}
					return;
				}
			},
		});
	}
}

export type SendMessageClientMessageStreamEvent =
	| { type: "message-start" }
	| {
			type: "text-block-start";
	  }
	| {
			type: "text-block-delta";
			delta: BlockNode;
	  }
	| {
			type: "text-block-stop";
	  }
	| {
			type: "message-stop";
	  }
	| {
			type: "error";
			message: string;
	  };
