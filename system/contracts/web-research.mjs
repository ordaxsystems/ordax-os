export const WEB_SEARCH_REQUEST_SCHEMA = "ordax.web.search/1";
export const WEB_EXTRACT_REQUEST_SCHEMA = "ordax.web.extract/1";
export const WEB_SOURCE_SCHEMA = "ordax.web.source/1";
export const WEB_PROVENANCE_SCHEMA = "ordax.web.provenance/1";
export const WEB_PROVIDER_SCHEMA = "ordax.web-provider/1";

export const WEB_SOURCE_TRUST = "untrusted-external-content";
export const WEB_MAX_QUERY_CHARS = 2048;
export const WEB_MAX_URL_CHARS = 4096;
export const WEB_MAX_RESULTS = 20;
export const WEB_MAX_EXTRACT_URLS = 10;
export const WEB_MAX_DOMAINS = 32;
export const WEB_MAX_EXTERNAL_BYTES = 10_000_000;
export const WEB_MAX_REQUESTS = 10;
export const WEB_MAX_DEADLINE_MS = 60_000;
export const WEB_MAX_COST_USD = 100;

const FRESHNESS = new Set(["current", "recent", "any"]);
const CACHE_MODES = new Set(["provider-policy", "bypass", "cache-only"]);
const CACHE_STATUSES = new Set(["miss", "hit", "revalidated", "bypass"]);
const PROVIDER_CAPABILITIES = new Set(["search", "extract", "map", "crawl", "research"]);
const FORBIDDEN_AUTHORITY_FIELDS = new Set([
  "authority",
  "grantRef",
  "approvalId",
  "toolExecution",
  "toolId",
  "toolArtifactSha256",
  "actionId",
  "decision",
]);
const SHA256_RE = /^[0-9a-f]{64}$/;
const LANGUAGE_RE = /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/;
const PROVIDER_ID_RE = /^[a-z][a-z0-9._-]{0,95}$/;

function object(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  return value;
}

function rejectAuthorityFields(value, label) {
  for (const field of FORBIDDEN_AUTHORITY_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(value, field)) {
      throw new TypeError(`${label} cannot carry authority field ${field}`);
    }
  }
}

function boundedText(value, label, max, { allowEmpty = false } = {}) {
  if (typeof value !== "string" || value.includes("\0")) {
    throw new TypeError(`${label} must be text`);
  }
  const normalized = value.trim();
  if ((!allowEmpty && !normalized) || normalized.length > max) {
    throw new TypeError(`${label} is outside bounds`);
  }
  return normalized;
}

function optionalText(value, label, max) {
  if (value == null || value === "") return null;
  return boundedText(value, label, max);
}

function timestamp(value, label) {
  const text = boundedText(value, label, 64);
  const parsed = Date.parse(text);
  if (!Number.isFinite(parsed)) {
    throw new TypeError(`${label} must be an ISO-8601 timestamp`);
  }
  return new Date(parsed).toISOString();
}

function optionalTimestamp(value, label) {
  return value == null || value === "" ? null : timestamp(value, label);
}

function webUrl(value, label) {
  const raw = boundedText(value, label, WEB_MAX_URL_CHARS);
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new TypeError(`${label} is invalid`);
  }
  if (!["https:", "http:"].includes(url.protocol) || !url.hostname || url.username || url.password) {
    throw new TypeError(`${label} must be an HTTP(S) URL without credentials`);
  }
  return url.href;
}

function domain(value, label) {
  const text = boundedText(value, label, 253).toLowerCase();
  if (text.includes("://") || text.includes("/") || text.startsWith(".") || text.endsWith(".")) {
    throw new TypeError(`${label} must be a hostname`);
  }
  try {
    const url = new URL(`https://${text}`);
    if (url.hostname !== text || !url.hostname.includes(".")) throw new Error("hostname");
  } catch {
    throw new TypeError(`${label} must be a hostname`);
  }
  return text;
}

