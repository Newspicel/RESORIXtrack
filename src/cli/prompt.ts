import { createInterface } from "node:readline/promises"
import { Writable } from "node:stream"

/** Ask on the terminal; `hidden` does not echo the answer (passwords). */
export async function ask(question: string, hidden = false): Promise<string> {
  let muted = false
  // readline echoes typed characters to its output; muting it after the prompt keeps a password invisible
  const output = new Writable({
    write(chunk: Buffer | string, encoding: BufferEncoding, done: () => void) {
      if (!muted) process.stdout.write(chunk, encoding)
      done()
    },
  })
  const rl = createInterface({ input: process.stdin, output, terminal: true })
  const pending = rl.question(question)
  muted = hidden
  const answer = await pending
  rl.close()
  if (hidden) process.stdout.write("\n")
  return answer
}

export async function confirm(question: string): Promise<boolean> {
  const yn = (await ask(`${question} [y/N] `)).trim().toLowerCase()
  return yn === "y" || yn === "yes"
}
