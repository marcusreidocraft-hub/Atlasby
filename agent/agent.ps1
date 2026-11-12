$ErrorActionPreference = "Stop"
$Version = "1.0.0"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$configPath = Join-Path $here "config.json"

function Enable-LocalTrust {
  if (-not ([System.Management.Automation.PSTypeName]"AtlasCloudPCTrustAll").Type) {
    Add-Type @"
using System.Net;
using System.Security.Cryptography.X509Certificates;
public class AtlasCloudPCTrustAll : ICertificatePolicy {
  public bool CheckValidationResult(ServicePoint point, X509Certificate certificate, WebRequest request, int problem) { return true; }
}
"@
  }
  [System.Net.ServicePointManager]::CertificatePolicy = New-Object AtlasCloudPCTrustAll
  [System.Net.ServicePointManager]::SecurityProtocol = [System.Net.SecurityProtocolType]::Tls12
}

function Invoke-Atlas {
  param($Method, $Uri, $Headers, $Body, $TimeoutSec)
  Enable-LocalTrust
  $params = @{
    Method = $Method
    Uri = $Uri
    Headers = $Headers
    TimeoutSec = $TimeoutSec
  }
  if ($PSVersionTable.PSVersion.Major -ge 6) { $params.SkipCertificateCheck = $true }
  if ($null -ne $Body) {
    $params.Body = $Body
    $params.ContentType = "application/json"
  }
  return Invoke-RestMethod @params
}

function Test-Sunshine {
  param($Config)
  if (-not $Config.SUNSHINE_USER -or -not $Config.SUNSHINE_PASSWORD) { return $false }
  try {
    $pair = "{0}:{1}" -f $Config.SUNSHINE_USER, $Config.SUNSHINE_PASSWORD
    $basic = [Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes($pair))
    Invoke-Atlas -Method GET -Uri "https://localhost:47990/api/apps" -Headers @{ Authorization = "Basic $basic" } -TimeoutSec 5 | Out-Null
    return $true
  } catch {
    return $false
  }
}

function Send-Pin {
  param($Config, $Job)
  $pair = "{0}:{1}" -f $Config.SUNSHINE_USER, $Config.SUNSHINE_PASSWORD
  $basic = [Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes($pair))
  $body = @{ pin = [string]$Job.pin; name = [string]$Job.name } | ConvertTo-Json -Compress
  Invoke-Atlas -Method POST -Uri "https://localhost:47990/api/pin" -Headers @{ Authorization = "Basic $basic" } -Body $body -TimeoutSec 15 | Out-Null
}

if (-not (Test-Path $configPath)) { throw "Falta config.json ao lado do agente." }
$config = Get-Content -Raw -Path $configPath | ConvertFrom-Json
if (-not $config.BOT_URL -or -not $config.AGENT_TOKEN) { throw "Preencha BOT_URL e AGENT_TOKEN." }
$base = $config.BOT_URL.TrimEnd("/")

while ($true) {
  try {
    $sunshine = Test-Sunshine -Config $config
    $headers = @{
      Authorization = "Bearer $($config.AGENT_TOKEN)"
      "X-Agent-Version" = $Version
      "X-Sunshine-Ok" = $(if ($sunshine) { "1" } else { "0" })
    }
    $poll = Invoke-Atlas -Method GET -Uri "$base/agent/v1/poll" -Headers $headers -TimeoutSec 40
    if ($poll.job) {
      $ok = $false
      $detail = "falha ao falar com o Sunshine"
      try {
        if (-not $config.SUNSHINE_USER -or -not $config.SUNSHINE_PASSWORD) { throw "credencial ausente" }
        Send-Pin -Config $config -Job $poll.job
        $ok = $true
        $detail = "pareado"
      } catch {
        $detail = "falha ao falar com o Sunshine"
      }
      $result = @{ id = [string]$poll.job.id; ok = $ok; detail = $detail } | ConvertTo-Json -Compress
      Invoke-Atlas -Method POST -Uri "$base/agent/v1/result" -Headers $headers -Body $result -TimeoutSec 20 | Out-Null
    }
  } catch {
    Start-Sleep -Seconds 5
  }
}
