/**
 * Splits a chunk of text into lines.
 *
 * Supported line endings:
 *   - LF      -> "\n"   (line feed)
 *   - CRLF    -> "\r\n" (carriage return + line feed)
 *   - CR      -> "\r"   (carriage return)
 *
 * @example
 * ```ts
 * const lines = new LineSplitter().split("Hello\nWorld\r\nTest\r");
 * console.log(lines); // ["Hello", "World", "Test"]
 * ```
 */
export class LineSplitter {
	#partialLine = ""; // Holds any text from the previous chunks that didn't end with a newline.
	#hasPendingCR = false; // Indicates if the previous chunk ended with a carriage return (\r), so we may ignore a leading "\n" next.

	/**
	 * Splits the given chunk of text passed as parameter into lines. By default, the last partial line is not returned.
	 * @param chunk - The chunk of text to split into lines.
	 * @param options.stream - A boolean flag indicating whether the last partial line is included in the returned lines. Defaults to false.
	 * @returns An array of lines after splitting the given chunk of text.
	 */
	split(chunk: string = "", options?: { stream: boolean }): string[] {
		const stream = options?.stream ?? false;

		const lines: string[] = [];

		let lineStartIndex = 0; // Start index of the current candidate line within this chunk.

		// If the last chunk ended with "\r" (CR), ignore a leading "\n" (LF) here (CRLF boundary).
		if (this.#hasPendingCR) {
			if (chunk[0] === "\n") lineStartIndex = 1;
			this.#hasPendingCR = false;
		}

		for (let i = lineStartIndex; i < chunk.length; i++) {
			const currentChar = chunk[i];

			// Check if the current character is newline (\n), which indicates the end of a line.
			if (currentChar === "\n") {
				// Prepend the partial line to the text from the current line and add it to the lines array.
				lines.push(this.#partialLine + chunk.slice(lineStartIndex, i));

				// Reset the partial line to an empty string.
				this.#partialLine = "";

				lineStartIndex = i + 1; // Set the next start index to the next character after the newline.
			} else if (currentChar === "\r") {
				// (1) CRLF is fully contained within this chunk. Emit the line up to the CR, skip the following LF, and continue.
				if (i + 1 < chunk.length && chunk[i + 1] === "\n") {
					lines.push(this.#partialLine + chunk.slice(lineStartIndex, i));

					this.#partialLine = "";

					i += 1; // Skip the next character ("\n") since it's part of the CRLF sequence.
					lineStartIndex = i + 1; // Set the next start index to the next character after the CRLF sequence.
				}
				// (2) CR occurs as the **last** character of the chunk. Emit line now and remember to swallow a leading "\n" (LF) next time.
				else if (i === chunk.length - 1) {
					lines.push(this.#partialLine + chunk.slice(lineStartIndex, i));

					this.#partialLine = "";

					lineStartIndex = i + 1;
					this.#hasPendingCR = true; // Set the flag to true to indicate that the current chunk ended with a carriage return (\r) and we may ignore a leading "\n" next time.
				}
				// (3) Lone CR (next char is NOT "\n" and CR is not at end-of-chunk).
				else {
					lines.push(this.#partialLine + chunk.slice(lineStartIndex, i));
					this.#partialLine = "";
					lineStartIndex = i + 1;
				}
			}
		}

		// Append any remaining text to the buffer to ensure that any text after the last newline is included in the next chunk.
		this.#partialLine += chunk.slice(lineStartIndex);

		// If not streaming and there is a partial line, add it to the lines array and reset the partial line.
		if (!stream && this.#partialLine.length > 0) {
			lines.push(this.#partialLine);
			this.#partialLine = "";
		}

		return lines;
	}
}
