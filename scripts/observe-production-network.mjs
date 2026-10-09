import dns from "node:dns/promises";
import net from "node:net";
import tls from "node:tls";
import { pathToFileURL } from "node:url";

// A fixed, read-only matrix for the operator-authorized canonical host. No credentials,
// redirects, alternate targets, retries or service-changing commands are accepted.
export const HOST = "pt.shbs.org.cn";
export const PORTS = [22, 80, 443, 3000, 5432, 2019, 5555, 8080];
const HTTP = new Set([80, 443, 3000, 2019, 5555, 8080]);

export function httpSummary(text, port) {
  const status = /^HTTP\/\d(?:\.\d)? (\d{3})/.exec(text);
  if (!status || !text.includes("\r\n\r\n")) return null;
  const location = /^location:\s*([^\r\n]+)/im.exec(text)?.[1];
  let redirect = null;
  if (location) {
    try {
      const url = new URL(location, `https://${HOST}`);
      redirect = url.origin === `https://${HOST}` ? "canonical-https-origin" : "other-origin";
    } catch { redirect = "invalid-location"; }
  }
  // Never export paths, queries, fragments, usernames or arbitrary response headers.
  return { httpStatus: Number(status[1]), redirect, tlsValidated: port === 443 };
}

export function provenance(env = process.env) {
  return env.GITHUB_ACTIONS === "true" && env.RUNNER_ENVIRONMENT === "github-hosted"
    ? { vantage: "GitHub-hosted runner", runnerOS: env.RUNNER_OS, runId: env.GITHUB_RUN_ID, commit: env.GITHUB_SHA }
    : { vantage: "Unverified local execution; not independent external evidence", commit: "local" };
}

export function observe(address, family, port, timeout = 5000) {
  return new Promise((resolve) => {
    const started = Date.now();
    let connected = false;
    let done = false;
    let received = Buffer.alloc(0);
    const socket = port === 443
      ? tls.connect({ host: address, family, port, servername: HOST, rejectUnauthorized: true })
      : net.connect({ host: address, family, port });
    const finish = (outcome, protocol = null) => {
      if (done) return;
      done = true;
      clearTimeout(deadline);
      socket.destroy();
      resolve({ address, family, port, connected, outcome, protocol, elapsedMs: Date.now() - started });
    };
    // Wall-clock bound includes handshake and partial/slow response; socket inactivity
    // alone would allow an unbounded trickle. Only a sanitized protocol summary survives.
    const deadline = setTimeout(() => finish(connected ? "connected-no-protocol" : "timeout-inconclusive"), timeout);
    socket.on("error", (error) => finish(error.code ?? "network-error"));
    socket.on("connect", () => { connected = true; });
    socket.on(port === 443 ? "secureConnect" : "connect", () => {
      if (HTTP.has(port)) socket.write(`GET /signin HTTP/1.1\r\nHost: ${HOST}\r\nConnection: close\r\n\r\n`);
      // PostgreSQL's unauthenticated SSLRequest has no account/database identity or write.
      if (port === 5432) socket.write(Buffer.from([0, 0, 0, 8, 4, 210, 22, 47]));
    });
    socket.on("data", (chunk) => {
      received = Buffer.concat([received, chunk.subarray(0, 4096 - received.length)]);
      const text = received.toString("utf8");
      if (port === 22 && /^SSH-\d\.\d-/.test(text)) return finish("protocol-response", "SSH banner");
      if (port === 5432 && ["S", "N"].includes(text[0])) return finish("protocol-response", "PostgreSQL SSL negotiation");
      const summary = HTTP.has(port) ? httpSummary(text, port) : null;
      if (summary) return finish("protocol-response", summary);
      if (received.length >= 4096) finish("unrecognized-response");
    });
    socket.on("end", () => finish(received.length ? "unrecognized-response" : "connected-no-protocol"));
  });
}

export async function collect() {
  const addresses = await dns.lookup(HOST, { all: true });
  const unique = addresses.filter((item, index) => addresses.findIndex(other => other.address === item.address) === index);
  if (unique.length > 4) throw new Error("Address inventory exceeds the bounded matrix; manual review required.");
  const results = [];
  for (const { address, family } of unique) for (const port of PORTS) results.push(await observe(address, family, port));
  return { host: HOST, recordedAt: new Date().toISOString(), ...provenance(), addresses: unique, results,
    interpretation: "Protocol responses establish only the observed path. A timeout, connection refusal or missing response does not prove firewall policy. Cloud control-plane inventory is still required." };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log(JSON.stringify(await collect(), null, 2));
}
