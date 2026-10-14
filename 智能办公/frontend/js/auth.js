(() => {
  const activeScript = document.currentScript;
  if (!activeScript || document.querySelector('script[data-interface-motion]')) return;
  const motionScript = document.createElement("script");
  motionScript.src = new URL("motion.js?v=4", activeScript.src).href;
  motionScript.dataset.interfaceMotion = "true";
  motionScript.addEventListener("load", () => { document.documentElement.dataset.motionAsset = "loaded"; });
  motionScript.addEventListener("error", () => { document.documentElement.dataset.motionAsset = "error"; });
  document.head.append(motionScript);
})();

function getPathPrefix() {
  return window.location.pathname.includes("/pages/") ? "../" : "";
}

function getOfficeAssistantUrl() {
  const host = window.location.hostname === "localhost" ? "localhost" : "127.0.0.1";
  return new URL(`http://${host}:8080/`);
}

async function loadCurrentUser() {
  const response = await fetch("/api/auth/me");
  if (!response.ok) return null;
  const result = await response.json();
  if (result.csrf_token) sessionStorage.setItem("csrf_token", result.csrf_token);
  return result.user;
}

async function logout() {
  const token = sessionStorage.getItem("csrf_token") || "";
  await fetch("/api/auth/logout", { method: "POST", headers: { "X-CSRF-Token": token } });
  sessionStorage.removeItem("csrf_token");
  const destination = `${getPathPrefix()}login.html`;
  if (window.navigateWithMotion) window.navigateWithMotion(destination, { replace: true });
  else window.location.href = destination;
}

function setupOfficeDrawer(user, nav) {
  if (document.getElementById("office-drawer")) return;
  const officeUrl = getOfficeAssistantUrl();
  officeUrl.searchParams.set("office_user", user.name || user.employee_no || "当前用户");
  officeUrl.searchParams.set("office_employee_id", String(user.id));
  officeUrl.searchParams.set("office_role", user.role || "employee");
  officeUrl.searchParams.set("office_department", user.department || "");
  const drawer = document.createElement("div");
  drawer.id = "office-drawer";
  drawer.className = "office-drawer";
  drawer.hidden = true;
  drawer.innerHTML = `<button class="office-drawer-backdrop" type="button" aria-label="关闭智能办公"></button><aside class="office-drawer-panel" role="dialog" aria-modal="true" aria-labelledby="office-drawer-title"><header class="office-drawer-header"><div><span class="office-drawer-kicker">当前工作区</span><h2 id="office-drawer-title">智能办公</h2></div><button class="office-drawer-close" type="button" aria-label="关闭智能办公">×</button></header><iframe class="office-drawer-frame" title="智能办公" loading="lazy"></iframe></aside>`;
  document.body.append(drawer);
  const frame = drawer.querySelector(".office-drawer-frame");
  const closeButton = drawer.querySelector(".office-drawer-close");
  const close = () => {
    drawer.classList.remove("is-open");
    document.body.classList.remove("office-drawer-open");
    window.setTimeout(() => { drawer.hidden = true; }, 220);
  };
  const open = async (event) => {
    event.preventDefault();
    drawer.hidden = false;
    frame.src = "about:blank";
    requestAnimationFrame(() => drawer.classList.add("is-open"));
    document.body.classList.add("office-drawer-open");
    window.setTimeout(() => closeButton.focus(), 50);
    try {
      const response = await fetch("/api/agent/session-token", { credentials: "same-origin" });
      if (!response.ok) throw new Error("身份凭证申请失败");
      const result = await response.json();
      const authenticatedUrl = new URL(officeUrl.href);
      authenticatedUrl.searchParams.set("office_token", result.token);
      authenticatedUrl.searchParams.set("office_role", result.user?.role || user.role || "employee");
      authenticatedUrl.searchParams.set("office_department", result.user?.department || user.department || "");
      frame.src = authenticatedUrl.href;
    } catch (error) {
      frame.srcdoc = `<p style="font:16px system-ui;padding:24px;color:#b42318">无法建立智能办公身份，请刷新页面后重试。</p>`;
      console.error(error);
    }
  };
  nav.querySelectorAll(".office-assistant-link").forEach((link) => link.addEventListener("click", open));
  closeButton.addEventListener("click", close);
  drawer.querySelector(".office-drawer-backdrop").addEventListener("click", close);
  document.addEventListener("keydown", (event) => { if (event.key === "Escape" && !drawer.hidden) close(); });
}

