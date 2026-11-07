# Claude Code hook for the Herdr mod "agent-groups": marks running sub-agents on the session's terminal.
#   start -> label sub.<agent_id>=<agent_type>   (SubagentStart)
#   stop  -> label sub.<agent_id>= (removed)     (SubagentStop)
#   clear -> removes every sub.* label           (SessionStart startup|resume, SessionEnd: no stop comes after a crash)
# One label per sub-agent, so parallel hooks never overwrite each other.
param([string]$Action = "")

$terminal = $env:HC_TERMINAL_ID
if ([string]::IsNullOrWhiteSpace($terminal)) { exit 0 }

if ($Action -eq "clear") {
    try { $info = hc get $terminal --json 2>$null | ConvertFrom-Json } catch { exit 0 }
    $keys = @($info.labels.PSObject.Properties.Name | Where-Object { $_ -like "sub.*" })
    if ($keys.Count -gt 0) { hc label $terminal @($keys | ForEach-Object { "$_=" }) 2>$null | Out-Null }
    exit 0
}

$reader = New-Object System.IO.StreamReader([Console]::OpenStandardInput(), [System.Text.Encoding]::UTF8)
try { $payload = $reader.ReadToEnd() | ConvertFrom-Json } catch { exit 0 }
$id = "$($payload.agent_id)"
if ($id -notmatch '^[A-Za-z0-9_-]+$') { exit 0 }

if ($Action -eq "start") {
    $type = "$($payload.agent_type)"
    if ($type -notmatch '^[\w:.-]+$') { $type = "agent" }
    hc label $terminal "sub.$id=$type" 2>$null | Out-Null
} elseif ($Action -eq "stop") {
    hc label $terminal "sub.$id=" 2>$null | Out-Null
}
exit 0
