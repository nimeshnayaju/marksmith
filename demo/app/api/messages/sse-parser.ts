export type EventParserOptions = {
	/**
	 * A callback function that is called when a comment is encountered in the stream.
	 * @param comment The comment that was encountered.
	 * @returns void
	 */
	onComment?: (comment: string) => void;
	/**
	 * A callback function that is called when a 'retry' field is encountered in the stream.
	 * @param interval The interval (in milliseconds) at which the client should attempt to reconnect.
	 * @returns void
	 */
	onRetry?: (interval: number) => void;
};
export class ServerSentEventParserStream extends TransformStream<
	string,
	{ id: string | undefined; event: string; data: string }
> {
	constructor({ onComment, onRetry }: EventParserOptions = {}) {
		// Persist the last event ID across event blocks
		let lastEventId: string | undefined;
		let buffer: {
			id: string | undefined;
			event: string | undefined;
			data: string;
		} | null = null;
		super({
			transform(line, controller) {
				// An empty line indicates the end of an event block.
				if (line === "") {
					if (buffer === null) return;

					// Only enqueue the accumulated event if it contains data.
					if (buffer.data.length > 0) {
						controller.enqueue({
							id: buffer.id ?? lastEventId,
							event:
								buffer.event && buffer.event.length > 0
									? buffer.event
									: "message",
							// Remove the trailing newline character from the data field if it exists.
							data: buffer.data.endsWith("\n")
								? buffer.data.slice(0, -1)
								: buffer.data,
						});
					}

					// Reset the buffer to prepare for the next event.
					buffer = null;
				}
				// A line starting with a colon indicates a comment.
				else if (line.startsWith(":")) {
					if (onComment !== undefined) {
						onComment(line.startsWith(": ") ? line.slice(2) : line.slice(1));
					}
				}
				// Process lines that define event fields
				else {
					// Find the index of the first colon in the line and split the line into a field and a value.
					const index = line.indexOf(":");
					let field: string, value: string;
					if (index !== -1) {
						// If the line contains a colon, split the line into a field and a value.
						field = line.slice(0, index);
						// Skip the space after the colon if it exists.
						value = line.slice(index + (line[index + 1] === " " ? 2 : 1));
					} else {
						// If the line does not contain a colon, treat the entire line as a field.
						field = line;
						value = "";
					}

					if (field === "event") {
						if (buffer === null) {
							buffer = { id: undefined, event: value, data: "" };
						} else {
							buffer.event = value;
						}
					} else if (field === "data") {
						if (buffer === null) {
							buffer = { id: undefined, event: undefined, data: value + "\n" };
						} else {
							buffer.data += value + "\n";
						}
					} else if (field === "id") {
						// Ignore the field if it contains a null character.
						if (value.includes("\0")) return;

						if (buffer === null) {
							buffer = { id: value, event: undefined, data: "" };
						} else {
							buffer.id = value;
						}

						lastEventId = value;
					} else if (field === "retry") {
						// Validate that the value is composed entirely of digits.
						if (/^\d+$/.test(value)) {
							if (onRetry !== undefined) {
								onRetry(parseInt(value, 10));
							}
						} else {
							// Ignore invalid retry values
							return;
						}
					} else {
						// Ignore unknown fields
						return;
					}
				}
			},
			flush(controller) {
				// Only enqueue the accumulated event if it contains data.
				if (buffer === null || buffer.data.length === 0) return;
				controller.enqueue({
					id: buffer.id ?? lastEventId,
					event:
						buffer.event && buffer.event.length > 0 ? buffer.event : "message",
					// Remove the trailing newline character from the data field if it exists.
					data: buffer.data.endsWith("\n")
						? buffer.data.slice(0, -1)
						: buffer.data,
				});
			},
		});
	}
}
