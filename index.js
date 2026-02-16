/**
 * WorldInfo Organizer (ST-WI-Organizer)
 * Target ST commit: 4672647293b616ba99a87bfe3dbeeb76d5f3ad7d (world-info.js)
 */

import { event_types } from "../../../../script.js";
import {
  deleteWIOriginalDataValue,
  loadWorldInfo,
  reloadEditor,
  saveWorldInfo,
  setWIOriginalDataValue,
} from "../../../../scripts/world-info.js";
import { accountStorage } from "../../../../scripts/util/AccountStorage.js";
import {
  CSS,
  OBSERVER_OPTIONS,
  REBUILD_DEBOUNCE_MS,
  REBUILD_REASONS,
  SELECTORS,
} from "./src/constants.js";
import { composeComment, parseGroupPrefix } from "./src/parsing.js";
import { buildRenderSignature, computeRenderPlan, getSortConfig } from "./src/render.js";
import {
  askDeleteAction,
  askGroupName,
  ensureCreateGroupButtons,
  getEntryMeta,
  getEntryNodes,
  isInjectedNode,
  openManageModal,
  removeStaleGroupHeaders,
  syncCommentProxy,
  upsertGroupBlock,
  upsertGroupHeader,
} from "./src/ui.js";
import {
  ensureSettingsRoot,
  getBookKeyFromUI,
  getBookSettings,
  getDebugSettings,
  isGroupCollapsed,
  isGroupEnabled,
  migrateGroupSettingsName,
  normalizeGroupOrder,
  removeGroupFromSettings,
  saveSettings,
  setGroupCollapsed,
  setGroupEnabled,
} from "./src/settings.js";
import {
  getTavernHelperInfo,
  makeEventListenerLast,
  registerEventListener,
} from "./src/adapters/tavern-helper.js";
import { getLALibInfo } from "./src/adapters/lalib.js";

const WI_PER_PAGE_KEY = "WI_PerPage";
const GROUPED_MIN_PER_PAGE = 500;

const runtime = {
  observer: /** @type {MutationObserver | null} */ (null),
  rebuildTimer: /** @type {ReturnType<typeof setTimeout> | null} */ (null),
  isRebuilding: false,
  pendingReasons: new Set(),
  currentGroupEntries: new Map(),
  lastRenderSignature: "",
  cleanupFns: [],
  adapters: null,
  rebuildStats: {
    count: 0,
    totalMs: 0,
    reasonCount: {},
  },
};

function ensureGroupedPerPage(shouldElevate) {
  if (!shouldElevate) return false;

  const rawCurrent = accountStorage.getItem(WI_PER_PAGE_KEY);
  const current = Number(rawCurrent);
  const normalizedCurrent = Number.isFinite(current) && current > 0 ? current : 25;
  if (normalizedCurrent >= GROUPED_MIN_PER_PAGE) return false;

  accountStorage.setItem(WI_PER_PAGE_KEY, String(GROUPED_MIN_PER_PAGE));
  return true;
}

function clearRuntimeListeners() {
  const fns = runtime.cleanupFns.splice(0, runtime.cleanupFns.length);
  for (const fn of fns) {
    try {
      fn();
    } catch {
      // no-op
    }
  }
}

const KILL_SWITCH_SELECTOR = '[name="entryKillSwitch"], .killSwitch';

function findKillSwitchControl(entryEl) {
  const direct = entryEl.querySelector(
    `.inline-drawer-header ${KILL_SWITCH_SELECTOR}, ${KILL_SWITCH_SELECTOR}`,
  );
  if (direct instanceof HTMLElement) {
    return direct;
  }

  const icon = entryEl.querySelector(
    ".inline-drawer-header i.fa-toggle-on, .inline-drawer-header i.fa-toggle-off, i.fa-toggle-on, i.fa-toggle-off",
  );
  if (icon instanceof HTMLElement) {
    return (
      icon.closest("button")
      || icon.closest("[role='button']")
      || icon.closest(".menu_button")
      || icon
    );
  }

  const fallback = entryEl.querySelector(
    ".disable_entry_button, .entry_kill_switch, [data-field='disable'], [data-property='disable']",
  );
  return fallback instanceof HTMLElement ? fallback : null;
}

