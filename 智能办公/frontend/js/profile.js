const esc = (value) => String(value ?? "—").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const link = (href, title, text, tone = "blue") => `<a class="action-item ${tone}" href="${href}"><span><strong>${title}</strong><small>${text}</small></span><b>→</b></a>`;
async function settled(url) { try { return await requestApi(url); } catch { return null; } }
function isoDate(value) { return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`; }

async function renderProfile() {
  while (!window.currentUser) await new Promise((resolve) => setTimeout(resolve, 20));
  const user = window.currentUser;
  document.getElementById("welcome-title").textContent = `${user.name}，你好`;
  document.getElementById("role-chip").textContent = user.role_name;
  document.getElementById("profile-content").innerHTML = [["姓名", user.name], ["工号", user.employee_no], ["部门", user.department || "未分配"], ["岗位", user.position || "未分配"], ["手机号", user.phone || "未填写"], ["账户状态", user.employment_status || "在职"]].map(([label, value]) => `<div><span>${label}</span><strong>${esc(value)}</strong></div>`).join("");

  const metrics = document.getElementById("workspace-metrics"), actions = document.getElementById("workspace-actions");
  let cards = [], next = [], copy = "这里展示与你的角色相关的下一步工作。";
  let focus = { title: "查看下一步工作", copy: "从与你角色相关的事项开始处理。", href: "#workspace-actions", action: "查看下一步" };
  if (user.role === "employee") {
    const now = new Date(), start = new Date(now.getFullYear(), now.getMonth() - 1, 1), end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    const [schedule, tasks, requests] = await Promise.all([settled(`/api/my-schedule?start=${isoDate(start)}&end=${isoDate(end)}`), settled("/api/my/tasks"), settled("/api/schedule-requests/mine")]);
    const pendingTasks = tasks?.tasks?.filter((item) => item.status === "待处理").length || 0;
    const pendingRequests = requests?.requests?.filter((item) => item.status?.includes("待")).length || 0;
    cards = [[schedule?.schedules?.length || 0, "已发布班次", "本月和上月的个人日历"], [pendingRequests, "申请处理中", "换班、请假进度"], [pendingTasks, "待处理事项", "需要你提交处理结果"]];
    next = [link("my-schedule.html", "查看我的班次", "点击当天班次即可申请换班或请假"), link("my-todos.html", "处理我的待办", pendingTasks ? `有 ${pendingTasks} 项待处理` : "当前没有待处理事项", pendingTasks ? "amber" : "blue"), link("my-todos.html#offboarding", "发起离职申请", "提交后由经理、老板和人事依次处理", "amber")];
    copy = "只显示你的班次、申请和个人待办。";
    focus = pendingTasks
      ? { title: `完成 ${pendingTasks} 项个人待办`, copy: "优先提交处理结果，避免后续流程停滞。", href: "my-todos.html", action: "处理待办" }
      : pendingRequests
        ? { title: `跟进 ${pendingRequests} 项申请`, copy: "查看换班或请假申请的最新审批进度。", href: "my-schedule.html", action: "查看申请" }
        : { title: "确认近期班次", copy: "检查接下来两周的班次和休息日安排。", href: "my-schedule.html", action: "打开日历" };
  } else if (user.role === "department_admin") {
    const [requests, plans] = await Promise.all([settled("/api/department/schedule-requests"), settled("/api/schedule-plans")]);
    const pending = requests?.requests?.length || 0, editablePlans = plans?.plans?.filter((item) => ["草稿", "已打回"].includes(item.status)) || [], draft = editablePlans[0];
    const draftLink = draft ? `schedule.html?department=${encodeURIComponent(draft.department)}&start=${encodeURIComponent(draft.start_date)}&end=${encodeURIComponent(draft.end_date)}` : "";
    cards = [[pending, "待审批申请", "员工请假与换班"], [editablePlans.length, "排班草稿", draft ? "点击继续编辑最近一份草稿" : "新建班表后会显示在这里", draftLink], [plans?.plans?.filter((item) => item.status === "待人事审核").length || 0, "人事审核中", "已提交的班表"]];
    next = [link("department-requests.html", "审批员工申请", pending ? `有 ${pending} 项等待你的决定` : "目前没有待审批申请", pending ? "amber" : "blue"), link("task-center.html", "发布工作待办", "向本部门员工布置事项并跟踪完成情况"), link("schedule.html", "安排本部门班次", "仅显示本部门的经理和员工")];
    copy = "你负责本部门排班，以及员工换班、请假的初审。";
    focus = pending
      ? { title: `审批 ${pending} 项员工申请`, copy: "先处理临近班次日期的换班与请假申请。", href: "department-requests.html", action: "进入审批" }
      : draft
        ? { title: "继续最近的排班草稿", copy: `${draft.department} · ${draft.start_date} 至 ${draft.end_date}`, href: draftLink, action: "继续排班" }
        : { title: "检查本部门排班", copy: "确认周期、覆盖人数和班间休息是否符合规则。", href: "schedule.html", action: "打开班表" };
  } else if (user.role === "hr_admin") {
    const [plans, queue, special] = await Promise.all([settled("/api/schedule-plans?status=待人事审核"), settled("/api/onboarding/queue"), settled("/api/admin/schedule-requests")]);
    const review = plans?.plans?.length || 0, onboarding = queue?.queue?.length || 0, exceptions = special?.requests?.length || 0;
    cards = [[review, "待审核班表", "部门经理提交的班表"], [onboarding, "待办理入职", "已获超级管理员批准"], [exceptions, "特殊申请", "部门经理本人的申请"]];
    next = [link("schedule.html", "审核或直接排班", review ? `有 ${review} 份经理班表待审核` : "可直接为任意部门排班", review ? "amber" : "blue"), link("task-center.html", "发布工作待办", "向员工布置事项并跟踪完成情况"), link("onboarding.html", "发起入职申请", "登记员工并提交超级管理员批准"), link("queue.html", "办理获批入职", onboarding ? `有 ${onboarding} 位员工等待办理` : "当前没有待办理入职", onboarding ? "amber" : "blue"), link("admin-schedule-requests.html", "处理特殊申请", exceptions ? `有 ${exceptions} 项等待处理` : "当前没有特殊申请")];
    copy = "你可以直接排班，也负责审核经理班表和办理获批的人事事项。";
    focus = review
      ? { title: `审核 ${review} 份部门班表`, copy: "核对岗位覆盖、连续工作和加班风险后再发布。", href: "schedule.html", action: "开始审核" }
      : onboarding
        ? { title: `办理 ${onboarding} 位员工入职`, copy: "获批人员正在等待账号、权限和行政事项办理。", href: "queue.html", action: "进入队列" }
        : exceptions
          ? { title: `处理 ${exceptions} 项特殊申请`, copy: "部门经理本人提交的申请需要人事终审。", href: "admin-schedule-requests.html", action: "开始处理" }
          : { title: "检查人员与班表状态", copy: "当前无紧急积压，可查看最新排班和人员档案。", href: "schedule.html", action: "查看班表" };
  } else {
    const todos = await settled("/api/admin/todos"), pending = todos?.todos?.length || 0;
    cards = [[pending, "待最终批准", "入职、离职及授权事项"], ["仅审批", "职责边界", "不直接编辑员工、班表或档案"], ["—", "审批完成后", "自动回到人事或员工办理"]];
    next = [link("admin-todos.html", "进入审批中心", pending ? `有 ${pending} 项需要最终决定` : "当前没有待批准事项", pending ? "amber" : "blue"), link("task-center.html", "发布工作待办", "向员工布置事项并跟踪完成情况")];
    copy = "你只做最终授权审批，日常人事与排班由对应岗位负责。";
    focus = pending
      ? { title: `完成 ${pending} 项最终审批`, copy: "核对申请人、业务说明和前序审批意见后作出决定。", href: "admin-todos.html", action: "进入审批" }
      : { title: "当前没有待审批事项", copy: "新的入职、离职或授权申请会自动出现在审批中心。", href: "admin-todos.html", action: "查看审批中心" };
  }
  document.getElementById("welcome-copy").textContent = copy;
  document.getElementById("workspace-focus-title").textContent = focus.title;
  document.getElementById("workspace-focus-copy").textContent = focus.copy;
  const focusLink = document.getElementById("workspace-focus-link");
  focusLink.href = focus.href;
  focusLink.firstChild.textContent = `${focus.action} `;
  metrics.innerHTML = cards.map(([number, title, description, href]) => href ? `<a class="metric-link" href="${href}"><strong>${esc(number)}</strong><span>${title}</span><small>${description}</small><b>继续编辑 →</b></a>` : `<article><strong>${esc(number)}</strong><span>${title}</span><small>${description}</small></article>`).join("");
  actions.innerHTML = next.join("");
}
renderProfile();
