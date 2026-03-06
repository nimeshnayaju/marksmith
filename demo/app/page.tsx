"use client";

import { type BlockNode, type InlineNode } from "markdown-parser";
import {
  type ReactNode,
  type SVGAttributes,
  startTransition,
  useActionState,
  useEffect,
  useOptimistic,
  useReducer,
  useRef,
  useState,
} from "react";
import type { SendMessageClientMessageStreamEvent } from "./api/messages/route";
import { LineSplitterStream } from "./line-splitter-stream";
import {
  BlockNodeComponent as _BlockNodeComponent,
  InlineNodeComponent as _InlineNodeComponent,
  type BlockNodeComponents,
  type InlineNodeComponents,
} from "./markdown";

/**
 * The minimum number of pixels from the bottom of the scrollable area before showing the scroll to bottom indicator.
 */
export const MIN_DISTANCE_BOTTOM_SCROLL_INDICATOR = 50;

export default function Page() {
  const form = useRef<HTMLFormElement | null>(null);
  const bottomMarker = useRef<HTMLDivElement | null>(null);
  const [message, setMessage] = useState<string>("");

  const generatedMessages = useRef<Set<AssistantMessageId>>(new Set());

  const [_messages, dispatch_messages] = useReducer(reducer, [
    {
      id: crypto.randomUUID() as UserMessageId,
      role: "user",
      parts: [{ type: "text", text: "Tell me about markdown-parser" }],
    },
    {
      id: crypto.randomUUID() as AssistantMessageId,
      role: "assistant",
      parts: [
        {
          type: "text",
          nodes: [
            {
              type: "heading",
              level: 3,
              children: [
                {
                  type: "text",
                  text: "markdown-parser",
                },
              ],
            },
            {
              type: "paragraph",
              children: [
                {
                  type: "text",
                  text: "This is a demo for ",
                },
                {
                  type: "link",
                  href: "https://github.com/nimeshnayaju/markdown-parser",
                  children: [
                    {
                      type: "text",
                      text: "markdown-parser",
                    },
                  ],
                },
                {
                  type: "text",
                  text: ", a stream-capable markdown parser, written in TypeScript.",
                },
              ],
            },
            {
              type: "paragraph",
              children: [
                {
                  type: "text",
                  text: "Feel free to submit some messages using the textbox below and see markdown streaming in. What's interesting is that the ",
                },
                {
                  type: "strong",
                  children: [
                    {
                      type: "text",
                      text: "markdown is incrementally parsed on the server",
                    },
                  ],
                },
                {
                  type: "text",
                  text: " and each top level block is streamed to the client as it's ready. Animating incoming blocks is very simple and efficient on the client device.",
                },
              ],
            },
            {
              type: "code-block",
              content:
                'import { MarkdownParser } from "markdown-parser";\n\nconst parser = new MarkdownParser();\nparser.parse("## Hello", { stream: true });\nparser.parse(" world", { stream: true });\n',
            },
            {
              type: "paragraph",
              children: [
                {
                  type: "text",
                  text: "If you find the library useful, consider giving the project a star on ",
                },
                {
                  type: "link",
                  href: "https://github.com/nimeshnayaju/markdown-parser",
                  children: [
                    {
                      type: "text",
                      text: "GitHub",
                    },
                  ],
                },
                {
                  type: "text",
                  text: ".",
                },
              ],
            },
          ],
        },
      ],
      status: "completed",
    },
  ]);

  const [messages, dispatch_optimisticMessages] = useOptimistic(
    _messages,
    reducer,
  );

  const [result_sendMessage, action_sendMessage, isPending_sendMessage] =
    useActionState<
      | { type: "SUCCESS" }
      | {
          type: "UNPROCESSABLE_ENTITY" | "INTERNAL_SERVER_ERROR";
          data: { message: string };
        }
      | null,
      { message: string }
    >(async (_, { message }) => {
      // Optimistically add the user message and assistant message to the messages list.
      const userMessageId = crypto.randomUUID() as UserMessageId;
      dispatch_optimisticMessages({
        type: "ADD_MESSAGE",
        data: [
          {
            id: userMessageId,
            role: "user",
            parts: [
              {
                type: "text",
                text: message,
              },
            ],
          },
          {
            id: crypto.randomUUID() as AssistantMessageId,
            role: "assistant",
            parts: [],
            status: "generating",
          },
        ],
      });

      const response = await fetch("/api/messages", {
        method: "POST",
        body: JSON.stringify({
          messages: [
            // Since, this is just a demo, we do not want to store messages on the server, so we send the message history (the last 3 messages) from the client.
            ..._messages.slice(-2).map((message) => {
              if (message.role === "user") {
                return { role: "user", content: message.parts };
              } else {
                return {
                  role: "assistant",
                  content: message.parts
                    .map((part) => {
                      if (part.type === "text") {
                        return {
                          type: "text",
                          text: part.nodes
                            .map((node) =>
                              convertMarkdownNodeToMarkdownText(node),
                            )
                            .join(""),
                        };
                      } else {
                        return null;
                      }
                    })
                    .filter((part) => part !== null),
                };
              }
            }),
            {
              role: "user",
              content: [{ type: "text", text: message }],
            },
          ],
        }),
        signal: new AbortController().signal,
      });

      if (!response.ok || response.body === null) {
        if (response.status === 422) {
          return {
            type: "UNPROCESSABLE_ENTITY",
            data: { message },
          };
        } else {
          return {
            type: "INTERNAL_SERVER_ERROR",
            data: { message },
          };
        }
      } else {
        const assistantMessage: UIAssistantMessage = {
          id: crypto.randomUUID() as AssistantMessageId,
          role: "assistant",
          parts: [],
          status: "generating",
        };

        generatedMessages.current.add(assistantMessage.id);

        startTransition(() => {
          dispatch_messages({
            type: "ADD_MESSAGE",
            data: [
              {
                id: crypto.randomUUID() as UserMessageId,
                role: "user",
                parts: [{ type: "text", text: message }],
              },
              assistantMessage,
            ],
          });
        });

        if (!ReadableStream.prototype[Symbol.asyncIterator]) {
          ReadableStream.prototype[Symbol.asyncIterator] = function () {
            const reader = this.getReader();
            return {
              async next() {
                return reader.read();
              },
              async return() {
                reader.releaseLock();
                return { done: true, value: undefined };
              },
              [Symbol.asyncIterator]() {
                return this;
              },
              async [Symbol.asyncDispose](): Promise<void> {
                reader.releaseLock();
              },
            };
          };
        }

        const events = response.body
          .pipeThrough(new TextDecoderStream())
          .pipeThrough(new LineSplitterStream())
          .pipeThrough(
            new TransformStream<string, SendMessageClientMessageStreamEvent>({
              transform(chunk, controller) {
                controller.enqueue(
                  JSON.parse(chunk) as SendMessageClientMessageStreamEvent,
                );
              },
            }),
          );

        (async () => {
          try {
            const parts: UIAssistantMessageTextPart[] = [];
            for await (const event of events) {
              switch (event.type) {
                case "message-start":
                case "message-stop":
                  break;
                case "text-block-start":
                  parts.push({ type: "text", nodes: [] });
                  dispatch_messages({
                    type: "UPDATE_ASSISTANT_MESSAGE",
                    messageId: assistantMessage.id,
                    update: {
                      parts: parts,
                    },
                  });
                  break;
                case "text-block-delta":
                  parts[parts.length - 1]?.nodes.push(event.delta);
                  dispatch_messages({
                    type: "UPDATE_ASSISTANT_MESSAGE",
                    messageId: assistantMessage.id,
                    update: {
                      parts: parts,
                    },
                  });
                  break;
                case "text-block-stop":
                  dispatch_messages({
                    type: "UPDATE_ASSISTANT_MESSAGE",
                    messageId: assistantMessage.id,
                    update: {
                      parts: parts,
                    },
                  });
                  break;
                case "error":
                  dispatch_messages({
                    type: "UPDATE_ASSISTANT_MESSAGE",
                    messageId: assistantMessage.id,
                    update: {
                      status: "failed",
                      errorMessage: event.message,
                    },
                  });
                  break;
                default:
                  console.warn(`Unknown event: ${JSON.stringify(event)}`);
                  break;
              }
            }
            dispatch_messages({
              type: "UPDATE_ASSISTANT_MESSAGE",
              messageId: assistantMessage.id,
              update: {
                status: "completed",
              },
            });
          } catch (error) {
            dispatch_messages({
              type: "UPDATE_ASSISTANT_MESSAGE",
              messageId: assistantMessage.id,
              update: {
                status: "failed",
                errorMessage:
                  "An unexpected error happened while processing your request. Please try again later.",
              },
            });
            console.warn(error);
          }
        })();

        return { type: "SUCCESS" };
      }
    }, null);

  const [isScrollAtBottom, setIsScrollAtBottom] = useState(true);

  useEffect(() => {
    if (bottomMarker.current === null) return;

    const observer = new IntersectionObserver(
      async (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setIsScrollAtBottom(true);
          } else {
            setIsScrollAtBottom(false);
          }
        }
      },
      {
        root: document,
        rootMargin: `${MIN_DISTANCE_BOTTOM_SCROLL_INDICATOR}px`,
      },
    );

    observer.observe(bottomMarker.current);
    return () => {
      observer.disconnect();
    };
  }, []);

  useEffect(() => {
    if (!isPending_sendMessage) return;

    if (bottomMarker.current === null) return;
    bottomMarker.current.scrollIntoView({ behavior: "smooth" });
  }, [isPending_sendMessage]);

  const lastMessage = messages[messages.length - 1];

  // Represents whether a request to send message was made but failed and a new request is not in progress
  const isSendMessageFailedAndNotInProgress =
    !isPending_sendMessage &&
    result_sendMessage !== null &&
    result_sendMessage.type !== "SUCCESS";

  return (
    <div className="relative flex h-dvh w-full flex-col items-center">
      <div className="relative mx-auto flex w-full max-w-4xl flex-col gap-6 px-8 py-8 md:px-16 mt-8">
        {messages.map((message, index) => {
          if (message.role === "user") {
            return (
              <div
                className="group ml-auto flex max-w-[80%] flex-col"
                key={message.id}
              >
                <div className="flex w-full flex-col">
                  {/* Message content */}
                  <div className="rounded-3xl [corner-shape:superellipse(1)] bg-neutral-100 px-5 py-2 wrap-break-word whitespace-break-spaces text-neutral-800">
                    {message.parts.map((part, index) => {
                      if (part.type === "text") {
                        return <p key={index}>{part.text}</p>;
                      } else {
                        return null;
                      }
                    })}
                  </div>
                </div>
              </div>
            );
          } else if (message.role === "assistant") {
            const isLastMessage = index === messages.length - 1;

            if (message.status === "generating" && message.parts.length === 0) {
              return (
                <div
                  className={`transition-colors w-fit max-w-full text-neutral-500 animate-[shimmer-text_2s_cubic-bezier(0.1,0,0.9,1)_infinite] select-none ${isLastMessage && !isSendMessageFailedAndNotInProgress ? "min-h-[50svh]" : ""} `}
                  key={message.id}
                >
                  Thinking…
                </div>
              );
            }

            const shouldAnimate = generatedMessages.current.has(message.id);

            return (
              <div
                className={`group flex flex-col gap-2 ${isLastMessage && !isSendMessageFailedAndNotInProgress ? "min-h-[50svh]" : ""} `}
                key={message.id}
              >
                {message.parts.map((part, i) => {
                  if (part.type === "text") {
                    return (
                      <div
                        className="wrap-break-word whitespace-break-spaces"
                        key={i}
                      >
                        {part.nodes.map((node, j) => {
                          switch (node.type) {
                            case "heading":
                              return (
                                <Heading
                                  className={
                                    shouldAnimate
                                      ? "animate-[fade-in_1s_ease-in-out] opacity-0 transition-opacity"
                                      : ""
                                  }
                                  key={j}
                                  level={node.level}
                                  style={
                                    shouldAnimate
                                      ? { animationFillMode: "forwards" }
                                      : undefined
                                  }
                                >
                                  {node.children.map((child, index) => {
                                    return (
                                      <InlineNodeComponent
                                        key={index}
                                        node={child}
                                      />
                                    );
                                  })}
                                </Heading>
                              );
                            case "paragraph":
                              return (
                                <Paragraph
                                  className={
                                    shouldAnimate
                                      ? "animate-[fade-in_1s_ease-in-out] opacity-0 transition-opacity"
                                      : ""
                                  }
                                  key={j}
                                  style={
                                    shouldAnimate
                                      ? { animationFillMode: "forwards" }
                                      : undefined
                                  }
                                >
                                  {node.children.map((child, index) => {
                                    return (
                                      <InlineNodeComponent
                                        key={index}
                                        node={child}
                                      />
                                    );
                                  })}
                                </Paragraph>
                              );
                            case "code-block":
                              return (
                                <CodeBlock
                                  className={
                                    shouldAnimate
                                      ? "animate-[fade-in_1s_ease-in-out] opacity-0 transition-opacity"
                                      : ""
                                  }
                                  content={node.content}
                                  info={node.info}
                                  key={j}
                                  style={
                                    shouldAnimate
                                      ? { animationFillMode: "forwards" }
                                      : undefined
                                  }
                                />
                              );
                            case "table":
                              return (
                                <Table
                                  body={{
                                    rows: node.body.rows.map((row) => {
                                      return {
                                        cells: row.cells.map((cell) => {
                                          return {
                                            children: cell.children.map(
                                              (child, index) => (
                                                <InlineNodeComponent
                                                  key={index}
                                                  node={child}
                                                />
                                              ),
                                            ),
                                            align: cell.align,
                                          };
                                        }),
                                      };
                                    }),
                                  }}
                                  className={
                                    shouldAnimate
                                      ? "animate-[fade-in_1s_ease-in-out] opacity-0 transition-opacity"
                                      : ""
                                  }
                                  head={{
                                    cells: node.head.cells.map((cell) => {
                                      return {
                                        children: cell.children.map(
                                          (child, index) => (
                                            <InlineNodeComponent
                                              key={index}
                                              node={child}
                                            />
                                          ),
                                        ),
                                        align: cell.align,
                                      };
                                    }),
                                  }}
                                  key={j}
                                  style={
                                    shouldAnimate
                                      ? { animationFillMode: "forwards" }
                                      : undefined
                                  }
                                />
                              );
                            case "blockquote":
                              return (
                                <Blockquote
                                  className={
                                    shouldAnimate
                                      ? "animate-[fade-in_1s_ease-in-out] opacity-0 transition-opacity"
                                      : ""
                                  }
                                  key={j}
                                  style={
                                    shouldAnimate
                                      ? { animationFillMode: "forwards" }
                                      : undefined
                                  }
                                >
                                  {node.children.map((child, k) => {
                                    return (
                                      <BlockNodeComponent
                                        key={k}
                                        node={child}
                                      />
                                    );
                                  })}
                                </Blockquote>
                              );
                            case "list":
                              if (node.kind === "ordered") {
                                return (
                                  <List
                                    className={
                                      shouldAnimate
                                        ? "animate-[fade-in_1s_ease-in-out] opacity-0 transition-opacity"
                                        : ""
                                    }
                                    items={node.items.map((item) => {
                                      return {
                                        children: item.children.map(
                                          (child, k) => (
                                            <BlockNodeComponent
                                              key={k}
                                              node={child}
                                            />
                                          ),
                                        ),
                                      };
                                    })}
                                    key={j}
                                    start={node.start}
                                    style={
                                      shouldAnimate
                                        ? { animationFillMode: "forwards" }
                                        : undefined
                                    }
                                    type="ordered"
                                  />
                                );
                              }
                              return (
                                <List
                                  className={
                                    shouldAnimate
                                      ? "animate-[fade-in_1s_ease-in-out] opacity-0 transition-opacity"
                                      : ""
                                  }
                                  items={node.items.map((item) => {
                                    return {
                                      children: item.children.map(
                                        (child, k) => (
                                          <BlockNodeComponent
                                            key={k}
                                            node={child}
                                          />
                                        ),
                                      ),
                                    };
                                  })}
                                  key={j}
                                  style={
                                    shouldAnimate
                                      ? { animationFillMode: "forwards" }
                                      : undefined
                                  }
                                  type="unordered"
                                />
                              );

                            case "thematic-break": {
                              return (
                                <ThematicBreak
                                  className={
                                    shouldAnimate
                                      ? "animate-[fade-in_1s_ease-in-out] opacity-0 transition-opacity"
                                      : ""
                                  }
                                  key={j}
                                  style={
                                    shouldAnimate
                                      ? { animationFillMode: "forwards" }
                                      : undefined
                                  }
                                />
                              );
                            }
                            default:
                              return null;
                          }
                        })}
                      </div>
                    );
                  } else {
                    return null;
                  }
                })}
              </div>
            );
          } else {
            return null;
          }
        })}

        {/* If a request to send message was made but failed and a new request is not in progress, we show an error message regarding the message that failed to send */}
        {isSendMessageFailedAndNotInProgress && (
          <>
            <div className="group ml-auto flex max-w-[80%] flex-col gap-2">
              <div className="flex w-full flex-row items-center gap-2">
                <CircleAlertIcon
                  className="shrink-0 size-4 text-red-500"
                  strokeWidth={3}
                />
                <div className="rounded-4xl bg-neutral-100 px-5 py-2.5 wrap-break-word whitespace-break-spaces text-neutral-800">
                  <p>{result_sendMessage.data.message}</p>
                </div>
              </div>
            </div>

            <div className="min-h-[50svh]">
              <div className="flex flex-row justify-between w-full items-center gap-4 rounded-2xl bg-neutral-100 p-4 text-sm">
                <div className="flex flex-col gap-1">
                  <h3 className="text-sm font-medium">
                    Message failed to send
                  </h3>

                  <p className="text-sm text-neutral-500 text-pretty">
                    {result_sendMessage.type === "UNPROCESSABLE_ENTITY"
                      ? "We couldn't process your request. Please try again."
                      : "Something went wrong while sending your message. Please try again in a moment."}
                  </p>
                </div>
                <button
                  className="inline-flex items-center justify-center gap-1 rounded-full border border-neutral-200 bg-transparent px-3 py-2 text-sm font-medium transition-colors hover:bg-neutral-200 disabled:cursor-not-allowed disabled:opacity-50"
                  onClick={() => {
                    startTransition(() => {
                      action_sendMessage({
                        message: result_sendMessage.data.message,
                      });
                    });
                  }}
                  type="button"
                >
                  Retry
                </button>
              </div>
            </div>
          </>
        )}
      </div>

      {/* Bottom container to detect when the user has scrolled to the bottom of the chat */}
      <div aria-hidden className="invisible sticky h-0" ref={bottomMarker} />

      <div className="to:bg-neutral-950 sticky bottom-0 mx-auto mt-auto w-full bg-linear-to-b from-transparent via-white via-80% to-white px-6 pb-4">
        <div className="pointer-events-none absolute inset-0 -top-12 flex justify-center">
          {!isScrollAtBottom && (
            <button
              className="pointer-events-none inline-flex size-7.5 items-center justify-center rounded-full bg-white p-1.5 opacity-0 shadow ring-1 ring-neutral-950/10 transition-[opacity,color] duration-200 ease-in-out hover:bg-neutral-100 data-visible:pointer-events-auto data-visible:opacity-100"
              data-visible={isScrollAtBottom ? undefined : ""}
              onClick={() => {
                if (bottomMarker.current === null) return;

                bottomMarker.current.scrollIntoView({
                  behavior: "smooth",
                  block: "start",
                  inline: "nearest",
                });
              }}
              tabIndex={isScrollAtBottom ? -1 : 0}
              type="button"
            >
              <ArrowDownIcon className="size-4" />
            </button>
          )}
        </div>

        {/* Composer */}
        <form
          className="mx-auto max-w-3xl rounded-2xl border border-neutral-900/12 bg-white shadow-[0_2px_5px_0_rgba(0,0,0,0.059),0_4px_4px_0_rgba(0,0,0,0.012)] md:rounded-3xl"
          onSubmit={(event) => {
            if (message.trim() === "") return;

            event.preventDefault();
            setMessage("");
            startTransition(() => {
              action_sendMessage({
                message: message,
              });
            });
          }}
          ref={form}
        >
          <div className="flex flex-col">
            <textarea
              autoFocus
              className="field-sizing-content max-h-60 resize-none px-4 pt-4 outline-none placeholder:text-neutral-400"
              onChange={(event) => {
                setMessage(event.target.value);
              }}
              onKeyDown={(event) => {
                let isMobile: boolean;
                if (
                  "userAgentData" in navigator &&
                  typeof navigator.userAgentData === "object" &&
                  navigator.userAgentData !== null &&
                  "mobile" in navigator.userAgentData &&
                  typeof navigator.userAgentData.mobile === "boolean" &&
                  navigator.userAgentData.mobile
                ) {
                  isMobile = true;
                } else if (
                  /iPad|iPhone|iPod/.test(navigator.userAgent) ||
                  /Android/.test(navigator.userAgent)
                ) {
                  isMobile = true;
                } else {
                  isMobile = false;
                }

                // 'Enter' + 'Shift' on mobile or desktop should allow default behavior (default textarea behavior is to insert a new line)
                if (event.key === "Enter" && event.shiftKey) return;

                // 'Enter' on mobile should allow default behavior as well
                if (event.key === "Enter" && isMobile) return;

                // 'Enter' on desktop should submit the form
                if (event.key === "Enter" && !isMobile) {
                  event.preventDefault();
                  // If the message is empty, we don't submit the form
                  if (message.trim() === "") return;

                  // If the message is currently being sent, we don't allow the user to submit the form
                  if (isPending_sendMessage) return;

                  // If the last message is an assistant message and it is still generating, we don't allow the user to submit the form
                  if (
                    lastMessage?.role === "assistant" &&
                    lastMessage.status === "generating"
                  ) {
                    return;
                  }

                  form.current?.requestSubmit();
                }

                // 'Enter' + 'Ctrl'/'Cmd' on desktop should submit the form
                if (
                  event.key === "Enter" &&
                  (event.ctrlKey || event.metaKey) &&
                  !isMobile
                ) {
                  event.preventDefault();

                  // If the message is empty, we don't submit the form
                  if (message.trim() === "") return;

                  // If the message is currently being sent, we don't allow the user to submit the form
                  if (isPending_sendMessage) return;

                  // If the last message is an assistant message and it is still generating, we don't allow the user to submit the form
                  if (
                    lastMessage?.role === "assistant" &&
                    lastMessage.status === "generating"
                  ) {
                    return;
                  }

                  form.current?.requestSubmit();
                }
              }}
              placeholder="Ask anything…"
              rows={1}
              value={message}
            />

            <div className="flex items-center gap-2 px-3 py-4">
              <div className="ml-auto">
                <button
                  className="inline-flex size-7.5 items-center justify-around rounded-full bg-neutral-200/50 text-neutral-900 transition-[colors] duration-150 hover:bg-neutral-200/80 disabled:cursor-not-allowed disabled:bg-neutral-200/50 disabled:opacity-50"
                  disabled={
                    message.trim() === "" ||
                    (lastMessage?.role === "assistant" &&
                      lastMessage.status === "generating")
                  }
                  type="submit"
                >
                  <ArrowUpIcon className="size-4" strokeWidth={3} />
                </button>
              </div>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}

