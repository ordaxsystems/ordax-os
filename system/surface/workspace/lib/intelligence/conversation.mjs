// Bounded Surface-only transcript: no persistence, authorization or inference provider.
const MAX_VISIBLE_TURNS = 8;
const MAX_CONTEXT_TURNS = 4;
function requireText(value, name) {
  if (typeof value !== "string" || !value.trim() || value.includes("\0"))
    throw new TypeError(name + " must be nonempty text");
  return value.trim();
}
export function createAuraConversationStore() {
  let turns = Object.freeze([]);
  let nextId = 0;
  let scopeKey = null;
  const listeners = new Set();
  const publish = () => { for (const listener of [...listeners]) listener(); };
  return Object.freeze({
    getSnapshot() { return turns; },
    getScope() { return scopeKey; },
    bindScope(nextScope) {
      if (typeof nextScope !== 'string' || !nextScope) throw new TypeError('Aura conversation scope is required');
      if (scopeKey === nextScope) return;
      scopeKey = nextScope;
      turns = Object.freeze([]);
      publish();
    },
    subscribe(listener) {
      if (typeof listener !== "function") throw new TypeError("Aura conversation listener must be a function");
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    record(prompt, response) {
      const text = requireText(prompt, "Aura prompt");
      const answer = requireText(response?.text, "Aura response");
      const engineId = requireText(response?.engineId, "Aura engine identity");
      const modelId = requireText(response?.modelId, "Aura model identity");
      const turn = Object.freeze({ id: ++nextId, prompt: text, answer, engineId, modelId });
      turns = Object.freeze([...turns.slice(-(MAX_VISIBLE_TURNS - 1)), turn]);
      publish();
      return turn;
    },
    context() {
      // Never send unconfirmed streamed text, failures or timeouts as history.
      return Object.freeze(turns.slice(-MAX_CONTEXT_TURNS).flatMap(turn => [
        Object.freeze({
          scope: "user", id: "aura-turn-" + turn.id + "-user",
          provenance: "surface.aura.session.user",
          text: "Mensagem anterior do usuário: " + turn.prompt.slice(0, 1600),
        }),
        Object.freeze({
          scope: "document", id: "aura-turn-" + turn.id + "-reply",
          provenance: "surface.aura.session.inference",
          text: "Resposta anterior da Aura: " + turn.answer.slice(0, 2400),
        }),
      ]));
    },
    clear() {
      if (!turns.length) return;
      turns = Object.freeze([]);
      publish();
    },
  });
}
