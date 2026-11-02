import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BUNBUN_PRODUCTION_SUPABASE_REF,
  isIsolatedAccountingStaging,
} from "../supabase/functions/_shared/accountingStagingGuard.js";

const STAGE_REF = "abcdefghijklmnopqrstuvwxyz".slice(0, 20);
const valid = {
  stageFlag: "isolated-staging",
  stagingProjectRef: STAGE_REF,
  projectUrl: "https://" + STAGE_REF + ".supabase.co",
  allowedOrigin: "https://staging.bunbun.example",
};

test("accounting functions stay disabled by default, even with valid URL", () => {
  assert.equal(isIsolatedAccountingStaging({ ...valid, stageFlag: null }), false);
  assert.equal(isIsolatedAccountingStaging({ ...valid, stageFlag: "" }), false);
});

test("isolated valid Supabase staging ref can be explicitly enabled", () => {
  assert.equal(isIsolatedAccountingStaging(valid), true);
  assert.equal(isIsolatedAccountingStaging({ ...valid, allowedOrigin: "http://localhost:5173" }), true);
});

test("Bunbun live project is never accepted as accounting staging", () => {
  const prod = BUNBUN_PRODUCTION_SUPABASE_REF;
  assert.equal(isIsolatedAccountingStaging({
    ...valid, stagingProjectRef: prod,
    projectUrl: "https://" + prod + ".supabase.co",
  }), false);
});

test("project URL must match declared staging project, not production", () => {
  assert.equal(isIsolatedAccountingStaging({
    ...valid,
    projectUrl: "https://" + BUNBUN_PRODUCTION_SUPABASE_REF + ".supabase.co",
  }), false);
  assert.equal(isIsolatedAccountingStaging({
    ...valid, projectUrl: "https://" + STAGE_REF + ".supabase.co.attacker.example",
  }), false);
});

test("short or malformed ref, missing allowed origin, or fake HTTPS is denied", () => {
  for (const props of [
    { stagingProjectRef: "demo" },
    { stagingProjectRef: "../../oops" },
    { stagingProjectRef: "" },
    { allowedOrigin: "" },
    { allowedOrigin: "https://staging.bunbun.example.attacker" , stageFlag: "wrong" },
    { projectUrl: "http://" + STAGE_REF + ".supabase.co" },
    { projectUrl: "https://evil:pw@" + STAGE_REF + ".supabase.co" },
    { projectUrl: "https://" + STAGE_REF + ".supabase.co/extra" },
    { projectUrl: "https://" + STAGE_REF + ".supabase.co/?q=1" },
  ]) {
    assert.equal(isIsolatedAccountingStaging({ ...valid, ...props }), false, JSON.stringify(props));
  }
});

test("allowed origin must be a canonical HTTPS origin, unless local development", () => {
  for (const bad of [
    "http://staging.bunbun.example",
    "https://staging.bunbun.example/suffix",
    "https://staging.bunbun.example/?secret=1",
    "file://staging.example",
    "http://127.0.0.2:5173",
    "null",
  ]) {
    assert.equal(isIsolatedAccountingStaging({ ...valid, allowedOrigin: bad }), false, bad);
  }
});
