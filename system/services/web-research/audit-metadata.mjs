import {
  validateWebExtractRequest,
  validateWebSearchRequest,
} from "../../contracts/web-research.mjs";
import { validateWebResourceRef } from "../../contracts/web-research-execution.mjs";

export const WEB_AUDIT_METADATA_SCHEMA = "ordax.web-audit-metadata/1";

function boundedLimits(limits) {
  return Object.freeze({
    maxResults: limits.maxResults,
    maxRequests: limits.maxRequests,
    maxExternalBytes: limits.maxExternalBytes,
    maxCostUsd: limits.maxCostUsd,
    deadlineMs: limits.deadlineMs,
  });
}

function shared(operation, request, resourceRef) {
  return {
    schema: WEB_AUDIT_METADATA_SCHEMA,
    operation,
    resourceRef: validateWebResourceRef(resourceRef, operation),
    limits: boundedLimits(request.limits),
    cacheMode: request.cache.mode,
    rawInputRetained: false,
  };
}

export function createWebSearchAuditMetadata(requestValue, resourceRef) {
  const request = validateWebSearchRequest(requestValue);
  return Object.freeze({
    ...shared("search", request, resourceRef),
    queryChars: request.query.length,
    locale: request.locale,
    freshness: request.freshness,
    includedDomainCount: request.domains.include.length,
    excludedDomainCount: request.domains.exclude.length,
  });
}

export function createWebExtractAuditMetadata(requestValue, resourceRef) {
  const request = validateWebExtractRequest(requestValue);
  const origins = new Set(request.urls.map((entry) => new URL(entry).origin));
  return Object.freeze({
    ...shared("extract", request, resourceRef),
    urlCount: request.urls.length,
    distinctOriginCount: origins.size,
  });
}
