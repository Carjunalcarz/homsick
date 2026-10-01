/**
 * Line prompts for CLI scripts, reading stdin through one shared buffer so
 * pasted input that runs past a line is kept for the next prompt. Hidden
 * prompts (passwords) use raw mode and echo nothing.
 */
type Input = NodeJS.ReadStream;
type Output = NodeJS.WriteStream;

export class PromptReader {
  private buffer = "";
  private ended = false;
  /** A "\r" ended the last line; drop a "\n" right after it. */
  private skipLf = false;
  private encodingSet = false;

  constructor(
    private readonly input: Input = process.stdin,
    private readonly output: Output = process.stdout,
  ) {}

  /**
   * Ask one question. Rejects with `eofMessage` when input ends before a
   * line is complete, and with "Cancelled." on Ctrl+C in a hidden prompt.
   */
  question(prompt: string, options: { hidden?: boolean; eofMessage: string }): Promise<string> {
    const { input, output } = this;
    const hidden = options.hidden ?? false;
    const tty = input.isTTY === true;
    if (hidden && !tty) {
      return Promise.reject(
        new Error("A hidden password prompt needs a terminal. Set OPD_ADMIN_PASSWORD instead."),
      );
    }

    output.write(prompt);
    if (!this.encodingSet) {
      input.setEncoding("utf8");
      this.encodingSet = true;
    }

    return new Promise<string>((resolve, reject) => {
      let value = "";
      let escape: "none" | "esc" | "seq" = "none";
      let done = false;

      const finish = (error: Error | null, line = "") => {
        done = true;
        input.off("data", onData);
        input.off("end", onEnd);
        input.pause();
        if (tty) input.setRawMode(false);
        if (hidden) output.write("\n");
        if (error) reject(error);
        else resolve(line);
      };

      // Consume buffered characters until a line ends; leave the rest.
      const consume = () => {
        while (!done && this.buffer.length > 0) {
          const ch = this.buffer[0];
          this.buffer = this.buffer.slice(1);
          if (this.skipLf) {
            this.skipLf = false;
            if (ch === "\n") continue;
          }
          if (escape === "esc") {
            escape = ch === "[" || ch === "O" ? "seq" : "none";
            continue;
          }
          if (escape === "seq") {
            if (ch >= "@" && ch <= "~") escape = "none";
            continue;
          }
          if (ch === "\r" || ch === "\n") {
            this.skipLf = ch === "\r";
            finish(null, value);
          } else if (ch === "\u0003") {
            finish(new Error("Cancelled."));
          } else if (ch === "\u0004") {
            this.ended = true;
            finish(new Error(options.eofMessage));
          } else if (ch === "\u007f" || ch === "\b") {
            value = value.slice(0, -1);
          } else if (ch === "\u001b") {
            escape = "esc";
          } else if (ch >= " ") {
            value += ch;
          }
          // Any other control byte is ignored.
        }
      };

      const onData = (chunk: string | Buffer) => {
        this.buffer += chunk.toString();
        consume();
      };
      const onEnd = () => {
        this.ended = true;
        consume();
        if (!done) finish(new Error(options.eofMessage));
      };

      consume();
      if (done) return;
      if (this.ended) {
        finish(new Error(options.eofMessage));
        return;
      }
      if (tty) input.setRawMode(hidden);
      input.on("data", onData);
      input.on("end", onEnd);
      input.resume();
    });
  }
}
