// Shared, presentation-only accessibility for native Account/Settings/System.
// The source of truth for an operation remains its owning OS service.
export function markSurfaceFeedback(element, tone = "information") {
  if (tone !== "information" && tone !== "attention") {
    throw new TypeError("Surface feedback tone must be information or attention");
  }
  element.dataset.surfaceFeedbackTone = tone;
  element.setAttribute("role", "status");
  element.setAttribute("aria-live", "polite");
  element.setAttribute("aria-atomic", "true");
  return element;
}
