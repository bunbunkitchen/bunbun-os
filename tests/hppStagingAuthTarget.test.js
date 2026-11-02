import { test } from "node:test";
import assert from "node:assert/strict";
import {
  verifyStagingSmokeTarget, checkLiveReadinessResponse,
} from "../scripts/staging/stagingTarget.mjs";

const ref = "stagingprojectrefabc";
const publishableKey = "sb_publishable_bunbun_test_key_not_production";
const valid = {
  mode: "isolated-staging",
  projectRef: ref,
  projectUrl: "https://" + ref + ".supabase.co",
  allowedOrigin: "https://staging.bunbun.example",
  publishableKey,
};
const readOnlyOwner = {
  ok: true,
  ownerAuthenticated: true,
  mayPost: false,
  ledgerConnected: false,
  cutoverApproved: false,
  financialValuesAvailable: false,
  status: "BLOCKED_PENDING_CUTOVER",
};

test("isolated remote Owner Auth smoke only accepts exact independent staging", () => {
  const target = verifyStagingSmokeTarget(valid);
  assert.equal(target.projectRef, ref);
  assert.equal(target.functionUrl,
    "https://" + ref + ".supabase.co/functions/v1/accounting-owner-readiness");
  assert.ok(Object.isFrozen(target));
});

test("staging remote Auth test always refuses production and mismatched refs", () => {
  const forbidden = [
    { ...valid, mode: "production" },
    { ...valid, projectRef: "amgyogvqyuxzdpjseqsi",
      projectUrl: "https://amgyogvqyuxzdpjseqsi.supabase.co" },
    { ...valid, projectRef: "badstage" },
    { ...valid, projectUrl: "https://amgyogvqyuxzdpjseqsi.supabase.co" },
    { ...valid, allowedOrigin: "https://staging.bunbun.example.evil.net" },
    { ...valid, allowedOrigin: "http://staging.bunbun.example" },
    { ...valid, publishableKey: "sb_secret_leaked" },
    { ...valid, publishableKey: "anon.jwt.key" },
  ];
  for (const configuration of forbidden) {
    assert.throws(() => verifyStagingSmokeTarget(configuration));
  }
});

test("actual Owner must be read-only, no accounting or cutover approval", () => {
  assert.equal(checkLiveReadinessResponse({
    role: "owner", httpStatus: 200, response: readOnlyOwner,
  }), true);
  for (const changes of [
    { mayPost: true }, { ledgerConnected: true },
    { cutoverApproved: true }, { financialValuesAvailable: true },
    { ownerAuthenticated: false }, { status: "READY_TO_POST" },
  ]) {
    assert.throws(() => checkLiveReadinessResponse({
      role: "owner", httpStatus: 200,
      response: { ...readOnlyOwner, ...changes },
    }));
  }
});

test("baker and inactive Owner are denied by current-profile role/status", () => {
  for (const role of ["baker","inactive-owner"]) {
    assert.equal(checkLiveReadinessResponse({
      role, httpStatus: 403, response: { code: "OWNER_REQUIRED" },
    }), true);
    assert.throws(() => checkLiveReadinessResponse({
      role, httpStatus: 200, response: readOnlyOwner,
    }));
  }
});

test("no Bearer or forged JWT is denied before role lookup", () => {
  for (const role of ["anonymous","forged-token"]) {
    for (const code of ["AUTH_REQUIRED","INVALID_SESSION",401]) {
      assert.equal(checkLiveReadinessResponse({
        role, httpStatus: 401, response: { code },
      }), true);
    }
    assert.throws(() => checkLiveReadinessResponse({
      role, httpStatus: 200, response: readOnlyOwner,
    }));
  }
});