function boundedInteger(value, label, { min, max, fallback }) {
  const resolved = value == null ? fallback : value;
  if (!Number.isSafeInteger(resolved) || resolved < min || resolved > max) {
    throw new TypeError(`${label} is outside bounds`);
  }
  return resolved;
}

function boundedCost(value, label, fallback = 0.05) {
  const resolved = value == null ? fallback : value;
  if (typeof resolved !== "number" || !Number.isFinite(resolved) || resolved < 0 || resolved > WEB_MAX_COST_USD) {
    throw new TypeError(`${label} is outside bounds`);
  }
  return resolved;
}

function stringList(value, label, maxItems, validator) {
  if (value == null) return Object.freeze([]);
  if (!Array.isArray(value) || value.length > maxItems) {
    throw new TypeError(`${label} must be a bounded array`);
  }
  const normalized = value.map((entry, index) => validator(entry, `${label}[${index}]`));
  if (new Set(normalized).size !== normalized.length) {
    throw new TypeError(`${label} cannot contain duplicates`);
  }
  return Object.freeze(normalized);
}

function validateLimits(value = {}) {
  const limits = object(value, "Web limits");
  return Object.freeze({
    maxResults: boundedInteger(limits.maxResults, "Web maxResults", { min: 1, max: WEB_MAX_RESULTS, fallback: 8 }),
    maxRequests: boundedInteger(limits.maxRequests, "Web maxRequests", { min: 1, max: WEB_MAX_REQUESTS, fallback: 3 }),
    maxExternalBytes: boundedInteger(limits.maxExternalBytes, "Web maxExternalBytes", {
      min: 1_024,
      max: WEB_MAX_EXTERNAL_BYTES,
      fallback: 1_000_000,
    }),
    maxCostUsd: boundedCost(limits.maxCostUsd, "Web maxCostUsd"),
    deadlineMs: boundedInteger(limits.deadlineMs, "Web deadlineMs", {
      min: 250,
      max: WEB_MAX_DEADLINE_MS,
      fallback: 10_000,
    }),
  });
}

function validateCache(value = {}) {
  const cache = object(value, "Web cache policy");
  const mode = cache.mode ?? "provider-policy";
  if (!CACHE_MODES.has(mode)) throw new TypeError("Web cache mode is invalid");
  return Object.freeze({ mode });
}

function validateDomains(value = {}) {
  const domains = object(value, "Web domain policy");
  const include = stringList(domains.include, "Web included domains", WEB_MAX_DOMAINS, domain);
  const exclude = stringList(domains.exclude, "Web excluded domains", WEB_MAX_DOMAINS, domain);
  for (const item of include) {
    if (exclude.includes(item)) throw new TypeError("Web domain cannot be both included and excluded");
  }
  return Object.freeze({ include, exclude });
}

export function validateWebSearchRequest(value) {
  const request = object(value, "Web search request");
  rejectAuthorityFields(request, "Web search request");
  if (request.schema !== undefined && request.schema !== WEB_SEARCH_REQUEST_SCHEMA) {
    throw new TypeError("Web search request schema is incompatible");
  }
  const freshness = request.freshness ?? "current";
  if (!FRESHNESS.has(freshness)) throw new TypeError("Web search freshness is invalid");
  const locale = optionalText(request.locale, "Web search locale", 35);
  if (locale && !LANGUAGE_RE.test(locale)) throw new TypeError("Web search locale is invalid");
  return Object.freeze({
    schema: WEB_SEARCH_REQUEST_SCHEMA,
    query: boundedText(request.query, "Web search query", WEB_MAX_QUERY_CHARS),
    locale,
    freshness,
    domains: validateDomains(request.domains),
    limits: validateLimits(request.limits),
    cache: validateCache(request.cache),
  });
}

