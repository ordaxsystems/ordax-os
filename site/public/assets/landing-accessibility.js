(() => {
  const stage = document.querySelector("[data-demo-stage]");
  if (!stage || !window.matchMedia) return;

  // Only a coarse-only device needs the compact preview removed from the
  // tab order. Hybrid touch + mouse/trackpad users keep precise navigation.
  const coarsePointer = window.matchMedia("(any-pointer: coarse)");
  const precisePointer = window.matchMedia("(any-pointer: fine)");
  const updateStage = () => stage.toggleAttribute(
    "inert", coarsePointer.matches && !precisePointer.matches
  );

  updateStage();
  coarsePointer.addEventListener?.("change", updateStage);
  precisePointer.addEventListener?.("change", updateStage);
})();
