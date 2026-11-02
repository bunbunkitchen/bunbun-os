import { test } from "node:test";
import assert from "node:assert/strict";
import {
  authorizeActiveOwner,
  createOwnerReadinessHandler,
} from "../supabase/functions/_shared/accountingOwnerReadiness.js";

const ORIGIN = "https://staging.bunbun.example";
const OWNER_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_ID = "22222222-2222-4222-8222-222222222222";
const OWNER = { id: OWNER_ID, role: "owner", is_active: true };

function makeDeps(overrides = {}) {
  return {
    stageEnabled: true,
    allowedOrigin: ORIGIN,
    verifyUserToken: async token => token === "valid.jwt.token" ? { id: OWNER_ID } : null,
    loadProfile: async userId => ({ ...OWNER, id: userId }),
    ...overrides,
  };
}

function post({ token = "valid.jwt.token", input = { action: "readiness" },
  origin = ORIGIN, raw, contentType = "application/json", method = "POST" } = {}) {
  const headers = {
    Origin: origin,
    "Content-Type": contentType,
    ...(token === null ? {} : { Authorization: "Bearer " + token }),
  };
  return new Request("https://edge.example/accounting-owner-readiness", {
    method, headers, body: method === "POST" ? (raw ?? JSON.stringify(input)) : undefined,
  });
}

test("only a valid active Owner session returns read-only staging readiness", async () => {
  const response = await createOwnerReadinessHandler(makeDeps())(post());
  const result = await response.json();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store, max-age=0");
  assert.equal(response.headers.get("access-control-allow-origin"), ORIGIN);
  assert.equal(result.ok, true);
  assert.equal(result.ownerAuthenticated, true);
  assert.equal(result.mayPost, false);
  assert.equal(result.ledgerConnected, false);
  assert.equal(result.cutoverApproved, false);
  assert.equal(result.financialValuesAvailable, false);
  assert.equal(result.status, "BLOCKED_PENDING_CUTOVER");
  assert.ok(result.blockers.length >= 2);
  assert.equal(JSON.stringify(result).includes(OWNER_ID), false);
});

test("not configured outside isolated staging, even for Owner", async () => {
  const handler = createOwnerReadinessHandler(makeDeps({ stageEnabled: false }));
  const response = await handler(post());
  assert.equal(response.status, 503);
  assert.equal((await response.json()).code, "STAGING_NOT_CONFIGURED");
});

test("staging allowed origin must be explicitly configured", async () => {
  const handler = createOwnerReadinessHandler(makeDeps({ allowedOrigin: "" }));
  assert.equal((await handler(post())).status, 503);
});

test("requests from unknown, null and lookalike origins are rejected", async () => {
  const handler = createOwnerReadinessHandler(makeDeps());
  for (const origin of ["https://evil.example", "https://staging.bunbun.example.attacker.net", "null"]) {
    const response = await handler(post({ origin }));
    assert.equal(response.status, 403);
    assert.equal(response.headers.get("access-control-allow-origin"), null);
  }
});

test("CORS preflight allowed only for exact staged origin, not a financial operation", async () => {
  const handler = createOwnerReadinessHandler(makeDeps());
  const allowed = await handler(new Request("https://edge.example/api", {
    method: "OPTIONS", headers: { Origin: ORIGIN },
  }));
  assert.equal(allowed.status, 204);
  assert.equal(allowed.headers.get("access-control-allow-origin"), ORIGIN);
  assert.equal((await handler(new Request("https://edge.example/api", {
    method: "OPTIONS", headers: { Origin: "https://evil.example" },
  }))).status, 403);
});

test("missing token never loads profile", async () => {
  let verifyCalls = 0, profileCalls = 0;
  const handler = createOwnerReadinessHandler(makeDeps({
    verifyUserToken: async () => { verifyCalls++; return { id: OWNER_ID }; },
    loadProfile: async () => { profileCalls++; return OWNER; },
  }));
  const response = await handler(post({ token: null }));
  assert.equal(response.status, 401);
  assert.equal(verifyCalls, 0);
  assert.equal(profileCalls, 0);
});

