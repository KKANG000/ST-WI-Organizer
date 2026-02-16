export const MODULE_NAME = "st_wi_organizer";

export const SELECTORS = {
  wiPanel: "#WorldInfo",
  worldPopup: "#world_popup",
  list: "#world_popup_entries_list",
  topControlsRow: "#world_popup .flex-container.alignitemscenter",
  newEntryBtn: "#world_popup_new",
  sortSelect: "#world_info_sort_order",
  search: "#world_info_search",
  editorSelect: "#world_editor_select",
  pagination: "#world_info_pagination",
  refreshBtn: "#world_refresh",
};

export const CSS = {
  injectedAttr: "data-wiog-injected",
  groupBlockClass: "wiog-group-block",
  headerClass: "wiog-group-header",
  headerCollapsed: "wiog-collapsed",
  headerDisabled: "wiog-disabled",
  injectTopBtnId: "wiog-create-group-top",
  injectToolbarBtnId: "wiog-create-group-toolbar",
  modalId: "wiog-modal-root",
  commentProxyClass: "wiog-comment-proxy",
  commentSourceClass: "wiog-comment-source",
};

export const OBSERVER_OPTIONS = { childList: true, subtree: true };
export const REBUILD_DEBOUNCE_MS = 50;

export const REBUILD_REASONS = Object.freeze({
  OBSERVER: "observer",
  SORT: "sort",
  SEARCH: "search",
  EDITOR_CHANGE: "editor-change",
  PAGINATION: "pagination",
  GROUP_MOVE: "group-move",
  GROUP_TOGGLE: "group-toggle",
  GROUP_COLLAPSE: "group-collapse",
  GROUP_RENAME: "group-rename",
  MANAGE_APPLY: "manage-apply",
  REFRESH: "refresh",
  INIT: "init",
});
