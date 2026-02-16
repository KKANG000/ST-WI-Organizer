import { Popup, POPUP_RESULT } from "../../../../popup.js";
import { CSS, SELECTORS } from "./constants.js";
import { composeComment, parseGroupPrefix, validateGroupName } from "./parsing.js";

const BOUND_ATTR = "data-wiog-bound";

function markInjected(el) {
  if (el?.setAttribute) el.setAttribute(CSS.injectedAttr, "1");
}

function escapeHtml(input) {
  return String(input).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  }[c]));
}

function syncGroupedEntryVisual(meta) {
  const entry = meta.entryEl;
  const existingBadge = entry.querySelector(".wiog-entry-group-pill");
  if (existingBadge) existingBadge.remove();

  if (!meta.group) {
    entry.classList.remove("wiog-grouped-entry");
    entry.removeAttribute("data-wiog-group");
    return;
  }

  entry.classList.add("wiog-grouped-entry");
  entry.setAttribute("data-wiog-group", meta.group);
}

/**
 * @returns {HTMLElement[]}
 */
export function getEntryNodes() {
  const list = document.querySelector(SELECTORS.list);
  if (!list) return [];
  return Array.from(list.querySelectorAll(".world_entry[uid]"));
}

/**
 * @param {HTMLElement} entryEl
 * @returns {import("./types.js").EntryMeta}
 */
export function getEntryMeta(entryEl) {
  const uid = String(entryEl.getAttribute("uid") || "");
  const commentEl = /** @type {HTMLTextAreaElement | null} */ (entryEl.querySelector('textarea[name="comment"]'));
  const rawComment = commentEl ? String(commentEl.value || "") : "";
  const parsed = parseGroupPrefix(rawComment);
  return {
    uid,
    entryEl,
    commentEl,
    rawComment,
    group: parsed.group,
    title: parsed.title,
  };
}

/**
 * Keep entry title input in sync while never showing the raw ::group:: prefix.
 *
 * @param {import("./types.js").EntryMeta} meta
 */
export function syncCommentProxy(meta) {
  const commentEl = meta.commentEl;
  if (!commentEl) return;
  const wrap = commentEl.parentElement;
  if (!wrap) return;
  syncGroupedEntryVisual(meta);

  let proxy = /** @type {HTMLTextAreaElement | null} */ (wrap.querySelector(`.${CSS.commentProxyClass}`));

  if (!meta.group) {
    commentEl.classList.remove(CSS.commentSourceClass);
    commentEl.removeAttribute("tabindex");
    commentEl.removeAttribute("aria-hidden");
    proxy?.remove();
    return;
  }

  commentEl.classList.add(CSS.commentSourceClass);
  commentEl.setAttribute("tabindex", "-1");
  commentEl.setAttribute("aria-hidden", "true");

  if (!proxy) {
    proxy = document.createElement("textarea");
    const baseClassName = String(commentEl.className || "")
      .split(/\s+/)
      .filter((c) => c && c !== CSS.commentSourceClass && c !== CSS.commentProxyClass)
      .join(" ");
    proxy.className = `${baseClassName} ${CSS.commentProxyClass}`.trim();
    proxy.rows = Number(commentEl.getAttribute("rows") || "1");
    proxy.spellcheck = commentEl.spellcheck;
    proxy.placeholder = commentEl.placeholder || "";
    proxy.setAttribute(BOUND_ATTR, "0");
    markInjected(proxy);
    wrap.appendChild(proxy);
  }

  proxy.dataset.group = meta.group;
  proxy.title = meta.title || "";
  if (proxy.value !== meta.title) proxy.value = meta.title;

  if (proxy.getAttribute(BOUND_ATTR) === "1") return;
  proxy.setAttribute(BOUND_ATTR, "1");

  let composing = false;
  const commit = (emitChange) => {
    const groupName = String(proxy?.dataset.group || "").trim();
    if (!groupName || !proxy) return;
    const next = composeComment(groupName, proxy.value || "");
    if (commentEl.value !== next) {
      commentEl.value = next;
      commentEl.dispatchEvent(new Event("input", { bubbles: true }));
    }
    if (emitChange) commentEl.dispatchEvent(new Event("change", { bubbles: true }));
  };

  proxy.addEventListener("compositionstart", () => {
    composing = true;
  });
  proxy.addEventListener("compositionend", () => {
    composing = false;
    commit(false);
  });
  proxy.addEventListener("input", () => {
    if (!composing) commit(false);
  });
  proxy.addEventListener("change", () => commit(true));
  proxy.addEventListener("blur", () => commit(true));
}