test("an invalid token and spoofed body ID cannot create Owner access", async () => {
  const handler = createOwnerReadinessHandler(makeDeps());
  const response = await handler(post({
    token: "forged.jwt.token",
    input: { action: "readiness", ownerId: OWNER_ID },
  }));
  assert.equal(response.status, 401);
  assert.equal((await response.json()).code, "INVALID_SESSION");
});

test("remote token verifier error denies without revealing secret or logs", async () => {
  const handler = createOwnerReadinessHandler(makeDeps({
    verifyUserToken: async () => { throw new Error("JWT backend problem with secret"); },
  }));
  const response = await handler(post());
  assert.equal(response.status, 401);
  assert.equal((await response.json()).code, "INVALID_SESSION");
});

test("Owner role is fetched fresh and staff role is forbidden", async () => {
  const handler = createOwnerReadinessHandler(makeDeps({
    loadProfile: async () => ({ id: OWNER_ID, role: "baker", is_active: true }),
  }));
  const response = await handler(post());
  assert.equal(response.status, 403);
  assert.equal((await response.json()).code, "OWNER_REQUIRED");
});

test("inactive Owner and mismatched profile ID are denied", async () => {
  for (const profile of [
    { ...OWNER, is_active: false },
    { ...OWNER, id: OTHER_ID },
    { ...OWNER, role: "helper" },
    null,
  ]) {
    const response = await createOwnerReadinessHandler(makeDeps({
      loadProfile: async () => profile,
    }))(post());
    assert.equal(response.status, 403);
  }
});

test("profile database outage is fail-closed", async () => {
  const response = await createOwnerReadinessHandler(makeDeps({
    loadProfile: async () => { throw new Error("Database offline"); },
  }))(post());
  assert.equal(response.status, 503);
  assert.equal((await response.json()).code, "PROFILE_UNAVAILABLE");
});

test("profile cannot be read if token verification returns fake user ID", async () => {
  let profileCalled = false;
  const response = await createOwnerReadinessHandler(makeDeps({
    verifyUserToken: async () => ({ id: "not-a-uuid" }),
    loadProfile: async () => { profileCalled = true; return OWNER; },
  }))(post());
  assert.equal(response.status, 401);
  assert.equal(profileCalled, false);
});

test("non-POST methods and non-JSON data are not accepted", async () => {
  const handler = createOwnerReadinessHandler(makeDeps());
  assert.equal((await handler(post({ method: "GET" }))).status, 405);
  assert.equal((await handler(post({ contentType: "text/plain" }))).status, 415);
});

test("unknown actions and posting attempts are always refused", async () => {
  const handler = createOwnerReadinessHandler(makeDeps());
  for (const input of [
    { action: "post-journal" },
    { action: "approve-opening" },
    { action: "readiness", ownerId: OWNER_ID },
    { action: "readiness", canPost: true },
    { action: "readiness", journalId: "some-id" },
    [],
    null,
  ]) {
    const response = await handler(post({ input }));
    assert.equal(response.status, 422, JSON.stringify(input));
    assert.equal((await response.json()).code, "ACTION_NOT_AVAILABLE");
  }
});

test("malformed JSON and too-large body are refused", async () => {
  const handler = createOwnerReadinessHandler(makeDeps());
  assert.equal((await handler(post({ raw: "{" }))).status, 400);
  assert.equal((await handler(post({ raw: JSON.stringify({ action: "readiness", pad: "x".repeat(5000) }) }))).status, 413);
});

test("unconfigured auth services fail closed rather than approving request", async () => {
  const result = await authorizeActiveOwner({
    authorization: "Bearer valid.jwt.token",
    verifyUserToken: null, loadProfile: null,
  });
  assert.equal(result.ok, false);
  assert.equal(result.status, 503);
});