function findDisableInput(entryEl) {
  const selectors = [
    'input[name="disable"]',
    'input[data-property="disable"]',
    '.disable_entry input[type="checkbox"]',
  ];
  for (const selector of selectors) {
    const el = entryEl.querySelector(selector);
    if (el instanceof HTMLInputElement) return el;
  }
  return null;
}

function readDisableState(meta) {
  const disableInput = findDisableInput(meta.entryEl);
  if (disableInput) {
    if (disableInput.type === "checkbox" || disableInput.type === "radio") {
      return !!disableInput.checked;
    }
    const raw = String(disableInput.value || "").trim().toLowerCase();
    return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
  }

  const killSwitch = findKillSwitchControl(meta.entryEl);
  if (killSwitch) {
    if (killSwitch.classList.contains("fa-toggle-off")) return true;
    if (killSwitch.classList.contains("fa-toggle-on")) return false;
  }
  return null;
}

function setDisableState(meta, disabled) {
  const disableInput = findDisableInput(meta.entryEl);
  if (disableInput) {
    if (disableInput.type === "checkbox" || disableInput.type === "radio") {
      if (!!disableInput.checked === !!disabled) return false;
      disableInput.checked = !!disabled;
    } else {
      const current = String(disableInput.value || "").trim().toLowerCase();
      let next = disabled ? "1" : "0";
      if (current === "true" || current === "false") {
        next = disabled ? "true" : "false";
      }
      if (current === "on" || current === "off") {
        next = disabled ? "on" : "off";
      }
      if (current === next) return false;
      disableInput.value = next;
    }
    disableInput.dispatchEvent(new Event("input", { bubbles: true }));
    disableInput.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  }

  const toggleBtn = findKillSwitchControl(meta.entryEl);
  if (!(toggleBtn instanceof HTMLElement)) return false;
  const currentDisabled = readDisableState(meta);
  if (currentDisabled !== null && currentDisabled === !!disabled) return false;
  toggleBtn.click();
  return true;
}

function readGroupEnabledFromEntries(entries) {
  if (!entries.length) return null;
  const knownStates = entries
    .map((meta) => readDisableState(meta))
    .filter((state) => state !== null);
  if (!knownStates.length) return null;
  return knownStates.some((isDisabled) => !isDisabled);
}

function collectMetas() {
  const metas = getEntryNodes().map(getEntryMeta);
  for (const meta of metas) {
    syncCommentProxy(meta);
  }
  return metas;
}

function readBookEntryComment(entry) {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return "";
  return String(entry.comment ?? entry.title ?? "");
}

function setBookEntryComment(data, uid, entry, nextComment) {
  const currentComment = readBookEntryComment(entry);
  if (currentComment === nextComment) return false;
  entry.comment = nextComment;
  const uidNumber = Number(entry?.uid ?? uid);
  if (Number.isFinite(uidNumber)) {
    setWIOriginalDataValue(data, uidNumber, "comment", nextComment);
  }
  return true;
}

function toBookMeta(entry, fallbackUid = "") {
  const uid = String(entry?.uid ?? fallbackUid ?? "");
  const rawComment = readBookEntryComment(entry);
  const parsed = parseGroupPrefix(rawComment);
  const keyTitle = Array.isArray(entry?.key) ? String(entry.key[0] || "").trim() : "";
  return {
    uid,
    entryEl: /** @type {any} */ (null),
    commentEl: null,
    rawComment,
    group: parsed.group,
    title: parsed.title || keyTitle || rawComment,
  };
}

async function collectBookMetas(bookKey) {
  const metasOnPage = collectMetas();
  if (!bookKey || bookKey === "__unknown__") return metasOnPage;
  try {
    const data = await loadWorldInfo(bookKey);
    if (!data || typeof data !== "object" || !data.entries) return metasOnPage;

    const rows = Object.entries(data.entries)
      .map(([key, entry]) => {
        if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
        const uid = String(entry.uid ?? key);
        const displayIndex = Number(entry.displayIndex);
        const uidNumber = Number(uid);
        return {
          meta: toBookMeta(entry, key),
          displayIndex: Number.isFinite(displayIndex) ? displayIndex : Number.MAX_SAFE_INTEGER,
          uidNumber: Number.isFinite(uidNumber) ? uidNumber : Number.MAX_SAFE_INTEGER,
          uid,
        };
      })
      .filter(Boolean)
      .sort((a, b) => {
        const byIndex = a.displayIndex - b.displayIndex;
        if (byIndex !== 0) return byIndex;
        const byUid = a.uidNumber - b.uidNumber;
        if (byUid !== 0) return byUid;
        return a.uid.localeCompare(b.uid);
      });

    const domByUid = new Map(metasOnPage.map((m) => [String(m.uid), m]));
    return rows.map((row) => domByUid.get(String(row.meta.uid)) || row.meta);
  } catch (error) {
    console.warn("[WorldInfo Organizer] collectBookMetas fallback to current page", error);
    return metasOnPage;
  }
}

