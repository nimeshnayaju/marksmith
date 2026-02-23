import { describe, expect, it } from "vitest";
import { LineSplitter } from "../line-splitter";

describe("LineSplitter", () => {
	describe("stream: false (default)", () => {
		it("splits text with LF (\n) line endings", () => {
			const splitter = new LineSplitter();
			const result = splitter.split("Hello\nWorld\nTest");
			expect(result).toEqual(["Hello", "World", "Test"]);
		});

		it("splits text with CRLF (\r\n) line endings", () => {
			const splitter = new LineSplitter();
			const result = splitter.split("Hello\r\nWorld\r\nTest");
			expect(result).toEqual(["Hello", "World", "Test"]);
		});

		it("splits text with CR (\r) line endings", () => {
			const splitter = new LineSplitter();
			const result = splitter.split("Hello\rWorld\rTest");
			expect(result).toEqual(["Hello", "World", "Test"]);
		});

		it("splits text with mixed line endings", () => {
			const splitter = new LineSplitter();
			const result = splitter.split("Hello\nWorld\r\nTest\r");
			expect(result).toEqual(["Hello", "World", "Test"]);
		});

		it("handles empty input", () => {
			const splitter = new LineSplitter();
			const result = splitter.split("");
			expect(result).toEqual([]);
		});

		it("handles input with no line endings (single line)", () => {
			const splitter = new LineSplitter();
			const result = splitter.split("Single line without newline");
			expect(result).toEqual(["Single line without newline"]);
		});

		it("handles input that is only a newline (LF)", () => {
			const splitter = new LineSplitter();
			const result = splitter.split("\n");
			expect(result).toEqual([""]);
		});

		it("handles input that is only a newline (CRLF)", () => {
			const splitter = new LineSplitter();
			const result = splitter.split("\r\n");
			expect(result).toEqual([""]);
		});

		it("handles input that is only a newline (CR)", () => {
			const splitter = new LineSplitter();
			const result = splitter.split("\r");
			expect(result).toEqual([""]);
		});

		it("handles multiple consecutive LF newlines (empty lines)", () => {
			const splitter = new LineSplitter();
			const result = splitter.split("Line1\n\n\nLine2");
			expect(result).toEqual(["Line1", "", "", "Line2"]);
		});

		it("handles multiple consecutive CRLF newlines (empty lines)", () => {
			const splitter = new LineSplitter();
			const result = splitter.split("Line1\r\n\r\n\r\nLine2");
			expect(result).toEqual(["Line1", "", "", "Line2"]);
		});

		it("handles multiple consecutive CR newlines (empty lines)", () => {
			const splitter = new LineSplitter();
			const result = splitter.split("Line1\r\r\rLine2");
			expect(result).toEqual(["Line1", "", "", "Line2"]);
		});

		it("handles trailing LF newline", () => {
			const splitter = new LineSplitter();
			const result = splitter.split("Line1\nLine2\n");
			expect(result).toEqual(["Line1", "Line2"]);
		});

		it("handles trailing CRLF newline", () => {
			const splitter = new LineSplitter();
			const result = splitter.split("Line1\r\nLine2\r\n");
			expect(result).toEqual(["Line1", "Line2"]);
		});

		it("handles trailing CR newline", () => {
			const splitter = new LineSplitter();
			const result = splitter.split("Line1\rLine2\r");
			expect(result).toEqual(["Line1", "Line2"]);
		});

		it("handles leading LF newline", () => {
			const splitter = new LineSplitter();
			const result = splitter.split("\nLine1\nLine2");
			expect(result).toEqual(["", "Line1", "Line2"]);
		});

		it("handles leading CRLF newline", () => {
			const splitter = new LineSplitter();
			const result = splitter.split("\r\nLine1\r\nLine2");
			expect(result).toEqual(["", "Line1", "Line2"]);
		});

		it("handles leading CR newline", () => {
			const splitter = new LineSplitter();
			const result = splitter.split("\rLine1\rLine2");
			expect(result).toEqual(["", "Line1", "Line2"]);
		});

		it("handles input with only multiple newlines", () => {
			const splitter = new LineSplitter();
			const result = splitter.split("\n\n\n");
			expect(result).toEqual(["", "", ""]);
		});

		it("includes final partial line by default", () => {
			const splitter = new LineSplitter();
			const result = splitter.split("Line1\nPartialLine");
			expect(result).toEqual(["Line1", "PartialLine"]);
		});

		it("explicitly passing stream: false behaves like default", () => {
			const splitter = new LineSplitter();
			const result = splitter.split("Line1\nPartial", { stream: false });
			expect(result).toEqual(["Line1", "Partial"]);
		});
	});

	describe("stream: true", () => {
		it("buffers partial line when streaming", () => {
			const splitter = new LineSplitter();
			const result = splitter.split("Hello", { stream: true });
			expect(result).toEqual([]);
		});

		it("returns complete lines and buffers partial line when streaming", () => {
			const splitter = new LineSplitter();
			const result = splitter.split("Line1\nPartial", { stream: true });
			expect(result).toEqual(["Line1"]);
		});

		it("accumulates partial lines across multiple chunks", () => {
			const splitter = new LineSplitter();

			const result1 = splitter.split("Hel", { stream: true });
			expect(result1).toEqual([]);

			const result2 = splitter.split("lo\nWor", { stream: true });
			expect(result2).toEqual(["Hello"]);

			const result3 = splitter.split("ld\n", { stream: true });
			expect(result3).toEqual(["World"]);
		});

		it("flushes remaining content when switching from stream to non-stream", () => {
			const splitter = new LineSplitter();

			const result1 = splitter.split("Hello\nWor", { stream: true });
			expect(result1).toEqual(["Hello"]);

			// Call without stream option to flush remaining content
			const result2 = splitter.split("ld");
			expect(result2).toEqual(["World"]);
		});

		it("handles empty chunks in streaming mode", () => {
			const splitter = new LineSplitter();

			const result1 = splitter.split("Hello", { stream: true });
			expect(result1).toEqual([]);

			const result2 = splitter.split("", { stream: true });
			expect(result2).toEqual([]);

			const result3 = splitter.split("\n", { stream: true });
			expect(result3).toEqual(["Hello"]);
		});

		it("handles CRLF split across two chunks (CR at end, LF at start)", () => {
			const splitter = new LineSplitter();

			const result1 = splitter.split("Line1\r", { stream: true });
			expect(result1).toEqual(["Line1"]);

			// The LF should be ignored since CR was at end of previous chunk
			const result2 = splitter.split("\nLine2", { stream: true });
			expect(result2).toEqual([]);

			const result3 = splitter.split("\n", { stream: true });
			expect(result3).toEqual(["Line2"]);
		});

		it("handles CR at end of chunk followed by non-LF character", () => {
			const splitter = new LineSplitter();

			const result1 = splitter.split("Line1\r", { stream: true });
			expect(result1).toEqual(["Line1"]);

			// Next chunk doesn't start with LF, so CR was standalone
			const result2 = splitter.split("Line2\n", { stream: true });
			expect(result2).toEqual(["Line2"]);
		});

		it("handles CR at end of chunk followed by empty chunk then LF", () => {
			const splitter = new LineSplitter();

			const result1 = splitter.split("Line1\r", { stream: true });
			expect(result1).toEqual(["Line1"]);

			// Empty chunk resets the pending CR flag
			const result2 = splitter.split("", { stream: true });
			expect(result2).toEqual([]);

			// Now LF is not swallowed since pending CR was reset by empty chunk
			const result3 = splitter.split("\nLine2", { stream: true });
			expect(result3).toEqual([""]); // LF creates an empty line
		});

		it("handles multiple CRLFs split across chunks", () => {
			const splitter = new LineSplitter();

			const result1 = splitter.split("A\r", { stream: true });
			expect(result1).toEqual(["A"]);

			const result2 = splitter.split("\nB\r", { stream: true });
			expect(result2).toEqual(["B"]);

			const result3 = splitter.split("\nC");
			expect(result3).toEqual(["C"]);
		});
	});
});
