function resolveLALib() {
  const g = /** @type {any} */ (globalThis);
  return g?.LALib || g?.lalib || g?.LA_LIB || null;
}

export function getLALib() {
  return resolveLALib();
}

export function getLALibInfo() {
  const lib = resolveLALib();
  if (!lib) {
    return {
      available: false,
      version: null,
      hasBatch: false,
    };
  }
  const maybeBatch = lib?.dom?.batch || lib?.batch || null;
  return {
    available: true,
    version: lib?.version || lib?.VERSION || null,
    hasBatch: typeof maybeBatch === "function",
  };
}

export async function runWithLALibBatch(work) {
  const lib = resolveLALib();
  const batch = lib?.dom?.batch || lib?.batch || null;
  if (typeof batch !== "function") {
    return await work();
  }
  try {
    return await batch(work);
  } catch {
    return await work();
  }
}

