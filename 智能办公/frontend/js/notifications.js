const byId = (id) => document.getElementById(id);
let notifications = [];
let activeFilter = "all";
let unreadCount = 0;

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[character]));
}

function showMessage(text, type = "success") {
  const box = byId("message");
  box.textContent = text;
  box.className = `message toast-message ${type}`;
}

function safeTarget(targetUrl) {
  try {
    const target = new URL(targetUrl, window.location.origin);
    if (target.origin === window.location.origin && target.pathname.startsWith("/pages/")) {
      return `${target.pathname}${target.search}${target.hash}`;
    }
  } catch (_) {
    /* 无效业务地址统一回到个人中心。 */
  }
  return "/pages/profile.html";
}

function formatTime(value) {
  const time = new Date(value);
  if (Number.isNaN(time.getTime())) return "时间未知";
  const seconds = Math.round((Date.now() - time.getTime()) / 1000);
  if (seconds >= 0 && seconds < 60) return "刚刚";
  if (seconds >= 60 && seconds < 3600) return `${Math.floor(seconds / 60)} 分钟前`;
  if (seconds >= 3600 && seconds < 86400) return `${Math.floor(seconds / 3600)} 小时前`;
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
  }).format(time);
}

function notificationMeta(type) {
  if (type === "schedule_published") return ["calendar", "班表通知", '<path d="M7 3v3M17 3v3M4 9h16M5 5h14a1 1 0 0 1 1 1v14H4V6a1 1 0 0 1 1-1Z"></path><path d="m9 15 2 2 4-5"></path>'];
  if (type === "schedule_withdrawn" || type === "schedule_returned") return ["warning", "班表变更", '<path d="M12 3 2.8 20h18.4L12 3Z"></path><path d="M12 9v5M12 17.5v.5"></path>'];
  if (type === "schedule_review" || type === "cycle_policy_review") return ["review", "待审批", '<path d="M8 4h8M9 2h6v4H9zM6 4H4v17h16V4h-2"></path><path d="m8 14 2 2 5-6"></path>'];
  if (type === "schedule_request" || type === "schedule_request_result") return ["request", "申请进度", '<path d="M7 4h10a2 2 0 0 1 2 2v12H9l-4 3V6a2 2 0 0 1 2-2Z"></path><path d="M9 9h6M9 13h4"></path>'];
  return ["system", "系统消息", '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"></path>'];
}

function renderNotifications() {
  const visible = activeFilter === "unread"
    ? notifications.filter((item) => !item.is_read)
    : notifications;
  byId("notification-count").textContent = unreadCount ? `${unreadCount} 条未读` : "已全部读完";
  byId("read-all-notifications").disabled = unreadCount === 0;
  if (!visible.length) {
    byId("notification-list").innerHTML = `<div class="notification-empty"><span aria-hidden="true">✓</span><strong>${activeFilter === "unread" ? "没有未读消息" : "暂时没有消息"}</strong><p>${activeFilter === "unread" ? "所有提醒都已经处理完了。" : "班表发布和申请进度会显示在这里。"}</p></div>`;
    return;
  }
  byId("notification-list").innerHTML = visible.map((item) => {
    const [tone, typeLabel, icon] = notificationMeta(item.notification_type);
    const target = safeTarget(item.target_url);
    return `<article class="notification-item ${item.is_read ? "" : "unread"}" data-notification-id="${item.notification_id}">
      <span class="notification-icon ${tone}" aria-hidden="true"><svg viewBox="0 0 24 24">${icon}</svg></span>
      <a class="notification-main" href="${escapeHtml(target)}" data-open-notification="${item.notification_id}">
        <header><span class="notification-type">${typeLabel}</span><time datetime="${escapeHtml(item.created_at)}">${escapeHtml(formatTime(item.created_at))}</time></header>
        <h3>${escapeHtml(item.title)}${item.is_read ? "" : '<i class="notification-unread-dot" aria-label="未读"></i>'}</h3>
        <p>${escapeHtml(item.content)}</p><small>查看相关内容 <b aria-hidden="true">→</b></small>
      </a>
      ${item.is_read ? "" : `<button class="notification-read-button secondary-button" type="button" data-read-notification="${item.notification_id}">标为已读</button>`}
    </article>`;
  }).join("");
}

async function loadNotifications({ announce = false } = {}) {
  const refreshButton = byId("refresh-notifications");
  refreshButton.disabled = true;
  refreshButton.textContent = "刷新中…";
  try {
    const result = await requestApi("/api/notifications?limit=100");
    notifications = result.notifications;
    unreadCount = Number(result.unread_count) || 0;
    renderNotifications();
    window.refreshNotificationBadge?.();
    if (announce) showMessage("消息已刷新");
  } catch (error) {
    byId("notification-list").innerHTML = '<div class="notification-empty error"><span aria-hidden="true">!</span><strong>消息加载失败</strong><p>请检查网络后重新刷新。</p></div>';
    showMessage(error.message, "error");
  } finally {
    refreshButton.disabled = false;
    refreshButton.textContent = "刷新";
  }
}

async function markRead(notificationId) {
  const item = notifications.find((notification) => String(notification.notification_id) === String(notificationId));
  if (!item || item.is_read) return;
  await requestApi(`/api/notifications/${notificationId}/read`, { method: "POST" });
  item.is_read = true;
  unreadCount = Math.max(0, unreadCount - 1);
  renderNotifications();
  window.refreshNotificationBadge?.();
}

byId("notification-list").addEventListener("click", async (event) => {
  const readButton = event.target.closest("[data-read-notification]");
  if (readButton) {
    readButton.disabled = true;
    try {
      await markRead(readButton.dataset.readNotification);
    } catch (error) {
      readButton.disabled = false;
      showMessage(error.message, "error");
    }
    return;
  }
  const openLink = event.target.closest("[data-open-notification]");
  if (!openLink) return;
  event.preventDefault();
  const target = safeTarget(openLink.getAttribute("href"));
  try {
    await markRead(openLink.dataset.openNotification);
  } catch (_) {
    /* 已读状态失败不阻止用户进入业务页面。 */
  }
  window.location.href = target;
});

document.querySelector(".notification-filter").addEventListener("click", (event) => {
  const button = event.target.closest("[data-filter]");
  if (!button) return;
  activeFilter = button.dataset.filter;
  document.querySelectorAll("[data-filter]").forEach((item) => {
    const active = item === button;
    item.classList.toggle("active", active);
    item.setAttribute("aria-pressed", String(active));
  });
  renderNotifications();
});

byId("read-all-notifications").addEventListener("click", async () => {
  const button = byId("read-all-notifications");
  button.disabled = true;
  button.textContent = "处理中…";
  try {
    const result = await requestApi("/api/notifications/read-all", { method: "POST" });
    notifications.forEach((item) => { item.is_read = true; });
    unreadCount = 0;
    renderNotifications();
    window.refreshNotificationBadge?.();
    showMessage(result.message);
  } catch (error) {
    showMessage(error.message, "error");
  } finally {
    button.textContent = "全部已读";
    button.disabled = unreadCount === 0;
  }
});

byId("refresh-notifications").addEventListener("click", () => loadNotifications({ announce: true }));
loadNotifications();