async function applyUidGroupChanges(bookKey, groupName, toAdd, toRemove) {
  if (!bookKey || bookKey === "__unknown__") return false;
  const data = await loadWorldInfo(bookKey);
  if (!data || typeof data !== "object" || !data.entries) return false;

  const byUid = new Map();
  for (const [key, entry] of Object.entries(data.entries)) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    byUid.set(String(entry.uid ?? key), entry);
  }

  let changed = false;
  const addSet = new Set((toAdd || []).map((uid) => String(uid)));
  const removeSet = new Set((toRemove || []).map((uid) => String(uid)));

  for (const uid of addSet) {
    const entry = byUid.get(uid);
    if (!entry) continue;
    const parsed = parseGroupPrefix(readBookEntryComment(entry));
    const title = parsed.title || readBookEntryComment(entry);
    if (setBookEntryComment(data, uid, entry, composeComment(groupName, title))) changed = true;
  }

  for (const uid of removeSet) {
    const entry = byUid.get(uid);
    if (!entry) continue;
    const parsed = parseGroupPrefix(readBookEntryComment(entry));
    if (parsed.group !== groupName) continue;
    if (setBookEntryComment(data, uid, entry, String(parsed.title || "").trim())) changed = true;
  }

  if (!changed) return false;
  await saveWorldInfo(bookKey, data, true);
  return true;
}

async function renameGroupInBook(bookKey, oldGroupName, newGroupName) {
  if (!bookKey || bookKey === "__unknown__") return false;
  const data = await loadWorldInfo(bookKey);
  if (!data || typeof data !== "object" || !data.entries) return false;

  let changed = false;
  for (const [key, entry] of Object.entries(data.entries)) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const uid = String(entry.uid ?? key);
    const parsed = parseGroupPrefix(readBookEntryComment(entry));
    if (parsed.group !== oldGroupName) continue;
    const nextComment = composeComment(newGroupName, parsed.title || readBookEntryComment(entry));
    if (setBookEntryComment(data, uid, entry, nextComment)) changed = true;
  }

  if (!changed) return false;
  await saveWorldInfo(bookKey, data, true);
  return true;
}

async function ungroupBookEntries(bookKey, groupName) {
  if (!bookKey || bookKey === "__unknown__") return false;
  const data = await loadWorldInfo(bookKey);
  if (!data || typeof data !== "object" || !data.entries) return false;

  let changed = false;
  for (const [key, entry] of Object.entries(data.entries)) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const uid = String(entry.uid ?? key);
    const parsed = parseGroupPrefix(readBookEntryComment(entry));
    if (parsed.group !== groupName) continue;
    if (setBookEntryComment(data, uid, entry, String(parsed.title || "").trim())) changed = true;
  }

  if (!changed) return false;
  await saveWorldInfo(bookKey, data, true);
  return true;
}

async function deleteBookEntriesInGroup(bookKey, groupName) {
  if (!bookKey || bookKey === "__unknown__") return false;
  const data = await loadWorldInfo(bookKey);
  if (!data || typeof data !== "object" || !data.entries) return false;

  let changed = false;
  for (const [key, entry] of Object.entries(data.entries)) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const uid = String(entry.uid ?? key);
    const parsed = parseGroupPrefix(readBookEntryComment(entry));
    if (parsed.group !== groupName) continue;
    delete data.entries[key];
    deleteWIOriginalDataValue(data, uid);
    changed = true;
  }

  if (!changed) return false;
  await saveWorldInfo(bookKey, data, true);
  return true;
}

