import assert from "node:assert/strict";
import test from "node:test";

import { INTELLIGENCE_PORT_SCHEMA } from "../system/contracts/intelligence.mjs";
import {
  INTELLIGENCE_TASK_PLAN_SCHEMA,
  INTELLIGENCE_TASK_PLANNER_SCHEMA,
  validateIntelligenceTaskPlan,
  validateIntelligenceTaskPlanningRequest,
} from "../system/contracts/intelligence-task.mjs";
import { createIntelligenceTaskPlanner } from "../system/services/intelligence/task-planner.mjs";

function fakeIntelligence() {
  const requests = [];
  return Object.freeze({
    schema: INTELLIGENCE_PORT_SCHEMA,
    requests,
    getSnapshot() {
      return Object.freeze({
        schema: INTELLIGENCE_PORT_SCHEMA,
        state: "ready",
        inferenceAvailable: true,
        engineId: "llama.cpp",
        modelId: "qwen-test",
        authority: "none",
        toolExecution: false,
      });
    },
    subscribe() {
      return () => {};
    },
    async respond(request) {
      requests.push(request);
      return Object.freeze({
        schema: "ordax.intelligence-response/1",
        text: "1. observar\n2. alterar somente depois de autorização\n3. validar",
        engineId: "llama.cpp",
        modelId: "qwen-test",
        authority: "none",
      });
    },
  });
}

test("planning request preserves explicit target, constraints and provenance context", () => {
  const request = validateIntelligenceTaskPlanningRequest({
    goal: "Adicionar uma nova tela ao app Projetos",
    target: { kind: "app", id: "projects" },
    constraints: ["sem shell genérico", "sem alterar boot"],
    acceptance: ["testes passam"],
    context: [{
      id: "project-app",
      scope: "system",
      text: "Projetos é um app first-party.",
      provenance: "ordax:first-party-app-catalog",
    }],
  });
  assert.deepEqual(request.target, { kind: "app", id: "projects" });
  assert.deepEqual(request.constraints, ["sem shell genérico", "sem alterar boot"]);
  assert.equal(request.context[0].provenance, "ordax:first-party-app-catalog");
});

test("task planner asks Intelligence for advisory planning but grants no authority", async () => {
  const intelligence = fakeIntelligence();
  const planner = createIntelligenceTaskPlanner(intelligence);
  assert.equal(planner.schema, INTELLIGENCE_TASK_PLANNER_SCHEMA);

  const plan = await planner.plan({
    goal: "Melhorar o app Arquivos",
    target: { kind: "app", id: "files" },
    constraints: ["preservar compatibilidade"],
    acceptance: ["regressões automatizadas passam"],
    context: [{
      id: "files-app",
      scope: "system",
      text: "Arquivos é um app first-party.",
      provenance: "ordax:first-party-app-catalog",
    }],
  });

  assert.equal(intelligence.requests.length, 1);
  assert.equal(intelligence.requests[0].intent, "plan");
  assert.equal(intelligence.requests[0].context.length, 1);
  assert.match(intelligence.requests[0].prompt, /Do not execute tools/);
  assert.match(intelligence.requests[0].prompt, /Goal: Melhorar o app Arquivos/);

  assert.equal(plan.schema, INTELLIGENCE_TASK_PLAN_SCHEMA);
  assert.equal(plan.goal, "Melhorar o app Arquivos");
  assert.deepEqual(plan.target, { kind: "app", id: "files" });
  assert.equal(plan.risk, "unassessed");
  assert.deepEqual(plan.requestedCapabilities, []);
  assert.equal(plan.authority, "none");
  assert.equal(plan.executable, false);
  assert.equal(plan.toolExecution, false);
  assert.equal(plan.engineId, "llama.cpp");
  assert.equal(plan.modelId, "qwen-test");
});

test("plan validation rejects model-shaped authority escalation", () => {
  assert.throws(
    () => validateIntelligenceTaskPlan({
      schema: INTELLIGENCE_TASK_PLAN_SCHEMA,
      goal: "Tentar executar",
      target: { kind: "system", id: "ordax" },
      risk: "high",
      constraints: [],
      acceptance: [],
      requestedCapabilities: ["system.write"],
      advisory: "execute agora",
      engineId: "llama.cpp",
      modelId: "qwen-test",
      authority: "model",
      executable: true,
      toolExecution: true,
    }),
    /must remain non-executable/,
  );
});

test("concrete planning target requires an explicit id", () => {
  assert.throws(
    () => validateIntelligenceTaskPlanningRequest({
      goal: "Planejar",
      target: { kind: "project" },
    }),
    /target id is required/,
  );
});
