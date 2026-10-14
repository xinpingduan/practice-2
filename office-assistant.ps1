param(
  [Parameter(Mandatory=$true)][ValidateSet('whoami','overview','notifications','notification-read','leave-list','leave-submit','leave-approve','leave-reject','tasks','task-publish','task-submit','schedule','schedule-request-list','schedule-approve','schedule-reject')][string]$Action,
  [string]$SessionToken,
  [string]$RequestId,
  [string]$TaskId,
  [string]$NotificationId,
  [string]$Dates,
  [string]$Start,
  [string]$End,
  [string]$Reason,
  [string]$Scope = 'mine',
  [switch]$Confirmed,
  [string]$Note,
  [string]$Content,
  [switch]$UnreadOnly,
  [string]$Title,
  [string]$Priority = '普通',
  [string]$DueDate,
  [string]$EmployeeIds,
  [string]$Department,
  [string]$PublishKey
)

$ErrorActionPreference = 'Stop'
$base = 'http://127.0.0.1:5001/api/agent'
$envFile = Join-Path $PSScriptRoot '智能办公\backend\.env'
$apiKey = ((Get-Content $envFile | Where-Object { $_ -match '^AGENT_API_KEY=' }) -replace '^AGENT_API_KEY=', '').Trim()
if (-not $apiKey) { throw '未找到 AGENT_API_KEY' }
$token = $SessionToken
if (-not $token) { $token = $env:OFFICE_SESSION_TOKEN }
if (-not $token) { $token = $env:DSH_OFFICE_SESSION_TOKEN }
if (-not $token) { throw '缺少 SessionToken：请使用智能办公页面生成的短期身份凭证' }
$headers = @{ 'X-API-Key' = $apiKey; 'X-Office-Session' = $token }

switch ($Action) {
  'whoami' { Invoke-RestMethod "$base/me" -Headers $headers | ConvertTo-Json -Depth 8; break }
  'overview' { Invoke-RestMethod "$base/overview" -Headers $headers | ConvertTo-Json -Depth 12; break }
  'notifications' {
    $query = if ($UnreadOnly) { '?unread_only=true' } else { '' }
    Invoke-RestMethod "$base/notifications$query" -Headers $headers | ConvertTo-Json -Depth 12
    break
  }
  'leave-list' { Invoke-RestMethod "$base/leave-requests?scope=$([uri]::EscapeDataString($Scope))" -Headers $headers | ConvertTo-Json -Depth 12; break }
  'tasks' { Invoke-RestMethod "$base/tasks" -Headers $headers | ConvertTo-Json -Depth 12; break }
  'task-publish' {
    if (-not $Title -or -not $Content) { throw 'task-publish 需要 -Title 和 -Content' }
    if (-not $Confirmed) { throw '发布待办前必须传入 -Confirmed' }
    if ($Priority -notin @('普通', '重要', '紧急')) { throw 'Priority 只能是 普通/重要/紧急' }
    $body = @{ title = $Title; content = $Content; priority = $Priority; confirmed = $true }
    if ($DueDate) { $body.due_date = $DueDate }
    if ($EmployeeIds) {
      $body.target_type = 'employee'
      $body.employee_ids = @($EmployeeIds -split ',' | ForEach-Object { $_.Trim() } | Where-Object { $_ } | ForEach-Object { [int]$_ })
    }
    else {
      if (-not $Department) { throw '请通过 -Department 指定目标部门，或用 -EmployeeIds 指定员工' }
      $body.target_type = 'department'
      $body.department = $Department
    }
    if ($PublishKey) { $body.idempotency_key = $PublishKey } else { $body.idempotency_key = [guid]::NewGuid().ToString('N') }
    $json = $body | ConvertTo-Json -Depth 6
    Invoke-RestMethod "$base/tasks/manual" -Method Post -Headers $headers -ContentType 'application/json' -Body $json | ConvertTo-Json -Depth 12
    break
  }
  'schedule' {
    if (-not $Start -or -not $End) { throw 'schedule 需要 Start 和 End（YYYY-MM-DD）' }
    Invoke-RestMethod "$base/my-schedule?start=$([uri]::EscapeDataString($Start))&end=$([uri]::EscapeDataString($End))" -Headers $headers | ConvertTo-Json -Depth 12
    break
  }
  'schedule-request-list' {
    Invoke-RestMethod "$base/schedule-requests?scope=$([uri]::EscapeDataString($Scope))" -Headers $headers | ConvertTo-Json -Depth 12
    break
  }
  'leave-submit' {
    if (-not $Dates -or -not $Reason) { throw 'leave-submit 需要 Dates（逗号分隔 YYYY-MM-DD）和 Reason' }
    if (-not $Confirmed) { throw '提交请假前必须传入 -Confirmed' }
    $body = @{ work_dates = @($Dates -split ',' | ForEach-Object { $_.Trim() }); reason = $Reason; confirmed = $true } | ConvertTo-Json
    Invoke-RestMethod "$base/leave-requests" -Method Post -Headers $headers -ContentType 'application/json' -Body $body | ConvertTo-Json -Depth 12
    break
  }
  'leave-approve' { $path = "$base/leave-requests/$RequestId/approve" }
  'leave-reject' { $path = "$base/leave-requests/$RequestId/reject" }
  'schedule-approve' { $path = "$base/schedule-requests/$RequestId/approve" }
  'schedule-reject' { $path = "$base/schedule-requests/$RequestId/reject" }
  'notification-read' {
    if (-not $NotificationId) { throw 'notification-read 需要 NotificationId' }
    if (-not $Confirmed) { throw '标记已读前必须传入 -Confirmed' }
    Invoke-RestMethod "$base/notifications/$NotificationId/read" -Method Post -Headers $headers -ContentType 'application/json' -Body (@{ confirmed = $true } | ConvertTo-Json) | ConvertTo-Json -Depth 12
    break
  }
  'task-submit' {
    if (-not $TaskId) { throw 'task-submit 需要 TaskId' }
    if (-not $Confirmed) { throw '提交待办前必须传入 -Confirmed' }
    $body = @{ confirmed = $true; content = $Content } | ConvertTo-Json
    Invoke-RestMethod "$base/tasks/$TaskId/submit" -Method Post -Headers $headers -ContentType 'application/json' -Body $body | ConvertTo-Json -Depth 12
    break
  }
}
if ($Action -in @('leave-approve','leave-reject','schedule-approve','schedule-reject')) {
  if (-not $RequestId) { throw "$Action 需要 RequestId" }
  if (-not $Confirmed) { throw '执行审批前必须传入 -Confirmed' }
  $body = @{ confirmed = $true; note = $Note } | ConvertTo-Json
  Invoke-RestMethod $path -Method Post -Headers $headers -ContentType 'application/json' -Body $body | ConvertTo-Json -Depth 12
}
