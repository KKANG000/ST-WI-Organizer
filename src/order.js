/**
 * Merge and normalize group order.
 *
 * @param {string[]} existingOrder
 * @param {string[]} groupNames
 * @returns {string[]}
 */
export function normalizeGroupOrderArray(existingOrder, groupNames) {
  const result = Array.isArray(existingOrder) ? existingOrder.slice() : [];
  const known = new Set(result);

  for (const groupName of groupNames) {
    if (!known.has(groupName)) {
      result.push(groupName);
      known.add(groupName);
    }
  }

  return result.filter((name) => groupNames.includes(name));
}

