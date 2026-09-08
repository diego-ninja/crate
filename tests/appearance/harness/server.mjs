import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(fileURLToPath(new URL("../../..", import.meta.url)));
const vite = path.join(root, "node_modules", ".bin", "vite");
const child = spawn(
  vite,
  [
    "--config",
    "tests/appearance/harness/vite.config.ts",
    "--host",
    "127.0.0.1",
    "--port",
    "4173",
  ],
  { cwd: root, stdio: "inherit", shell: process.platform === "win32" },
);

const stop = (signal) => {
  if (!child.killed) child.kill(signal);
};

process.on("SIGINT", () => stop("SIGINT"));
process.on("SIGTERM", () => stop("SIGTERM"));
child.on("exit", (code, signal) => {
  process.exitCode = code ?? (signal ? 1 : 0);
});
