import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  APP_JOBS,
  JOB_KINDS,
  PLAN_ONLY_MODELS,
  POLICY,
  assertModelForPhase,
  classifyJob,
  isPlanKind,
  isPlanOnlyModel,
  needsPlan,
  route,
  routeChain,
} from "../src/index.ts";

describe("policy", () => {
  it("covers every job kind exactly once", () => {
    assert.deepEqual(Object.keys(POLICY).sort(), [...JOB_KINDS].sort());
  });

  it("execution kinds never pick a plan-only model", () => {
    for (const kind of JOB_KINDS) {
      if (isPlanKind(kind)) continue;
      for (const id of routeChain(kind)) {
        assert.equal(isPlanOnlyModel(id), false, `${kind} → ${id}`);
      }
    }
  });

  it("planning kinds only pick plan-only models", () => {
    for (const kind of ["plan", "plan-max", "plan-3d"] as const) {
      for (const id of routeChain(kind)) {
        assert.equal(isPlanOnlyModel(id), true, `${kind} → ${id}`);
      }
      assert.equal(route(kind).phase, "think");
    }
  });

  it("every app job points at a real kind", () => {
    for (const row of APP_JOBS) {
      assert.ok(JOB_KINDS.includes(row.kind), row.job);
    }
  });

  it("CAD cheap-shots then repairs, never the other way around", () => {
    assert.equal(route("cad").model, "google/gemini-3.8-flash");
    assert.ok(route("cad").fallbacks.includes("anthropic/claude-sonnet-5"));
    assert.equal(route("repair").model, "anthropic/claude-sonnet-5");
    assert.notEqual(route("cad").model, route("repair").model);
  });

  it("classify is a two-vendor chain", () => {
    const chain = routeChain("classify");
    assert.equal(chain.length, 2);
    assert.ok(chain[0].startsWith("openai/"));
    assert.ok(chain[1].startsWith("google/"));
  });
});

describe("phase", () => {
  it("phase think on an execution kind jumps to the planner", () => {
    const thinking = route("cad", { phase: "think" });
    assert.equal(thinking.kind, "plan");
    assert.equal(thinking.phase, "think");
    assert.equal(thinking.model, "anthropic/claude-opus-5");
    assert.equal(isPlanOnlyModel(thinking.model), true);
  });

  it("phase do on cad stays Flash", () => {
    const doing = route("cad", { phase: "do" });
    assert.equal(doing.model, "google/gemini-3.8-flash");
    assert.equal(doing.phase, "do");
  });

  it("refuses a plan-only model on the do path", () => {
    assert.throws(() => assertModelForPhase("anthropic/claude-opus-5", "do"));
    assert.equal(assertModelForPhase("google/gemini-3.8-flash", "do"), "google/gemini-3.8-flash");
    assert.equal(assertModelForPhase("anthropic/claude-fable-5.1", "think"), "anthropic/claude-fable-5.1");
  });
});

describe("classifyJob", () => {
  it("honours an explicit kind", () => {
    assert.equal(classifyJob({ kind: "eval", text: "add fillets to this CAD" }), "eval");
  });

  it("maps CAD / photo / repair / story / triage language", () => {
    assert.equal(classifyJob({ text: "parametric box with M3 heat-set inserts" }), "cad");
    assert.equal(
      classifyJob({ text: "photo of a broken bracket, caliper readings", hasImage: true }),
      "cad-vision",
    );
    assert.equal(classifyJob({ text: "script does not close, refine the script" }), "repair");
    assert.equal(classifyJob({ text: "a waymark appears in the dreamscape" }), "story");
    assert.equal(classifyJob({ text: "triage this feedback as json_object" }), "classify");
    assert.equal(classifyJob({ text: "run the shelter probe bank judge" }), "eval");
    assert.equal(classifyJob({ text: "hey, how are you feeling" }), "chat");
  });

  it("sends new / complex planning to Opus, greenfield to Fable, 3D upgrades to Fable & Astra", () => {
    assert.equal(classifyJob({ text: "think through the architecture before we code" }), "plan");
    assert.equal(classifyJob({ text: "design the system for a new plan" }), "plan");
    assert.equal(classifyJob({ text: "rebuild the whole platform from scratch" }), "plan-max");
    assert.equal(classifyJob({ text: "complex 3D upgrade jobs and CAD engine overhaul" }), "plan-3d");
    assert.equal(route("plan-3d").model, "anthropic/claude-fable-5.1");
    assert.ok(route("plan-3d").fallbacks.includes("openai/gpt-6-astra"));
    assert.equal(needsPlan({ text: "think through the architecture" }), true);
    assert.equal(needsPlan({ text: "complex 3D upgrade jobs" }), true);
    assert.equal(needsPlan({ text: "parametric box with M3 holes" }), false);
  });

  it("defaults to the daily driver, not the expensive tier", () => {
    assert.equal(classifyJob({}), "chat");
    assert.equal(route(classifyJob({})).role, "daily");
  });
});

describe("plan-only catalog", () => {
  it("knows Fable / Opus / Astra by name", () => {
    for (const id of PLAN_ONLY_MODELS) {
      assert.equal(isPlanOnlyModel(id), true);
    }
    assert.equal(isPlanOnlyModel("google/gemini-3.8-flash"), false);
  });
});
