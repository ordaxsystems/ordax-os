import { assertIntelligencePort } from "../../contracts/intelligence.mjs";
import {
  INTELLIGENCE_TASK_PLAN_SCHEMA,
  INTELLIGENCE_TASK_PLANNER_SCHEMA,
  validateIntelligenceTaskPlan,
  validateIntelligenceTaskPlanningRequest,
} from "../../contracts/intelligence-task.mjs";

function renderList(label, values) {
  if (values.length === 0) return `${label}: none supplied`;
  return [
    `${label}:`,
    ...values.map((value) => `- ${value}`),
  ].join("\n");
}

function renderPlanningPrompt(request) {
  const target = request.target.kind === "unspecified"
    ? "unspecified"
    : `${request.target.kind}:${request.target.id}`;
  return [
    "Create a concise, consultative implementation plan for the following OrdaX task.",
    "Do not execute tools, modify files, change system state, or claim that any action already happened.",
    "Identify assumptions, likely risks, validation steps, and a safe sequence of work.",
    "Capability names in your answer are suggestions only and grant no authority.",
    `Goal: ${request.goal}`,
    `Target: ${target}`,
    renderList("Constraints", request.constraints),
    renderList("Acceptance criteria", request.acceptance),
  ].join("\n");
}

export function createIntelligenceTaskPlanner(intelligenceValue) {
  const intelligence = assertIntelligencePort(intelligenceValue);

  return Object.freeze({
    schema: INTELLIGENCE_TASK_PLANNER_SCHEMA,
    async plan(value) {
      const request = validateIntelligenceTaskPlanningRequest(value);
      const response = await intelligence.respond({
        intent: "plan",
        prompt: renderPlanningPrompt(request),
        context: request.context,
        maxTokens: request.maxTokens,
      });

      return validateIntelligenceTaskPlan({
        schema: INTELLIGENCE_TASK_PLAN_SCHEMA,
        goal: request.goal,
        target: request.target,
        risk: "unassessed",
        constraints: request.constraints,
        acceptance: request.acceptance,
        requestedCapabilities: [],
        advisory: response.text,
        engineId: response.engineId,
        modelId: response.modelId,
        authority: "none",
        executable: false,
        toolExecution: false,
      });
    },
  });
}