/**
 * @param {() => void} onOpenGroupEditor
 */
export function ensureCreateGroupButtons(onOpenGroupEditor) {
  const row = document.querySelector(SELECTORS.topControlsRow);
  const newBtn = document.querySelector(SELECTORS.newEntryBtn);
  if (row && newBtn && !document.getElementById(CSS.injectToolbarBtnId)) {
    const btn = document.createElement("div");
    btn.id = CSS.injectToolbarBtnId;
    btn.className = "menu_button fa-solid fa-layer-group interactable wiog-toolbar-btn";
    btn.title = "Group Editor";
    btn.setAttribute("tabindex", "0");
    btn.setAttribute("role", "button");
    btn.addEventListener("click", onOpenGroupEditor);
    markInjected(btn);
    newBtn.insertAdjacentElement("afterend", btn);
  }
}

function findGroupHeader(list, groupName) {
  const headers = Array.from(list.querySelectorAll(`.${CSS.headerClass}`));
  return headers.find((el) => el.getAttribute("data-group") === groupName) || null;
}

function findGroupBlock(list, groupName) {
  const blocks = Array.from(list.querySelectorAll(`.${CSS.groupBlockClass}`));
  return blocks.find((el) => el.getAttribute("data-group") === groupName) || null;
}

/**
 * @param {HTMLElement} list
 * @param {string} groupName
 * @returns {HTMLElement}
 */
export function upsertGroupBlock(list, groupName) {
  let block = findGroupBlock(list, groupName);
  if (!block) {
    block = document.createElement("div");
    block.className = CSS.groupBlockClass;
    markInjected(block);
  }
  block.setAttribute("data-group", groupName);
  return block;
}

/**
 * @param {HTMLElement} header
 * @param {import("./types.js").GroupState} groupState
 */
function patchGroupHeader(header, groupState) {
  header.dataset.group = groupState.name;
  header.querySelector(".wiog-name").textContent = groupState.name;
  header.querySelector(".wiog-count").textContent = `(${groupState.entries.length})`;

  const collapseIcon = header.querySelector(".wiog-collapse-btn i");
  if (collapseIcon) {
    collapseIcon.className = `fa-solid ${groupState.collapsed ? "fa-chevron-right" : "fa-chevron-down"}`;
  }

  const checkbox = /** @type {HTMLInputElement | null} */ (header.querySelector('input[type="checkbox"]'));
  if (checkbox) checkbox.checked = groupState.enabled;

  header.classList.toggle(CSS.headerDisabled, !groupState.enabled);
  header.classList.toggle(CSS.headerCollapsed, groupState.collapsed);
}

/**
 * @param {HTMLElement} list
 * @param {import("./types.js").GroupState} groupState
 * @param {{
 *   onToggleCollapse: (groupName: string) => void,
 *   onToggleEnabled: (groupName: string, enabled: boolean) => void,
 *   onMoveUp: (groupName: string) => void,
 *   onMoveDown: (groupName: string) => void,
 *   onRename: (groupName: string) => void,
 *   onManage: (groupName: string) => void,
 *   onDelete: (groupName: string) => void,
 * }} callbacks
 * @returns {HTMLElement}
 */
