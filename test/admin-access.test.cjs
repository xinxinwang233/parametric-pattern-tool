const test = require("node:test");
const assert = require("node:assert/strict");
const { getClientIp, isAdminRequestAllowed, normalizeIp } = require("../src/admin-access.cjs");

function request(remoteAddress, forwardedFor) {
  return {
    socket: { remoteAddress },
    headers: forwardedFor ? { "x-forwarded-for": forwardedFor } : {},
  };
}

test("normalizes IPv4-mapped and zoned IP addresses", () => {
  assert.equal(normalizeIp("::ffff:127.0.0.1"), "127.0.0.1");
  assert.equal(normalizeIp("FE80::1%lo0"), "fe80::1");
});

test("allows only exact whitelisted client IPs", () => {
  const config = { allowedIps: ["127.0.0.1"], trustedProxyIps: [] };
  assert.equal(isAdminRequestAllowed(request("::ffff:127.0.0.1"), config), true);
  assert.equal(isAdminRequestAllowed(request("192.0.2.30"), config), false);
});

test("ignores spoofed forwarding headers from untrusted clients", () => {
  const config = { allowedIps: ["203.0.113.8"], trustedProxyIps: ["10.0.0.2"] };
  const spoofed = request("198.51.100.20", "203.0.113.8");
  assert.equal(getClientIp(spoofed, config), "198.51.100.20");
  assert.equal(isAdminRequestAllowed(spoofed, config), false);
});

test("uses the first forwarded address only for a trusted proxy", () => {
  const config = { allowedIps: ["203.0.113.8"], trustedProxyIps: ["10.0.0.2"] };
  const proxied = request("::ffff:10.0.0.2", "203.0.113.8, 10.0.0.2");
  assert.equal(getClientIp(proxied, config), "203.0.113.8");
  assert.equal(isAdminRequestAllowed(proxied, config), true);
});
