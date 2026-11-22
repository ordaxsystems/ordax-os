// The authoritative validators and contracts remain in ordax-os.
// Binding rejects a missing or incompatible schema before a runtime is created.
export function requireContractPort(name, port, schemaField, expectedSchema, functions) {
  if (!port || typeof port !== "object" || port[schemaField] !== expectedSchema) {
    throw new TypeError(`Canonical ${name} contracts for ${expectedSchema} are required`);
  }
  for (const method of functions) {
    if (typeof port[method] !== "function") {
      throw new TypeError(`Canonical ${name} contract is missing ${method}()`);
    }
  }
}
