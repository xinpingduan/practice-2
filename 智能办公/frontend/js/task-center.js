const byId = (id) => document.getElementById(id);
const escapeTask = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const message = (text, type = "success") => { const box = byId("task-message"); box.textContent = text; box.className = `message ${type}`; };
let employees = [];
let publishRequestId = window.crypto?.randomUUID?.() || `task-${Date.now()}-${Math.random().toString(16).slice(2)}`;

function renderTargetControls() {
  const employeeMode = byId("task-target-type").value === "employee";
  byId("task-department-field").hidden = employeeMode;
  byId("task-employees-field").hidden = !employeeMode;
  byId("task-department").required = !employeeMode;
  byId("task-employees").required = employeeMode;
  updateTargetCount();
}
function updateTargetCount() {
  const count = byId("task-target-type").value === "employee" ? byId("task-employees").querySelectorAll("input:checked").length : (byId("task-department").value ? "该部门全部在职员工" : "请选择目标部门");
  byId("task-target-count").textContent = typeof count === "number" ? `已选择 ${count} 名员工` : count;
}
function renderPublished(tasks) {
  const completed = tasks.filter((task) => task.status === "已完成").length, overdue = tasks.filter((task) => task.display_status === "已逾期").length, pending = tasks.filter((task) => task.status === "待处理").length;
  byId("task-summary").textContent = tasks.length ? `共 ${tasks.length} 人 · 已完成 ${completed} · 待处理 ${pending}${overdue ? ` · 已逾期 ${overdue}` : ""}` : "暂无发布数据";
  byId("published-task-list").innerHTML = tasks.length ? tasks.map((task) => `<article class="request-card task-published-item"><div><span class="request-status">${escapeTask(task.display_status || task.status)}</span><h3>${escapeTask(task.employee_name)} · ${escapeTask(task.title)}</h3><p>${escapeTask(task.content)}</p><small>${escapeTask(task.priority)}${task.due_date ? ` · 截止 ${escapeTask(String(task.due_date).slice(0, 10))}` : ""} · ${escapeTask(task.department)}</small></div></article>`).join("") : '<p class="empty-tip">还没有发布记录。</p>';
}
async function loadPublished() { try { const result = await requestApi("/api/tasks/manual/published"); renderPublished(result.tasks || []); } catch (error) { byId("published-task-list").innerHTML = `<p class="empty-tip">${escapeTask(error.message)}</p>`; } }
async function loadTargets() {
  const user = window.currentUser || await loadCurrentUser();
  const result = await requestApi("/api/tasks/manual/targets");
  byId("task-department").innerHTML = `<option value="">请选择部门</option>${(result.departments || []).map((item) => `<option value="${escapeTask(item.name)}">${escapeTask(item.name)}</option>`).join("")}`;
  employees = result.employees || [];
  byId("task-employees").innerHTML = employees.map((item) => `<label><input type="checkbox" value="${item.id}"><span>${escapeTask(item.name)}<small>${escapeTask(item.employee_no)} · ${escapeTask(item.department)}</small></span></label>`).join("") || '<span class="form-hint">暂无可选择的在职员工。</span>';
  if (user?.role === "department_admin") byId("task-department").value = user.department || "";
  updateTargetCount();
}
byId("task-target-type").addEventListener("change", renderTargetControls);
byId("task-department").addEventListener("change", updateTargetCount);
byId("task-employees").addEventListener("change", updateTargetCount);
byId("refresh-published").addEventListener("click", loadPublished);
byId("manual-task-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const employeeMode = byId("task-target-type").value === "employee";
  const employeeIds = [...byId("task-employees").querySelectorAll("input:checked")].map((item) => Number(item.value));
  const button = byId("publish-task"); button.disabled = true;
  try {
    const result = await requestApi("/api/tasks/manual", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ target_type: employeeMode ? "employee" : "department", department: byId("task-department").value, employee_ids: employeeIds, title: byId("task-title").value.trim(), content: byId("task-content").value.trim(), priority: byId("task-priority").value, due_date: byId("task-due-date").value, idempotency_key: publishRequestId }) });
    message(result.message); event.target.reset(); publishRequestId = window.crypto?.randomUUID?.() || `task-${Date.now()}-${Math.random().toString(16).slice(2)}`; byId("task-target-type").value = "department"; renderTargetControls(); await loadPublished();
  } catch (error) { message(error.message, "error"); } finally { button.disabled = false; }
});
(async () => { try { await loadTargets(); renderTargetControls(); await loadPublished(); } catch (error) { message(error.message, "error"); } })();