function logRebuildSummary(reasons, elapsedMs, skipped) {
  const debug = getDebugSettings();
  if (!debug.enabled || !debug.logRebuilds) return;
  const reasonLabel = reasons.join(",");
  const flag = skipped ? "skip" : "apply";
  console.info(`[WIORG] rebuild(${flag}) reasons=[${reasonLabel}] time=${elapsedMs.toFixed(1)}ms`);
}

function logAdapterSummary() {
  const debug = getDebugSettings();
  if (!debug.enabled || !debug.logAdapters || !runtime.adapters) return;
  console.info(
    `[WIORG] adapters: TavernHelper=${runtime.adapters.tavernHelper.available ? "yes" : "no"}`
    + ` (eventOn=${runtime.adapters.tavernHelper.hasEventOn ? "yes" : "no"},`
    + ` eventMakeLast=${runtime.adapters.tavernHelper.hasEventMakeLast ? "yes" : "no"})`
    + `, LALib=${runtime.adapters.lalib.available ? "yes" : "no"}`
    + ` (batch=${runtime.adapters.lalib.hasBatch ? "yes" : "no"})`,
  );
}

function requestRebuild(reason) {
  runtime.pendingReasons.add(reason);
  if (runtime.rebuildTimer) clearTimeout(runtime.rebuildTimer);
  runtime.rebuildTimer = setTimeout(() => {
    runtime.rebuildTimer = null;
    const reasons = Array.from(runtime.pendingReasons);
    runtime.pendingReasons.clear();
    rebuildGroupsUI(reasons);
  }, REBUILD_DEBOUNCE_MS);
}

function reloadWorldInfoPage(reason = REBUILD_REASONS.REFRESH) {
  const bookKey = getBookKeyFromUI();
  if (bookKey && bookKey !== "__unknown__") {
    void reloadEditor(bookKey, true).catch(() => {
      const refreshBtn = document.querySelector(SELECTORS.refreshBtn);
      if (refreshBtn instanceof HTMLElement) refreshBtn.click();
    });
  } else {
    const refreshBtn = document.querySelector(SELECTORS.refreshBtn);
    if (refreshBtn instanceof HTMLElement) refreshBtn.click();
  }
  requestRebuild(reason);
}

function moveGroup(bookKey, groupName, delta) {
  const bs = getBookSettings(bookKey);
  const order = Array.isArray(bs.groupOrder) ? bs.groupOrder.slice() : [];
  const idx = order.indexOf(groupName);
  if (idx < 0) return;
  const nextIndex = idx + delta;
  if (nextIndex < 0 || nextIndex >= order.length) return;
  order.splice(idx, 1);
  order.splice(nextIndex, 0, groupName);
  bs.groupOrder = order;
  saveSettings();
  reloadWorldInfoPage(REBUILD_REASONS.GROUP_MOVE);
}

function applyGroupEnableState(bookKey, groupName, enabled) {
  const entries = runtime.currentGroupEntries.get(groupName) || collectMetas().filter((m) => m.group === groupName);
  let changed = false;
  for (const meta of entries) {
    if (setDisableState(meta, !enabled)) changed = true;
  }
  setGroupEnabled(bookKey, groupName, enabled);
  if (changed) {
    reloadWorldInfoPage(REBUILD_REASONS.GROUP_TOGGLE);
  } else {
    requestRebuild(REBUILD_REASONS.GROUP_TOGGLE);
  }
}

async function renameGroupFlow(groupName) {
  const bookKey = getBookKeyFromUI();
  const next = await askGroupName("Rename Group", `Rename "${groupName}" to:`, groupName);
  if (!next || next === groupName) return;

  await renameGroupInBook(bookKey, groupName, next);

  migrateGroupSettingsName(bookKey, groupName, next);
  reloadWorldInfoPage(REBUILD_REASONS.GROUP_RENAME);
}

async function deleteGroupFlow(groupName) {
  const action = await askDeleteAction(groupName);
  if (action === "cancel") return;

  const bookKey = getBookKeyFromUI();
  if (action === "ungroup") {
    await ungroupBookEntries(bookKey, groupName);
  }
  if (action === "delete") {
    await deleteBookEntriesInGroup(bookKey, groupName);
  }
  removeGroupFromSettings(bookKey, groupName);
  reloadWorldInfoPage(REBUILD_REASONS.MANAGE_APPLY);
}

