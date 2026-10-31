# First Run design reference

Status: REFERENCE_ONLY. This directory is historical design evidence, not a runtime entry or source of behavior.

The former `setup` storyboard was removed from the executable Meridian journey
catalog. Native/USB and the Windows emulator mount
`system/surface/ui/first-run.mjs`; step order belongs to
`system/services/first-run/journey.mjs`, with the existing First Run contracts
and shared Meridian tokens/styles. Differences in available controls come from
capability ports, not an independent setup implementation.

`setup-design-reference.json` preserves the prior PT-BR/EN-US fields, error
examples and planned features for future work. Product code must not import or
execute this reference. Future capabilities must be added to the canonical
First Run renderer and its domain owners, with honest unavailable states.

Validation: `node --test tests/test_first_run_journey_ssot.mjs tests/test_meridian_localization.mjs`
and the Windows emulator end-to-end smoke proof.