function CircleAlertIcon(props: SVGAttributes<SVGSVGElement>) {
  return (
    <svg
      fill="none"
      height="24"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      viewBox="0 0 24 24"
      width="24"
      xmlns="http://www.w3.org/2000/svg"
      {...props}
    >
      <circle cx="12" cy="12" r="10" />
      <line x1="12" x2="12" y1="8" y2="12" />
      <line x1="12" x2="12.01" y1="16" y2="16" />
    </svg>
  );
}

function ArrowUpIcon(props: SVGAttributes<SVGSVGElement>) {
  return (
    <svg
      fill="none"
      height="24"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      viewBox="0 0 24 24"
      width="24"
      xmlns="http://www.w3.org/2000/svg"
      {...props}
    >
      <path d="m5 12 7-7 7 7" />
      <path d="M12 19V5" />
    </svg>
  );
}

function ArrowDownIcon(props: SVGAttributes<SVGSVGElement>) {
  return (
    <svg
      fill="none"
      height="24"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      viewBox="0 0 24 24"
      width="24"
      xmlns="http://www.w3.org/2000/svg"
      {...props}
    >
      <path d="M12 5v14" />
      <path d="m19 12-7 7-7-7" />
    </svg>
  );
}

declare const brand: unique symbol;
type Brand<T, TBrand extends string> = T & { [brand]: TBrand };

