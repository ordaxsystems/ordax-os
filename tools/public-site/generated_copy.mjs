// Shared by the public snapshot generator and its CRLF/repeatability tests.
// Generated copy never becomes a second source of localized product messages.
export function stripGeneratedSurfaceCopy(value) {
  if (typeof value !== "string") {
    throw new TypeError("Surface catalog source must be text");
  }
  const normalized = value.replace(/\r\n/g, "\n");
  const clean = normalized.replace(
    /^  \/\/ BEGIN GENERATED SURFACE COPY\n[\s\S]*?^  \/\/ END GENERATED SURFACE COPY\n/gm,
    "",
  );
  if (/^  \/\/ (?:BEGIN|END) GENERATED SURFACE COPY\s*$/m.test(clean)) {
    throw new Error("Unbalanced generated Surface copy block");
  }
  return clean;
}
