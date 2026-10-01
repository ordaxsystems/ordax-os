import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = await readFile(
  resolve(ROOT, "system/surface/ui/memory-review-controls.mjs"),
  "utf8",
);

for (const marker of [
  'MEMORY_REVIEW_CONTROLS_SCHEMA = "ordax.memory-review-controls/1"',
  'dataset.memoryReviewSearch',
  'dataset.memoryReviewOwner',
  'dataset.memoryReviewNew',
  'dataset.memoryReviewCreate',
  'dataset.memoryReviewSave',
  'dataset.memoryReviewRemove',
  'dataset.memoryReviewPage',
  'dataset.memoryReviewExport',
  'dataset.memoryReviewClear',
  'dataset.memoryReviewClearConfirm',
  'dataset.memoryReviewClearCancel',
  'article.dataset.sensitivity = item.sensitivity',
  '${item.kind} · ${item.scope} · ${item.sensitivity} · ${item.provenance}',
  'viewModel.setQuery(target.value)',
  'viewModel.selectOwner({',
  'viewModel.create(textarea.value)',
  'viewModel.previousPage()',
  'viewModel.exportSnapshot()',
  'ordax-memory-export.json',
  'createObjectURL',
  'revokeObjectURL',
  'viewModel.nextPage()',
  'viewModel.update(id, { content: textarea.value })',
  'viewModel.remove(id)',
  'viewModel.clearAll()',
  'viewModel.subscribe(render)',
  'unsubscribe()',
]) {
  assert.equal(
    source.includes(marker),
    true,
    `missing memory-review control marker: ${marker}`,
  );
}

for (const forbidden of [
  "localStorage",
  "fetch(",
  "OpenAI",
  "llama",
  "window.confirm",
  "CSS.escape",
]) {
  assert.equal(source.includes(forbidden), false, `unexpected authority marker: ${forbidden}`);
}

console.log("MEMORY_REVIEW_CONTROLS=PASS");