type UserMessageId = Brand<string, "UserMessageId">;
type AssistantMessageId = Brand<string, "AssistantMessageId">;

type UIUserMessagePart = { type: "text"; text: string };
export type UIUserMessage = {
  id: UserMessageId;
  role: "user";
  parts: UIUserMessagePart[];
};

export type UIAssistantMessageTextPart = {
  type: "text";
  nodes: BlockNode[];
};

type UIAssistantMessagePart = UIAssistantMessageTextPart;

type UIAssistantMessage = {
  id: AssistantMessageId;
  role: "assistant";
  parts: UIAssistantMessagePart[];
} & (
  | {
      status: "generating" | "completed" | "failed" | "cancelled";
      errorMessage?: never;
    }
  | {
      status: "failed";
      errorMessage: string;
    }
);

type UIMessage = UIUserMessage | UIAssistantMessage;

function reducer(
  prevMessages: UIMessage[],
  action:
    | {
        type: "ADD_MESSAGE";
        data: UIMessage | Array<UIMessage>;
      }
    | {
        type: "UPDATE_ASSISTANT_MESSAGE";
        messageId: AssistantMessageId;
        update: {
          id?: AssistantMessageId;
          parts?: UIAssistantMessagePart[];
        } & (
          | {
              status?: "generating" | "completed" | "cancelled";
            }
          | { status?: "failed"; errorMessage: string }
        );
      },
): UIMessage[] {
  if (action.type === "ADD_MESSAGE") {
    if (Array.isArray(action.data)) {
      return [...prevMessages, ...action.data];
    } else {
      return [...prevMessages, action.data];
    }
  } else if (action.type === "UPDATE_ASSISTANT_MESSAGE") {
    const messageIndex = prevMessages.findIndex(
      (message) => message.id === action.messageId,
    );
    const existingMessage = prevMessages[messageIndex];
    if (existingMessage === undefined || existingMessage.role !== "assistant") {
      console.warn(`Assistant message with id ${action.messageId} not found.`);
      return prevMessages;
    }

    // If the message is already completed, cancelled, or failed, return the previous messages.
    if (
      (existingMessage as UIAssistantMessage).status === "completed" ||
      (existingMessage as UIAssistantMessage).status === "cancelled" ||
      (existingMessage as UIAssistantMessage).status === "failed"
    ) {
      return prevMessages;
    }

    let updatedMessage: UIAssistantMessage;
    if (action.update.status === "failed") {
      updatedMessage = {
        ...existingMessage,
        status: "failed",
        errorMessage: action.update.errorMessage,
      };
    } else {
      updatedMessage = {
        ...existingMessage,
        ...action.update,
        errorMessage: undefined,
      };
    }

    return [
      ...prevMessages.slice(0, messageIndex),
      updatedMessage,
      ...prevMessages.slice(messageIndex + 1),
    ];
  }

  return prevMessages;
}

