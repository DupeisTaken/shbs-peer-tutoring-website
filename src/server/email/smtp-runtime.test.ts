import { createServer, Socket } from "node:net";
import nodemailer from "nodemailer";
import { expect, it } from "vitest";

it("delivers through a caller-owned socket with the installed SMTP runtime", async () => {
  // Loopback-only SMTP fixture: exercise the real dependency, without credentials,
  // external delivery or TLS exceptions in application configuration.
  let received = "";
  const peers = new Set<Socket>();
  const server = createServer((peer) => {
    peers.add(peer);
    peer.on("close", () => peers.delete(peer));
    peer.write("220 localhost test SMTP\r\n");
    let buffer = "";
    let data = false;
    peer.on("data", (chunk: Buffer) => {
      buffer += chunk.toString();
      let end: number;
      while ((end = buffer.indexOf("\r\n")) >= 0) {
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        if (data && line === ".") {
          data = false;
          peer.write("250 queued locally\r\n");
        } else if (data) received += line + "\n";
        else if (line.startsWith("EHLO")) peer.write("250 localhost\r\n");
        else if (line === "DATA") { data = true; peer.write("354 send message\r\n"); }
        else if (line === "QUIT") peer.end("221 bye\r\n");
        else peer.write("250 OK\r\n");
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Expected TCP server");
  const socket = new Socket();
  const transport = nodemailer.createTransport({
    host: "127.0.0.1", port: address.port, socket, secure: false, ignoreTLS: true,
    connectionTimeout: 1000, greetingTimeout: 1000, socketTimeout: 1000,
  });
  try {
    const result = await transport.sendMail({
      from: "sender@example.test", to: "recipient@example.test", subject: "Runtime check", text: "Local fixture only",
    });
    expect(result.accepted).toEqual(["recipient@example.test"]);
    expect(received).toContain("Local fixture only");
  } finally {
    socket.destroy();
    transport.close();
    for (const peer of peers) peer.destroy();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
