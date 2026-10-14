const byId = (id) => document.getElementById(id);
const escapeHtml = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const weekdays = ["日", "一", "二", "三", "四", "五", "六"];
let shifts = [], calendar = new Map(), rule = { max_consecutive_days: 6, min_rest_hours: 10 };
let board = { department: "", start: "", end: "", plan: null, employees: [], assignments: new Map(), leaveDays: new Set(), dirty: false, selectedKey: "" };
let savingBoard = false;
let boardLoadRequestId = 0;
let pendingImportAssignments = [];
let messageDismissTimer = 0, messageCleanupTimer = 0, messageSequence = 0;

function message(text, type = "success") {
  const box = byId("message"), sequence = ++messageSequence;
  window.clearTimeout(messageDismissTimer);
  window.clearTimeout(messageCleanupTimer);
  box.hidden = false;
  box.textContent = text;
  box.className = `message toast-message ${type}`;
  box.setAttribute("role", type === "error" ? "alert" : "status");
  window.requestAnimationFrame(() => {
    if (sequence === messageSequence) box.classList.add("is-visible");
  });
  messageDismissTimer = window.setTimeout(() => {
    if (sequence !== messageSequence) return;
    box.classList.remove("is-visible");
    messageCleanupTimer = window.setTimeout(() => {
      if (sequence !== messageSequence) return;
      box.hidden = true;
      box.textContent = "";
      box.className = "message toast-message";
      box.removeAttribute("role");
    }, 220);
  }, type === "error" ? 6500 : 3600);
}
function workflowFeedback(title, detail) { byId("workflow-feedback-title").textContent = title; byId("workflow-feedback-detail").textContent = detail; byId("workflow-feedback").hidden = false; }
function localDateString(date) { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`; }
function dates(start, end) { const list = [], current = new Date(`${start}T00:00:00`), last = new Date(`${end}T00:00:00`); while (current <= last) { list.push(localDateString(current)); current.setDate(current.getDate() + 1); } return list; }
function key(id, day) { return `${id}:${day}`; }
function shift(id) { return shifts.find((item) => String(item.shift_id) === String(id)); }
function effectivelyAssigned(assignment) { return board.assignments.has(assignment) && !board.leaveDays.has(assignment); }
function editable() { return !board.plan || ["草稿", "已打回"].includes(board.plan.status); }
function dayMeta(day) { const date = new Date(`${day}T00:00:00`), item = calendar.get(day); return { weekday: weekdays[date.getDay()], rest: Boolean(item && !item.is_workday), note: item?.label || "" }; }
function options(selected = "") { return `<option value="">休</option>${shifts.map((item) => `<option value="${item.shift_id}" ${String(item.shift_id) === String(selected) ? "selected" : ""}>${escapeHtml(item.name)}</option>`).join("")}`; }
function shiftInterval(day, item) { const start = new Date(`${day}T${String(item.start_time).slice(0, 5)}:00`).getTime(), rawEnd = new Date(`${day}T${String(item.end_time).slice(0, 5)}:00`).getTime(); return { start, end: rawEnd <= start ? rawEnd + 86400000 : rawEnd }; }

function issues() {
  const result = [], dayList = board.start ? dates(board.start, board.end) : [], employeeMap = new Map(board.employees.map((e) => [String(e.id), e]));
  const monthlyOvertime = new Map(), staffing = new Map(), employeeShifts = new Map();
  for (const [assignment, shiftId] of board.assignments) {
    if (board.leaveDays.has(assignment)) continue;
    const [id, day] = assignment.split(":"), employee = employeeMap.get(id), item = shift(shiftId), meta = dayMeta(day);
    if (meta.rest) result.push({ key: assignment, title: "休息日仍有排班", detail: `${employee?.name || "员工"} · ${day}${meta.note ? `（${meta.note}）` : ""}；提交时需说明值班、调休或补偿安排。`, forceable: true });
    const overtime = Math.max(Number(item?.duration_hours || 0) - 8, 0);
    if (overtime > Number(rule.max_daily_overtime_hours || 0)) result.push({ key: assignment, title: `${employee?.name || "员工"} 单日加班超限`, detail: `${day} 加班 ${overtime} 小时，超过每日上限 ${rule.max_daily_overtime_hours} 小时。`, forceable: true });
    const monthKey = `${id}:${day.slice(0, 7)}`; monthlyOvertime.set(monthKey, (monthlyOvertime.get(monthKey) || 0) + overtime);
    const position = employee?.position || "未设置岗位", staffKey = `${day}:${position}`; staffing.set(staffKey, (staffing.get(staffKey) || 0) + 1);
    if (item) employeeShifts.set(id, [...(employeeShifts.get(id) || []), { key: assignment, day, item, ...shiftInterval(day, item) }]);
  }
  const minimumRest = Number(rule.min_rest_hours || 0);
  if (minimumRest > 0) for (const [id, assignedShifts] of employeeShifts) { assignedShifts.sort((a, b) => a.start - b.start); for (let index = 1; index < assignedShifts.length; index += 1) { const previous = assignedShifts[index - 1], current = assignedShifts[index], restHours = (current.start - previous.end) / 3600000; if (restHours < minimumRest) result.push({ key: current.key, title: `${employeeMap.get(id)?.name || "员工"} 班间休息不足`, detail: `${previous.day} ${previous.item.name} → ${current.day} ${current.item.name}；${restHours < 0 ? "班次时间重叠" : `仅休息 ${restHours} 小时`}，规则要求至少 ${minimumRest} 小时。`, forceable: false }); } }
  for (const [monthKey, overtime] of monthlyOvertime) { if (overtime > Number(rule.max_monthly_overtime_hours || 0)) { const [id, month] = monthKey.split(":"); result.push({ key: key(id, `${month}-01`), title: `${employeeMap.get(id)?.name || "员工"} 月度加班超限`, detail: `${month} 累计加班 ${overtime} 小时，超过上限 ${rule.max_monthly_overtime_hours} 小时。`, forceable: true }); } }
  if (Number(rule.min_staff_per_position) > 1) for (const [staffKey, total] of staffing) { if (total < Number(rule.min_staff_per_position)) { const [day, position] = staffKey.split(":"); result.push({ key: "", title: `${position} 岗位人数不足`, detail: `${day} 实际在岗 ${total} 人，低于最低 ${rule.min_staff_per_position} 人。`, forceable: true }); } }
  for (const employee of board.employees) { let continuous = 0, continuousStart = ""; for (const day of dayList) { if (effectivelyAssigned(key(employee.id, day))) { continuous += 1; if (continuous === 1) continuousStart = day; } else { continuous = 0; continuousStart = ""; } if (continuous === Number(rule.max_consecutive_days) + 1) result.push({ key: key(employee.id, day), title: `${employee.name} 连续排班 ${continuous} 天`, detail: `${continuousStart} 至 ${day}；请调整班次，或填写业务原因交由人事复核。`, forceable: true }); } }
  return result;
}

function updateScheduleFlow(foundIssues = []) {
  const steps = [...document.querySelectorAll("#schedule-flow [data-flow-step]")];
  if (!steps.length) return;
  const loaded = Boolean(board.department && board.start && board.end);
  const hasAssignments = board.assignments.size > 0;
  const submitted = ["待人事审核", "已发布"].includes(board.plan?.status);
  let activeIndex = 0;
  if (loaded) activeIndex = hasAssignments ? (foundIssues.length ? 2 : 3) : 1;
  if (submitted) activeIndex = 3;
  steps.forEach((step, index) => {
    step.classList.toggle("is-active", index === activeIndex);
    step.classList.toggle("is-complete", index < activeIndex || (submitted && index === activeIndex));
    if (index === activeIndex) step.setAttribute("aria-current", "step");
    else step.removeAttribute("aria-current");
  });
}

function renderStatus() {
  const dayList = board.start ? dates(board.start, board.end) : [], workDays = dayList.filter((day) => !dayMeta(day).rest), total = board.employees.length * workDays.length, assigned = [...board.assignments.keys()].filter((assignment) => effectivelyAssigned(assignment) && workDays.includes(assignment.slice(assignment.indexOf(":") + 1))).length, foundIssues = issues();
  byId("assigned-count").textContent = assigned; byId("unassigned-count").textContent = Math.max(total - assigned, 0); byId("issue-count").textContent = foundIssues.length; byId("coverage-rate").textContent = total ? `${Math.round(assigned / total * 100)}%` : "—";
  byId("issue-list").innerHTML = foundIssues.length ? foundIssues.slice(0, 5).map((item) => `<button class="issue-item" type="button" data-key="${item.key}"><strong>${escapeHtml(item.title)}</strong><span>${escapeHtml(item.detail)}</span></button>`).join("") + (foundIssues.length > 5 ? `<p class="more-issues">另有 ${foundIssues.length - 5} 条提示</p>` : "") : '<p class="empty-tip success-tip">✓ 暂未发现休息、连续工作或覆盖问题</p>';
  const coverage = dayList.map((day) => ({ day, count: board.employees.filter((e) => effectivelyAssigned(key(e.id, day))).length, meta: dayMeta(day) }));
  const attentionDays = coverage.filter((item) => !item.meta.rest && item.count < board.employees.length);
  const missingSlots = attentionDays.reduce((totalMissing, item) => totalMissing + board.employees.length - item.count, 0);
  byId("coverage-list").innerHTML = !board.employees.length ? '<div class="compact-empty"><strong>该部门暂未配置员工</strong><span>完成人员入职分配后即可排班。</span></div>' : !assigned ? '<div class="compact-empty"><strong>当前周期还没有班次</strong><span>选择班次或使用“批量填充”开始排班。</span></div>' : !attentionDays.length ? '<div class="compact-empty success"><strong>当前工作日覆盖正常</strong><span>所有工作日均已安排到位。</span></div>' : `<div class="coverage-summary"><strong>${attentionDays.length} 个工作日未覆盖完整</strong><span>共缺少 ${missingSlots} 个员工班次</span><small>请在班表中补充班次后再提交审核。</small></div>`;
  updateScheduleFlow(foundIssues);
}

function renderActionBar() {
  const loaded = Boolean(board.department), canEdit = editable(), isHr = window.currentUser?.role === "hr_admin", isManager = window.currentUser?.role === "department_admin", isPending = board.plan?.status === "待人事审核"; byId("action-bar").hidden = !loaded;
  document.body.classList.toggle("has-schedule-actions", loaded);
  byId("save-board").disabled = savingBoard || !canEdit || !board.dirty; byId("publish").disabled = savingBoard || (isHr ? (!isPending && board.plan?.status !== "草稿") : !canEdit || !board.employees.length); byId("withdraw").disabled = savingBoard || !isHr || !board.plan || board.plan.status !== "已发布";
  byId("discard-changes").hidden = !board.dirty; byId("discard-changes").disabled = savingBoard || !board.dirty;
  byId("revoke-submission").hidden = !(isManager && isPending); byId("revoke-submission").disabled = savingBoard || !(isManager && isPending);
  byId("return-plan").hidden = !(isHr && isPending); byId("return-plan").disabled = savingBoard || !(isHr && isPending);
  const hasPolicyWarning = issues().some((item) => item.forceable); byId("force-submit").hidden = !(isManager && canEdit && hasPolicyWarning); byId("force-submit").disabled = savingBoard || !(isManager && canEdit && hasPolicyWarning);
  byId("publish").textContent = isHr ? "审核并发布" : "提交人事审核";
  byId("open-versions").hidden = !board.plan; byId("open-versions").disabled = !board.plan;
  byId("open-batch").disabled = !canEdit; byId("open-auto-schedule").disabled = !canEdit; byId("clear-selection").disabled = !canEdit;
  byId("action-title").textContent = board.plan?.status === "已发布" ? "班表已发布" : isPending ? "等待人事审核" : board.plan?.status === "已打回" ? "班表已被打回" : board.dirty ? "有未保存修改" : "草稿已保存";
  byId("action-detail").textContent = board.plan?.status === "已发布" ? "已同步到员工个人日历。" : isPending ? (isManager ? "人事正在审核；尚未处理前可撤销提交。" : "请核对班表后审核发布，或打回部门经理修改。") : board.plan?.status === "已打回" ? `人事意见：${board.plan.hr_note || "请修改后重新提交。"}` : board.dirty ? "请先保存草稿，再提交人事审核。" : isHr ? "选择待审核班表后可审核发布。" : "完成排班后提交人事审核。";
  byId("save-status").textContent = board.plan?.status === "已发布" ? "已发布，当前不可编辑" : board.dirty ? "未保存修改" : board.plan ? "草稿已保存" : "尚未保存";
  byId("plan-badge").textContent = board.plan?.status || "未保存"; byId("plan-badge").className = `status-badge ${board.plan?.status === "已发布" ? "published" : "draft"}`;
}

function renderBoard() {
  const dayList = board.start ? dates(board.start, board.end) : [], canEdit = editable(), isHr = window.currentUser?.role === "hr_admin", isPending = board.plan?.status === "待人事审核";
  const issueMap = new Map();
  issues().forEach((item) => { if (item.key && !issueMap.has(item.key)) issueMap.set(item.key, item); });
  const loaded = Boolean(board.department && board.start && board.end);
  byId("schedule-empty-state").hidden = loaded;
  byId("schedule-workspace").hidden = !loaded;
  byId("schedule-summary").hidden = !loaded;
  byId("board-head").innerHTML = `<tr><th class="sticky-col employee-col">员工</th><th class="sticky-col position-col">岗位</th>${dayList.map((day) => { const meta = dayMeta(day); return `<th class="date-col ${meta.rest ? "rest-day" : ""}" title="${escapeHtml(meta.note)}"><span>周${meta.weekday}</span><small>${day.slice(5)}</small></th>`; }).join("")}</tr>`;
  byId("board-body").innerHTML = board.employees.map((employee) => `<tr><td class="sticky-col employee-col"><strong>${escapeHtml(employee.name)}</strong><small>${escapeHtml(employee.employee_no)}</small></td><td class="sticky-col position-col">${escapeHtml(employee.position || "未设置")}</td>${dayList.map((day) => { const assignment = key(employee.id, day), id = board.assignments.get(assignment) || "", item = shift(id), meta = dayMeta(day), onLeave = board.leaveDays.has(assignment), issue = issueMap.get(assignment); return `<td class="schedule-cell ${meta.rest ? "rest-day" : ""} ${onLeave ? "leave-day" : ""} ${issue ? (issue.forceable ? "cell-warning" : "cell-error") : ""}" data-key="${assignment}" title="${issue ? escapeHtml(issue.title + "：" + issue.detail) : ""}">${onLeave ? `<span class="leave-day-badge">请假</span>` : ""}<select class="board-cell ${item ? "has-shift" : ""}" data-employee-id="${employee.id}" data-work-date="${day}" ${(canEdit && !onLeave) ? "" : "disabled"} title="${onLeave ? `请假已生效；原班次：${escapeHtml(item?.name || "无")}` : ""}" style="--shift-color:${item?.color || "transparent"}">${options(id)}</select></td>`; }).join("")}</tr>`).join("") || `<tr><td colspan="${dayList.length + 2}">该部门暂无员工。请先完成人员入职分配。</td></tr>`;
  byId("shift-legend").innerHTML = shifts.map((item) => `<span><i style="background:${item.color}"></i>${escapeHtml(item.name)} <small>${item.start_time}–${item.end_time}</small></span>`).join("") || "<span>请先在右侧班次库创建班次</span>";
  byId("board-status").textContent = board.plan ? `${board.department} · ${board.start} 至 ${board.end} · ${board.plan.status}${canEdit ? "，可直接选择单元格编辑。" : isHr && isPending ? "，可审核并发布部门经理提交的班表。" : "，班表已锁定。"}` : board.department ? "当前班表尚未保存，安排完成后保存草稿。" : "选择部门和日期范围后加载班表。";
  renderStatus(); renderActionBar();
}

function renderShiftLibrary() { byId("shift-list").innerHTML = shifts.map((item) => `<div class="shift-list-item"><i style="background:${item.color}"></i><span><strong>${escapeHtml(item.name)}</strong><small>${item.start_time}–${item.end_time} · ${item.duration_hours} 小时</small></span></div>`).join("") || '<p class="empty-tip">暂无班次</p>'; byId("batch-shift").innerHTML = options(); }
function renderRulePanel(user) { const restHours = Number(rule.min_rest_hours || 0); byId("rule-rest-summary").textContent = `${Number.isInteger(restHours) ? restHours : restHours.toFixed(1)} 小时`; byId("rule-days-summary").textContent = `${rule.max_consecutive_days} 天`; byId("rule-staff-summary").textContent = `${rule.min_staff_per_position} 人`; const form = byId("schedule-rule-form"), canEditRules = ["hr_admin", "super_admin"].includes(user?.role); form.hidden = !canEditRules; if (!canEditRules) return; byId("rule-min-rest").value = restHours; byId("rule-max-days").value = rule.max_consecutive_days; byId("rule-daily-overtime").value = Number(rule.max_daily_overtime_hours || 0); byId("rule-monthly-overtime").value = Number(rule.max_monthly_overtime_hours || 0); byId("rule-min-staff").value = rule.min_staff_per_position; }
function updateBatchSelectedCount() { const total = byId("batch-employees").querySelectorAll("input").length, selected = byId("batch-employees").querySelectorAll("input:checked").length; byId("batch-selected-count").textContent = `已选 ${selected} / ${total} 人`; }
function renderBatchEmployees() { byId("batch-employees").innerHTML = board.employees.map((employee) => `<label><input type="checkbox" value="${employee.id}"><span>${escapeHtml(employee.name)}</span><small>${escapeHtml(employee.position || "未设置")}</small></label>`).join("") || '<p class="empty-tip">暂无可选择员工</p>'; updateBatchSelectedCount(); }
function setDirty(value = true) { board.dirty = value; renderActionBar(); }
async function loadScheduleTemplates() { const result = await requestApi(`/api/schedule-templates?${new URLSearchParams({ department: board.department })}`); return Array.isArray(result.templates) ? result.templates : []; }
async function renderScheduleTemplates() {
  const list = byId("schedule-template-list");
  try {
    const templates = await loadScheduleTemplates();
    list.innerHTML = templates.length ? templates.map((template) => `<label class="schedule-template-item"><input type="radio" name="schedule-template" value="${template.template_id}"><span><strong>${escapeHtml(template.name)}</strong><small>${escapeHtml(template.department)} · ${template.assignments.length} 条班次 · ${escapeHtml(template.created_at)}</small></span><button type="button" class="text-button" data-delete-template="${template.template_id}">删除</button></label>`).join("") : '<div class="compact-empty"><strong>还没有排班模板</strong><span>先完成一份班表，再从“更多操作”保存。</span></div>';
  } catch (error) { list.innerHTML = `<p class="empty-tip">${escapeHtml(error.message)}</p>`; }
}
function currentTemplateAssignments() { const employeeMap = new Map(board.employees.map((employee) => [String(employee.id), employee.employee_no])); return [...board.assignments.entries()].map(([assignment, shiftId]) => { const [employeeId, workDate] = assignment.split(":"); const shiftInfo = shift(shiftId); const dayIndex = Math.round((new Date(`${workDate}T00:00:00`) - new Date(`${board.start}T00:00:00`)) / 86400000); return { employee_no: employeeMap.get(employeeId), shift_name: shiftInfo?.name, day_index: dayIndex }; }).filter((item) => item.employee_no && item.shift_name && item.day_index >= 0); }
function applyScheduleTemplate(template) {
  const employeeMap = new Map(board.employees.map((employee) => [String(employee.employee_no), employee.id])), shiftMap = new Map(shifts.map((item) => [String(item.name), item.shift_id]));
  let applied = 0, skipped = 0;
  for (const item of template.assignments) {
    const employeeId = employeeMap.get(String(item.employee_no)), shiftId = shiftMap.get(String(item.shift_name)), targetDate = new Date(`${board.start}T00:00:00`); targetDate.setDate(targetDate.getDate() + Number(item.day_index)); const workDate = localDateString(targetDate);
    if (!employeeId || !shiftId || !Number.isInteger(item.day_index) || workDate > board.end || board.leaveDays.has(key(employeeId, workDate))) { skipped += 1; continue; }
    board.assignments.set(key(employeeId, workDate), String(shiftId)); applied += 1;
  }
  if (!applied) return message("模板没有可套用到当前周期的排班记录。", "error");
  setDirty(); renderBoard(); message(`已套用 ${applied} 条模板排班${skipped ? `，跳过 ${skipped} 条不匹配记录` : ""}；请检查后保存。`, "success");
}
function mountAutoScheduleUi() {
  byId("open-batch").insertAdjacentHTML("afterend", '<button id="open-auto-schedule" class="secondary-button" type="button">自动排班</button>');
  document.body.insertAdjacentHTML("beforeend", '<dialog id="auto-schedule-dialog" class="auto-schedule-dialog"><form id="auto-schedule-form"><div class="dialog-heading"><div><p class="eyebrow">AUTO SCHEDULING</p><h2>自动排班沙盘</h2><p class="description">系统会根据当前周期、在职员工和已批准请假生成候选班表；确认前不会修改数据。</p></div><button class="icon-button" type="button" id="close-auto-schedule" aria-label="关闭自动排班" title="关闭">×</button></div><fieldset class="auto-shift-options"><legend>可用班次</legend><div id="auto-shift-list"></div></fieldset><label class="auto-skip-rest"><input id="auto-skip-rest" type="checkbox" checked><span>跳过系统标记的休息日和节假日</span></label><p id="auto-schedule-preview" class="form-hint">请选择至少一个班次。</p><div class="dialog-actions"><button class="secondary-button" type="button" id="cancel-auto-schedule">取消</button><button type="submit" id="generate-auto-schedule">生成预览</button></div></form></dialog>');
}
function renderAutoShiftOptions() { byId("auto-shift-list").innerHTML = shifts.map((item, index) => `<label><input type="checkbox" name="auto-shift" value="${item.shift_id}" ${index < 2 ? "checked" : ""}><i style="background:${item.color}"></i><span>${escapeHtml(item.name)}<small>${item.start_time}–${item.end_time}</small></span></label>`).join("") || '<p class="empty-tip">暂无可用班次</p>'; }
mountAutoScheduleUi();

async function loadBaseData() { const [departments, shiftResult, ruleResult] = await Promise.all([requestApi("/api/departments"), requestApi("/api/shifts"), requestApi("/api/scheduling-rules")]); const user = window.currentUser || await loadCurrentUser(); shifts = shiftResult.shifts; rule = ruleResult.rule; const isManager = user?.role === "department_admin"; const visibleDepartments = isManager ? departments.departments.filter((item) => item.name === user.department) : departments.departments; byId("board-department").innerHTML = `<option value="">请选择部门</option>${visibleDepartments.map((item) => `<option value="${escapeHtml(item.name)}">${escapeHtml(item.name)}</option>`).join("")}`; if (isManager) { byId("board-department").value = user.department; byId("board-department").hidden = true; byId("board-department-static").textContent = user.department; byId("board-department-static").hidden = false; } renderShiftLibrary(); renderAutoShiftOptions(); renderRulePanel(user); }
async function loadReviewQueue() { const user = window.currentUser || await loadCurrentUser(); const queue = byId("hr-review-queue"); if (user?.role !== "hr_admin") return; queue.hidden = false; const list = byId("hr-review-list"); try { const { plans } = await requestApi(`/api/schedule-plans?${new URLSearchParams({ status: "待人事审核" })}`); list.innerHTML = plans.map((plan) => { const needsReschedule = !plan.cycle_id, forced = Boolean(plan.force_submit_reason); return `<article class="request-card ${needsReschedule ? "request-card--attention" : ""}"><div><span class="request-status">${needsReschedule ? "需重新排期" : forced ? "强制提交待复核" : "待人事审核"}</span><h3>${escapeHtml(plan.department)} · ${escapeHtml(plan.name)}</h3><p>${plan.start_date} 至 ${plan.end_date}${needsReschedule ? " · 该旧班表不符合现行周期，不能发布" : ""}</p>${forced ? `<small>强制提交原因：${escapeHtml(plan.force_submit_reason)}</small>` : ""}</div>${needsReschedule ? `<button type="button" class="secondary-button danger-button" data-return-legacy="${plan.plan_id}">打回重排</button>` : `<button type="button" class="review-button" data-review-department="${escapeHtml(plan.department)}" data-review-start="${plan.start_date}" data-review-end="${plan.end_date}">进入审核</button>`}</article>`; }).join("") || '<p class="empty-tip">当前没有待审核班表。</p>'; } catch (error) { list.innerHTML = `<p class="empty-tip">${escapeHtml(error.message)}</p>`; } }
function rememberLoadedBoard() {
  if (!board.department || !board.start) return;
  const url = new URL(window.location.href);
  url.searchParams.set("department", board.department);
  url.searchParams.set("anchor", board.start);
  window.history.replaceState(null, "", `${url.pathname}?${url.searchParams}${url.hash}`);
}
async function loadBoard(event) {
  if (event) event.preventDefault();
  const department = byId("board-department").value, start = byId("board-start").value, end = byId("board-end").value;
  if (!department || !start || !end) { message("请选择部门、开始日期和结束日期。", "error"); return false; }
  if (start > end) { message("开始日期不能晚于结束日期。", "error"); return false; }
  if ((new Date(`${end}T00:00:00`) - new Date(`${start}T00:00:00`)) / 86400000 > 30) { message("为保证排班体验，单次最多查看 31 天。", "error"); return false; }
  const requestId = ++boardLoadRequestId;
  try {
    const params = new URLSearchParams({ department, start, end });
    const [result, calendarResult] = await Promise.all([requestApi(`/api/schedule-board?${params}`), requestApi(`/api/work-calendar?${params}`)]);
    if (requestId !== boardLoadRequestId) return false;
    calendar = new Map(calendarResult.calendar.map((item) => [String(item.work_date).slice(0, 10), item]));
    board = { department, start, end, plan: result.plan, employees: result.employees, assignments: new Map(result.assignments.map((item) => [key(item.employee_id, String(item.work_date).slice(0, 10)), String(item.shift_id)])), leaveDays: new Set(result.assignments.filter((item) => item.is_on_leave).map((item) => key(item.employee_id, String(item.work_date).slice(0, 10)))), dirty: false, selectedKey: "" };
    renderBatchEmployees();
    renderBoard();
    rememberLoadedBoard();
    return true;
  } catch (error) {
    message(error.message, "error");
    return false;
  }
}
function formatDraftSavedAt(value) { if (!value) return "刚刚保存"; return String(value).replace("T", " ").slice(0, 16); }
async function loadDrafts() {
  const card = byId("draft-list-card"), list = byId("draft-list");
  try {
    const { plans } = await requestApi(`/api/schedule-plans?${new URLSearchParams({ status: "草稿", limit: "3" })}`);
    card.hidden = !plans.length;
    list.innerHTML = plans.map((plan) => {
      const active = String(board.plan?.plan_id) === String(plan.plan_id), editableDraft = Boolean(plan.cycle_id);
      return `<article class="draft-item ${active ? "is-active" : ""}"><div class="draft-item-copy"><span class="draft-status">${active ? "当前编辑中" : "草稿"}</span><h3>${escapeHtml(plan.department)} · ${escapeHtml(plan.name)}</h3><p>${escapeHtml(plan.start_date)} 至 ${escapeHtml(plan.end_date)}</p><small>最近保存：${escapeHtml(formatDraftSavedAt(plan.updated_at || plan.created_at))}${editableDraft ? "" : " · 旧周期草稿，请重新排期"}</small></div><div class="draft-item-actions">${editableDraft ? `<button type="button" class="secondary-button" data-edit-draft="${plan.plan_id}" data-draft-department="${escapeHtml(plan.department)}" data-draft-start="${escapeHtml(plan.start_date)}">${active ? "继续编辑" : "打开草稿"}</button>` : ""}<button type="button" class="text-button draft-delete" data-delete-draft="${plan.plan_id}" data-draft-name="${escapeHtml(plan.name)}">删除草稿</button></div></article>`;
    }).join("");
    return plans;
  } catch (error) {
    card.hidden = false;
    list.innerHTML = `<p class="empty-tip">${escapeHtml(error.message)}</p>`;
    return [];
  }
}
async function openVersionHistory() {
  if (!board.plan) return message("请先打开已保存的班表。", "error");
  const dialog = byId("version-history-dialog"), list = byId("version-history-list");
  list.innerHTML = '<p class="empty-tip">正在加载版本记录…</p>';
  dialog.showModal();
  try {
    const { versions } = await requestApi(`/api/schedule-plans/${board.plan.plan_id}/versions`);
    list.innerHTML = versions.map((version) => {
      const assignmentTotal = version.snapshot?.assignments?.length || 0;
      return `<article class="version-item"><header><span>v${version.plan_version} · ${escapeHtml(version.action)}</span><time>${escapeHtml(String(version.created_at || "").replace("T", " "))}</time></header><h3>${escapeHtml(version.status)}</h3><p>${escapeHtml(version.actor_name || "系统")} · ${assignmentTotal} 条班次</p>${version.note ? `<small>${escapeHtml(version.note)}</small>` : ""}</article>`;
    }).join("") || '<p class="empty-tip">当前还没有版本记录；下次保存或审批后会自动留痕。</p>';
  } catch (error) { list.innerHTML = `<p class="empty-tip">${escapeHtml(error.message)}</p>`; }
}
function collectAssignments() { return [...board.assignments.entries()].map(([assignment, shiftId]) => { const [employeeId, workDate] = assignment.split(":"); return { employee_id: Number(employeeId), work_date: workDate, shift_id: Number(shiftId) }; }); }
async function saveBoard(silent = false) { if (!board.department) { if (!silent) message("请先加载部门班表。", "error"); return false; } if (savingBoard) return false; savingBoard = true; renderActionBar(); try { byId("save-status").textContent = "正在保存…"; const result = await requestApi("/api/schedule-board", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ department: board.department, start_date: board.start, end_date: board.end, version: board.plan?.version ?? 1, assignments: collectAssignments() }) }); board.plan = result.plan; board.assignments = new Map(result.assignments.map((item) => [key(item.employee_id, String(item.work_date).slice(0, 10)), String(item.shift_id)])); board.leaveDays = new Set(result.assignments.filter((item) => item.is_on_leave).map((item) => key(item.employee_id, String(item.work_date).slice(0, 10)))); board.dirty = false; await loadDrafts(); if (!silent) message(`${result.message}（${board.assignments.size} 条班次）`); return true; } catch (error) { if (!silent) message(error.message, "error"); return false; } finally { savingBoard = false; renderBoard(); } }

byId("board-body").addEventListener("change", (event) => { const cell = event.target; if (!cell.classList.contains("board-cell")) return; const assignment = key(cell.dataset.employeeId, cell.dataset.workDate); cell.value ? board.assignments.set(assignment, cell.value) : board.assignments.delete(assignment); setDirty(); renderBoard(); });
byId("board-body").addEventListener("click", (event) => { const cell = event.target.closest(".schedule-cell"); if (cell) board.selectedKey = cell.dataset.key; });
byId("download-import-template").addEventListener("click", async () => {
  if (!board.plan?.plan_id) return message("请先加载并保存一个班表草稿。", "error");
  try { const token = await getCsrfToken(); const response = await fetch(`/api/schedule-plans/${board.plan.plan_id}/assignments/import-template`, { headers: { "X-CSRF-Token": token } }); if (!response.ok) throw new Error("模板下载失败，请稍后重试。"); const link = document.createElement("a"); link.href = URL.createObjectURL(await response.blob()); link.download = "排班导入模板.xlsx"; link.click(); window.setTimeout(() => URL.revokeObjectURL(link.href), 1000); } catch (error) { message(error.message, "error"); }
});
byId("export-board").addEventListener("click", async () => {
  if (!board.plan?.plan_id) return message("请先加载并保存一个班表草稿。", "error");
  if (board.dirty && !window.confirm("当前有未保存修改，导出内容只包含数据库中已保存的班表。是否继续？")) return;
  try { const token = await getCsrfToken(); const response = await fetch(`/api/schedule-plans/${board.plan.plan_id}/assignments/export`, { headers: { "X-CSRF-Token": token } }); if (!response.ok) { const result = await response.json(); throw new Error(result.message || "班表导出失败。"); } const link = document.createElement("a"); link.href = URL.createObjectURL(await response.blob()); link.download = "当前班表.xlsx"; link.click(); window.setTimeout(() => URL.revokeObjectURL(link.href), 1000); message("当前已保存班表已导出。", "success"); } catch (error) { message(error.message, "error"); }
});
byId("save-schedule-template").addEventListener("click", async () => {
  if (!board.assignments.size) return message("当前还没有排班，不能保存空模板。", "error");
  const name = window.prompt("请输入模板名称", `${board.department}排班模板`); if (!name?.trim()) return;
  try { await requestApi("/api/schedule-templates", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: name.trim().slice(0, 100), department: board.department, assignments: currentTemplateAssignments() }) }); message("排班模板已保存到云端。", "success"); } catch (error) { message(error.message, "error"); }
});
byId("open-schedule-templates").addEventListener("click", async () => { byId("schedule-template-dialog").showModal(); await renderScheduleTemplates(); });
byId("close-schedule-templates").addEventListener("click", () => byId("schedule-template-dialog").close());
byId("cancel-schedule-templates").addEventListener("click", () => byId("schedule-template-dialog").close());
byId("schedule-template-list").addEventListener("click", async (event) => { const button = event.target.closest("[data-delete-template]"); if (!button) return; if (!window.confirm("确定删除这个排班模板吗？")) return; try { await requestApi(`/api/schedule-templates/${button.dataset.deleteTemplate}`, { method: "DELETE" }); await renderScheduleTemplates(); message("排班模板已删除。", "success"); } catch (error) { message(error.message, "error"); } });
byId("schedule-template-form").addEventListener("submit", async (event) => { event.preventDefault(); const selected = byId("schedule-template-list").querySelector("input[name='schedule-template']:checked"); if (!selected) return message("请选择一个模板。", "error"); try { const templates = await loadScheduleTemplates(), template = templates.find((item) => String(item.template_id) === selected.value); byId("schedule-template-dialog").close(); if (template) applyScheduleTemplate(template); } catch (error) { message(error.message, "error"); } });
byId("open-auto-schedule").addEventListener("click", () => { if (!board.plan?.plan_id) return message("请先加载并保存一个班表草稿。", "error"); if (!editable()) return message("当前班表不可编辑。", "error"); renderAutoShiftOptions(); byId("auto-schedule-preview").textContent = "请选择至少一个班次。"; byId("auto-schedule-dialog").showModal(); });
byId("close-auto-schedule").addEventListener("click", () => byId("auto-schedule-dialog").close());
byId("cancel-auto-schedule").addEventListener("click", () => byId("auto-schedule-dialog").close());
byId("auto-schedule-form").addEventListener("submit", async (event) => {
  event.preventDefault(); const shiftIds = [...byId("auto-shift-list").querySelectorAll("input:checked")].map((input) => Number(input.value));
  if (!shiftIds.length) return message("请至少选择一个班次。", "error");
  const button = byId("generate-auto-schedule"); button.disabled = true; byId("auto-schedule-preview").textContent = "正在生成候选班表…";
  try {
    const result = await requestApi(`/api/schedule-plans/${board.plan.plan_id}/assignments/auto-preview`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ shift_ids: shiftIds, skip_rest_days: byId("auto-skip-rest").checked }) });
    if (!result.assignments?.length) throw new Error("当前规则下没有可生成的班次。");
    const existingCount = board.assignments.size;
    if (existingCount && !window.confirm(`自动排班将替换当前 ${existingCount} 条未保存/已加载班次，是否继续？`)) return;
    board.assignments = new Map(result.assignments.map((item) => [key(item.employee_id, String(item.work_date).slice(0, 10)), String(item.shift_id)]));
    board.dirty = true; byId("auto-schedule-dialog").close(); renderBoard(); message(`已生成 ${result.count} 条自动排班候选，请检查冲突后保存。`, "success");
  } catch (error) { byId("auto-schedule-preview").textContent = error.message; message(error.message, "error"); }
  finally { button.disabled = false; }
});
byId("schedule-import-file").addEventListener("change", async (event) => {
  const file = event.target.files?.[0]; event.target.value = "";
  if (!file || !board.plan?.plan_id) return message("请先加载并保存一个班表草稿。", "error");
  const body = new FormData(); body.append("file", file);
  try {
    const token = await getCsrfToken();
    const response = await fetch(`/api/schedule-plans/${board.plan.plan_id}/assignments/import-preview`, { method: "POST", headers: { "X-CSRF-Token": token }, body });
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || "排班文件读取失败。");
    pendingImportAssignments = result.assignments || [];
    byId("import-preview-summary").textContent = `${file.name} · 已识别 ${result.count} 条记录，请核对后确认。`;
    byId("import-preview-list").innerHTML = (result.preview_rows || []).map((row, index) => `<div class="import-preview-row"><span>${index + 1}</span><strong>${escapeHtml(row.employee_name)}<small>${escapeHtml(row.employee_no)}</small></strong><time>${escapeHtml(String(row.work_date).slice(0, 10))}</time><b>${escapeHtml(row.shift_name)}</b></div>`).join("");
    byId("import-preview-dialog").showModal();
  } catch (error) { message(error.message, "error"); }
});
byId("close-import-preview").addEventListener("click", () => { pendingImportAssignments = []; byId("import-preview-dialog").close(); });
byId("cancel-import-preview").addEventListener("click", () => { pendingImportAssignments = []; byId("import-preview-dialog").close(); });
byId("import-preview-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!pendingImportAssignments.length || !board.plan?.plan_id) return message("没有可确认的排班记录。", "error");
  const button = byId("confirm-import-preview"); button.disabled = true;
  try {
    const result = await requestApi(`/api/schedule-plans/${board.plan.plan_id}/assignments/import-confirm`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ assignments: pendingImportAssignments }) });
    board.plan = result.plan || board.plan;
    board.assignments = new Map(result.assignments.map((item) => [key(item.employee_id, String(item.work_date).slice(0, 10)), String(item.shift_id)]));
    board.leaveDays = new Set(result.assignments.filter((item) => item.is_on_leave).map((item) => key(item.employee_id, String(item.work_date).slice(0, 10))));
    board.dirty = false; pendingImportAssignments = []; byId("import-preview-dialog").close(); renderBoard(); message(result.message || "排班导入成功。", "success");
  } catch (error) { message(error.message, "error"); }
  finally { button.disabled = false; }
});
byId("clear-selection").addEventListener("click", () => { if (!board.selectedKey) return message("请先点击需要清除的班次单元格。", "error"); if (board.leaveDays.has(board.selectedKey)) return message("该日期请假已生效；请先处理请假申请，不能直接清除原班次。", "error"); board.assignments.delete(board.selectedKey); setDirty(); renderBoard(); message("已清除选中的班次。"); });
function selectedBatchDays() { const start = byId("batch-start").value, end = byId("batch-end").value; if (!start || !end || start > end) return []; const restWeekdays = new Set([...document.querySelectorAll("input[name='batch-rest-weekday']:checked")].map((input) => Number(input.value))), skipSystemRest = byId("batch-skip-system-rest").checked; return dates(start, end).filter((day) => !restWeekdays.has(new Date(`${day}T00:00:00`).getDay()) && !(skipSystemRest && dayMeta(day).rest)); }
function updateBatchPreview() { const start = byId("batch-start").value, end = byId("batch-end").value, selectedDays = selectedBatchDays(); if (!start || !end || start > end) { byId("batch-preview").textContent = "请选择有效日期范围。"; return; } const skipped = dates(start, end).length - selectedDays.length; byId("batch-preview").textContent = `将排 ${selectedDays.length} 天${skipped ? `，跳过 ${skipped} 天休息日` : ""}。`; }
byId("open-batch").addEventListener("click", () => { if (!board.department) return message("请先加载班表。", "error"); if (!editable()) return message("已发布班表需先撤回才能修改。", "error"); for (const id of ["batch-start", "batch-end"]) { byId(id).min = board.start; byId(id).max = board.end; } byId("batch-start").value = board.start; byId("batch-end").value = board.end; byId("batch-employees").querySelectorAll("input").forEach((input) => { input.checked = true; }); updateBatchSelectedCount(); updateBatchPreview(); byId("batch-dialog").showModal(); });
byId("close-batch").addEventListener("click", () => byId("batch-dialog").close());
byId("close-batch-icon").addEventListener("click", () => byId("batch-dialog").close());
byId("batch-fill-form").addEventListener("submit", (event) => { event.preventDefault(); const employees = [...byId("batch-employees").querySelectorAll("input:checked")].map((input) => input.value), shiftId = byId("batch-shift").value, start = byId("batch-start").value, end = byId("batch-end").value, workDays = selectedBatchDays(); if (!employees.length || !shiftId || !start || !end) return message("请选择员工、班次和日期范围。", "error"); if (start < board.start || end > board.end || start > end) return message("批量日期必须位于当前班表范围内。", "error"); if (!workDays.length) return message("当前休息规则排除了全部日期，请调整休息日设置。", "error"); const targets = workDays.flatMap((day) => employees.map((employee) => key(employee, day))).filter((assignment) => !board.leaveDays.has(assignment)); const skippedLeave = employees.length * workDays.length - targets.length; let overwritten = targets.filter((assignment) => board.assignments.has(assignment)).length; if (overwritten && !window.confirm(`本次将填充 ${targets.length} 条班次，并覆盖 ${overwritten} 条已有班次，是否继续？`)) return; for (const assignment of targets) board.assignments.set(assignment, shiftId); byId("batch-dialog").close(); setDirty(); renderBoard(); message(`已填充 ${targets.length} 条班次${overwritten ? `，其中覆盖 ${overwritten} 条` : ""}${skippedLeave ? `；跳过 ${skippedLeave} 个已批准请假日期` : ""}。`); });
byId("batch-dialog").addEventListener("change", (event) => { if (["batch-start", "batch-end", "batch-skip-system-rest"].includes(event.target.id) || event.target.name === "batch-rest-weekday") updateBatchPreview(); });
byId("batch-employees").addEventListener("change", updateBatchSelectedCount);
byId("select-all-batch").addEventListener("click", () => { byId("batch-employees").querySelectorAll("input").forEach((input) => { input.checked = true; }); updateBatchSelectedCount(); });
byId("clear-all-batch").addEventListener("click", () => { byId("batch-employees").querySelectorAll("input").forEach((input) => { input.checked = false; }); updateBatchSelectedCount(); });
byId("shift-form").addEventListener("submit", async (event) => { event.preventDefault(); try { await requestApi("/api/shifts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: byId("shift-name").value.trim(), start_time: byId("shift-start").value, end_time: byId("shift-end").value, duration_hours: Number(byId("shift-duration").value), color: byId("shift-color").value }) }); event.target.reset(); byId("shift-color").value = "#2563eb"; shifts = (await requestApi("/api/shifts")).shifts; renderShiftLibrary(); renderBoard(); message("班次已新增，可立即用于排班。"); } catch (error) { message(error.message, "error"); } });
byId("schedule-rule-form").addEventListener("submit", async (event) => { event.preventDefault(); const submitButton = event.target.querySelector("button[type='submit']"); submitButton.disabled = true; try { const result = await requestApi("/api/scheduling-rules", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ min_rest_hours: Number(byId("rule-min-rest").value), max_consecutive_days: Number(byId("rule-max-days").value), max_daily_overtime_hours: Number(byId("rule-daily-overtime").value), max_monthly_overtime_hours: Number(byId("rule-monthly-overtime").value), min_staff_per_position: Number(byId("rule-min-staff").value) }) }); rule = result.rule; renderRulePanel(window.currentUser); renderStatus(); message("排班约束规则已保存，当前班表已按新规则重新检查。", "success"); } catch (error) { message(error.message, "error"); } finally { submitButton.disabled = false; } });
byId("issue-list").addEventListener("click", (event) => { const item = event.target.closest(".issue-item"), target = item && document.querySelector(`[data-key="${item.dataset.key}"]`); target?.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" }); if (target) { target.classList.add("cell-attention"); setTimeout(() => target.classList.remove("cell-attention"), 1200); } });
byId("focus-issues").addEventListener("click", () => byId("issue-list").scrollIntoView({ behavior: "smooth", block: "center" }));
byId("open-versions").addEventListener("click", openVersionHistory);
byId("close-versions").addEventListener("click", () => byId("version-history-dialog").close());
byId("save-board").addEventListener("click", () => saveBoard());
byId("draft-list").addEventListener("click", async (event) => {
  const editButton = event.target.closest("[data-edit-draft]");
  const deleteButton = event.target.closest("[data-delete-draft]");
  if (!editButton && !deleteButton) return;
  if (editButton) {
    if (board.dirty && !window.confirm("切换草稿会放弃当前未保存的修改。是否继续？")) return;
    byId("board-department").value = editButton.dataset.draftDepartment;
    byId("board-cycle-anchor").value = editButton.dataset.draftStart;
    if (!await loadCycleBoard(null, true)) return;
    await loadDrafts();
    window.scrollTo({ top: 0, behavior: "smooth" });
    message(`已打开草稿，恢复 ${board.assignments.size} 条班次。`, "success");
    return;
  }
  if (!window.confirm(`确定删除草稿“${deleteButton.dataset.draftName}”吗？其中的班次也会一并删除，且不可恢复。`)) return;
  try {
    const deletedId = deleteButton.dataset.deleteDraft;
    const result = await requestApi(`/api/schedule-plans/${deletedId}`, { method: "DELETE" });
    if (String(board.plan?.plan_id) === String(deletedId)) await loadCycleBoard();
    await loadDrafts();
    message(result.message || "草稿已删除。", "success");
  } catch (error) { message(error.message, "error"); }
});
byId("discard-changes").addEventListener("click", async () => { if (!board.dirty || !window.confirm("未保存的班次修改将被放弃，并恢复为数据库中的草稿。是否继续？")) return; await loadCycleBoard(null, true); message("已恢复为数据库中保存的班表。", "success"); });
byId("refresh-review-queue").addEventListener("click", loadReviewQueue);
byId("hr-review-list").addEventListener("click", async (event) => { const legacyButton = event.target.closest("[data-return-legacy]"); if (legacyButton) { try { const result = await requestApi(`/api/schedule-plans/${legacyButton.dataset.returnLegacy}/return`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ note: "该旧班表未覆盖当前完整排班周期，请按系统周期重新排班后再提交。" }) }); message(result.message); await loadReviewQueue(); } catch (error) { message(error.message, "error"); } return; } const button = event.target.closest("[data-review-department]"); if (!button) return; byId("board-department").value = button.dataset.reviewDepartment; byId("board-cycle-anchor").value = button.dataset.reviewStart; await loadCycleBoard(); window.scrollTo({ top: 0, behavior: "smooth" }); message("已打开该周期班表，可审核发布或打回修改。", "success"); });
byId("publish").addEventListener("click", async () => { const isHr = window.currentUser?.role === "hr_admin"; const found = issues(), blocking = isHr && board.plan?.force_submit_reason ? found.filter((item) => !item.forceable) : found; if (blocking.length) return message(`请先处理 ${blocking.length} 条排班检查提示，再继续。`, "error"); if (!board.plan) return message("请先保存班表草稿，再提交审核。", "error"); if (!isHr && board.dirty && !await saveBoard()) return; try { const action = isHr ? "publish" : "submit"; const result = await requestApi(`/api/schedule-plans/${board.plan.plan_id}/${action}`, { method: "POST" }); await loadBoard(); await loadDrafts(); const successText = result.message || (isHr ? "人事已审核发布，员工日历已同步。" : "班表已提交人事审核。"); workflowFeedback(isHr ? "班表已审核发布" : "班表已提交人事审核", isHr ? "员工个人日历已同步，当前版本已锁定。" : "人事审核前，你仍可使用“撤销提交”将班表恢复为草稿。" ); message(successText); } catch (error) { message(`提交失败：${error.message}`, "error"); } });
byId("force-submit").addEventListener("click", async () => { if (!board.plan && !await saveBoard()) return; if (board.dirty && !await saveBoard()) return; byId("force-submit-reason").value = ""; byId("force-submit-dialog").showModal(); });
byId("close-force-submit").addEventListener("click", () => byId("force-submit-dialog").close());
byId("cancel-force-submit").addEventListener("click", () => byId("force-submit-dialog").close());
byId("force-submit-form").addEventListener("submit", async (event) => { event.preventDefault(); const reason = byId("force-submit-reason").value.trim(); if (reason.length < 10) return message("请填写至少 10 个字的业务原因。", "error"); try { const result = await requestApi(`/api/schedule-plans/${board.plan.plan_id}/submit`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ force: true, reason }) }); byId("force-submit-dialog").close(); await loadBoard(); await loadReviewQueue(); workflowFeedback("已强制提交人事复核", "连续排班预警及你的业务原因已随班表提交；人事审核前不会发布。" ); message(result.message); } catch (error) { message(error.message, "error"); } });
byId("withdraw").addEventListener("click", async () => { if (!board.plan || !window.confirm("撤回后员工将无法按当前版本查看班表，是否继续？")) return; try { await requestApi(`/api/schedule-plans/${board.plan.plan_id}/withdraw`, { method: "POST" }); await loadBoard(); message("班表已撤回为草稿，可继续修改。"); } catch (error) { message(error.message, "error"); } });
byId("revoke-submission").addEventListener("click", async () => { if (!board.plan || !window.confirm("撤销后班表将回到草稿，人事将无法继续审核。是否继续？")) return; try { await requestApi(`/api/schedule-plans/${board.plan.plan_id}/revoke-submission`, { method: "POST" }); await loadBoard(); message("已撤销提交，班表已恢复为草稿。"); } catch (error) { message(error.message, "error"); } });
byId("return-plan").addEventListener("click", () => { if (!board.plan) return; byId("return-note").value = ""; byId("return-plan-dialog").showModal(); });
byId("close-return").addEventListener("click", () => byId("return-plan-dialog").close());
byId("cancel-return").addEventListener("click", () => byId("return-plan-dialog").close());
byId("return-plan-form").addEventListener("submit", async (event) => { event.preventDefault(); try { const result = await requestApi(`/api/schedule-plans/${board.plan.plan_id}/return`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ note: byId("return-note").value.trim() }) }); byId("return-plan-dialog").close(); await loadBoard(); await loadReviewQueue(); message(result.message); } catch (error) { message(error.message, "error"); } });
async function syncCycle(anchor) {
  const { cycle } = await requestApi(`/api/schedule-cycles?${new URLSearchParams({ anchor })}`);
  byId("board-start").value = cycle.start_date; byId("board-end").value = cycle.end_date;
  return cycle;
}
async function refreshCycleGovernance() {
  const user = window.currentUser || await loadCurrentUser(), trigger = byId("cycle-policy-trigger");
  if (!user || !["hr_admin", "super_admin"].includes(user.role)) return;
  trigger.hidden = false;
  const data = await requestApi("/api/scheduling-cycle-policy"), pending = data.pending;
  byId("cycle-policy-description").textContent = `当前规则：每月 ${data.default_start_day} 日起算。当前周期为 ${data.current_cycle.start_date} 至 ${data.current_cycle.end_date}。规则变更必须由人事发起、老板审批。`;
  byId("cycle-policy-trigger-text").textContent = pending ? "有一条规则变更等待处理" : `当前：每月 ${data.default_start_day} 日起算`;
  const days = Array.from({ length: 28 }, (_, i) => `<option value="${i + 1}">每月 ${i + 1} 日</option>`).join("");
  byId("cycle-policy-content").innerHTML = user.role === "hr_admin" ? `${pending ? `<div class="coverage-summary"><strong>待老板审批：每月 ${pending.proposed_start_day} 日起算</strong><span>切换期 ${pending.transition_start} 起；新规则首周期 ${pending.effective_start} 起。</span></div>` : `<form id="cycle-change-form" class="compact-form"><label>申请新的周期开始日<select id="cycle-start-day">${days}</select></label><button type="submit">提交老板审批</button><p class="form-hint">系统会保留一次短切换期，确保已生效周期不被截断。</p></form>`}` : (pending ? `<div class="coverage-summary"><strong>人事申请：每月 ${pending.proposed_start_day} 日起算</strong><span>切换期 ${pending.transition_start} 起；新规则首周期 ${pending.effective_start} 起。</span><div class="button-group"><button type="button" data-cycle-review="approve" data-request-id="${pending.request_id}">批准并生效</button><button type="button" class="secondary-button" data-cycle-review="reject" data-request-id="${pending.request_id}">驳回</button></div></div>` : `<p class="empty-tip">当前没有待审批的周期变更。</p>`);
}
async function refreshCycleSummary() {
  const card = byId("cycle-summary-card"); card.hidden = false;
  if (!board.plan?.cycle_id) { card.hidden = true; return; }
  const result = await requestApi(`/api/schedule-cycles/${board.plan.cycle_id}/summary?${new URLSearchParams({ department: board.department })}`);
  byId("cycle-summary-description").textContent = `${result.cycle.start_date} 至 ${result.cycle.end_date} · ${result.cycle.cycle_kind === "transition" ? "切换期" : "标准周期"} · 正式覆盖率仅统计已发布班表，草稿进度单独展示`;
  byId("cycle-summary-content").innerHTML = result.departments.map((item) => `<article><header><strong>${escapeHtml(item.department || "未分配部门")}</strong><b>${item.coverage_rate}% 正式覆盖</b></header><div class="cycle-metric-row"><span><small>员工</small>${item.employee_count} 人</span><span><small>已发布班次</small>${item.assignment_count}</span><span><small>已发布工时</small>${item.scheduled_hours}h</span></div><div class="cycle-metric-row"><span><small>人均班次</small>${item.avg_shifts_per_employee}</span><span><small>人均工时</small>${item.avg_hours_per_employee}h</span><span class="${item.unassigned_employee_days ? "metric-warning" : ""}"><small>正式未排缺口</small>${item.unassigned_employee_days} 人日</span></div><div class="cycle-draft-progress ${item.draft_assignment_count ? "has-data" : ""}"><span><small>草稿进度</small><strong>${item.draft_assignment_count || 0} 条班次 · ${item.draft_scheduled_hours || 0}h</strong></span><em>${item.draft_assignment_count ? "数据已保存，发布后计入正式统计" : "当前没有待发布的草稿班次"}</em></div><p>${Object.entries(item.plan_statuses || {}).map(([status, total]) => `${status} ${total} 份`).join(" · ") || "本周期尚未创建班表"}</p></article>`).join("") || '<p class="empty-tip">本周期暂无可统计的排班数据。</p>';
}
const legacyLoadBoard = loadBoard;
async function loadCycleBoard(event, discardUnsaved = false) {
  if (event) { event.preventDefault(); event.stopImmediatePropagation(); }
  const department = byId("board-department").value, anchor = byId("board-cycle-anchor").value;
  if (!department || !anchor) { message("请选择部门和周期定位日。", "error"); return false; }
  if (board.dirty && !discardUnsaved && !window.confirm("切换部门或周期会放弃当前未保存的修改。是否继续？")) return false;
  const requestId = ++boardLoadRequestId;
  try {
    await syncCycle(anchor);
    if (requestId !== boardLoadRequestId) return false;
    if (!await legacyLoadBoard()) return false;
    await refreshCycleSummary();
    return true;
  } catch (error) {
    if (requestId !== boardLoadRequestId) return false;
    message(error.message, "error");
    return false;
  }
}
byId("board-query-form").addEventListener("submit", loadCycleBoard, true);
byId("cycle-policy-content").addEventListener("submit", async (event) => { if (event.target.id !== "cycle-change-form") return; event.preventDefault(); try { const result = await requestApi("/api/scheduling-cycle-policy/requests", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ start_day: Number(byId("cycle-start-day").value) }) }); message(result.message); await refreshCycleGovernance(); } catch (error) { message(error.message, "error"); } });
byId("cycle-policy-content").addEventListener("click", async (event) => { const button = event.target.closest("[data-cycle-review]"); if (!button) return; try { const result = await requestApi(`/api/scheduling-cycle-policy/requests/${button.dataset.requestId}/review`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ decision: button.dataset.cycleReview }) }); message(result.message); await refreshCycleGovernance(); } catch (error) { message(error.message, "error"); } });
byId("open-cycle-policy").addEventListener("click", () => byId("cycle-policy-dialog").showModal());
byId("close-cycle-policy").addEventListener("click", () => byId("cycle-policy-dialog").close());
window.addEventListener("beforeunload", (event) => { if (board.dirty) { event.preventDefault(); event.returnValue = ""; } });
window.addEventListener("pageshow", () => { loadDrafts(); });
(async () => {
  try {
    await loadBaseData();
    const query = new URLSearchParams(window.location.search), today = new Date();
    byId("board-cycle-anchor").value = query.get("anchor") || query.get("start") || localDateString(today);
    if (query.get("department")) byId("board-department").value = query.get("department");
    const [, , drafts] = await Promise.all([loadReviewQueue(), refreshCycleGovernance(), loadDrafts()]);
    if (byId("board-department").value && (query.get("anchor") || query.get("start"))) {
      await loadCycleBoard();
      return;
    }
    const latestDraft = drafts.find((plan) => plan.cycle_id && plan.department === byId("board-department").value);
    if (latestDraft) {
      byId("board-cycle-anchor").value = latestDraft.start_date;
      if (await loadCycleBoard(null, true)) message(`已自动恢复最近草稿，共 ${board.assignments.size} 条班次。`, "success");
    }
  } catch (error) { message(error.message, "error"); }
})();