function InlineNodeComponent(props: { node: InlineNode }) {
  return (
    <_InlineNodeComponent components={DEFAULT_INLINE_COMPONENTS} {...props} />
  );
}

const DEFAULT_INLINE_COMPONENTS: InlineNodeComponents = {
  Text: (props) => <span>{props.text}</span>,
  CodeSpan: (props) => <code>{props.text}</code>,
  HardBreak: () => <br />,
  SoftBreak: () => null,
  Emphasis: (props) => <em>{props.children}</em>,
  Strong: (props) => <strong>{props.children}</strong>,
  Link: (props) => (
    <a
      className="underline after:content-['↗'] after:cursor-pointer font-semibold"
      href={props.href}
      rel="noopener noreferrer"
      target="_blank"
      title={props.title}
    >
      {props.children}
    </a>
  ),
  Image: (props) => (
    <img alt={props.alt} src={props.href} title={props.title} />
  ),
  Html: (props) => props.content,
};

function BlockNodeComponent(props: { node: BlockNode }) {
  return (
    <_BlockNodeComponent components={DEFAULT_BLOCK_COMPONENTS} {...props} />
  );
}

const DEFAULT_BLOCK_COMPONENTS: BlockNodeComponents = {
  Heading: Heading,
  Paragraph: Paragraph,
  CodeBlock: CodeBlock,
  Table: Table,
  ThematicBreak: ThematicBreak,
  Blockquote: Blockquote,
  List: List,
  HtmlBlock: HtmlBlock,
};

