/**
 * WorldInfo Organizer (ST-WI-Organizer)
 * Target ST commit: 4672647293b616ba99a87bfe3dbeeb76d5f3ad7d (world-info.js)
 */

import { event_types } from "../../../../script.js";
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
import { getLALibInfo, runWithLALibBatch } from "./src/adapters/lalib.js";

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

function dispatchCommentChanged(commentEl) {
  commentEl.dispatchEvent(new Event("input", { bubbles: true }));
  commentEl.dispatchEvent(new Event("change", { bubbles: true }));
}

function updateEntryGroup(meta, groupName) {
  if (!meta.commentEl) return;
  const title = meta.title || parseGroupPrefix(meta.commentEl.value).title || meta.commentEl.value || "";
  meta.commentEl.value = composeComment(groupName, title);
  dispatchCommentChanged(meta.commentEl);
}

function ungroupEntry(meta, expectedGroup = null) {
  if (!meta.commentEl) return;
  const parsed = parseGroupPrefix(meta.commentEl.value);
  if (expectedGroup && parsed.group !== expectedGroup) return;
  meta.commentEl.value = String(parsed.title || "").trim();
  dispatchCommentChanged(meta.commentEl);
}

function deleteEntry(meta) {
  meta.entryEl.querySelector(".delete_entry_button")?.click();
}

function collectMetas() {
  const metas = getEntryNodes().map(getEntryMeta);
  for (const meta of metas) {
    syncCommentProxy(meta);
  }
  return metas;
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
  const refreshBtn = document.querySelector(SELECTORS.refreshBtn);
  if (refreshBtn instanceof HTMLElement) {
    refreshBtn.click();
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

async function renameGroupFlow(groupName) {
  const bookKey = getBookKeyFromUI();
  const next = await askGroupName("Rename Group", `Rename "${groupName}" to:`, groupName);
  if (!next || next === groupName) return;

  const metas = collectMetas().filter((m) => m.group === groupName);
  for (const meta of metas) {
    if (!meta.commentEl) continue;
    meta.commentEl.value = composeComment(next, meta.title || "");
    dispatchCommentChanged(meta.commentEl);
  }

  migrateGroupSettingsName(bookKey, groupName, next);
  reloadWorldInfoPage(REBUILD_REASONS.GROUP_RENAME);
}

async function deleteGroupFlow(groupName) {
  const action = await askDeleteAction(groupName);
  if (action === "cancel") return;

  const bookKey = getBookKeyFromUI();
  const entries = runtime.currentGroupEntries.get(groupName) || collectMetas().filter((m) => m.group === groupName);
  if (action === "ungroup") {
    for (const meta of entries) ungroupEntry(meta, groupName);
  }
  if (action === "delete") {
    for (const meta of entries) deleteEntry(meta);
  }
  removeGroupFromSettings(bookKey, groupName);
  reloadWorldInfoPage(REBUILD_REASONS.MANAGE_APPLY);
}

async function manageGroupFlow(groupName, opts = {}) {
  let currentGroup = groupName;
  let creating = !!opts.creating;

  while (true) {
    const bookKey = getBookKeyFromUI();
    const allMetas = collectMetas();
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
        const stillGrouped = collectMetas().some((m) => m.group === currentGroup);
        if (!stillGrouped) {
          removeGroupFromSettings(bookKey, currentGroup);
          reloadWorldInfoPage(REBUILD_REASONS.MANAGE_APPLY);
        }
      }
      return;
    }

    const byUid = new Map(allMetas.map((m) => [String(m.uid), m]));
    await runWithLALibBatch(async () => {
      for (const uid of result.toAdd) {
        const meta = byUid.get(String(uid));
        if (meta) updateEntryGroup(meta, currentGroup);
      }
      for (const uid of result.toRemove) {
        const meta = byUid.get(String(uid));
        if (meta) ungroupEntry(meta, currentGroup);
      }
    });

    const groupsAfterApply = Array.from(new Set(collectMetas().map((m) => m.group).filter(Boolean)));
    normalizeGroupOrder(bookKey, groupsAfterApply);
    saveSettings();
    reloadWorldInfoPage(REBUILD_REASONS.MANAGE_APPLY);
    return;
  }
}

async function openGroupEditorFlow() {
  const bookKey = getBookKeyFromUI();
  const groups = Array.from(new Set(collectMetas().map((m) => m.group).filter(Boolean)));
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
      setGroupEnabled(bookKey, groupName, enabled);
      requestRebuild(REBUILD_REASONS.GROUP_TOGGLE);
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
    const normalizedOrder = normalizeGroupOrder(bookKey, groupNames);
    const sortConfig = getSortConfig(/** @type {HTMLSelectElement | null} */ (document.querySelector(SELECTORS.sortSelect)));

    const plan = computeRenderPlan(
      metasAll,
      normalizedOrder,
      sortConfig,
      (groupName) => isGroupEnabled(bookKey, groupName),
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
