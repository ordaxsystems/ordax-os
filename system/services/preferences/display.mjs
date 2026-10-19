export const DISPLAY_SCALE_PREFERENCE_ID = "display.scale";

export const DISPLAY_SCALE_OPTIONS = Object.freeze([
  Object.freeze({ value: "automatic", label: "Automático" }),
  Object.freeze({ value: "compact", label: "Compacto" }),
  Object.freeze({ value: "standard", label: "Padrão" }),
  Object.freeze({ value: "comfortable", label: "Confortável" }),
  Object.freeze({ value: "large", label: "Grande" }),
]);

const DISPLAY_SCALE_VALUES = new Set(DISPLAY_SCALE_OPTIONS.map(({ value }) => value));

export const displayScalePreference = Object.freeze({
  id: DISPLAY_SCALE_PREFERENCE_ID,
  sectionId: "display",
  label: "Tela",
  title: "Escala da interface",
  description:
    "Ajuste o tamanho dos elementos da Surface neste dispositivo. O modo automático acompanha a largura disponível; a resolução e o brilho do monitor dependem do suporte do host.",
  defaultValue: "automatic",
  options: DISPLAY_SCALE_OPTIONS,
  validate(value) {
    if (!DISPLAY_SCALE_VALUES.has(value)) {
      throw new TypeError(`Unsupported ${DISPLAY_SCALE_PREFERENCE_ID}: ${String(value)}`);
    }
    return value;
  },
});