function Heading(props: {
  level: 1 | 2 | 3 | 4 | 5 | 6;
  children: ReactNode;
  className?: string;
  style?: React.CSSProperties;
}) {
  const level = props.level;
  const HeadingTag = `h${level}` as const;
  return (
    <HeadingTag
      className={`mt-6 mb-1.5 font-semibold text-balance ${
        level === 1
          ? "text-2xl leading-8"
          : level === 2
            ? "text-xl leading-7"
            : level === 3
              ? "text-lg leading-6"
              : level === 4
                ? "text-base leading-5"
                : level === 5
                  ? "text-sm leading-4"
                  : "text-xs leading-3"
      } ${props.className}`}
      style={props.style}
    >
      {props.children}
    </HeadingTag>
  );
}

function Paragraph(props: {
  children: ReactNode;
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <p
      className={`my-3 leading-relaxed text-pretty ${props.className}`}
      style={props.style}
    >
      {props.children}
    </p>
  );
}

function CodeBlock(props: {
  content: string;
  info?: string;
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <pre
      className={`min-w-0 m-0 px-4 text-[85%] leading-relaxed overflow-x-auto rounded-md border border-neutral-200 isolate py-3 ${props.className}`}
      style={props.style}
    >
      <code className="font-mono">{props.content}</code>
    </pre>
  );
}

