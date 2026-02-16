import { saveSettingsDebounced } from "../../../../../script.js";
import { extension_settings } from "../../../../extensions.js";
import { MODULE_NAME, SELECTORS } from "./constants.js";
import { normalizeGroupOrderArray } from "./order.js";

function makeDefaultBookSettings() {
  return {
    groupOrder: [],
    groupEnabled: {},
    groupCollapsed: {},
  };
}

function makeDefaultDebugSettings() {
  return {
    enabled: false,
    logRebuilds: false,
    logAdapters: false,
  };
}

export function ensureSettingsRoot() {
  extension_settings[MODULE_NAME] = extension_settings[MODULE_NAME] || {};
  extension_settings[MODULE_NAME].books = extension_settings[MODULE_NAME].books || {};
  extension_settings[MODULE_NAME].debug = extension_settings[MODULE_NAME].debug || makeDefaultDebugSettings();

  // Backward compatible schema version bump.
  const currentVersion = Number(extension_settings[MODULE_NAME].version || 1);
  if (currentVersion < 2) {
    extension_settings[MODULE_NAME].version = 2;
  }
}

/**
 * @param {string} bookKey
 * @returns {import("./types.js").BookSettings}
 */
export function getBookSettings(bookKey) {
  ensureSettingsRoot();
  const books = extension_settings[MODULE_NAME].books;
  books[bookKey] = books[bookKey] || makeDefaultBookSettings();
  books[bookKey].groupOrder = Array.isArray(books[bookKey].groupOrder) ? books[bookKey].groupOrder : [];
  books[bookKey].groupEnabled = books[bookKey].groupEnabled || {};
  books[bookKey].groupCollapsed = books[bookKey].groupCollapsed || {};
  return books[bookKey];
}

export function saveSettings() {
  saveSettingsDebounced();
}

/**
 * @returns {import("./types.js").DebugSettings}
 */
export function getDebugSettings() {
  ensureSettingsRoot();
  const settings = extension_settings[MODULE_NAME].debug || makeDefaultDebugSettings();
  settings.enabled = !!settings.enabled;
  settings.logRebuilds = !!settings.logRebuilds;
  settings.logAdapters = !!settings.logAdapters;
  extension_settings[MODULE_NAME].debug = settings;
  return settings;
}

/**
 * @param {string} bookKey
 * @param {string[]} currentGroupNames
 * @returns {string[]}
 */
export function normalizeGroupOrder(bookKey, currentGroupNames) {
  const bs = getBookSettings(bookKey);
  bs.groupOrder = normalizeGroupOrderArray(bs.groupOrder, currentGroupNames);
  return bs.groupOrder.slice();
}

export function isGroupEnabled(bookKey, groupName) {
  const bs = getBookSettings(bookKey);
  const value = bs.groupEnabled[groupName];
  return value === undefined ? true : !!value;
}

export function setGroupEnabled(bookKey, groupName, enabled) {
  const bs = getBookSettings(bookKey);
  bs.groupEnabled[groupName] = !!enabled;
  saveSettings();
}

export function isGroupCollapsed(bookKey, groupName) {
  const bs = getBookSettings(bookKey);
  return !!bs.groupCollapsed[groupName];
}

export function setGroupCollapsed(bookKey, groupName, collapsed) {
  const bs = getBookSettings(bookKey);
  bs.groupCollapsed[groupName] = !!collapsed;
  saveSettings();
}

export function removeGroupFromSettings(bookKey, groupName) {
  const bs = getBookSettings(bookKey);
  bs.groupOrder = (bs.groupOrder || []).filter((x) => x !== groupName);
  delete bs.groupEnabled[groupName];
  delete bs.groupCollapsed[groupName];
  saveSettings();
}

/**
 * @param {string} bookKey
 * @param {string} oldName
 * @param {string} newName
 */
export function migrateGroupSettingsName(bookKey, oldName, newName) {
  const bs = getBookSettings(bookKey);
  if (oldName in bs.groupEnabled) {
    bs.groupEnabled[newName] = bs.groupEnabled[oldName];
    delete bs.groupEnabled[oldName];
  }
  if (oldName in bs.groupCollapsed) {
    bs.groupCollapsed[newName] = bs.groupCollapsed[oldName];
    delete bs.groupCollapsed[oldName];
  }
  bs.groupOrder = (bs.groupOrder || []).map((g) => (g === oldName ? newName : g));
  saveSettings();
}

/**
 * @returns {string}
 */
export function getBookKeyFromUI() {
  const select = document.querySelector(SELECTORS.editorSelect);
  if (select && select.selectedIndex >= 0) {
    const option = select.options[select.selectedIndex];
    const label = (option?.textContent || "").trim();
    if (label) return label;
  }

  const rendered = document.querySelector("#select2-world_editor_select-container");
  const fallback = rendered?.getAttribute("title");
  return fallback ? fallback.trim() : "__unknown__";
}