export function validateWebExtractRequest(value) {
  const request = object(value, "Web extract request");
  rejectAuthorityFields(request, "Web extract request");
  if (request.schema !== undefined && request.schema !== WEB_EXTRACT_REQUEST_SCHEMA) {
    throw new TypeError("Web extract request schema is incompatible");
  }
  const urls = stringList(request.urls, "Web extract URLs", WEB_MAX_EXTRACT_URLS, webUrl);
  if (urls.length === 0) throw new TypeError("Web extract requires at least one URL");
  return Object.freeze({
    schema: WEB_EXTRACT_REQUEST_SCHEMA,
    urls,
    limits: validateLimits({ ...request.limits, maxResults: request.limits?.maxResults ?? urls.length }),
    cache: validateCache(request.cache),
  });
}

export function validateWebProvenance(value) {
  const provenance = object(value, "Web provenance");
  rejectAuthorityFields(provenance, "Web provenance");
  if (provenance.schema !== WEB_PROVENANCE_SCHEMA) {
    throw new TypeError("Web provenance schema is incompatible");
  }
  const providerId = boundedText(provenance.providerId, "Web provider id", 96).toLowerCase();
  if (!PROVIDER_ID_RE.test(providerId)) throw new TypeError("Web provider id is invalid");
  const extractorId = optionalText(provenance.extractorId, "Web extractor id", 96);
  const cacheStatus = provenance.cacheStatus ?? "miss";
  if (!CACHE_STATUSES.has(cacheStatus)) throw new TypeError("Web cache status is invalid");
  return Object.freeze({
    schema: WEB_PROVENANCE_SCHEMA,
    providerId,
    providerResultId: optionalText(provenance.providerResultId, "Web provider result id", 256),
    extractorId,
    extractorVersion: extractorId == null
      ? null
      : boundedText(provenance.extractorVersion, "Web extractor version", 96),
    retrievedAt: timestamp(provenance.retrievedAt, "Web provenance retrievedAt"),
    cacheStatus,
  });
}

export function validateWebSource(value) {
  const source = object(value, "Web source");
  rejectAuthorityFields(source, "Web source");
  if (source.schema !== WEB_SOURCE_SCHEMA || source.trust !== WEB_SOURCE_TRUST) {
    throw new TypeError("Web source identity/trust is incompatible");
  }
  const digest = boundedText(source.contentHash, "Web source content hash", 64);
  if (!SHA256_RE.test(digest)) throw new TypeError("Web source content hash is invalid");
  const language = optionalText(source.language, "Web source language", 35);
  if (language && !LANGUAGE_RE.test(language)) throw new TypeError("Web source language is invalid");
  return Object.freeze({
    schema: WEB_SOURCE_SCHEMA,
    trust: WEB_SOURCE_TRUST,
    sourceUrl: webUrl(source.sourceUrl, "Web source URL"),
    canonicalUrl: webUrl(source.canonicalUrl, "Web canonical URL"),
    title: boundedText(source.title, "Web source title", 512, { allowEmpty: true }),
    publishedAt: optionalTimestamp(source.publishedAt, "Web source publishedAt"),
    retrievedAt: timestamp(source.retrievedAt, "Web source retrievedAt"),
    mimeType: boundedText(source.mimeType, "Web source MIME type", 128).toLowerCase(),
    language,
    contentHash: digest,
    provenance: validateWebProvenance(source.provenance),
  });
}

export function assertWebProvider(value) {
  const provider = object(value, "Web provider");
  if (provider.schema !== WEB_PROVIDER_SCHEMA) throw new TypeError("Compatible Web provider is required");
  const providerId = boundedText(provider.providerId, "Web provider id", 96).toLowerCase();
  if (!PROVIDER_ID_RE.test(providerId)) throw new TypeError("Web provider id is invalid");
  const capabilities = stringList(
    provider.capabilities,
    "Web provider capabilities",
    PROVIDER_CAPABILITIES.size,
    (entry, label) => {
      const capability = boundedText(entry, label, 32);
      if (!PROVIDER_CAPABILITIES.has(capability)) throw new TypeError(`${label} is invalid`);
      return capability;
    },
  );
  if (capabilities.length === 0) throw new TypeError("Web provider must expose at least one capability");
  for (const capability of capabilities) {
    if (typeof provider[capability] !== "function") {
      throw new TypeError(`Web provider must implement ${capability}()`);
    }
  }
  return provider;
}
