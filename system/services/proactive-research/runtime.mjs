import {
  PROACTIVE_RESEARCH_RESULT_SCHEMA,
  PROACTIVE_RESEARCH_SCHEMA,
  assertResearchAuthorization,
  assertResearchSource,
  validateResearchEvidence,
  validateResearchRequest,
  validateResearchResult,
} from "../../contracts/proactive-research.mjs";

const ANALYZER_SCHEMA = "ordax.proactive-research-analyzer/1";

function assertAnalyzer(value) {
  if (
    !value
    || typeof value !== "object"
    || value.schema !== ANALYZER_SCHEMA
    || value.network !== false
    || value.mutation !== false
    || typeof value.analyze !== "function"
  ) throw new TypeError("A compatible local authority-free research analyzer is required");
  return value;
}

function assertEvidenceArray(value, sourceId, includeRestricted) {
  if (!Array.isArray(value) || value.length > 32) {
    throw new TypeError("Research source output must be a bounded array");
  }
  const validated = [];
  for (const raw of value) {
    const evidence = validateResearchEvidence(raw);
    if (evidence.sourceId !== sourceId) throw new TypeError("Research evidence source binding mismatch");
    if (!includeRestricted && evidence.sensitivity === "restricted") continue;
    validated.push(evidence);
  }
  return validated;
}

export function createProactiveResearchRuntime({
  sourceResolver,
  authorization: authorizationValue,
  analyzer: analyzerValue,
} = {}) {
  if (typeof sourceResolver !== "function") throw new TypeError("Research runtime requires a source resolver");
  const authorization = assertResearchAuthorization(authorizationValue);
  const analyzer = assertAnalyzer(analyzerValue);

  return Object.freeze({
    schema: PROACTIVE_RESEARCH_SCHEMA,

    run(requestValue) {
      const request = validateResearchRequest(requestValue);
      const evidence = [];

      for (const sourceId of request.sourceIds) {
        let source;
        try {
          source = assertResearchSource(sourceResolver(sourceId));
        } catch {
          throw new Error(`Research source ${sourceId} is unavailable or incompatible`);
        }
        if (source.id !== sourceId) throw new Error("Research source resolver returned a mismatched source");

        const authorized = authorization.authorizeRead(Object.freeze({
          researchId: request.researchId,
          subjectId: request.subjectId,
          sourceId,
          sourceKind: source.kind,
          ownerKind: request.ownerKind,
          ownerId: request.ownerId,
          spaceId: request.spaceId,
          projectId: request.projectId,
          includeRestricted: request.includeRestricted,
          authority: "none",
        }));
        if (authorized !== true) {
          throw new Error(`Research read authorization denied for source ${sourceId}`);
        }

        const remaining = 64 - evidence.length;
        if (remaining <= 0) break;
        const sourceEvidence = assertEvidenceArray(source.read(Object.freeze({
          query: request.query,
          ownerKind: request.ownerKind,
          ownerId: request.ownerId,
          spaceId: request.spaceId,
          projectId: request.projectId,
          includeRestricted: request.includeRestricted,
          limit: Math.min(32, remaining),
          authority: "none",
        })), sourceId, request.includeRestricted);
        evidence.push(...sourceEvidence.slice(0, remaining));
      }

      const analysis = analyzer.analyze(Object.freeze({
        researchId: request.researchId,
        subjectId: request.subjectId,
        query: request.query,
        evidence: Object.freeze([...evidence]),
        authority: "none",
      }));
      if (!analysis || typeof analysis !== "object" || analysis.authority !== "none") {
        throw new TypeError("Research analyzer output must remain authority-free");
      }

      return validateResearchResult({
        schema: PROACTIVE_RESEARCH_RESULT_SCHEMA,
        researchId: request.researchId,
        subjectId: request.subjectId,
        summary: analysis.summary,
        evidenceRefs: evidence.map((entry) => entry.evidenceId),
        authority: "none",
      });
    },
  });
}

export const PROACTIVE_RESEARCH_ANALYZER_SCHEMA = ANALYZER_SCHEMA;
