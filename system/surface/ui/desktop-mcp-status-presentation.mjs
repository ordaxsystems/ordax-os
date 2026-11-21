// Read-only UX mapping for the OS-owned MCP Supervisor observation.
export function desktopMcpStatusPresentation(status, failed = false) {
  if (status === null || status === undefined) {
    return {
      valueId: failed ? "system.overview.mcp.unavailable" : "system.overview.mcp.checking",
      detailId: "system.overview.mcp.noObservation",
    };
  }
  if (status.schema === "ordax.product-runtime-supervisor-status/1"
      && status.host === "ordax-desktop"
      && status.state === "running" && status.processRunning === true
      && Boolean(status.enrolled) && status.mcpReady === true
      && status.centralSessionAttested === true
      && typeof status.capabilityDigest === "string"
      && /^[0-9a-f]{64}$/.test(status.capabilityDigest)) {
    return { valueId: "system.overview.mcp.attested",
      detailId: "system.overview.mcp.attestedDetail" };
  }
  if (!status.enrolled || status.reason === "device_not_enrolled") {
    return { valueId: "system.overview.mcp.notEnrolled",
      detailId: "system.overview.mcp.notEnrolledDetail" };
  }
  if (status.state === "running") {
    // This observation proves the local process only. The Platform, not
    // the Surface, determines whether a GPT session is attested.
    return { valueId: "system.overview.mcp.running",
      detailId: "system.overview.mcp.runningDetail" };
  }
  if (status.state === "blocked") {
    return { valueId: "system.overview.mcp.blocked",
      detailId: "system.overview.mcp.blockedDetail" };
  }
  return { valueId: "system.overview.mcp.stopped",
    detailId: "system.overview.mcp.stoppedDetail" };
}
