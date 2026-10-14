(() => {
  if (window.__interfaceMotionReady) return;
  window.__interfaceMotionReady = true;
  document.documentElement.classList.add("interface-motion-ready");

  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

  function createEnvironment3D() {
    if (!document.body || document.querySelector(".environment-3d")) return;
    const environment = document.createElement("div");
    environment.className = "environment-3d";
    environment.setAttribute("aria-hidden", "true");

    [
      "environment-floor",
      "environment-plane environment-plane--one",
      "environment-plane environment-plane--two",
      "environment-plane environment-plane--three",
      "environment-plane environment-plane--four",
    ].forEach((className) => {
      const layer = document.createElement("span");
      layer.className = className;
      environment.append(layer);
    });

    document.body.prepend(environment);
  }

  createEnvironment3D();
  const entrySelector = [
    ".request-card", ".task-card", ".action-item", ".notification-item",
    ".issue-item", ".shift-list-item", ".calendar-day:not(.blank)",
    ".profile-grid > div", ".workspace-metrics > article", ".metric-link",
    ".draft-item", ".version-item", ".cycle-summary-grid > article",
    ".empty-state", ".notification-empty", ".workflow-feedback",
    ".assistant-message", "tbody > tr",
  ].join(",");

  const duration = (value) => reduceMotion.matches ? 0 : value;

  function animateEntries(elements) {
    if (reduceMotion.matches) return;
    [...new Set(elements)]
      .filter((element) => element instanceof HTMLElement && element.isConnected && !element.closest("[hidden]"))
      .slice(0, 36)
      .forEach((element, index) => {
        element.animate([
          { opacity: 0, transform: "translateY(8px)" },
          { opacity: 1, transform: "translateY(0)" },
        ], {
          duration: duration(240),
          delay: Math.min(index * 18, 108),
          easing: "cubic-bezier(.2,.8,.2,1)",
        });
      });
  }

  function findEntries(node) {
    if (!(node instanceof Element)) return [];
    const entries = [];
    if (node.matches(entrySelector)) entries.push(node);
    entries.push(...node.querySelectorAll(entrySelector));
    return entries;
  }

  function reveal(element) {
    if (!(element instanceof HTMLElement) || element.hidden || reduceMotion.matches) return;
    element.animate([
      { opacity: 0, transform: "translateY(8px)" },
      { opacity: 1, transform: "translateY(0)" },
    ], { duration: duration(240), easing: "cubic-bezier(.2,.8,.2,1)" });
  }

  const observer = new MutationObserver((mutations) => {
    const entries = [];
    for (const mutation of mutations) {
      if (mutation.type === "childList") {
        mutation.addedNodes.forEach((node) => entries.push(...findEntries(node)));
      }
      if (mutation.type === "attributes" && mutation.attributeName === "hidden" && !mutation.target.hidden) {
        reveal(mutation.target);
        entries.push(...findEntries(mutation.target));
      }
      if (mutation.type === "attributes" && mutation.attributeName === "open" && mutation.target.matches("dialog[open], details[open]")) {
        reveal(mutation.target);
      }
    }
    if (entries.length) requestAnimationFrame(() => animateEntries(entries));
  });

  observer.observe(document.documentElement, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ["hidden", "open"],
  });

  function addRipple(target, event) {
    if (reduceMotion.matches || target.querySelector(":scope > .motion-ripple")) return;
    const rect = target.getBoundingClientRect();
    const size = Math.max(rect.width, rect.height) * 1.7;
    const ripple = document.createElement("span");
    ripple.className = "motion-ripple";
    ripple.style.width = ripple.style.height = `${size}px`;
    ripple.style.left = `${event.clientX - rect.left - size / 2}px`;
    ripple.style.top = `${event.clientY - rect.top - size / 2}px`;
    target.append(ripple);
    ripple.addEventListener("animationend", () => ripple.remove(), { once: true });
  }

  document.addEventListener("pointerdown", (event) => {
    const target = event.target.closest("button, .permission-link, .table-button");
    if (target && !target.matches(":disabled")) addRipple(target, event);
  });

  document.addEventListener("change", (event) => {
    const surface = event.target.closest("label, .schedule-cell, .notification-filter, .compact-form") || event.target;
    if (!(surface instanceof HTMLElement) || reduceMotion.matches) return;
    surface.animate([
      { transform: "scale(1)" },
      { transform: "scale(1.004)", offset: .42 },
      { transform: "scale(1)" },
    ], { duration: duration(200), easing: "ease-out" });
  });

  window.navigateWithMotion = (url, options = {}) => {
    if (!url) return;
    const navigate = () => options.replace ? window.location.replace(url) : window.location.assign(url);
    if (reduceMotion.matches || document.startViewTransition) {
      navigate();
      return;
    }
    document.documentElement.classList.add("motion-page-leaving");
    window.setTimeout(navigate, 220);
  };

  document.addEventListener("click", (event) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const anchor = event.target.closest("a[href]");
    if (!anchor || anchor.target || anchor.hasAttribute("download")) return;
    const destination = new URL(anchor.href, window.location.href);
    if (destination.origin !== window.location.origin) return;
    if (destination.pathname === window.location.pathname && destination.search === window.location.search && destination.hash) return;
    if (reduceMotion.matches || document.startViewTransition) return;
    event.preventDefault();
    window.navigateWithMotion(destination.href);
  });

  window.addEventListener("pageshow", () => {
    document.documentElement.classList.remove("motion-page-leaving");
    requestAnimationFrame(() => document.documentElement.classList.add("motion-ready"));
  });

  animateEntries(document.querySelectorAll(entrySelector));
})();
