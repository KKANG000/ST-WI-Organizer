/**
 * @param {HTMLSelectElement | null} sortSelectEl
 * @returns {{ mode: "field" | "none" | "as-is", field?: string, order?: "asc" | "desc", rule?: string }}
 */
export function getSortConfig(sortSelectEl) {
  if (!sortSelectEl) return { mode: "none" };
  const opt = sortSelectEl.options[sortSelectEl.selectedIndex];
  const field = opt?.getAttribute("data-field") || undefined;
  const order = /** @type {"asc" | "desc" | undefined} */ (opt?.getAttribute("data-order") || undefined);
  const rule = opt?.getAttribute("data-rule") || "none";
  if (!field || !order) return { mode: "as-is", rule };
  return { mode: "field", field, order, rule };
}

/**
 * @param {import("./types.js").EntryMeta} meta
 * @param {string} field
 * @returns {number | string | null}
 */
export function getEntryFieldValue(meta, field) {
  const el = meta.entryEl;
  if (!el) return null;

  switch (field) {
    case "comment":
      return String(meta.title || "").toLowerCase();
    case "uid":
      return Number(meta.uid);
    case "order":
      return Number(el.querySelector('input[name="order"]')?.value ?? 0);
    case "depth":
      return Number(el.querySelector('input[name="depth"]')?.value ?? 0);
    case "probability":
      return Number(el.querySelector('input[name="probability"]')?.value ?? 0);
    case "content":
      return String(el.querySelector('textarea[name="content"]')?.value || "").length;
    default:
      return null;
  }
}

/**
 * @param {number | string | null} a
 * @param {number | string | null} b
 * @param {"asc" | "desc"} order
 * @returns {number}
 */
export function compareValues(a, b, order) {
  const dir = order === "desc" ? -1 : 1;
  if (a == null && b == null) return 0;
  if (a == null) return -1 * dir;
  if (b == null) return 1 * dir;

  if (typeof a === "number" && typeof b === "number") {
    if (a === b) return 0;
    return a < b ? -1 * dir : 1 * dir;
  }

  return String(a).localeCompare(String(b)) * dir;
}

/**
 * @param {import("./types.js").EntryMeta[]} metas
 * @param {{ mode: "field" | "none" | "as-is", field?: string, order?: "asc" | "desc" }} sortConfig
 * @returns {import("./types.js").EntryMeta[]}
 */
export function sortGroupEntries(metas, sortConfig) {
  if (sortConfig.mode !== "field" || !sortConfig.field || !sortConfig.order) return metas.slice();
  const field = sortConfig.field;
  const order = sortConfig.order;

  return metas.slice().sort((a, b) => {
    const c = compareValues(getEntryFieldValue(a, field), getEntryFieldValue(b, field), order);
    if (c !== 0) return c;
    return String(a.title || "").localeCompare(String(b.title || ""));
  });
}

/**
 * @param {import("./types.js").EntryMeta[]} metasAll
 * @param {string[]} orderedGroupNames
 * @param {{ mode: "field" | "none" | "as-is", field?: string, order?: "asc" | "desc" }} sortConfig
 * @param {(groupName: string) => boolean} isEnabled
 * @param {(groupName: string) => boolean} isCollapsed
 * @returns {import("./types.js").RenderPlan}
 */
export function computeRenderPlan(metasAll, orderedGroupNames, sortConfig, isEnabled, isCollapsed) {
  const grouped = metasAll.filter((m) => !!m.group);
  const groupsMap = new Map();
  for (const meta of grouped) {
    if (!groupsMap.has(meta.group)) groupsMap.set(meta.group, []);
    groupsMap.get(meta.group).push(meta);
  }

  const normalizedOrder = orderedGroupNames.filter((name) => groupsMap.has(name));
  const orderedGroups = [];
  for (const name of normalizedOrder) {
    const entries = sortGroupEntries(groupsMap.get(name) || [], sortConfig);
    if (entries.length === 0) continue;
    orderedGroups.push({
      name,
      entries,
      enabled: isEnabled(name),
      collapsed: isCollapsed(name),
    });
  }

  return { orderedGroups, normalizedOrder };
}

/**
 * @param {import("./types.js").RenderPlan} plan
 * @returns {string}
 */
export function buildRenderSignature(plan) {
  const parts = [];
  for (const g of plan.orderedGroups) {
    const uids = g.entries.map((e) => e.uid).join(",");
    parts.push(`${g.name}|${g.enabled ? 1 : 0}|${g.collapsed ? 1 : 0}|${uids}`);
  }
  return parts.join(";");
}

