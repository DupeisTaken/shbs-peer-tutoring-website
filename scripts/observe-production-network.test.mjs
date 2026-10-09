import assert from "node:assert/strict";
import net from "node:net";
import test from "node:test";
import { HOST, PORTS, observe, httpSummary, provenance } from "./observe-production-network.mjs";

test("redirects expose only origin classification, never response credentials", () => {
  const summary = httpSummary(`HTTP/1.1 302 Found\r\nLocation: https://${HOST}/reset/private-token?secret=private-query#private-fragment\r\nSet-Cookie: private-cookie\r\n\r\nprivate-body`, 80);
  assert.deepEqual(summary, { httpStatus: 302, redirect: "canonical-https-origin", tlsValidated: false });
  assert.ok(!JSON.stringify(summary).includes("private"));
  assert.equal(httpSummary("HTTP/1.1 200 OK\r\n", 80), null);
});

test("only hosted workflow context is described as the independent vantage", () => {
  assert.match(provenance({}).vantage, /Unverified local/);
  assert.match(provenance({ GITHUB_ACTIONS: "true", RUNNER_ENVIRONMENT: "self-hosted" }).vantage, /Unverified local/);
  assert.deepEqual(provenance({ GITHUB_ACTIONS: "true", RUNNER_ENVIRONMENT: "github-hosted", RUNNER_OS: "Linux", GITHUB_RUN_ID: "123", GITHUB_SHA: "abc" }),
    { vantage: "GitHub-hosted runner", runnerOS: "Linux", runId: "123", commit: "abc" });
});

test("production matrix is fixed and contains every documented boundary", () => {
  assert.equal(HOST, "pt.shbs.org.cn");
  assert.deepEqual(PORTS, [22, 80, 443, 3000, 5432, 2019, 5555, 8080]);
});

test("silent peers are bounded and remain inconclusive", async () => {
  const sockets = new Set();
  const server = net.createServer(socket => { sockets.add(socket); socket.on("close", () => sockets.delete(socket)); });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const result = await observe("127.0.0.1", 4, server.address().port, 80);
    assert.equal(result.connected, true);
    assert.equal(result.outcome, "connected-no-protocol");
    assert.ok(result.elapsedMs < 2000);
  } finally { for (const socket of sockets) socket.destroy(); await new Promise(resolve => server.close(resolve)); }
});

test("unrecognized data is capped and never exported", async () => {
  const server = net.createServer(socket => { socket.on("error", () => {}); socket.end("private-body".repeat(500)); });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const result = await observe("127.0.0.1", 4, server.address().port, 500);
    assert.equal(result.outcome, "unrecognized-response");
    assert.equal(result.protocol, null);
    assert.ok(!JSON.stringify(result).includes("private-body"));
  } finally { await new Promise(resolve => server.close(resolve)); }
});
