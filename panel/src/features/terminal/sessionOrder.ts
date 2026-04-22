export function reorderIds(ids: string[], fromId: string, toId: string): string[] {
  if (fromId === toId) return ids;
  const fi = ids.indexOf(fromId);
  const ti = ids.indexOf(toId);
  if (fi === -1 || ti === -1) return ids;
  if (fi + 1 === ti) return ids;
  const next = ids.filter((id) => id !== fromId);
  const newTi = next.indexOf(toId);
  next.splice(newTi, 0, fromId);
  return next;
}

export function swapIds(ids: string[], idA: string, idB: string): string[] {
  if (idA === idB) return ids;
  const ai = ids.indexOf(idA);
  const bi = ids.indexOf(idB);
  if (ai === -1 || bi === -1) return ids;
  const next = [...ids];
  next[ai] = idB;
  next[bi] = idA;
  return next;
}

export function mergeOrder(storedOrder: string[], serverIds: string[]): string[] {
  const serverSet = new Set(serverIds);
  const kept = storedOrder.filter((id) => serverSet.has(id));
  const keptSet = new Set(kept);
  const appended = serverIds.filter((id) => !keptSet.has(id));
  const next = [...kept, ...appended];
  // Return the original reference when nothing actually changed, so React
  // setState + the order-persist effect don't fire on every 8s poll tick.
  if (
    next.length === storedOrder.length &&
    next.every((id, i) => id === storedOrder[i])
  ) {
    return storedOrder;
  }
  return next;
}
