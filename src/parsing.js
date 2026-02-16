/**
 * Parse a title with optional WI organizer prefix.
 * Example: ::Group:: Entry title
 *
 * @param {string} comment
 * @returns {{ group: string | null, title: string }}
 */
export function parseGroupPrefix(comment) {
  if (!comment) return { group: null, title: "" };
  const m = String(comment).match(/^::([^:][\s\S]*?)::\s*(.*)$/);
  if (!m) return { group: null, title: String(comment) };
  const group = normalizeGroupName(m[1] || "");
  if (!group) return { group: null, title: String(comment) };
  return { group, title: String(m[2] || "").trim() };
}

/**
 * @param {string} group
 * @param {string} title
 * @returns {string}
 */
export function composeComment(group, title) {
  const cleanGroup = normalizeGroupName(group);
  const cleanTitle = String(title ?? "").trim();
  return `::${cleanGroup}:: ${cleanTitle}`.trimEnd();
}

/**
 * @param {string} name
 * @returns {string}
 */
export function normalizeGroupName(name) {
  return String(name ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * @param {string} value
 * @returns {{ ok: true, value: string } | { ok: false, error: string }}
 */
export function validateGroupName(value) {
  const groupName = normalizeGroupName(value);
  if (!groupName) {
    return { ok: false, error: "Group name cannot be empty." };
  }
  if (groupName.includes("::")) {
    return { ok: false, error: 'Group name cannot include "::".' };
  }
  return { ok: true, value: groupName };
}

