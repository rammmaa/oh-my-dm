// Keep this as a top-level, self-contained browser callback. Functions created
// inside it can be rewritten by tsx/esbuild to call a module-scoped __name
// helper, which does not exist in the browser context.
export function observeDomChanges(): void {
  const key = "__ohMyDmObserverInstalled";
  const browserWindow = window as typeof window & Record<string, unknown>;
  if (browserWindow[key]) return;
  browserWindow[key] = true;

  let timer: ReturnType<typeof setTimeout> | undefined;
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      if (!document.body) return;
      new MutationObserver(() => {
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => {
          const callback = browserWindow.__ohMyDmWake;
          if (typeof callback === "function") void callback();
        }, 120);
      }).observe(document.body, {
        subtree: true,
        childList: true,
        characterData: true,
        attributes: true,
        attributeFilter: ["aria-label", "aria-live", "href"],
      });
    }, { once: true });
  } else if (document.body) {
    new MutationObserver(() => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        const callback = browserWindow.__ohMyDmWake;
        if (typeof callback === "function") void callback();
      }, 120);
    }).observe(document.body, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: ["aria-label", "aria-live", "href"],
    });
  }
}