function setNavigation(user) {
  const prefix = getPathPrefix();
  const nav = document.querySelector(".nav-links");
  if (!nav) return;
    const officeUrl = getOfficeAssistantUrl();
  officeUrl.searchParams.set("office_user", user.name || user.employee_no || "当前用户");
  officeUrl.searchParams.set("office_employee_id", String(user.id));
  officeUrl.searchParams.set("office_role", user.role || "employee");
  officeUrl.searchParams.set("office_department", user.department || "");
  const officeHref = officeUrl.href;
  const notificationLink = `<a class="nav-notification-link" href="${prefix}pages/notifications.html" aria-label="消息"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"></path></svg><span>消息</span><b id="nav-unread-badge" class="nav-unread-badge" hidden>0</b></a>`;
  if (user.role === "super_admin") {
    nav.innerHTML = `<a href="${prefix}pages/admin-todos.html">审批中心</a><a href="${prefix}pages/task-center.html">待办中心</a><a href="${prefix}pages/schedule.html">周期规则审批</a><a href="${prefix}pages/audit-logs.html">操作审计</a><a class="office-assistant-link" href="${officeHref}">智能办公</a><a href="${prefix}pages/profile.html">个人中心</a>${notificationLink}<button class="nav-logout" type="button">退出登录</button>`;
  } else if (user.role === "hr_admin") {
    nav.innerHTML = `<a href="${prefix}index.html">员工登记</a><a href="${prefix}pages/onboarding.html">入职申请</a><a href="${prefix}pages/queue.html">入职办理</a><a href="${prefix}pages/schedule.html">班表审核发布</a><a href="${prefix}pages/task-center.html">待办中心</a><a href="${prefix}pages/admin-schedule-requests.html">特殊申请</a><a href="${prefix}pages/records.html">员工档案</a><a class="office-assistant-link" href="${officeHref}">智能办公</a><a href="${prefix}pages/profile.html">个人中心</a>${notificationLink}<button class="nav-logout" type="button">退出登录</button>`;
  } else if (user.role === "department_admin") {
    nav.innerHTML = `<a href="${prefix}pages/profile.html">个人中心</a>${notificationLink}<a href="${prefix}pages/schedule.html">本部门排班</a><a href="${prefix}pages/my-schedule.html">我的班次</a><a href="${prefix}pages/department-requests.html">员工申请</a><a href="${prefix}pages/task-center.html">待办中心</a><a href="${prefix}pages/my-todos.html">我的待办</a><a class="office-assistant-link" href="${officeHref}">智能办公</a><button class="nav-logout" type="button">退出登录</button>`;
  } else {
    nav.innerHTML = `<a href="${prefix}pages/profile.html">个人中心</a>${notificationLink}<a href="${prefix}pages/my-schedule.html">我的班次</a><a href="${prefix}pages/my-todos.html">我的待办</a><a href="${prefix}pages/my-todos.html#offboarding">离职申请</a><a class="office-assistant-link" href="${officeHref}">智能办公</a><button class="nav-logout" type="button">退出登录</button>`;
  }
  nav.querySelector(".nav-logout").addEventListener("click", logout);
  const currentFile = window.location.pathname.split("/").pop() || "index.html";
  nav.querySelectorAll("a").forEach((item) => {
    const target = new URL(item.getAttribute("href"), window.location.href).pathname.split("/").pop();
    const isCurrent = target === currentFile;
    item.classList.toggle("active", isCurrent);
    if (isCurrent) item.setAttribute("aria-current", "page");
    else item.removeAttribute("aria-current");
  });
  setupResponsiveNavigation(nav);
  setupOfficeDrawer(user, nav);
}

function setupResponsiveNavigation(nav) {
  const header = nav.closest(".hero");
  const container = nav.parentElement;
  if (!header || !container || container.querySelector(".nav-menu-toggle")) return;
  if (!nav.id) nav.id = "primary-navigation";
  const toggle = document.createElement("button");
  toggle.className = "nav-menu-toggle";
  toggle.type = "button";
  toggle.setAttribute("aria-controls", nav.id);
  toggle.setAttribute("aria-expanded", "false");
  toggle.innerHTML = '<span aria-hidden="true">☰</span><span>菜单</span>';
  container.insertBefore(toggle, nav);

  const setOpen = (open, returnFocus = false) => {
    nav.dataset.open = String(open);
    toggle.setAttribute("aria-expanded", String(open));
    if (returnFocus) toggle.focus();
  };
  toggle.addEventListener("click", () => setOpen(nav.dataset.open !== "true"));
  nav.addEventListener("click", (event) => {
    if (event.target.closest("a")) setOpen(false);
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && nav.dataset.open === "true") setOpen(false, true);
  });
  document.addEventListener("pointerdown", (event) => {
    if (nav.dataset.open === "true" && !header.contains(event.target)) setOpen(false);
  });
  window.addEventListener("resize", () => {
    if (window.innerWidth > 760) setOpen(false);
  });
}

async function refreshNotificationBadge() {
  const link = document.querySelector(".nav-notification-link");
  const badge = document.getElementById("nav-unread-badge");
  if (!link || !badge) return;
  try {
    const response = await fetch("/api/notifications/unread-count");
    if (!response.ok) return;
    const result = await response.json();
    const count = Math.max(Number(result.unread_count) || 0, 0);
    badge.textContent = count > 99 ? "99+" : String(count);
    badge.hidden = count === 0;
    link.setAttribute("aria-label", count ? `消息，${count} 条未读` : "消息，无未读消息");
    link.title = count ? `${count} 条未读消息` : "暂无未读消息";
  } catch (_) {
    /* 导航消息数属于增强信息，接口短暂失败不阻断主页面。 */
  }
}

function setupNotificationRefresh() {
  if (window.notificationRefreshTimer) return;
  window.refreshNotificationBadge = refreshNotificationBadge;
  window.notificationRefreshTimer = window.setInterval(() => {
    if (!document.hidden) refreshNotificationBadge();
  }, 60000);
  window.addEventListener("focus", refreshNotificationBadge);
}

function applyBrandAssets() {
  const assetUrl = new URL(`${getPathPrefix()}assets/brand-mark.svg`, window.location.href).href;
  let favicon = document.querySelector("link[rel~='icon']");
  if (!favicon) {
    favicon = document.createElement("link");
    favicon.rel = "icon";
    favicon.type = "image/svg+xml";
    document.head.append(favicon);
  }
  favicon.href = assetUrl;
  document.querySelectorAll(".brand").forEach((brand) => {
    brand.replaceChildren(Object.assign(document.createElement("img"), { className: "brand-mark", src: assetUrl, alt: "EM" }));
  });
}

function addSkipLink() {
  const main = document.querySelector("main");
  if (!main || document.querySelector(".skip-link")) return;
  if (!main.id) main.id = "main-content";
  const link = document.createElement("a");
  link.className = "skip-link";
  link.href = `#${main.id}`;
  link.textContent = "跳到主要内容";
  document.body.prepend(link);
}

