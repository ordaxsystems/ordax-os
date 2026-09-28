import { validateProjectEvidenceSnapshot } from "../../contracts/project-evidence.mjs";
import { validateIntelligenceContext } from "../../contracts/intelligence.mjs";

export const PROJECT_EVIDENCE_CONTEXT_SOURCE_ID = "project-evidence-selection";

export function createProjectEvidenceIntelligenceContext(snapshotValue) {
  const snapshot = validateProjectEvidenceSnapshot(snapshotValue);
  if (snapshot.items.length === 0) {
    return validateIntelligenceContext([{
      id: `${PROJECT_EVIDENCE_CONTEXT_SOURCE_ID}-${snapshot.projectId}-empty`,
      scope: "workspace",
      text: JSON.stringify({
        evidenceItems: 0,
        limitation: "No approved top-level project evidence was observed.",
      }),
      provenance: "ordax:project-evidence:explicit-user-authorized-selection:empty",
    }]);
  }

  return validateIntelligenceContext(snapshot.items.map((item, index) => ({
    id: `${PROJECT_EVIDENCE_CONTEXT_SOURCE_ID}-${snapshot.projectId}-${index + 1}`,
    scope: "workspace",
    text: JSON.stringify({
      kind: item.kind,
      label: item.label,
      evidence: item.text,
    }),
    provenance: item.provenance,
  })));
}
