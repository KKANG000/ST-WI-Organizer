/**
 * @typedef {Object} EntryMeta
 * @property {string} uid
 * @property {HTMLElement} entryEl
 * @property {HTMLTextAreaElement | null} commentEl
 * @property {string} rawComment
 * @property {string | null} group
 * @property {string} title
 */

/**
 * @typedef {Object} GroupState
 * @property {string} name
 * @property {EntryMeta[]} entries
 * @property {boolean} enabled
 * @property {boolean} collapsed
 */

/**
 * @typedef {Object} RenderPlan
 * @property {GroupState[]} orderedGroups
 * @property {string[]} normalizedOrder
 */

/**
 * @typedef {Object} BookSettings
 * @property {string[]} groupOrder
 * @property {Record<string, boolean>} groupEnabled
 * @property {Record<string, boolean>} groupCollapsed
 */

/**
 * @typedef {Object} DebugSettings
 * @property {boolean} enabled
 * @property {boolean} logRebuilds
 * @property {boolean} logAdapters
 */

export const WIORG_TYPES = Object.freeze({});