function setupAssistant(user) {
  if (document.getElementById("assistant-toggle")) return;
  if (!document.querySelector("link[data-assistant-fixes]")) {
    const assistantStyles = document.createElement("link");
    assistantStyles.rel = "stylesheet";
    assistantStyles.href = `${getPathPrefix()}css/assistant-fixes.css?v=1`;
    assistantStyles.dataset.assistantFixes = "true";
    document.head.append(assistantStyles);
  }
  const shell = document.createElement("section");
  shell.className = "assistant-shell";
  shell.innerHTML = `
    <button id="assistant-toggle" class="assistant-toggle" type="button" aria-controls="assistant-panel" aria-expanded="false">
      <span class="assistant-grip" aria-hidden="true">⠿</span><img class="assistant-spark" src="${getPathPrefix()}assets/brand-mark.svg" alt=""><span>智能助手</span>
    </button>
    <aside id="assistant-panel" class="assistant-panel" role="dialog" aria-modal="false" aria-labelledby="assistant-title" aria-hidden="true">
      <header class="assistant-header" data-assistant-drag-handle><div><p>EM INSIGHT</p><h2 id="assistant-title">智能运营助手</h2><span>已授权的业务信息与会话上下文</span></div><div class="assistant-header-actions"><button id="assistant-conversations" class="assistant-settings-toggle icon-button" type="button" aria-controls="assistant-conversations-dialog" aria-expanded="false" title="管理会话" aria-label="管理会话"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h10"></path></svg></button><button id="assistant-settings" class="assistant-settings-toggle icon-button" type="button" aria-controls="assistant-settings-dialog" aria-expanded="false" title="助手设置" aria-label="助手设置"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6 7 7M17 17l1.4 1.4M18.4 5.6 17 7M7 17l-1.4 1.4"></path><circle cx="12" cy="12" r="3.5"></circle></svg></button><button id="assistant-reset" class="assistant-new" type="button" title="恢复默认位置和窗口大小">归位</button><button id="assistant-new" class="assistant-new" type="button" title="开始新对话">新对话</button><button id="assistant-close" class="assistant-close" type="button" aria-label="关闭助手">×</button></div></header>
      <div id="assistant-messages" class="assistant-messages" aria-live="polite"></div>
      <form id="assistant-form" class="assistant-form" novalidate><label class="sr-only" for="assistant-question">向智能助手提问</label><textarea id="assistant-question" maxlength="1000" placeholder="请输入你的问题"></textarea><p id="assistant-compose-message" class="assistant-compose-message" aria-live="polite"></p><div class="assistant-compose-actions"><button id="assistant-submit" type="submit">发送</button></div></form>
      <dialog id="assistant-settings-dialog" class="assistant-settings-dialog" aria-labelledby="assistant-settings-title"><form method="dialog"><header><div><p>AI ASSISTANT</p><h3 id="assistant-settings-title">助手设置</h3></div><button id="assistant-settings-close" class="icon-button" type="submit" aria-label="关闭设置">×</button></header><div class="assistant-settings-content"><label class="assistant-format-option"><span>回答格式</span><select id="assistant-output-format" aria-label="返回格式"><option value="normal">正常回答</option><option value="json">JSON</option><option value="list">列表</option><option value="xml">XML</option></select></label><label class="assistant-memory-option"><span>会话记忆</span><select id="assistant-memory-type" aria-label="会话记忆策略"><option value="buffer">完整记忆</option><option value="window">窗口记忆</option><option value="token">Token 记忆</option><option value="summary">摘要记忆</option></select></label><div id="assistant-memory-settings" class="assistant-memory-settings" aria-label="记忆参数"><label class="memory-number memory-window-setting"><span>保留最近</span><input id="assistant-window-messages" type="number" min="1" max="40" value="8" inputmode="numeric"><small>条消息</small></label><label class="memory-number memory-token-setting"><span>Token 上限</span><input id="assistant-token-limit" type="number" min="256" max="16000" step="256" value="4000" inputmode="numeric"></label><label class="memory-number memory-summary-setting"><span>摘要长度</span><input id="assistant-summary-length" type="number" min="500" max="6000" step="100" value="3000" inputmode="numeric"><small>字</small></label></div><section id="assistant-summary-editor" class="assistant-summary-editor" hidden><div><span>当前摘要</span><small id="assistant-summary-count">0 / 6000</small></div><textarea id="assistant-summary-text" maxlength="6000" placeholder="当前会话还没有可编辑的摘要。"></textarea><div class="assistant-summary-actions"><button id="assistant-summary-save" type="button">保存摘要</button><button id="assistant-summary-clear" type="button" class="secondary-button">清空</button></div></section><label class="assistant-stream-option" title="开启后逐段显示回答"><input id="assistant-stream" type="checkbox" checked><span class="assistant-stream-switch" aria-hidden="true"></span><span>流式显示回答</span></label></div></form></dialog><dialog id="assistant-conversations-dialog" class="assistant-settings-dialog assistant-conversations-dialog" aria-labelledby="assistant-conversations-title"><header><div><p>AI ASSISTANT</p><h3 id="assistant-conversations-title">会话管理</h3></div><button id="assistant-conversations-close" class="icon-button" type="button" aria-label="关闭会话管理">×</button></header><div class="assistant-conversation-content"><div id="assistant-conversation-list" class="assistant-conversation-list" aria-live="polite"></div><div class="assistant-conversation-actions"><label><span>会话名称</span><input id="assistant-conversation-title" maxlength="80" placeholder="选择一个会话"></label><div><button id="assistant-conversation-rename" type="button">保存名称</button><button id="assistant-conversation-delete" type="button" class="secondary-button">删除会话</button></div></div></div></dialog>
    </aside>`;
  document.body.append(shell);
  const panel = document.getElementById("assistant-panel");
  const toggle = document.getElementById("assistant-toggle");
  const messages = document.getElementById("assistant-messages");
  const input = document.getElementById("assistant-question");
  const submit = document.getElementById("assistant-submit");
  const composeMessage = document.getElementById("assistant-compose-message");
  const settingsButton = document.getElementById("assistant-settings");
  const settingsDialog = document.getElementById("assistant-settings-dialog");
  const conversationsButton = document.getElementById("assistant-conversations");
  const conversationsDialog = document.getElementById("assistant-conversations-dialog");
  const newConversationButton = document.getElementById("assistant-new");
  const streamOption = document.getElementById("assistant-stream");
  const formatOption = document.getElementById("assistant-output-format");
  const memoryOption = document.getElementById("assistant-memory-type");
  const memorySettings = document.getElementById("assistant-memory-settings");
  const windowMessagesInput = document.getElementById("assistant-window-messages");
  const tokenLimitInput = document.getElementById("assistant-token-limit");
  const summaryLengthInput = document.getElementById("assistant-summary-length");
  const summaryEditor = document.getElementById("assistant-summary-editor");
  const summaryText = document.getElementById("assistant-summary-text");
  const summaryCount = document.getElementById("assistant-summary-count");
  const assistantHeader = shell.querySelector("[data-assistant-drag-handle]");
  const positionStorageKey = `assistant_position_${user.id}`;
  const sizeStorageKey = `assistant_size_${user.id}`;
  let dragState = null;
  let suppressToggleClick = false;
  let hasCustomPosition = false;

  toggle.title = "拖动可调整位置，双击恢复默认位置";
  assistantHeader.title = "拖动可调整助手位置，双击恢复默认位置";

  const suggestionButtons = [];
  const databaseQueryAllowed = ["department_admin", "hr_admin", "super_admin"].includes(user.role);

  const saveAssistantPosition = (x, y) => {
    try { localStorage.setItem(positionStorageKey, JSON.stringify({ x: Math.round(x), y: Math.round(y) })); } catch (_) {}
  };

  const setAssistantPosition = (x, y, persist = false) => {
    const toggleRect = toggle.getBoundingClientRect();
    const safeX = Math.min(Math.max(12, x), Math.max(12, window.innerWidth - toggleRect.width - 12));
    const safeY = Math.min(Math.max(12, y), Math.max(12, window.innerHeight - toggleRect.height - 12));
    shell.style.left = `${safeX}px`;
    shell.style.top = `${safeY}px`;
    shell.style.right = "auto";
    shell.style.bottom = "auto";
    hasCustomPosition = true;
    if (persist) saveAssistantPosition(safeX, safeY);
  };

  const resetAssistantPosition = () => {
    shell.style.removeProperty("left");
    shell.style.removeProperty("top");
    shell.style.removeProperty("right");
    shell.style.removeProperty("bottom");
    hasCustomPosition = false;
    try { localStorage.removeItem(positionStorageKey); } catch (_) {}
    panel.style.removeProperty("width");
    panel.style.removeProperty("height");
    try { localStorage.removeItem(sizeStorageKey); } catch (_) {}
  };

  const restoreAssistantPosition = () => {
    try {
      const saved = JSON.parse(localStorage.getItem(positionStorageKey) || "null");
      if (Number.isFinite(saved?.x) && Number.isFinite(saved?.y)) setAssistantPosition(saved.x, saved.y);
    } catch (_) { /* 损坏的位置数据直接忽略。 */ }
    try {
      const saved = JSON.parse(localStorage.getItem(sizeStorageKey) || "null");
      if (Number.isFinite(saved?.width) && Number.isFinite(saved?.height)) {
        panel.style.width = `${saved.width}px`;
        panel.style.height = `${saved.height}px`;
      }
    } catch (_) { /* 损坏的尺寸数据直接忽略。 */ }
  };
  if (window.ResizeObserver) {
    const resizeObserver = new window.ResizeObserver(() => {
      const rect = panel.getBoundingClientRect();
      if (rect.width && rect.height) {
        try { localStorage.setItem(sizeStorageKey, JSON.stringify({ width: Math.round(rect.width), height: Math.round(rect.height) })); } catch (_) {}
      }
    });
    resizeObserver.observe(panel);
  }

  const beginAssistantDrag = (event, source) => {
    if (event.button !== 0 || event.target.closest("button:not(#assistant-toggle), input, textarea, select, a")) return;
    const rect = toggle.getBoundingClientRect();
    shell.style.removeProperty("transform");
    dragState = {
      pointerId: event.pointerId,
      source,
      startX: event.clientX,
      startY: event.clientY,
      originX: rect.left,
      originY: rect.top,
      toggleWidth: rect.width,
      toggleHeight: rect.height,
      moved: false,
    };
    source.setPointerCapture?.(event.pointerId);
  };

  const moveAssistant = (event) => {
    if (!dragState || event.pointerId !== dragState.pointerId) return;
    const deltaX = event.clientX - dragState.startX;
    const deltaY = event.clientY - dragState.startY;
    if (!dragState.moved && Math.hypot(deltaX, deltaY) < 5) return;
    dragState.moved = true;
    shell.classList.add("assistant-dragging");
    event.preventDefault();
    dragState.nextX = Math.min(Math.max(12, dragState.originX + deltaX), Math.max(12, window.innerWidth - dragState.toggleWidth - 12));
    dragState.nextY = Math.min(Math.max(12, dragState.originY + deltaY), Math.max(12, window.innerHeight - dragState.toggleHeight - 12));
    shell.style.transform = `translate3d(${dragState.nextX - dragState.originX}px, ${dragState.nextY - dragState.originY}px, 0)`;
  };

  const endAssistantDrag = (event) => {
    if (!dragState || event.pointerId !== dragState.pointerId) return;
    shell.style.removeProperty("transform");
    if (dragState.moved) {
      setAssistantPosition(dragState.nextX, dragState.nextY, true);
      suppressToggleClick = dragState.source === toggle;
    }
    shell.classList.remove("assistant-dragging");
    dragState = null;
  };

  toggle.addEventListener("pointerdown", (event) => beginAssistantDrag(event, toggle));
  assistantHeader.addEventListener("pointerdown", (event) => beginAssistantDrag(event, assistantHeader));
  document.addEventListener("pointermove", moveAssistant, { passive: false });
  document.addEventListener("pointerup", endAssistantDrag);
  document.addEventListener("pointercancel", endAssistantDrag);
  toggle.addEventListener("dblclick", resetAssistantPosition);
  assistantHeader.addEventListener("dblclick", (event) => { if (!event.target.closest("button")) resetAssistantPosition(); });
  window.addEventListener("resize", () => {
    if (!hasCustomPosition) return;
    const rect = toggle.getBoundingClientRect();
    setAssistantPosition(rect.left, rect.top, true);
  });
  restoreAssistantPosition();
  panel.inert = true;
  try { streamOption.checked = localStorage.getItem("assistant_stream_enabled") !== "false"; } catch (_) { /* Privacy mode: keep the default enabled. */ }
  formatOption.value = "normal";
  try { localStorage.removeItem("assistant_output_format"); } catch (_) { /* 隐私模式无需清理旧偏好。 */ }
  streamOption.addEventListener("change", () => { try { localStorage.setItem("assistant_stream_enabled", String(streamOption.checked)); } catch (_) {} });
  const formatHints = { normal: "自然中文回答", json: "适合程序处理", list: "适合逐项阅读", xml: "适合系统集成" };
  formatOption.title = formatHints.normal;
  formatOption.addEventListener("change", () => { formatOption.title = formatHints[formatOption.value]; });
  const formatLabels = { normal: "正常回答", json: "JSON", list: "列表", xml: "XML" };
  const conversationStorageKey = `assistant_conversation_id_${user.id}`;
  const memoryStorageKey = `assistant_memory_type_${user.id}`;
  const memoryOptionsStorageKey = `assistant_memory_options_${user.id}`;
  const memoryOptionInputs = [windowMessagesInput, tokenLimitInput, summaryLengthInput];
  const clampMemoryValue = (input) => {
    const min = Number(input.min), max = Number(input.max);
    const value = Number(input.value);
    input.value = String(Number.isFinite(value) ? Math.min(max, Math.max(min, Math.round(value))) : Number(input.defaultValue));
  };
  const memoryOptions = () => ({
    window_messages: Number(windowMessagesInput.value),
    token_limit: Number(tokenLimitInput.value),
    summary_max_characters: Number(summaryLengthInput.value),
  });
  const updateMemorySettings = () => {
    const type = memoryOption.value;
    memorySettings.hidden = type === "buffer";
    summaryEditor.hidden = type !== "summary";
    memorySettings.classList.toggle("is-window", type === "window");
    memorySettings.classList.toggle("is-token", type === "token");
    memorySettings.classList.toggle("is-summary", type === "summary");
  };
  let conversationId = null;
  try {
    const savedConversationId = localStorage.getItem(conversationStorageKey);
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(savedConversationId || "")) {
      conversationId = savedConversationId;
    }
  } catch (_) { /* 隐私模式下仅保留本页会话。 */ }
  try {
    const savedMemoryType = localStorage.getItem(memoryStorageKey);
    if (["buffer", "window", "token", "summary"].includes(savedMemoryType)) memoryOption.value = savedMemoryType;
    const savedMemoryOptions = JSON.parse(localStorage.getItem(memoryOptionsStorageKey) || "null");
    if (savedMemoryOptions && typeof savedMemoryOptions === "object") {
      if (Number.isFinite(savedMemoryOptions.window_messages)) windowMessagesInput.value = String(savedMemoryOptions.window_messages);
      if (Number.isFinite(savedMemoryOptions.token_limit)) tokenLimitInput.value = String(savedMemoryOptions.token_limit);
      if (Number.isFinite(savedMemoryOptions.summary_max_characters)) summaryLengthInput.value = String(savedMemoryOptions.summary_max_characters);
    }
  } catch (_) { /* Privacy mode: keep the server default. */ }
  memoryOptionInputs.forEach(clampMemoryValue);
  updateMemorySettings();
  memoryOption.addEventListener("change", () => {
    try { localStorage.setItem(memoryStorageKey, memoryOption.value); } catch (_) {}
    updateMemorySettings();
    refreshSummaryEditor();
  });
  memoryOptionInputs.forEach((input) => input.addEventListener("change", () => {
    clampMemoryValue(input);
    try { localStorage.setItem(memoryOptionsStorageKey, JSON.stringify(memoryOptions())); } catch (_) {}
  }));

  const rememberConversation = (value) => {
    if (!value || typeof value !== "string") return;
    conversationId = value;
    try { localStorage.setItem(conversationStorageKey, value); } catch (_) {}
  };
  const forgetConversation = () => {
    conversationId = null;
    try { localStorage.removeItem(conversationStorageKey); } catch (_) {}
  };

  const syncSummaryCount = () => {
    summaryCount.textContent = `${summaryText.value.length} / 6000`;
  };

  const refreshSummaryEditor = async () => {
    if (memoryOption.value !== "summary") return;
    if (!conversationId) {
      summaryText.value = "";
      summaryText.disabled = true;
      syncSummaryCount();
      return;
    }
    summaryText.disabled = true;
    try {
      const result = await requestApi(`/api/assistant/conversations/${encodeURIComponent(conversationId)}`);
      if (conversationId === result.conversation_id) summaryText.value = result.memory_summary || "";
    } catch (_) {
      summaryText.value = "";
    } finally {
      summaryText.disabled = false;
      syncSummaryCount();
    }
  };

  const renderConversationList = (conversations) => {
    const list = document.getElementById("assistant-conversation-list");
    list.replaceChildren();
    if (!conversations.length) {
      const empty = document.createElement("p");
      empty.className = "assistant-conversation-empty";
      empty.textContent = "还没有已保存的会话。";
      list.append(empty);
      return;
    }
    const labels = { buffer: "完整记忆", window: "窗口记忆", token: "Token 记忆", summary: "摘要记忆" };
    conversations.forEach((conversation) => {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "assistant-conversation-item";
      item.classList.toggle("is-active", conversation.conversation_id === conversationId);
      const title = document.createElement("strong");
      title.textContent = conversation.title;
      const meta = document.createElement("span");
      const updated = new Date(conversation.updated_at).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
      meta.textContent = `${labels[conversation.memory_type] || "完整记忆"} · ${updated}`;
      item.append(title, meta);
      item.addEventListener("click", () => {
        conversationId = conversation.conversation_id;
        rememberConversation(conversationId);
        conversationsDialog.close();
        restoreConversation();
      });
      list.append(item);
    });
  };

  const loadConversationList = async () => {
    const list = document.getElementById("assistant-conversation-list");
    list.textContent = "正在加载会话...";
    const result = await requestApi("/api/assistant/conversations");
    const conversations = Array.isArray(result.conversations) ? result.conversations : [];
    renderConversationList(conversations);
    const current = conversations.find((item) => item.conversation_id === conversationId);
    document.getElementById("assistant-conversation-title").value = current?.title || "";
  };

  const setOpen = (open) => {
    const wasOpen = panel.classList.contains("is-open");
    shell.classList.toggle("assistant-is-open", open);
    panel.classList.toggle("is-open", open);
    panel.setAttribute("aria-hidden", String(!open));
    toggle.setAttribute("aria-expanded", String(open));
    panel.inert = !open;
    if (open) input.focus();
    else if (wasOpen) toggle.focus();
  };
  const appendMessage = (role, content) => {
    const article = document.createElement("article");
    article.className = `assistant-message assistant-message--${role}`;
    const label = document.createElement("strong");
    label.textContent = role === "user" ? "你" : "EM 助手";
    const paragraph = document.createElement("p");
    paragraph.textContent = content;
    article.append(label, paragraph);
    messages.append(article);
    messages.scrollTop = messages.scrollHeight;
    return article;
  };
  const appendDatabaseResult = (result) => {
    const article = appendMessage("bot", result.row_count
      ? `已返回 ${result.row_count} 条记录（最多 ${result.limit} 条）。`
      : "查询完成，未找到符合条件的记录。");
    article.classList.add("assistant-message--database-result");
    article.querySelector("strong").textContent = `业务数据库 · ${result.scope}`;
    const metadata = document.createElement("small");
    metadata.className = "assistant-query-meta";
    metadata.textContent = `表：${(result.tables || []).join("、") || "—"} · 只读查询`;
    article.append(metadata);
    if (Array.isArray(result.rows) && result.rows.length && Array.isArray(result.columns) && result.columns.length) {
      const wrapper = document.createElement("div");
      wrapper.className = "assistant-query-table-wrap";
      const table = document.createElement("table");
      const head = document.createElement("thead");
      const headRow = document.createElement("tr");
      result.columns.forEach((column) => {
        const cell = document.createElement("th");
        cell.textContent = column;
        headRow.append(cell);
      });
      head.append(headRow);
      const body = document.createElement("tbody");
      result.rows.forEach((row) => {
        const rowElement = document.createElement("tr");
        result.columns.forEach((column) => {
          const cell = document.createElement("td");
          const value = row?.[column];
          cell.textContent = value === null || value === undefined ? "—" : String(value);
          rowElement.append(cell);
        });
        body.append(rowElement);
      });
      table.append(head, body);
      wrapper.append(table);
      article.append(wrapper);
    }
    messages.scrollTop = messages.scrollHeight;
    return article;
  };
  const renderWelcome = () => {
    messages.replaceChildren();
    const welcome = appendMessage("bot", "我可以帮你梳理待办、已发布班次与当前流程。涉及修改或审批时，我会说明应前往的页面。");
    welcome.querySelector("strong").textContent = `你好，${user.name}`;
  };
  const applyStructuredResult = (article, result) => {
    const resultFormat = ["normal", "json", "list", "xml"].includes(result?.output_format)
      ? result.output_format
      : formatOption.value;
    article.classList.remove("assistant-message--pending");
    article.classList.add("assistant-message--structured", `assistant-message--format-${resultFormat}`);
    article.querySelector("strong").textContent = `EM 助手 · ${formatLabels[resultFormat]}`;
    article.querySelector("p").textContent = typeof result?.answer === "string" ? result.answer : "结构化响应为空";
    if (["buffer", "window", "token", "summary"].includes(result?.memory_type)) {
      memoryOption.value = result.memory_type;
      updateMemorySettings();
    }
    if (result?.memory_options && typeof result.memory_options === "object") {
      if (Number.isFinite(result.memory_options.window_messages)) windowMessagesInput.value = String(result.memory_options.window_messages);
      if (Number.isFinite(result.memory_options.token_limit)) tokenLimitInput.value = String(result.memory_options.token_limit);
      if (Number.isFinite(result.memory_options.summary_max_characters)) summaryLengthInput.value = String(result.memory_options.summary_max_characters);
      try { localStorage.setItem(memoryOptionsStorageKey, JSON.stringify(memoryOptions())); } catch (_) {}
    }
    rememberConversation(result?.conversation_id);
  };
  const requestAssistantStream = async (payload, onDelta, onStructured) => {
    const csrfToken = await getCsrfToken();
    const response = await fetch("/api/assistant/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": csrfToken },
      body: JSON.stringify({ ...payload, stream: true }),
    });
    if (!response.ok || !response.body) {
      const result = await response.json().catch(() => null);
      throw new Error(result?.message || `AI 服务请求失败（HTTP ${response.status}）`);
    }
    const reader = response.body.getReader(), decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value || new Uint8Array(), { stream: !done }).replace(/\r/g, "");
      const events = buffer.split("\n\n"); buffer = events.pop();
      for (const event of events) {
        const type = event.match(/^event:\s*(.+)$/m)?.[1];
        const data = event.match(/^data:\s*(.+)$/m)?.[1];
        if (!data) continue;
        const parsed = JSON.parse(data);
        if (type === "delta") onDelta(parsed.text || "");
        if (type === "structured") onStructured(parsed);
        if (type === "error") throw new Error(parsed.message || "AI 流式响应中断");
      }
      if (done) break;
    }
  };
  const ask = async (question) => {
    question = question.trim();
    if (submit.disabled) return;
    if (!question) {
      composeMessage.textContent = "请输入问题后再发送。";
      input.focus();
      return;
    }
    composeMessage.textContent = "";
    // 员工资料、离职、交接、请假和审批由服务端按当前登录会话授权处理；前端不持有角色范围或审批规则。
    try {
      const operation = await requestApi("/api/assistant/operations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question,
          conversation_id: conversationId,
          memory_type: memoryOption.value,
          memory_options: memoryOptions(),
        }),
      });
      if (operation.handled) {
        if (operation.conversation_id) rememberConversation(operation.conversation_id);
        appendMessage("user", question);
        input.value = "";
        const reply = appendMessage("bot", operation.answer || "操作完成。");
        reply.querySelector("strong").textContent = "EM 助手 · 授权业务操作";
        if (operation.confirm_text) {
          const actions = document.createElement("div");
          actions.className = "assistant-operation-actions";
          const confirm = document.createElement("button");
          confirm.type = "button";
          confirm.textContent = operation.confirm_text;
          confirm.addEventListener("click", () => ask(operation.confirm_text));
          const cancel = document.createElement("button");
          cancel.type = "button";
          cancel.className = "secondary-button";
          cancel.textContent = "取消";
          cancel.addEventListener("click", () => ask("取消"));
          actions.append(confirm, cancel);
          reply.append(actions);
        }
        if (Array.isArray(operation.actions) && operation.actions.length) {
          const actions = document.createElement("div");
          actions.className = "assistant-operation-actions";
          operation.actions.slice(0, 6).forEach((action) => {
            if (!action || typeof action.message !== "string") return;
            const button = document.createElement("button");
            button.type = "button";
            button.className = "secondary-button";
            button.textContent = action.label || action.message;
            button.addEventListener("click", () => ask(action.message));
            actions.append(button);
          });
          if (actions.childElementCount) reply.append(actions);
        }
        messages.scrollTop = messages.scrollHeight;
        return;
      }
    } catch (error) {
      // 未命中业务操作或服务短暂不可用时，继续使用原有助手问答链路。
    }
    // “我的/自己/个人班次”属于当前用户的授权上下文，必须交给助手读取当前用户的班次，
    // 不能被部门管理员的通用数据库查询入口抢先识别成排班计划查询。
    const looksLikePersonalScheduleQuestion = /(?:我的|自己|个人|本人)/.test(question)
      && /(?:排班|班次|班表)/.test(question);
    const looksLikeDataQuestion = !looksLikePersonalScheduleQuestion
      && /(?:查询|查看|列出|统计|有哪些|多少)/.test(question)
      && /(?:员工|用户|人员|同事|花名册|档案|资料|信息|入职|待办理|排班|班次|班表|部门|表|\bid\b)/i.test(question);
    if (databaseQueryAllowed && looksLikeDataQuestion) {
      appendMessage("user", question).querySelector("strong").textContent = "你 · 业务查询";
      input.value = "";
      submit.disabled = true;
      newConversationButton.disabled = true;
      streamOption.disabled = true;
      formatOption.disabled = true;
      suggestionButtons.forEach((button) => { button.disabled = true; });
      const pending = appendMessage("bot", "正在识别业务查询并读取授权数据…");
      pending.classList.add("assistant-message--pending");
      try {
        const result = await requestApi("/api/assistant/data-query", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ question }),
        });
        if (result.handled) {
          pending.remove();
          appendDatabaseResult(result);
          return;
        }
        pending.remove();
      } catch (error) {
        pending.classList.remove("assistant-message--pending");
        pending.querySelector("strong").textContent = "业务数据库";
        pending.querySelector("p").textContent = error.message || "查询失败，请检查查询范围。";
        return;
      } finally {
        submit.disabled = false;
        newConversationButton.disabled = false;
        streamOption.disabled = false;
        formatOption.disabled = false;
        suggestionButtons.forEach((button) => { button.disabled = false; });
      }
    }
    appendMessage("user", question);
    input.value = "";
    submit.disabled = true;
    newConversationButton.disabled = true;
    streamOption.disabled = true;
    formatOption.disabled = true;
    suggestionButtons.forEach((button) => { button.disabled = true; });
    panel.setAttribute("aria-busy", "true");
    submit.textContent = "思考中…";
    const pending = appendMessage("bot", "正在根据你的授权数据整理建议…");
    pending.classList.add("assistant-message--pending");
    const payload = { question, conversation_id: conversationId, page: document.querySelector(".hero h1")?.textContent?.trim() || "工作台", output_format: formatOption.value, memory_type: memoryOption.value, memory_options: memoryOptions() };
    let streamedAnswer = "", hasStreamedText = false, hasStructuredResult = false;
    const pendingText = pending.querySelector("p");
    try {
      if (streamOption.checked) {
        await requestAssistantStream(payload, (text) => {
          if (!hasStreamedText) { pending.classList.remove("assistant-message--pending"); pendingText.textContent = ""; hasStreamedText = true; }
          streamedAnswer += text; pendingText.textContent = streamedAnswer; messages.scrollTop = messages.scrollHeight;
        }, (result) => {
          hasStructuredResult = true;
          streamedAnswer = result.answer || "";
          applyStructuredResult(pending, result);
          messages.scrollTop = messages.scrollHeight;
        });
        if (!hasStructuredResult || !streamedAnswer.trim()) throw new Error("AI 返回内容未通过结构解析");
      } else {
        const result = await requestApi("/api/assistant/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
        applyStructuredResult(pending, result);
      }
    } catch (error) {
      if (/对话.*(?:失效|无效)/.test(error?.message || "")) {
        forgetConversation();
        payload.conversation_id = null;
      }
      try {
        const result = await requestApi("/api/assistant/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
        applyStructuredResult(pending, result);
      } catch (fallbackError) {
        if (hasStreamedText) {
          pending.classList.remove("assistant-message--pending");
          pendingText.textContent = `${streamedAnswer}\n\n[结构解析未完成，请重新提问或切换返回格式]`;
        } else {
          pending.remove(); appendMessage("bot", fallbackError.message || error.message || "暂时无法生成建议，请稍后再试。");
        }
      }
    } finally {
      submit.textContent = "发送";
      submit.disabled = false;
      newConversationButton.disabled = false;
      streamOption.disabled = false;
      formatOption.disabled = false;
      suggestionButtons.forEach((button) => { button.disabled = false; });
      panel.removeAttribute("aria-busy");
      updateAssistantMode();
    }
  };
  toggle.addEventListener("click", (event) => {
    if (suppressToggleClick) {
      suppressToggleClick = false;
      event.preventDefault();
      return;
    }
    setOpen(!panel.classList.contains("is-open"));
  });
  document.getElementById("assistant-close").addEventListener("click", () => setOpen(false));
  document.getElementById("assistant-settings-close").addEventListener("click", () => {
    settingsDialog.close();
  });
  settingsButton.addEventListener("click", () => {
    if (!settingsDialog.open) settingsDialog.showModal();
    settingsButton.setAttribute("aria-expanded", "true");
    refreshSummaryEditor();
  });
  settingsDialog.addEventListener("close", () => settingsButton.setAttribute("aria-expanded", "false"));
  settingsDialog.addEventListener("click", (event) => {
    if (event.target === settingsDialog) settingsDialog.close();
  });
  summaryText.addEventListener("input", syncSummaryCount);
  document.getElementById("assistant-summary-save").addEventListener("click", async () => {
    if (!conversationId || summaryText.disabled) return;
    summaryText.disabled = true;
    try {
      const result = await requestApi(`/api/assistant/conversations/${encodeURIComponent(conversationId)}`, {
        method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ memory_summary: summaryText.value }),
      });
      summaryText.value = result.memory_summary || "";
      syncSummaryCount();
    } catch (error) {
      window.alert(error.message || "摘要保存失败");
    } finally {
      summaryText.disabled = false;
    }
  });
  document.getElementById("assistant-summary-clear").addEventListener("click", () => {
    if (summaryText.disabled) return;
    summaryText.value = "";
    syncSummaryCount();
  });
  document.getElementById("assistant-conversations-close").addEventListener("click", () => conversationsDialog.close());
  conversationsButton.addEventListener("click", async () => {
    conversationsButton.setAttribute("aria-expanded", "true");
    conversationsDialog.showModal();
    try {
      await loadConversationList();
    } catch (error) {
      document.getElementById("assistant-conversation-list").textContent = error.message || "会话加载失败";
    }
  });
  conversationsDialog.addEventListener("close", () => conversationsButton.setAttribute("aria-expanded", "false"));
  conversationsDialog.addEventListener("click", (event) => { if (event.target === conversationsDialog) conversationsDialog.close(); });
  document.getElementById("assistant-conversation-rename").addEventListener("click", async () => {
    if (!conversationId) return;
    const title = document.getElementById("assistant-conversation-title").value.trim();
    if (!title) return;
    try {
      await requestApi(`/api/assistant/conversations/${encodeURIComponent(conversationId)}`, {
        method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title }),
      });
      await loadConversationList();
    } catch (error) {
      window.alert(error.message || "会话名称保存失败");
    }
  });
  document.getElementById("assistant-conversation-delete").addEventListener("click", async () => {
    if (!conversationId || !window.confirm("删除后无法恢复这个会话及其摘要，确认删除吗？")) return;
    try {
      await requestApi(`/api/assistant/conversations/${encodeURIComponent(conversationId)}`, { method: "DELETE" });
      forgetConversation();
      conversationsDialog.close();
      renderWelcome();
    } catch (error) {
      window.alert(error.message || "删除会话失败");
    }
  });
  document.getElementById("assistant-reset").addEventListener("click", () => {
    resetAssistantPosition();
    input.focus();
  });
  panel.addEventListener("keydown", (event) => {
    if (event.key === "Escape") setOpen(false);
  });
  newConversationButton.addEventListener("click", () => {
    if (submit.disabled) return;
    forgetConversation();
    formatOption.value = "normal";
    formatOption.title = formatHints.normal;
    renderWelcome();
    input.focus();
  });
  document.getElementById("assistant-form").addEventListener("submit", (event) => { event.preventDefault(); ask(input.value); });
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      ask(input.value);
    }
  });
  const restoreConversation = async () => {
    if (!conversationId) { renderWelcome(); return; }
    const restoringConversationId = conversationId;
    try {
      const result = await requestApi(`/api/assistant/conversations/${encodeURIComponent(conversationId)}`);
      if (conversationId !== restoringConversationId || submit.disabled) return;
      if (!Array.isArray(result.messages) || !result.messages.length) { renderWelcome(); return; }
      messages.replaceChildren();
      result.messages.forEach((message) => {
        const article = appendMessage(message.role === "user" ? "user" : "bot", message.content || "");
        if (message.role === "assistant") {
          applyStructuredResult(article, { answer: message.content, output_format: message.output_format });
        }
      });
    } catch (_) {
      if (conversationId !== restoringConversationId || submit.disabled) return;
      forgetConversation();
      renderWelcome();
    }
  };
  renderWelcome();
  restoreConversation();
}

