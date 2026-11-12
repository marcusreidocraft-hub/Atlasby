# Execute uma vez como Administrador, na VM que vai virar a imagem base.
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$dest = "C:\ProgramData\AtlasCloudPC"
New-Item -ItemType Directory -Force -Path $dest | Out-Null
Copy-Item (Join-Path $root "agent.ps1") (Join-Path $dest "agent.ps1") -Force
$sourceConfig = Join-Path $root "agent.config.json"
$destConfig = Join-Path $dest "agent.config.json"
if (-not (Test-Path $destConfig)) { Copy-Item $sourceConfig $destConfig }
$config = Get-Content -Raw -Path $destConfig | ConvertFrom-Json
$port = 7474
if ($config.AgentPort) { $port = [int]$config.AgentPort }
netsh advfirewall firewall delete rule name="Atlas Cloud PC Agent" | Out-Null
netsh advfirewall firewall add rule name="Atlas Cloud PC Agent" dir=in action=allow protocol=TCP localport=$port | Out-Null
netsh http delete urlacl url="http://+:$port/" | Out-Null
netsh http add urlacl url="http://+:$port/" user="NT AUTHORITY\SYSTEM" | Out-Null
$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$dest\agent.ps1`""
$trigger = New-ScheduledTaskTrigger -AtStartup
$principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero)
Register-ScheduledTask -TaskName "Atlas Cloud PC Agent" -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force | Out-Null
Start-ScheduledTask -TaskName "Atlas Cloud PC Agent"
Write-Host "Agente instalado. Confira o Sunshine e o AgentSecret e depois capture a imagem desta VM."
