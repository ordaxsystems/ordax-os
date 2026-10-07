import assert from "node:assert/strict";
import test from "node:test";

import { validateNotificationPresentation } from "../system/contracts/notifications.mjs";
import { interpolateLocalizationMessage } from "../system/services/i18n/interpolation.mjs";

test("notification semantic presentation values share the canonical interpolation value domain", () => {
  const presentation = validateNotificationPresentation({
    id: "system-updates.applied",
    values: {
      deliveryNumber: 12,
      releaseLabel: "Entrega 12",
    },
  });

  assert.deepEqual(presentation, {
    id: "system-updates.applied",
    values: {
      deliveryNumber: 12,
      releaseLabel: "Entrega 12",
    },
  });
  assert.equal(
    interpolateLocalizationMessage(
      "{releaseLabel} / {deliveryNumber}",
      presentation.values,
    ),
    "Entrega 12 / 12",
  );
});

test("notification semantic presentation rejects boolean and coercive values instead of leaking raw tokens into localized copy", () => {
  for (const rawValue of [true, false, 1n, ["x"], { value: "x" }, Number.NaN, Infinity]) {
    assert.throws(
      () => validateNotificationPresentation({
        id: "system-updates.applied",
        values: { value: rawValue },
      }),
      /must be text or a finite number/,
    );
  }
});
