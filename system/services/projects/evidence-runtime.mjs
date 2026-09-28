import { assertFileSpacePort, validateFileListing, validateTextFile } from "../../contracts/file-space.mjs";
import { assertProjectCatalogPort, validateProjectId } from "../../contracts/project-catalog.mjs";
import {
  MAX_PROJECT_EVIDENCE_ITEMS,
  MAX_PROJECT_EVIDENCE_TEXT_CHARS,
  MAX_PROJECT_EVIDENCE_TOTAL_CHARS,
  PROJECT_EVIDENCE_SCHEMA,
  PROJECT_EVIDENCE_SNAPSHOT_SCHEMA,
  validateProjectEvidenceSnapshot,
} from "../../contracts/project-evidence.mjs";

const TOP_LEVEL_TEXT_FILES = new Map([
  ["readme", "readme"],
  ["readme.md", "readme"],
  ["readme.txt", "readme"],
  ["package.json", "manifest"],
  ["pyproject.toml", "manifest"],
  ["cargo.toml", "manifest"],
  ["go.mod", "manifest"],
  ["requirements.txt", "manifest"],
  ["composer.json", "manifest"],
  ["pom.xml", "manifest"],
  ["build.gradle", "manifest"],
  ["build.gradle.kts", "manifest"],
  ["agents.md", "guidance"],
]);

const SHALLOW_DIRECTORIES = new Map([
  ["tests", "tests"],
  ["test", "tests"],
  ["spec", "tests"],
  ["__tests__", "tests"],
  ["docs", "docs"],
  ["documentation", "docs"],
  ["contracts", "contracts"],
  ["schema", "contracts"],
  ["schemas", "contracts"],
  ["dist", "artifacts"],
  ["build", "artifacts"],
  ["out", "artifacts"],
  ["artifacts", "artifacts"],
]);

const MAX_SHALLOW_NAMES = 24;
const MAX_SHALLOW_NAME_CHARS = 120;

function joinLogicalPath(parent, name) {
  return parent === "/" ? `/${name}` : `${parent}/${name}`;
}

function sanitizeLabel(value) {
  return String(value ?? "").trim().slice(0, 160);
}

function clippedText(value) {
  return String(value ?? "").trim().slice(0, MAX_PROJECT_EVIDENCE_TEXT_CHARS);
}

function remainingBudget(items) {
  return MAX_PROJECT_EVIDENCE_TOTAL_CHARS
    - items.reduce((sum, item) => sum + item.text.length, 0);
}

function appendBounded(items, candidate) {
  if (items.length >= MAX_PROJECT_EVIDENCE_ITEMS) return false;
  const remaining = remainingBudget(items);
  if (remaining <= 0) return false;
  const text = clippedText(candidate.text).slice(0, remaining);
  if (!text) return false;
  items.push(Object.freeze({ ...candidate, text }));
  return true;
}

function matchingListing(value, expectedPath) {
  const listing = validateFileListing(value);
  if (listing.path !== expectedPath) {
    throw new Error("Project evidence listing identity mismatch");
  }
  return listing;
}

function matchingTextFile(value, expectedPath) {
  const textFile = validateTextFile(value);
  if (textFile.path !== expectedPath) {
    throw new Error("Project evidence file identity mismatch");
  }
  return textFile;
}

function directorySummary(listing) {
  const names = listing.entries
    .slice(0, MAX_SHALLOW_NAMES)
    .map((entry) => `${entry.kind === "directory" ? "dir" : "file"}:${entry.name.slice(0, MAX_SHALLOW_NAME_CHARS)}`);
  return JSON.stringify({
    entryCount: listing.entries.length,
    entriesIncluded: names.length,
    entries: names,
  });
}

function projectById(projectPort, projectId) {
  const id = validateProjectId(projectId);
  const project = projectPort.getSnapshot().projects.find((entry) => entry.id === id) ?? null;
  if (project === null) throw new Error("Project evidence target is unavailable");
  return project;
}

export function createProjectEvidenceRuntime({
  projects,
  fileSpace,
  now = Date.now,
} = {}) {
  const projectPort = assertProjectCatalogPort(projects);
  const files = assertFileSpacePort(fileSpace);
  if (typeof now !== "function") {
    throw new TypeError("Project evidence runtime requires a clock");
  }

  return Object.freeze({
    schema: PROJECT_EVIDENCE_SCHEMA,
    async inspect(projectId) {
      const project = projectById(projectPort, projectId);
      const root = matchingListing(await files.list(project.path), project.path);
      const items = [];

      for (const entry of root.entries) {
        if (items.length >= MAX_PROJECT_EVIDENCE_ITEMS || remainingBudget(items) <= 0) break;
        const normalizedName = entry.name.toLowerCase();
        const fileKind = entry.kind === "file" ? TOP_LEVEL_TEXT_FILES.get(normalizedName) : null;
        if (fileKind) {
          const expectedPath = joinLogicalPath(project.path, entry.name);
          try {
            const textFile = matchingTextFile(await files.readTextFile(expectedPath), expectedPath);
            appendBounded(items, {
              kind: fileKind,
              label: sanitizeLabel(entry.name),
              text: textFile.text,
              provenance: `ordax:project-evidence:${fileKind}:top-level-file`,
            });
          } catch {
            // Evidence collection is best-effort per item. Unreadable or mismatched files are omitted.
          }
          continue;
        }

        const directoryKind = entry.kind === "directory"
          ? SHALLOW_DIRECTORIES.get(normalizedName)
          : null;
        if (!directoryKind) continue;
        const expectedPath = joinLogicalPath(project.path, entry.name);
        try {
          const childListing = matchingListing(await files.list(expectedPath), expectedPath);
          appendBounded(items, {
            kind: directoryKind,
            label: sanitizeLabel(entry.name),
            text: directorySummary(childListing),
            provenance: `ordax:project-evidence:${directoryKind}:shallow-directory-summary`,
          });
        } catch {
          // A missing/unreadable/mismatched directory is omitted rather than expanded elsewhere.
        }
      }

      const currentProject = projectById(projectPort, project.id);
      if (currentProject.path !== project.path) {
        throw new Error("Project evidence target changed during inspection");
      }
      const capturedAt = now();
      if (!Number.isSafeInteger(capturedAt) || capturedAt < 0) {
        throw new TypeError("Project evidence runtime clock is invalid");
      }
      return validateProjectEvidenceSnapshot({
        schema: PROJECT_EVIDENCE_SNAPSHOT_SCHEMA,
        projectId: project.id,
        capturedAt,
        items,
        readOnly: true,
        authority: "none",
      });
    },
  });
}
