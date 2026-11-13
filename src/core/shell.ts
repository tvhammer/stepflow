import { spawn } from "node:child_process";

export function runShell(command: string, cwd: string): Promise<{ exitCode: number; output: string }> {
  return new Promise((resolve) => {
    const p = spawn(command, { shell: true, cwd });
    let out = "";
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (out += d));
    p.on("error", (e) => resolve({ exitCode: 127, output: String(e) }));
    p.on("close", (code) => resolve({ exitCode: code ?? 1, output: out.length > 8000 ? "…" + out.slice(-8000) : out }));
  });
}