export function upsertGroupHeader(list, groupState, callbacks) {
  let header = findGroupHeader(list, groupState.name);
  if (!header) {
    header = document.createElement("div");
    header.className = `${CSS.headerClass} flex-container alignitemscenter`;
    header.innerHTML = `
      <button type="button" data-action="collapse" class="wiog-collapse-btn menu_button interactable" title="Collapse/Expand">
        <i class="fa-solid fa-chevron-down"></i>
      </button>
      <label class="wiog-enable">
        <input type="checkbox" />
        <span class="wiog-switch" aria-hidden="true"></span>
      </label>
      <div class="wiog-title">
        <span class="wiog-name"></span>
        <span class="wiog-count"></span>
      </div>
      <div class="wiog-actions">
        <button type="button" data-action="up" class="menu_button interactable wiog-up" title="Move group up"><i class="fa-solid fa-chevron-up"></i></button>
        <button type="button" data-action="down" class="menu_button interactable wiog-down" title="Move group down"><i class="fa-solid fa-chevron-down"></i></button>
        <button type="button" data-action="rename" class="menu_button interactable wiog-rename" title="Rename group"><i class="fa-solid fa-pencil"></i></button>
        <button type="button" data-action="manage" class="menu_button interactable wiog-manage" title="Manage entries"><i class="fa-solid fa-right-left"></i></button>
        <button type="button" data-action="delete" class="menu_button interactable wiog-delete redWarningBG" title="Delete group"><i class="fa-solid fa-trash-can"></i></button>
      </div>
    `;
    markInjected(header);
  }

  patchGroupHeader(header, groupState);

  if (header.getAttribute(BOUND_ATTR) !== "1") {
    header.setAttribute(BOUND_ATTR, "1");
    header.addEventListener("click", (event) => {
      const target = /** @type {HTMLElement | null} */ (event.target instanceof HTMLElement ? event.target : null);
      const button = target?.closest("[data-action]");
      if (!button) return;
      const groupName = String(header.dataset.group || "");
      const action = button.getAttribute("data-action");
      if (action === "collapse") callbacks.onToggleCollapse(groupName);
      if (action === "up") callbacks.onMoveUp(groupName);
      if (action === "down") callbacks.onMoveDown(groupName);
      if (action === "rename") callbacks.onRename(groupName);
      if (action === "manage") callbacks.onManage(groupName);
      if (action === "delete") callbacks.onDelete(groupName);
    });
    const checkbox = /** @type {HTMLInputElement | null} */ (header.querySelector('input[type="checkbox"]'));
    checkbox?.addEventListener("change", (event) => {
      const target = /** @type {HTMLInputElement} */ (event.target);
      const groupName = String(header.dataset.group || "");
      callbacks.onToggleEnabled(groupName, !!target.checked);
    });
  }

  return header;
}

/**
 * @param {HTMLElement} list
 * @param {Set<string>} validGroupNames
 */
export function removeStaleGroupHeaders(list, validGroupNames) {
  const blocks = Array.from(list.querySelectorAll(`.${CSS.groupBlockClass}`));
  for (const block of blocks) {
    const name = String(block.getAttribute("data-group") || "");
    if (validGroupNames.has(name)) continue;
    const parent = block.parentElement;
    if (parent) {
      const children = Array.from(block.children);
      for (const child of children) {
        parent.insertBefore(child, block);
      }
    }
    block.remove();
  }

  const headers = Array.from(list.querySelectorAll(`.${CSS.headerClass}`));
  for (const header of headers) {
    if (!validGroupNames.has(String(header.getAttribute("data-group") || ""))) {
      header.remove();
    }
  }
}

/**
 * @param {string | null} header
 * @param {string | null} text
 * @param {string} defaultValue
 * @returns {Promise<string | null>}
 */
export async function askGroupName(header, text, defaultValue = "") {
  let candidate = defaultValue;
  while (true) {
    const result = await Popup.show.input(header, text, candidate);
    if (result === null) return null;
    const valid = validateGroupName(result);
    if (valid.ok) return valid.value;

    await Popup.show.confirm("Invalid Group Name", valid.error, {
      okButton: "OK",
      cancelButton: false,
    });
    candidate = String(result || "");
  }
}

/**
 * @param {string} groupName
 * @returns {Promise<"ungroup" | "delete" | "cancel">}
 */
export async function askDeleteAction(groupName) {
  const result = await Popup.show.confirm(
    `Delete group "${groupName}"`,
    "Choose how to handle entries in this group.",
    {
      okButton: "Ungroup Entries",
      cancelButton: "Cancel",
      customButtons: [
        {
          text: "Delete Entries",
          result: POPUP_RESULT.CUSTOM1,
          classes: ["redWarningBG"],
          appendAtEnd: true,
        },
      ],
    },
  );

  if (result === POPUP_RESULT.AFFIRMATIVE) return "ungroup";
  if (result === POPUP_RESULT.CUSTOM1) return "delete";
  return "cancel";
}

function buildEntryCheckboxRow(meta, showGroupBadge) {
  const row = document.createElement("label");
  row.className = "wiog-entry-row";
  row.dataset.title = (meta.title || meta.rawComment || "").toLowerCase();
  row.dataset.group = (meta.group || "").toLowerCase();

  const title = meta.title || meta.rawComment || `(UID ${meta.uid})`;
  const badge = meta.group
    ? `<span class="wiog-badge">${escapeHtml(meta.group)}</span>`
    : `<span class="wiog-badge wiog-badge-none">ungrouped</span>`;
  row.innerHTML = `
    <input type="checkbox" data-uid="${escapeHtml(String(meta.uid))}" />
    <span class="wiog-entry-title">${escapeHtml(title)}</span>
    ${showGroupBadge ? badge : ""}
  `;
  return row;
}

