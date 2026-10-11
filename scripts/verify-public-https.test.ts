import { test } from "node:test";
import assert from "node:assert/strict";
import { isPublicAddress, resolvePublicEndpoint, pinnedLookup, publicHttpsFetch } from "../src/api/services/public-https";
import { EventEmitter } from "node:events";
import { request, type RequestOptions } from "node:https";
import type { ClientRequest, IncomingMessage } from "node:http";

function fakeRequest(status: number, chunks: string[], inspect: (url: URL, options: RequestOptions, body: unknown) => void = () => {}) {
  return ((url: URL, options: RequestOptions, callback: (res: IncomingMessage) => void) => {
    const req = new EventEmitter() as ClientRequest;
    req.destroy = () => req;
    req.end = ((body: unknown) => {
      inspect(url, options, body);
      queueMicrotask(() => {
        const res = new EventEmitter() as IncomingMessage;
        res.statusCode = status; res.headers = { "content-type": "application/json" };
        let destroyed = false;
        res.destroy = (error?: Error) => { destroyed = true; if (error) res.emit("error", error); return res; };
        callback(res);
        for (const chunk of chunks) if (!destroyed) res.emit("data", Buffer.from(chunk));
        if (!destroyed) res.emit("end");
      });
      return req;
    }) as ClientRequest["end"];
    return req;
  }) as typeof request;
}

test("real transport path retains TLS identity, uses pinned lookup and preserves JSON POST", async () => {
  const body = '{"jsonrpc":"2.0","method":"notifications/initialized"}';
  let called = false;
  const response = await publicHttpsFetch("https://example.com/mcp", { method: "POST", body, headers: { "content-type": "application/json" } }, {
    resolveDns: async () => [{ address: "1.1.1.1", family: 4 }],
    request: fakeRequest(200, ['{"ok":true}'], (url, options, sent) => {
      called = true; assert.equal(url.hostname, "example.com"); assert.equal(options.servername, "example.com");
      assert.equal(options.agent, false); assert.equal(options.family, 4); assert.equal(options.method, "POST"); assert.equal(sent, body);
      options.lookup?.("example.com", {}, (error, address) => { assert.equal(error, null); assert.equal(address, "1.1.1.1"); });
    }),
  });
  assert.ok(called); assert.deepEqual(await response.json(), { ok: true });
});

test("transport refuses private DNS before socket, redirects, oversized bodies and aborted requests", async () => {
  let sockets = 0;
  await assert.rejects(publicHttpsFetch("https://localtest.me/mcp", {}, {
    resolveDns: async () => [{ address: "127.0.0.1", family: 4 }],
    request: fakeRequest(200, [], () => { sockets++; }),
  }), /non-public/);
  assert.equal(sockets, 0);
  const resolveDns = async () => [{ address: "1.1.1.1", family: 4 }];
  await assert.rejects(publicHttpsFetch("https://example.com/mcp", {}, { resolveDns, request: fakeRequest(302, []) }), /redirects/);
  await assert.rejects(publicHttpsFetch("https://example.com/mcp", {}, { resolveDns, request: fakeRequest(200, ["x".repeat(256 * 1024 + 1)]) }), /exceeded/);
  await assert.rejects(publicHttpsFetch("https://example.com/mcp", { signal: AbortSignal.abort(new Error("cancelled")) }, { resolveDns }), /cancelled/);
});

test("rejects private, link-local, metadata, mapped, reserved and documentation IPs", () => {
  for (const ip of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "192.168.0.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "192.0.2.1", "198.18.0.1", "198.51.100.4", "203.0.113.5", "224.0.0.1", "255.255.255.255", "::1", "::", "::ffff:127.0.0.1", "fc00::1", "fe80::1", "2001:db8::1", "2001:0::1", "2002:7f00:1::", "3fff::1", "garbage"]) {
    assert.equal(isPublicAddress(ip), false, ip);
  }
  for (const ip of ["1.1.1.1", "8.8.8.8", "93.184.216.34", "2606:4700:4700::1111", "2001:4860:4860::8888"]) assert.equal(isPublicAddress(ip), true, ip);
});

test("domain-shaped loopback and mixed DNS answers fail before connecting", async () => {
  await assert.rejects(resolvePublicEndpoint("https://localtest.me/mcp", async () => [{ address: "127.0.0.1", family: 4 }]), /non-public/);
  await assert.rejects(resolvePublicEndpoint("https://example.com/mcp", async () => [{ address: "1.1.1.1", family: 4 }, { address: "::1", family: 6 }]), /non-public/);
  await assert.rejects(resolvePublicEndpoint("https://example.com/mcp", async () => []), /non-public/);
  await assert.rejects(resolvePublicEndpoint("https://example.com/mcp", async () => [{ address: "1.1.1.1", family: 6 }]), /non-public/);
});

test("vetted lookup pins a public IP instead of resolving a rebinding domain again", async () => {
  let resolutions = 0;
  const resolver = async () => [{ address: ++resolutions === 1 ? "1.1.1.1" : "127.0.0.1", family: 4 }];
  const target = await resolvePublicEndpoint("https://example.com/mcp", resolver);
  const lookup = pinnedLookup(target.address);
  await new Promise<void>((resolve, reject) => lookup("example.com", {}, (err, address, family) => {
    if (err) return reject(err);
    assert.equal(address, "1.1.1.1"); assert.equal(family, 4); resolve();
  }));
  await new Promise<void>((resolve, reject) => lookup("example.com", { all: true }, (err, addresses) => {
    if (err) return reject(err);
    assert.deepEqual(addresses, [{ address: "1.1.1.1", family: 4 }]); resolve();
  }));
  assert.equal(resolutions, 1);
  assert.equal(target.url.hostname, "example.com"); // original TLS identity retained
  await assert.rejects(resolvePublicEndpoint("https://example.com/mcp", resolver), /non-public/);
});