async function manageGroupFlow(groupName, opts = {}) {
  let currentGroup = groupName;
  let creating = !!opts.creating;

  while (true) {
    const bookKey = getBookKeyFromUI();
    const allMetas = await collectBookMetas(bookKey);
    const groupsNow = Array.from(new Set(allMetas.map((m) => m.group).filter(Boolean)));
    const orderedNow = normalizeGroupOrder(bookKey, groupsNow);
    const groupNamesForPicker = orderedNow.includes(currentGroup)
      ? orderedNow
      : [...orderedNow, currentGroup].filter(Boolean);

    const result = await openManageModal({
      groupName: currentGroup,
      allMetas,
      creating,
      groupNames: groupNamesForPicker,
    });

    if (result.switchTo) {
      currentGroup = result.switchTo;
      creating = false;
      continue;
    }

    if (result.createRequested) {
      const nextGroupName = await askGroupName("Create Group", "Enter a new group name:", "");
      if (!nextGroupName) continue;
      normalizeGroupOrder(bookKey, [...groupsNow, nextGroupName]);
      saveSettings();
      currentGroup = nextGroupName;
      creating = true;
      continue;
    }

    if (!result.applied) {
      if (creating) {
        const stillGrouped = (await collectBookMetas(bookKey)).some((m) => m.group === currentGroup);
        if (!stillGrouped) {
          removeGroupFromSettings(bookKey, currentGroup);
          reloadWorldInfoPage(REBUILD_REASONS.MANAGE_APPLY);
        }
      }
      return;
    }

    await applyUidGroupChanges(bookKey, currentGroup, result.toAdd, result.toRemove);

    const groupsAfterApply = Array.from(new Set((await collectBookMetas(bookKey)).map((m) => m.group).filter(Boolean)));
    normalizeGroupOrder(bookKey, groupsAfterApply);
    saveSettings();
    reloadWorldInfoPage(REBUILD_REASONS.MANAGE_APPLY);
    return;
  }
}

async function openGroupEditorFlow() {
  const bookKey = getBookKeyFromUI();
  const groups = Array.from(new Set((await collectBookMetas(bookKey)).map((m) => m.group).filter(Boolean)));
  const ordered = normalizeGroupOrder(bookKey, groups);
  if (ordered.length > 0) {
    await manageGroupFlow(ordered[0], { creating: false });
    return;
  }

  const groupName = await askGroupName("Create Group", "Enter a new group name:", "");
  if (!groupName) return;
  normalizeGroupOrder(bookKey, [...groups, groupName]);
  saveSettings();
  await manageGroupFlow(groupName, { creating: true });
}

function applyGroupBlockLayout(list, orderedGroups) {
  const resolveTopLevelNode = (node) => {
    let current = node instanceof HTMLElement ? node : null;
    while (current && current.parentElement && current.parentElement !== list) {
      current = current.parentElement;
    }
    return current && current.parentElement === list ? current : null;
  };

  const groupedEntryOrder = orderedGroups.flatMap((g) => g.entries.map((e) => e.entryEl));
  let insertionCursor = resolveTopLevelNode(groupedEntryOrder[0] || null);

  const callbacks = {
    onToggleCollapse: (groupName) => {
      const bookKey = getBookKeyFromUI();
      setGroupCollapsed(bookKey, groupName, !isGroupCollapsed(bookKey, groupName));
      requestRebuild(REBUILD_REASONS.GROUP_COLLAPSE);
    },
    onToggleEnabled: (groupName, enabled) => {
      const bookKey = getBookKeyFromUI();
      applyGroupEnableState(bookKey, groupName, enabled);
    },
    onMoveUp: (groupName) => moveGroup(getBookKeyFromUI(), groupName, -1),
    onMoveDown: (groupName) => moveGroup(getBookKeyFromUI(), groupName, +1),
    onRename: (groupName) => {
      renameGroupFlow(groupName);
    },
    onManage: (groupName) => {
      manageGroupFlow(groupName);
    },
    onDelete: (groupName) => {
      deleteGroupFlow(groupName);
    },
  };

  runtime.currentGroupEntries.clear();
  for (const groupState of orderedGroups) {
    runtime.currentGroupEntries.set(groupState.name, groupState.entries);
    const block = upsertGroupBlock(list, groupState.name);
    const header = upsertGroupHeader(list, groupState, callbacks);

    if (insertionCursor && insertionCursor.parentElement === list) {
      if (insertionCursor !== block) {
        insertionCursor.insertAdjacentElement("beforebegin", block);
      }
    } else if (block.parentElement !== list) {
      list.appendChild(block);
    }

    if (header.parentElement !== block) {
      block.insertBefore(header, block.firstChild);
    } else if (block.firstChild !== header) {
      block.insertBefore(header, block.firstChild);
    }

    let anchor = header;
    for (const meta of groupState.entries) {
      if (meta.entryEl.parentElement !== block || anchor.nextSibling !== meta.entryEl) {
        block.insertBefore(meta.entryEl, anchor.nextSibling);
      }
      meta.entryEl.style.display = groupState.collapsed ? "none" : "";
      anchor = meta.entryEl;
    }

    insertionCursor = block.nextSibling;
  }
}