async function guardPage() {
  addSkipLink();
  const user = await loadCurrentUser();
  const prefix = getPathPrefix();
  if (!user) {
    const destination = `${prefix}login.html`;
    if (window.navigateWithMotion) window.navigateWithMotion(destination, { replace: true });
    else window.location.replace(destination);
    return;
  }
  window.currentUser = user;
  applyBrandAssets();
  setNavigation(user);
  refreshNotificationBadge();
  setupNotificationRefresh();
  const access = document.body.dataset.access || (document.body.dataset.page === "profile" ? "logged-in" : document.body.dataset.page === "manager" ? "hr" : "super-admin");
  const allowed = access === "logged-in" || (access === "department-admin" && user.role === "department_admin") || (access === "schedule-owner" && ["department_admin", "hr_admin", "super_admin"].includes(user.role)) || (access === "task-publisher" && ["department_admin", "hr_admin", "super_admin"].includes(user.role)) || (access === "hr" && user.role === "hr_admin") || (access === "super-admin" && user.role === "super_admin");
  if (!allowed) {
    document.querySelector("main").innerHTML = `<section class="card permission-card"><div class="heading-icon">!</div><h2>无权限访问</h2><p>当前账户为“${user.role_name}”，该工作台已按岗位职责限制访问。</p><a class="permission-link" href="${prefix}pages/profile.html"><span aria-hidden="true">←</span> 返回个人中心</a></section>`;
  }
  if (allowed) setupAssistant(user);
  document.body.classList.remove("access-pending");
}

guardPage();
