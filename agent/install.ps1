# Execute como Administrador, na pasta que contém agent.ps1 e config.example.json.
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$dest = "C:\ProgramData\AtlasCloudPC"
New-Item -ItemType Directory -Force -Path $dest | Out-Null
Copy-Item (Join-Path $root "agent.ps1") (Join-Path $dest "agent.ps1") -Force
$config = Join-Path $dest "config.json"
if (-not (Test-Path $config)) {
  Copy-Item (Join-Path $root "config.example.json") $config
  Write-Host "Edite C:\ProgramData\AtlasCloudPC\config.json e rode este instalador de novo."
  exit 1
}
$command = "powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$dest\agent.ps1`""
schtasks.exe /Create /TN "Atlas Cloud PC Agent" /SC ONSTART /RU SYSTEM /RL HIGHEST /F /TR $command
if ($LASTEXITCODE -ne 0) { throw "Não foi possível registrar a tarefa." }
schtasks.exe /Run /TN "Atlas Cloud PC Agent"
Write-Host "Agente instalado. A tarefa Atlas Cloud PC Agent inicia com o Windows, como SYSTEM."