function rebuildGroupsUI(reasons = [REBUILD_REASONS.OBSERVER]) {
  if (runtime.isRebuilding) return;
  const panel = document.querySelector(SELECTORS.wiPanel);
  const list = document.querySelector(SELECTORS.list);
  if (!panel || !list) return;

  const startedAt = performance.now();
  runtime.isRebuilding = true;
  runtime.observer?.disconnect();

  try {
    ensureCreateGroupButtons(() => {
      openGroupEditorFlow();
    });

    const bookKey = getBookKeyFromUI();
    const metasAll = collectMetas();
    const groupNames = Array.from(new Set(metasAll.map((m) => m.group).filter(Boolean)));
    const hasGroupUsage = groupNames.length > 0 || getBookSettings(bookKey).groupOrder.length > 0;
    if (ensureGroupedPerPage(hasGroupUsage)) {
      reloadWorldInfoPage(REBUILD_REASONS.PAGINATION);
      return;
    }
    const normalizedOrder = normalizeGroupOrder(bookKey, groupNames);
    const metasByGroup = new Map();
    for (const meta of metasAll) {
      if (!meta.group) continue;
      if (!metasByGroup.has(meta.group)) metasByGroup.set(meta.group, []);
      metasByGroup.get(meta.group).push(meta);
    }
    const groupEnabledFromEntries = new Map();
    for (const name of normalizedOrder) {
      groupEnabledFromEntries.set(name, readGroupEnabledFromEntries(metasByGroup.get(name) || []));
    }
    const sortConfig = getSortConfig(/** @type {HTMLSelectElement | null} */ (document.querySelector(SELECTORS.sortSelect)));

    const plan = computeRenderPlan(
      metasAll,
      normalizedOrder,
      sortConfig,
      (groupName) => groupEnabledFromEntries.get(groupName) ?? isGroupEnabled(bookKey, groupName),
      (groupName) => isGroupCollapsed(bookKey, groupName),
    );

    const validGroups = new Set(plan.orderedGroups.map((g) => g.name));
    removeStaleGroupHeaders(list, validGroups);
    if (plan.orderedGroups.length === 0) {
      runtime.currentGroupEntries.clear();
      runtime.lastRenderSignature = "";
      return;
    }

    const nextSignature = buildRenderSignature(plan);
    const headersPresent = plan.orderedGroups.every((g) => !!list.querySelector(`.${CSS.headerClass}[data-group="${g.name}"]`));
    const shouldApplyLayout = nextSignature !== runtime.lastRenderSignature || !headersPresent;

    if (shouldApplyLayout) {
      applyGroupBlockLayout(list, plan.orderedGroups);
      runtime.lastRenderSignature = nextSignature;
    }

    const elapsed = performance.now() - startedAt;
    runtime.rebuildStats.count += 1;
    runtime.rebuildStats.totalMs += elapsed;
    for (const reason of reasons) {
      runtime.rebuildStats.reasonCount[reason] = (runtime.rebuildStats.reasonCount[reason] || 0) + 1;
    }
    logRebuildSummary(reasons, elapsed, !shouldApplyLayout);
  } finally {
    runtime.isRebuilding = false;
    const currentList = document.querySelector(SELECTORS.list);
    if (runtime.observer && currentList) runtime.observer.observe(currentList, OBSERVER_OPTIONS);
  }
}