function Table(props: {
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
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <table
      className={`w-full my-4 border-collapse table-auto wrap-break-word ${props.className}`}
      style={props.style}
    >
      <thead className="border-b-2 border-neutral-200">
        <tr>
          {props.head.cells.map((heading, index) => {
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
        {props.body.rows.map((row, index) => {
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
}

function List(
  props: {
    className?: string;
    style?: React.CSSProperties;
    items: { children: ReactNode }[];
  } & (
    | {
        type: "ordered";
        start?: number;
      }
    | {
        type: "unordered";
      }
  ),
) {
  if (props.type === "ordered") {
    return (
      <ol
        className={`my-3 pl-5 list-decimal list-outside flex flex-col gap-1 ${props.className}`}
        start={props.start}
        style={props.style}
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
    <ul
      className={`my-3 pl-5 list-disc list-outside flex flex-col gap-1 ${props.className}`}
      style={props.style}
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
    </ul>
  );
}

function Blockquote(props: {
  children: ReactNode;
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <blockquote
      className={`my-4 border-l-4 border-neutral-200 pl-4 ${props.className}`}
      style={props.style}
    >
      {props.children}
    </blockquote>
  );
}

function ThematicBreak(props: {
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <hr
      className={`my-4 border-neutral-200 ${props.className}`}
      style={props.style}
    />
  );
}

function HtmlBlock(props: { content: string }) {
  return props.content;
}

// A very simple serializer for markdown nodes to text (for demo purposes)
function convertMarkdownNodeToMarkdownText(node: BlockNode): string {
  switch (node.type) {
    case "heading": {
      const prefix = "#".repeat(node.level);
      const text = node.children.map(convertInlineNodeToMarkdownText).join("");
      return `${prefix} ${text}\n\n`;
    }
    case "paragraph":
      return `${node.children.map(convertInlineNodeToMarkdownText).join("")}\n\n`;
    case "code-block": {
      const info = node.info ?? "";
      return `\`\`\`${info}\n${node.content}\`\`\`\n\n`;
    }
    case "blockquote": {
      const inner = node.children
        .map(convertMarkdownNodeToMarkdownText)
        .join("");
      return inner
        .split("\n")
        .map((line) => (line === "" ? ">" : `> ${line}`))
        .join("\n");
    }
    case "list": {
      return (
        node.items
          .map((item, i) => {
            const marker =
              node.kind === "ordered"
                ? `${node.start + i}. `
                : `${node.marker} `;
            const content = item.children
              .map(convertMarkdownNodeToMarkdownText)
              .join("")
              .replace(/\n$/, "");
            const indent = " ".repeat(marker.length);
            const lines = content.split("\n");
            const first = `${marker}${lines[0]}`;
            const rest = lines
              .slice(1)
              .map((line) => (line === "" ? "" : `${indent}${line}`));
            return [first, ...rest].join("\n");
          })
          .join(node.tight ? "\n" : "\n\n") + "\n"
      );
    }
    case "thematic-break":
      return "---\n\n";
    case "table": {
      const headerCells = node.head.cells.map((cell) =>
        cell.children.map(convertInlineNodeToMarkdownText).join(""),
      );
      const header = `| ${headerCells.join(" | ")} |`;

      const alignRow = node.head.cells.map((cell) => {
        switch (cell.align) {
          case "left":
            return ":---";
          case "right":
            return "---:";
          case "center":
            return ":---:";
          default:
            return "---";
        }
      });
      const separator = `| ${alignRow.join(" | ")} |`;

      const bodyRows = node.body.rows.map((row) => {
        const cells = row.cells.map((cell) =>
          cell.children.map(convertInlineNodeToMarkdownText).join(""),
        );
        return `| ${cells.join(" | ")} |`;
      });

      return [header, separator, ...bodyRows].join("\n") + "\n\n";
    }
    case "html-block":
      return `${node.content}\n\n`;
  }
}

function convertInlineNodeToMarkdownText(node: InlineNode): string {
  switch (node.type) {
    case "text":
      return node.text;
    case "code-span":
      return `\`${node.text}\``;
    case "hardbreak":
      return "  \n";
    case "softbreak":
      return "\n";
    case "strong":
      return `**${node.children.map(convertInlineNodeToMarkdownText).join("")}**`;
    case "emphasis":
      return `*${node.children.map(convertInlineNodeToMarkdownText).join("")}*`;
    case "link": {
      const text = node.children.map(convertInlineNodeToMarkdownText).join("");
      const title = node.title ? ` "${node.title}"` : "";
      return `[${text}](${node.href}${title})`;
    }
    case "image": {
      const alt = node.children.map(convertInlineNodeToMarkdownText).join("");
      const title = node.title ? ` "${node.title}"` : "";
      return `![${alt}](${node.href}${title})`;
    }
    case "html":
      return node.content;
  }
}