function ensureModalRoot() {
  const mountHost = document.querySelector(SELECTORS.worldPopup) || document.body;
  let root = document.getElementById(CSS.modalId);
  if (root) {
    if (root.parentElement !== mountHost) {
      mountHost.appendChild(root);
    }
    return root;
  }
  root = document.createElement("div");
  root.id = CSS.modalId;
  root.className = "wiog-modal-root";
  markInjected(root);
  mountHost.appendChild(root);
  return root;
}

function closeModal() {
  const root = document.getElementById(CSS.modalId);
  if (root) root.innerHTML = "";
}

function applyListFilter(list, query) {
  const q = String(query || "").trim().toLowerCase();
  const rows = Array.from(list.querySelectorAll(".wiog-entry-row"));
  for (const row of rows) {
    const title = row.getAttribute("data-title") || "";
    const group = row.getAttribute("data-group") || "";
    const visible = !q || title.includes(q) || group.includes(q);
    row.style.display = visible ? "" : "none";
  }
}

function massSelect(list, mode) {
  const boxes = Array.from(list.querySelectorAll('.wiog-entry-row input[type="checkbox"]'));
  for (const box of boxes) {
    const row = box.closest(".wiog-entry-row");
    if (row && row instanceof HTMLElement && row.style.display === "none") continue;
    if (mode === "all") box.checked = true;
    if (mode === "none") box.checked = false;
    if (mode === "invert") box.checked = !box.checked;
  }
}

/**
 * @param {{ groupName: string, allMetas: import("./types.js").EntryMeta[], creating?: boolean, groupNames?: string[] }} options
 * @returns {Promise<{ applied: boolean, toAdd: string[], toRemove: string[], switchTo?: string, createRequested?: boolean }>}
 */
