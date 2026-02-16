import { eventSource } from "../../../../../../script.js";

function resolveHelper() {
  const g = /** @type {any} */ (globalThis);
  return g?.TavernHelper || g?.tavernHelper || g?.tavern_helper || null;
}

export function getTavernHelper() {
  return resolveHelper();
}

export function getTavernHelperInfo() {
  const helper = resolveHelper();
  if (!helper) {
    return {
      available: false,
      version: null,
      hasEventOn: false,
      hasEventMakeLast: false,
    };
  }
  return {
    available: true,
    version: helper?.version || helper?.VERSION || null,
    hasEventOn: typeof helper?.eventOn === "function",
    hasEventMakeLast: typeof helper?.eventMakeLast === "function",
  };
}

export function registerEventListener(eventName, handler) {
  const helper = resolveHelper();
  if (helper && typeof helper.eventOn === "function") {
    const off = helper.eventOn(eventName, handler);
    return () => {
      if (typeof off === "function") {
        try {
          off();
        } catch {
          // no-op
        }
      }
    };
  }

  eventSource.on(eventName, handler);
  return () => {
    try {
      if (typeof eventSource.removeListener === "function") {
        eventSource.removeListener(eventName, handler);
      } else if (typeof eventSource.off === "function") {
        eventSource.off(eventName, handler);
      }
    } catch {
      // no-op
    }
  };
}

export function makeEventListenerLast(eventName, handler) {
  const helper = resolveHelper();
  if (!helper || typeof helper.eventMakeLast !== "function") return false;

  try {
    helper.eventMakeLast(eventName, handler);
    return true;
  } catch {
    try {
      helper.eventMakeLast(eventName);
      return true;
    } catch {
      return false;
    }
  }
}
