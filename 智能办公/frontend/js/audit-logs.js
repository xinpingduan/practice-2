const byId = (id) => document.getElementById(id);
const escapeHtml = (value) => String(value ?? "").replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]);
let page = 1;
let total = 0;
const pageSize = 30;

function formatTime(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value ?? "—") : date.toLocaleString("zh-CN", { hour12: false });
}

function formatDetails(value) {
  if (!value) return "—";
  if (typeof value === "string") {
    try { return JSON.stringify(JSON.parse(value)); } catch (_) { return value; }
  }
  try { return JSON.stringify(value); } catch (_) { return String(value); }
}

async function load() {
  const query = new URLSearchParams({ page: String(page), page_size: String(pageSize) });
  const actor = byId("actor-employee-no").value.trim();
  const action = byId("action").value.trim();
  if (actor) query.set("actor_employee_no", actor);
  if (action) query.set("action", action);
  try {
    const result = await requestApi(`/api/audit-logs?${query}`);
    total = result.total;
    byId("audit-list").innerHTML = result.logs.map((item) => `<tr><td>${escapeHtml(formatTime(item.created_at))}</td><td>${escapeHtml(item.actor_employee_no)}</td><td>${escapeHtml(item.action)}</td><td>${escapeHtml(item.http_method)}</td><td>${escapeHtml(item.request_path)}</td><td>${escapeHtml(item.status_code)}</td><td>${escapeHtml(item.client_ip || "—")}</td><td>${escapeHtml(formatDetails(item.details))}</td></tr>`).join("") || '<tr><td colspan="8" class="empty-tip">暂无符合条件的审计记录。</td></tr>';
    const pages = Math.max(1, Math.ceil(total / pageSize));
    byId("page-summary").textContent = `第 ${page} / ${pages} 页，共 ${total} 条`;
    byId("previous-page").disabled = page <= 1;
    byId("next-page").disabled = page >= pages;
  } catch (error) {
    byId("message").textContent = error.message;
    byId("message").className = "message error";
  }
}

byId("filter-form").addEventListener("submit", (event) => { event.preventDefault(); page = 1; load(); });
byId("refresh-button").addEventListener("click", load);
byId("previous-page").addEventListener("click", () => { page -= 1; load(); });
byId("next-page").addEventListener("click", () => { page += 1; load(); });
load();
