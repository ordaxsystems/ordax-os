import { validatePersonalOrdaxRuntimeSnapshot } from "../../contracts/personal-ordax-store.mjs";

export function projectPersonalActivitySnapshot(value) {
  const snapshot = validatePersonalOrdaxRuntimeSnapshot(value);
  const activitiesByWork = new Map();
  for (const event of snapshot.activities) {
    const list = activitiesByWork.get(event.workItemId) ?? [];
    list.push(event);
    activitiesByWork.set(event.workItemId, list);
  }
  const resultByWork = new Map(
    snapshot.results.map((result) => [result.workItemId, result]),
  );

  return Object.freeze({
    ownerKind: snapshot.ownerKind,
    ownerId: snapshot.ownerId,
    persistence: snapshot.persistence,
    work: Object.freeze(snapshot.workItems.map((item) => Object.freeze({
      item,
      activities: Object.freeze([...(activitiesByWork.get(item.id) ?? [])]),
      result: resultByWork.get(item.id) ?? null,
    }))),
  });
}
