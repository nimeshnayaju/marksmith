export class LineSplitterStream extends TransformStream<string, string> {
  constructor() {
    let buffer = ""; // Holds any text from the previous chunks that didn't end with a newline.
    let hasPendingCR = false; // Indicates if the previous chunk ended with a carriage return (\r).

    super({
      transform(chunk, controller) {
        let index = 0; // The index of the start of the current line.

        // If previous chunk ended with CR, swallow a leading LF here.
        if (hasPendingCR) {
          if (chunk[0] === "\n") index += 1;
          hasPendingCR = false;
        }

        for (let i = index; i < chunk.length; i++) {
          // Check if the current character is newline (\n), which indicates the end of a line.
          if (chunk[i] === "\n") {
            // Concatenate the buffer with the text from the current line and enqueue it.
            controller.enqueue(buffer + chunk.slice(index, i));
            buffer = "";
            index = i + 1;
          } else if (chunk[i] === "\r") {
            // Check if the current character is a carriage return (\r) followed by a newline (\n), which indicates the end of a line (CRLF).
            if (i + 1 < chunk.length && chunk[i + 1] === "\n") {
              controller.enqueue(buffer + chunk.slice(index, i));
              buffer = "";
              i += 1; // Skip the next character since it is part of the CRLF sequence.
              index = i + 1; // Set the index to the next character after the CRLF sequence.
            }
            // Check if the current character is a carriage return and it is the last character in the chunk, the next character could be a newline (\n)
            else if (i === chunk.length - 1) {
              controller.enqueue(buffer + chunk.slice(index, i));
              buffer = "";
              index = i + 1;
              hasPendingCR = true; // Set the flag to true to indicate that the current chunk ended with a carriage return (\r).
            }
            // Check if the current character is a lone carriage return (\r)
            else {
              controller.enqueue(buffer + chunk.slice(index, i));
              buffer = "";
              index = i + 1;
            }
          }
        }
        // Append any remaining text to the buffer to ensure that any text after the last newline is included in the next chunk.
        buffer += chunk.slice(index);
      },
    });
  }
}
