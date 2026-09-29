export const MEMORY_AUTO_CAPTURE_PREFERENCE_ID = "memory.auto-capture";

const OPTIONS = Object.freeze([
  Object.freeze({ value: "on", label: "Ativada" }),
  Object.freeze({ value: "off", label: "Desativada" }),
]);

export const memoryAutoCapturePreference = Object.freeze({
  id: MEMORY_AUTO_CAPTURE_PREFERENCE_ID,
  sectionId: "memory",
  label: "Memória",
  title: "Memória automática",
  description:
    "Permite que a OrdaX Intelligence registre automaticamente memórias úteis dentro das regras de privacidade e autorização do dispositivo.",
  defaultValue: "on",
  options: OPTIONS,
  validate(value) {
    if (value !== "on" && value !== "off") {
      throw new TypeError(`Unsupported memory auto-capture preference: ${String(value)}`);
    }
    return value;
  },
});

export function memoryAutoCaptureEnabled(snapshot) {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
    throw new TypeError("Memory auto-capture preference snapshot must be an object");
  }
  return snapshot[MEMORY_AUTO_CAPTURE_PREFERENCE_ID] !== "off";
}
