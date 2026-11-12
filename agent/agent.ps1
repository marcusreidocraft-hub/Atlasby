$ErrorActionPreference = "Stop"
$fails = @{}
$logFile = "C:\ProgramData\AtlasCloudPC\agent.log"

function Write-AgentLog([string]$message) {
  try {
    $dir = Split-Path -Parent $logFile
    if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
    $clean = [string]$message
    $hidden = @()
    if ($script:secret) { $hidden += [string]$script:secret }
    if ($script:config -and $script:config.AgentSecret) { $hidden += [string]$script:config.AgentSecret }
    if ($script:config -and $script:config.SunshinePassword) { $hidden += [string]$script:config.SunshinePassword }
    foreach ($item in $hidden) {
      if ($item) { $clean = $clean.Replace($item, "[omitido]") }
    }
    $stamp = [DateTime]::UtcNow.ToString("yyyy-MM-ddTHH:mm:ssZ")
    Add-Content -Path $logFile -Value ($stamp + " " + $clean) -Encoding UTF8
  } catch {}
}

try {
  $here = Split-Path -Parent $MyInvocation.MyCommand.Path
  $configPath = Join-Path $here "agent.config.json"
  if (-not (Test-Path $configPath)) { throw "Falta agent.config.json ao lado do agente." }
  $config = Get-Content -Raw -Path $configPath | ConvertFrom-Json
  $port = 7474
  if ($config.AgentPort) { $port = [int]$config.AgentPort }
  $sunshinePort = 47990
  if ($config.SunshinePort) { $sunshinePort = [int]$config.SunshinePort }
  $secret = [string]$config.AgentSecret
  if (-not ("AtlasCloudPC.LocalTrust2" -as [type])) {
    Add-Type @"
using System.Net;
using System.Net.Security;
using System.Security.Cryptography.X509Certificates;
namespace AtlasCloudPC {
  public static class LocalTrust2 {
    public static bool Allow(object sender, X509Certificate certificate, X509Chain chain, SslPolicyErrors errors) {
      var request = sender as HttpWebRequest;
      if (request == null || request.RequestUri == null) return false;
      return request.RequestUri.Host == "127.0.0.1";
    }
    public static RemoteCertificateValidationCallback Callback { get { return new RemoteCertificateValidationCallback(Allow); } }
  }
}
"@
  }
  [System.Net.ServicePointManager]::ServerCertificateValidationCallback = [AtlasCloudPC.LocalTrust2]::Callback
  [System.Net.ServicePointManager]::SecurityProtocol = [System.Net.SecurityProtocolType]::Tls12
  $listener = New-Object System.Net.HttpListener
  $listener.Prefixes.Add("http://+:$port/")
  $listener.Start()
  Write-AgentLog ("Agente iniciado. Escutando na porta " + $port + ".")
} catch {
  Write-AgentLog ("Falha ao iniciar o agente: " + $_.Exception.Message)
  throw
}

function Test-Secret([string]$given, [string]$expected) {
  $left = [Text.Encoding]::UTF8.GetBytes([string]$given)
  $right = [Text.Encoding]::UTF8.GetBytes([string]$expected)
  $length = [Math]::Max($left.Length, $right.Length)
  $diff = $left.Length -bxor $right.Length
  for ($index = 0; $index -lt $length; $index++) {
    $a = 0
    $b = 0
    if ($index -lt $left.Length) { $a = $left[$index] }
    if ($index -lt $right.Length) { $b = $right[$index] }
    $diff = $diff -bor ($a -bxor $b)
  }
  return ($diff -eq 0) -and ($expected.Length -gt 0)
}

function Add-Failure([string]$ip) {
  $now = [DateTime]::UtcNow
  $recent = @()
  if ($fails.ContainsKey($ip)) {
    $recent = @($fails[$ip] | Where-Object { $_ -gt $now.AddMinutes(-1) })
  }
  $recent += $now
  $fails[$ip] = $recent
  return $recent.Count -gt 20
}

function Send-Json($response, [int]$status, $body) {
  $bytes = [Text.Encoding]::UTF8.GetBytes(($body | ConvertTo-Json -Compress))
  $response.StatusCode = $status
  $response.ContentType = "application/json; charset=utf-8"
  $response.ContentLength64 = $bytes.Length
  $response.OutputStream.Write($bytes, 0, $bytes.Length)
  $response.Close()
}

