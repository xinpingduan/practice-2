const registerForm = document.getElementById("register-form");
const message = document.getElementById("message");
function showMessage(text, type) { message.textContent = text; message.className = `message ${type}`; }
registerForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const password = document.getElementById("password").value;
  const confirmPassword = document.getElementById("confirm-password").value;
  if (password !== confirmPassword) return showMessage("两次输入的密码不一致。", "error");
  try {
    const result = await requestApi("/api/employees/register", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: document.getElementById("name").value.trim(), password, confirm_password: confirmPassword, phone: document.getElementById("phone").value.trim(), email: document.getElementById("email").value.trim() }) });
    showMessage(`${result.message}（${result.employee?.employee_no || "工号已生成"}），请前往入职分配继续处理。`, "success"); registerForm.reset();
  } catch (error) { showMessage(error.message, "error"); }
});
