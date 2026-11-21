// Keyboard activation belongs to the Surface presentation, never to the
// provider receiving the prompt. Enter must first finish IME composition.
export function shouldSubmitTextInputOnEnter(event) {
  return event?.key === "Enter" && event.isComposing !== true && event.keyCode !== 229;
}