function isInternalMutation(mutations) {
  if (mutations.length === 0) return false;
  return mutations.every((mutation) => {
    const changedNodes = [...mutation.addedNodes, ...mutation.removedNodes];
    if (changedNodes.length === 0) return false;
    return changedNodes.every((node) => isInjectedNode(node));
  });
}

function attachObserver() {
  const list = document.querySelector(SELECTORS.list);
  if (!list) return;

  if (runtime.observer) runtime.observer.disconnect();
  runtime.observer = new MutationObserver((mutations) => {
    if (runtime.isRebuilding) return;
    if (isInternalMutation(mutations)) return;
    requestRebuild(REBUILD_REASONS.OBSERVER);
  });
  runtime.observer.observe(list, OBSERVER_OPTIONS);
}

function addListenerOnce(el, eventName, key, handler) {
  if (!el) return;
  if (el.getAttribute(key) === "1") return;
  el.setAttribute(key, "1");
  el.addEventListener(eventName, handler);
}

function attachUIListeners() {
  addListenerOnce(document.querySelector(SELECTORS.sortSelect), "change", "data-wiog-sort-bound", () => {
    requestRebuild(REBUILD_REASONS.SORT);
  });
  addListenerOnce(document.querySelector(SELECTORS.search), "input", "data-wiog-search-bound", () => {
    requestRebuild(REBUILD_REASONS.SEARCH);
  });
  addListenerOnce(document.querySelector(SELECTORS.editorSelect), "change", "data-wiog-editor-bound", () => {
    requestRebuild(REBUILD_REASONS.EDITOR_CHANGE);
  });
  addListenerOnce(document.querySelector(SELECTORS.pagination), "click", "data-wiog-page-bound", () => {
    requestRebuild(REBUILD_REASONS.PAGINATION);
  });
  addListenerOnce(document.querySelector(SELECTORS.refreshBtn), "click", "data-wiog-refresh-bound", () => {
    requestRebuild(REBUILD_REASONS.REFRESH);
  });
}

function attachPromptFilterHook() {
  const handler = (payload) => {
    try {
      ensureSettingsRoot();
      const arrays = [
        payload?.globalLore,
        payload?.characterLore,
        payload?.chatLore,
        payload?.personaLore,
      ].filter(Boolean);

      for (const arr of arrays) {
        for (const entry of arr) {
          const comment = entry?.comment ?? entry?.title ?? "";
          const parsed = parseGroupPrefix(comment);
          if (!parsed.group) continue;
          const bookKey = String(
            entry?.world ??
            entry?.world_name ??
            entry?.worldName ??
            entry?.lorebook ??
            entry?.book ??
            "__unknown__",
          );
          if (!isGroupEnabled(bookKey, parsed.group)) {
            entry.disable = true;
          }
        }
      }
    } catch (error) {
      console.warn("[WorldInfo Organizer] prompt filter hook error", error);
    }
  };

  const off = registerEventListener(event_types.WORLDINFO_ENTRIES_LOADED, handler);
  runtime.cleanupFns.push(off);
  makeEventListenerLast(event_types.WORLDINFO_ENTRIES_LOADED, handler);
}

function cleanInjectedUi() {
  clearRuntimeListeners();
  document.querySelectorAll(`.${CSS.headerClass}`).forEach((n) => n.remove());
  document.getElementById(CSS.injectToolbarBtnId)?.remove();
  document.getElementById(CSS.injectTopBtnId)?.remove();
  const modalRoot = document.getElementById(CSS.modalId);
  if (modalRoot) modalRoot.innerHTML = "";
}

function init() {
  ensureSettingsRoot();
  runtime.adapters = {
    tavernHelper: getTavernHelperInfo(),
    lalib: getLALibInfo(),
  };
  logAdapterSummary();
  cleanInjectedUi();
  attachPromptFilterHook();

  const tryAttach = () => {
    const panel = document.querySelector(SELECTORS.wiPanel);
    const list = document.querySelector(SELECTORS.list);
    if (!panel || !list) return false;
    attachObserver();
    attachUIListeners();
    requestRebuild(REBUILD_REASONS.INIT);
    return true;
  };

  if (tryAttach()) return;
  let tries = 0;
  const timer = setInterval(() => {
    tries += 1;
    if (tryAttach() || tries > 60) clearInterval(timer);
  }, 250);
}

jQuery(async () => {
  init();
});
