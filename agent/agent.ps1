$ErrorActionPreference = "Stop"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$config = Get-Content -Raw -Path (Join-Path $here "agent.config.json") | ConvertFrom-Json
$port = 7474
if ($config.AgentPort) { $port = [int]$config.AgentPort }
$sunshinePort = 47990
if ($config.SunshinePort) { $sunshinePort = [int]$config.SunshinePort }
$secret = [string]$config.AgentSecret
$fails = @{}

if (-not ("AtlasCloudPC.LocalTrust" -as [type])) {
  Add-Type @"
using System.Net;
using System.Net.Security;
using System.Security.Cryptography.X509Certificates;
namespace AtlasCloudPC {
  public static class LocalTrust {
    public static bool Allow(object sender, X509Certificate certificate, X509Chain chain, SslPolicyErrors errors) {
      var request = sender as HttpWebRequest;
      if (request == null || request.RequestUri == null) return false;
      return request.RequestUri.Host == "127.0.0.1";
    }
  }
}
"@
}
[System.Net.ServicePointManager]::ServerCertificateValidationCallback = [AtlasCloudPC.LocalTrust]::Allow
[System.Net.ServicePointManager]::SecurityProtocol = [System.Net.SecurityProtocolType]::Tls12

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
  if (-not $config.SunshineUser -or -not $config.SunshinePassword) { return @{ ok = $false; error = "sunshine" } }
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
    return @{ ok = $false; error = "sunshine" }
  }
}

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://+:$port/")
$listener.Start()

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
    try { Send-Json $response 500 @{ ok = $false; error = "erro interno" } } catch {}
  }
}
