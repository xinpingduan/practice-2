const form = document.getElementById("onboarding-form");
const employeeSelect = document.getElementById("employee-id");
const message = document.getElementById("message");
function showMessage(text, type) { message.textContent = text; message.className = `message ${type}`; }
async function loadEmployeeOptions() {
  try { const { employees } = await requestApi("/api/employees?employment_status=待分配"); for (const employee of employees) { const option = document.createElement("option"); option.value = employee.id; option.textContent = `${employee.name}（${employee.employee_no}）`; employeeSelect.append(option); } }
  catch (error) { showMessage("无法加载员工，请确认 Flask 服务已启动。", "error"); }
}
form.addEventListener("submit", async (event) => { event.preventDefault(); try { const { record } = await requestApi("/api/onboarding", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ employee_id: employeeSelect.value, department: document.getElementById("department").value.trim(), position: document.getElementById("position").value.trim(), role: document.getElementById("role").value }) }); showMessage(`已完成分配：${record.employee_name} → ${record.onboarding_type}（${record.priority}）`, "success"); } catch (error) { showMessage(error.message, "error"); } });
loadEmployeeOptions();