function Invoke-Sunshine([string]$path, $payload) {
  if (-not $config.SunshineUser -or -not $config.SunshinePassword) {
    Write-AgentLog ("Falha ao chamar o Sunshine em " + $path + ": credenciais ausentes.")
    return @{ ok = $false; error = "sunshine" }
  }
  $pair = "{0}:{1}" -f [string]$config.SunshineUser, [string]$config.SunshinePassword
  $basic = [Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes($pair))
  $request = [System.Net.HttpWebRequest]::Create("https://127.0.0.1:$sunshinePort$path")
  $request.Method = "POST"
  $request.ContentType = "application/json"
  $request.Timeout = 10000
  $request.Headers.Add("Authorization", "Basic $basic")
  $bytes = [Text.Encoding]::UTF8.GetBytes(($payload | ConvertTo-Json -Compress))
  $request.ContentLength = $bytes.Length
  $stream = $request.GetRequestStream()
  $stream.Write($bytes, 0, $bytes.Length)
  $stream.Close()
  try {
    $response = $request.GetResponse()
    $response.Close()
    return @{ ok = $true; result = "aceito" }
  } catch {
    $detail = [string]$_.Exception.Message
    if ($payload -and $payload.pin) { $detail = $detail.Replace([string]$payload.pin, "[omitido]") }
    Write-AgentLog ("Falha ao chamar o Sunshine em " + $path + ": " + $detail)
    return @{ ok = $false; error = "sunshine" }
  }
}

while ($listener.IsListening) {
  $context = $listener.GetContext()
  $request = $context.Request
  $response = $context.Response
  try {
    $ip = [string]$request.RemoteEndPoint.Address
    $header = [string]$request.Headers["Authorization"]
    $given = ""
    if ($header.StartsWith("Bearer ")) { $given = $header.Substring(7).Trim() }
    $authorized = Test-Secret $given $secret
    if (-not $authorized) {
      $limited = Add-Failure $ip
      if ($limited) { Send-Json $response 429 @{ ok = $false; error = "muitas tentativas" } }
      else { Send-Json $response 401 @{ ok = $false; error = "não autorizado" } }
      continue
    }
    $path = $request.Url.AbsolutePath.TrimEnd("/")
    if ($request.HttpMethod -eq "GET" -and $path -eq "/health") {
      Send-Json $response 200 @{ ok = $true }
      continue
    }
    $reader = New-Object IO.StreamReader($request.InputStream, [Text.Encoding]::UTF8)
    $raw = $reader.ReadToEnd()
    $reader.Close()
    if ($raw.Length -gt 4096) {
      Send-Json $response 400 @{ ok = $false; error = "pedido inválido" }
      continue
    }
    if ($request.HttpMethod -eq "POST" -and $path -eq "/pin") {
      $data = $null
      try { $data = $raw | ConvertFrom-Json } catch { $data = $null }
      if (-not $data -or [string]$data.pin -notmatch '^\d{4}$') {
        Send-Json $response 400 @{ ok = $false; error = "pedido inválido" }
        continue
      }
      $result = Invoke-Sunshine "/api/pin" @{ pin = [string]$data.pin; name = "Cliente" }
      if ($result.ok) { Send-Json $response 200 @{ ok = $true; result = "aceito" } }
      else { Send-Json $response 502 @{ ok = $false; error = "sunshine" } }
      continue
    }
    if ($request.HttpMethod -eq "POST" -and $path -eq "/unpair-all") {
      $result = Invoke-Sunshine "/api/clients/unpair-all" @{}
      if ($result.ok) { Send-Json $response 200 @{ ok = $true; result = "despareado" } }
      else { Send-Json $response 502 @{ ok = $false; error = "sunshine" } }
      continue
    }
    Send-Json $response 404 @{ ok = $false; error = "não encontrado" }
  } catch {
    $detail = [string]$_.Exception.Message
    if ($raw) { $detail = $detail.Replace([string]$raw, "[omitido]") }
    if ($data -and $data.pin) { $detail = $detail.Replace([string]$data.pin, "[omitido]") }
    if ($given) { $detail = $detail.Replace([string]$given, "[omitido]") }
    Write-AgentLog ("Erro no listener: " + $detail)
    try { Send-Json $response 500 @{ ok = $false; error = "erro interno" } } catch {}
  }
}
