import { useSyncExternalStore } from "react";

type NavigationLike = EventTarget;

function subscribe(onChange: () => void): () => void {
  window.addEventListener("popstate", onChange);
  window.addEventListener("hashchange", onChange);
  const navigation = (window as Window & { navigation?: NavigationLike }).navigation;
  let navigationNotificationPending = false;
  function onCurrentEntryChange() {
    if (navigationNotificationPending) return;
    navigationNotificationPending = true;
    // A history write can fire this event synchronously inside React's insertion effect.
    queueMicrotask(() => {
      if (!navigationNotificationPending) return;
      navigationNotificationPending = false;
      onChange();
    });
  }
  navigation?.addEventListener("currententrychange", onCurrentEntryChange);
  // Without the Navigation API, pushState is not observable; poll as a fallback.
  const timer = navigation ? 0 : window.setInterval(onChange, 500);
  return () => {
    window.removeEventListener("popstate", onChange);
    window.removeEventListener("hashchange", onChange);
    navigationNotificationPending = false;
    navigation?.removeEventListener("currententrychange", onCurrentEntryChange);
    if (timer) window.clearInterval(timer);
  };
}

/** Current pathname and hash. Updates on client-side navigation. */
export function useLocationParts(): { pathname: string; hash: string } {
  const pathname = useSyncExternalStore(subscribe, () => window.location.pathname, () => "/");
  const hash = useSyncExternalStore(subscribe, () => window.location.hash, () => "");
  return { pathname, hash };
}
