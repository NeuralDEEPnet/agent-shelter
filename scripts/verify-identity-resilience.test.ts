import assert from "node:assert/strict";
import { isTransientIdentityError, optionalIdentity } from "../src/api/services/auth";

console.log("Testing isTransientIdentityError...");

// Test matches
assert.equal(isTransientIdentityError(new Error("fetch failed")), true);
assert.equal(isTransientIdentityError(new TypeError("fetch failed")), true);
assert.equal(isTransientIdentityError(new Error("timeout exceeded when trying to connect")), true);
assert.equal(isTransientIdentityError(new Error("connect ECONNREFUSED 127.0.0.1:3000")), true);
assert.equal(isTransientIdentityError(new Error("read ECONNRESET")), true);
assert.equal(isTransientIdentityError(new Error("UND_ERR_CONNECT_TIMEOUT")), true);
assert.equal(isTransientIdentityError(new Error("network error")), true);

// Test non-transient errors
assert.equal(isTransientIdentityError(new Error("Invalid password")), false);
assert.equal(isTransientIdentityError(new Error("Database syntax error")), false);

console.log("Testing optionalIdentity...");

// Test successful call
const success = await optionalIdentity(async () => ({ user: "test-user" }));
assert.deepEqual(success, { user: "test-user" });

// Test retry on transient error with eventual success
let attempts = 0;
const retrySuccess = await optionalIdentity(async () => {
  attempts++;
  if (attempts === 1) throw new Error("fetch failed");
  return { user: "recovered-user" };
});
assert.deepEqual(retrySuccess, { user: "recovered-user" });
assert.equal(attempts, 2);

// Test persistent transient error fails closed to null without throwing
const persistentFailure = await optionalIdentity(async () => {
  throw new TypeError("fetch failed");
});
assert.equal(persistentFailure, null);

// Test non-transient error returns null without throwing
const nonTransient = await optionalIdentity(async () => {
  throw new Error("Some other error");
});
assert.equal(nonTransient, null);

console.log("All identity resilience checks PASSED!");