export async function openManageModal(options) {
  const root = ensureModalRoot();
  root.innerHTML = "";

  const inGroup = options.allMetas.filter((m) => m.group === options.groupName);
  const others = options.allMetas.filter((m) => m.group !== options.groupName);
  const availableGroupNames = Array.isArray(options.groupNames)
    ? options.groupNames.slice()
    : Array.from(new Set(options.allMetas.map((m) => m.group).filter(Boolean)));
  if (options.groupName && !availableGroupNames.includes(options.groupName)) {
    availableGroupNames.push(options.groupName);
  }

  return await new Promise((resolve) => {
    const modal = document.createElement("div");
    modal.className = "wiog-modal";
    markInjected(modal);
    modal.innerHTML = `
      <div class="wiog-modal-backdrop"></div>
      <div class="wiog-modal-card">
        <div class="wiog-modal-header">
          <div class="wiog-modal-head-left">
            <div class="wiog-modal-title">${options.creating ? "Create Group" : "Group Editor"}</div>
            <div class="wiog-modal-head-controls">
              <label class="wiog-modal-head-label">Group</label>
              <select class="text_pole wiog-group-picker">
                ${availableGroupNames.map((name) => `<option value="${escapeHtml(name)}" ${name === options.groupName ? "selected" : ""}>${escapeHtml(name)}</option>`).join("")}
              </select>
              <button type="button" class="menu_button interactable wiog-group-create-inline"><i class="fa-solid fa-folder-plus"></i><span>New</span></button>
            </div>
          </div>
          <button type="button" class="menu_button interactable wiog-modal-close"><i class="fa-solid fa-xmark"></i></button>
        </div>
        <div class="wiog-modal-body">
          <div class="wiog-modal-section">
            <div class="wiog-modal-section-title">Add / Move entries into this group</div>
            <div class="wiog-modal-tools">
              <input type="search" class="text_pole wiog-modal-search wiog-search-add" placeholder="Search entries..." />
              <div class="wiog-modal-batch">
                <button type="button" class="menu_button interactable wiog-add-all">All</button>
                <button type="button" class="menu_button interactable wiog-add-none">None</button>
                <button type="button" class="menu_button interactable wiog-add-invert">Invert</button>
              </div>
            </div>
            <div class="wiog-modal-list wiog-add-list"></div>
          </div>
          <div class="wiog-modal-section">
            <div class="wiog-modal-section-title">Remove entries from this group</div>
            <div class="wiog-modal-tools">
              <input type="search" class="text_pole wiog-modal-search wiog-search-remove" placeholder="Search entries..." />
              <div class="wiog-modal-batch">
                <button type="button" class="menu_button interactable wiog-remove-all">All</button>
                <button type="button" class="menu_button interactable wiog-remove-none">None</button>
                <button type="button" class="menu_button interactable wiog-remove-invert">Invert</button>
              </div>
            </div>
            <div class="wiog-modal-list wiog-remove-list"></div>
          </div>
        </div>
        <div class="wiog-modal-footer">
          <button type="button" class="menu_button interactable wiog-apply">Apply</button>
          <button type="button" class="menu_button interactable wiog-cancel">Cancel</button>
        </div>
      </div>
    `;

    const addList = /** @type {HTMLElement} */ (modal.querySelector(".wiog-add-list"));
    const removeList = /** @type {HTMLElement} */ (modal.querySelector(".wiog-remove-list"));
    const addSearch = /** @type {HTMLInputElement} */ (modal.querySelector(".wiog-search-add"));
    const removeSearch = /** @type {HTMLInputElement} */ (modal.querySelector(".wiog-search-remove"));
    const groupPicker = /** @type {HTMLSelectElement} */ (modal.querySelector(".wiog-group-picker"));

    for (const meta of others) addList.appendChild(buildEntryCheckboxRow(meta, true));
    for (const meta of inGroup) removeList.appendChild(buildEntryCheckboxRow(meta, false));

    const resolveAndClose = (result) => {
      closeModal();
      resolve(result);
    };

    modal.querySelector(".wiog-modal-close")?.addEventListener("click", () => resolveAndClose({ applied: false, toAdd: [], toRemove: [] }));
    modal.querySelector(".wiog-cancel")?.addEventListener("click", () => resolveAndClose({ applied: false, toAdd: [], toRemove: [] }));
    modal.querySelector(".wiog-modal-backdrop")?.addEventListener("click", () => resolveAndClose({ applied: false, toAdd: [], toRemove: [] }));
    modal.querySelector(".wiog-modal-card")?.addEventListener("click", (e) => e.stopPropagation());
    groupPicker?.addEventListener("change", () => {
      const next = String(groupPicker.value || "").trim();
      if (!next || next === options.groupName) return;
      resolveAndClose({ applied: false, toAdd: [], toRemove: [], switchTo: next });
    });
    modal.querySelector(".wiog-group-create-inline")?.addEventListener("click", () => {
      resolveAndClose({ applied: false, toAdd: [], toRemove: [], createRequested: true });
    });

    addSearch?.addEventListener("input", () => applyListFilter(addList, addSearch.value));
    removeSearch?.addEventListener("input", () => applyListFilter(removeList, removeSearch.value));

    modal.querySelector(".wiog-add-all")?.addEventListener("click", () => massSelect(addList, "all"));
    modal.querySelector(".wiog-add-none")?.addEventListener("click", () => massSelect(addList, "none"));
    modal.querySelector(".wiog-add-invert")?.addEventListener("click", () => massSelect(addList, "invert"));
    modal.querySelector(".wiog-remove-all")?.addEventListener("click", () => massSelect(removeList, "all"));
    modal.querySelector(".wiog-remove-none")?.addEventListener("click", () => massSelect(removeList, "none"));
    modal.querySelector(".wiog-remove-invert")?.addEventListener("click", () => massSelect(removeList, "invert"));

    modal.querySelector(".wiog-apply")?.addEventListener("click", () => {
      const toAdd = Array.from(addList.querySelectorAll('input[type="checkbox"]:checked')).map((el) => String(el.getAttribute("data-uid") || ""));
      const toRemove = Array.from(removeList.querySelectorAll('input[type="checkbox"]:checked')).map((el) => String(el.getAttribute("data-uid") || ""));
      resolveAndClose({ applied: true, toAdd, toRemove });
    });

    root.appendChild(modal);
  });
}

/**
 * @param {Node} node
 * @returns {boolean}
 */
export function isInjectedNode(node) {
  if (!node) return false;

  let el = null;
  if (node instanceof HTMLElement) el = node;
  if (!el && node.parentElement) el = node.parentElement;
  if (!el) return false;

  if (el.getAttribute(CSS.injectedAttr) === "1") return true;
  if (el.id === CSS.modalId) return true;
  if (el.closest(`[${CSS.injectedAttr}="1"]`)) return true;
  return false;
}
