import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";

async function main() {
  // Reserve an OS-selected local port; the child signals readiness through stdout.
  const reservation = createServer();
  reservation.listen(0, "127.0.0.1");
  await once(reservation, "listening");
  const address = reservation.address();
  assert(address && typeof address !== "string");
  const port = address.port;
  await new Promise<void>((resolve, reject) => reservation.close((err) => err ? reject(err) : resolve()));
  const server = spawn(process.execPath, [
    "node_modules/next/dist/bin/next", "dev", "--hostname", "127.0.0.1", "--port", String(port),
  ], { stdio: ["ignore", "pipe", "pipe"], env: process.env });
  const exited = once(server, "exit");
  try {
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Server readiness timed out")), 60_000);
      let output = "";
      server.stdout.on("data", (chunk) => {
        output += chunk;
        if (/Ready in/.test(output)) { clearTimeout(timeout); resolve(); }
      });
      server.stderr.on("data", (chunk) => process.stderr.write(chunk));
      server.once("error", (err) => { clearTimeout(timeout); reject(err); });
      server.once("exit", (code) => { clearTimeout(timeout); reject(new Error(`Server exited: ${code}`)); });
    });
    const rpc = async (id: number, method: string, params: unknown) => {
      const response = await fetch(`http://127.0.0.1:${port}/api/mcp`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
        body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
        signal: AbortSignal.timeout(180_000),
      });
      assert.equal(response.status, 200);
      const body = await response.text();
      const messages = response.headers.get("content-type")?.includes("text/event-stream")
        ? body.split("\n").filter((line) => line.startsWith("data: ")).map((line) => JSON.parse(line.slice(6)))
        : [JSON.parse(body)];
      const message = messages.find((item) => item.id === id);
      assert(message && !message.error, body);
      return message.result;
    };
    const initialized = await rpc(1, "initialize", {
      protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "proofreader-smoke", version: "1.0" },
    });
    console.log(`MCP initialized: ${initialized.serverInfo.name}`);
    const result = await rpc(2, "tools/call", {
      name: "proofread", arguments: { text: "오늘은 날씨가 좋다.", depth: "light" },
    });
    assert(!result.isError, JSON.stringify(result));
    const output = result.content.map((item: { text?: string }) => item.text ?? "").join("\n");
    assert(output.includes("오늘"), output);
    console.log(output);
    console.log("SMOKE PASS: proofread tool completed through the real MCP server");
  } finally {
    server.kill("SIGTERM");
    await exited;
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
