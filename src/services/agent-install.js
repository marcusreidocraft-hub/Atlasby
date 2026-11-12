import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const AGENT_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../agent/agent.ps1");

function psQuote(value) {
  return `'${String(value ?? "").replaceAll("'", "''")}'`;
}

function sunshineInstall() {
  return `
  try { winget install --id LizardByte.Sunshine -e --silent --accept-package-agreements --accept-source-agreements | Out-Null } catch {}
  $exe = Find-Sunshine
  if (-not $exe) {
    try {
      $release = Invoke-RestMethod -UseBasicParsing -Uri 'https://api.github.com/repos/LizardByte/Sunshine/releases/latest'
      $asset = $release.assets | Where-Object { $_.name -match 'Windows.*installer.*\\.exe$' } | Select-Object -First 1
      if ($asset) {
        $setup = Join-Path $env:TEMP 'AtlasSunshineSetup.exe'
        Invoke-WebRequest -UseBasicParsing -Uri $asset.browser_download_url -OutFile $setup
        Start-Process -FilePath $setup -ArgumentList '/S' -Wait
      }
    } catch {}
    $exe = Find-Sunshine
  }`;
}

export function buildAgentInstallScript({ botUrl, token, installSunshine = false, source = null }) {
  const file = source ?? fs.readFileSync(AGENT_PATH);
  const payload = Buffer.from(file).toString("base64");
  const install = installSunshine ? sunshineInstall() : "\n  $exe = Find-Sunshine";
  return `$ErrorActionPreference = 'Stop'
$dest = 'C:\\ProgramData\\AtlasCloudPC'
New-Item -ItemType Directory -Force -Path $dest | Out-Null
[IO.File]::WriteAllBytes((Join-Path $dest 'agent.ps1'), [Convert]::FromBase64String(${psQuote(payload)}))
$botUrl = ${psQuote(botUrl)}
$token = ${psQuote(token)}
function Find-Sunshine {
  $cmd = Get-Command sunshine.exe -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  foreach ($candidate in @('C:\\Program Files\\Sunshine\\sunshine.exe', 'C:\\Program Files (x86)\\Sunshine\\sunshine.exe')) {
    if (Test-Path $candidate) { return $candidate }
  }
  return $null
}
$configPath = Join-Path $dest 'config.json'
$user = ''
$pass = ''
if (Test-Path $configPath) {
  try {
    $old = Get-Content -Raw -Path $configPath | ConvertFrom-Json
    if ($old.SUNSHINE_USER -and $old.SUNSHINE_PASSWORD) {
      $user = [string]$old.SUNSHINE_USER
      $pass = [string]$old.SUNSHINE_PASSWORD
    }
  } catch {}
}
if (-not $user -or -not $pass) {
  $user = 'atlas' + -join ((48..57 + 97..122) | Get-Random -Count 8 | ForEach-Object { [char]$_ })
  $bytes = New-Object byte[] 18
  [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
  $pass = ([Convert]::ToBase64String($bytes)).TrimEnd('=').Replace('+','a').Replace('/','b')
${install}
  if (-not $exe) { throw 'Sunshine não encontrado nesta VM.' }
  & $exe --creds $user $pass *> $null
  if ($LASTEXITCODE -ne 0) { throw 'Falha ao definir as credenciais do Sunshine.' }
}
$json = @{ BOT_URL = $botUrl; AGENT_TOKEN = $token; SUNSHINE_USER = $user; SUNSHINE_PASSWORD = $pass } | ConvertTo-Json -Compress
[IO.File]::WriteAllText($configPath, $json)
icacls $configPath /inheritance:r /grant:r '*S-1-5-18:(F)' '*S-1-5-32-544:(F)' | Out-Null
$command = 'powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "' + (Join-Path $dest 'agent.ps1') + '"'
schtasks.exe /Create /TN 'Atlas Cloud PC Agent' /SC ONSTART /RU SYSTEM /RL HIGHEST /F /TR $command | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Não foi possível registrar a tarefa do agente.' }
schtasks.exe /Run /TN 'Atlas Cloud PC Agent' | Out-Null
Write-Output 'agente instalado'
`;
}
