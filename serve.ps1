# Minimal static file server for the Fitness app.
#
# This machine has neither Node nor Python, so `npx serve .` and
# `python -m http.server` aren't available. This uses .NET's HttpListener,
# which ships with Windows - no install step, consistent with the app's
# no-build-step constraint.
#
# Usage:  .\serve.ps1            (serves this folder on http://localhost:47613)
#         .\serve.ps1 -Port 9000
#
# On macOS, use `python3 -m http.server 47613` instead.
#
# Why port 47613 and not something memorable: the GitHub token lives in
# localStorage, which is scoped to the origin - and http://localhost:PORT is
# the SAME origin for anything else you ever serve on that port. A common
# port (3000, 8000, 8080, 8123...) means some future dev server and its whole
# npm dependency tree could read the token. Keep this port dedicated to this
# app, and always serve it on the same port or the token/settings won't
# follow you.

param(
  [int]$Port = 47613,
  [switch]$NoBrowser
)

$Root = $PSScriptRoot
$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$Port/")

try {
  $listener.Start()
} catch {
  Write-Host ""
  Write-Host "  Could not bind to port $Port - something is already listening." -ForegroundColor Red

  # Almost always a previous instance of this script. Note that netstat/
  # Get-NetTCPConnection report the owner as PID 4 (System) because
  # HttpListener registers with the HTTP.SYS kernel driver, so match on the
  # command line instead to find the real process.
  #
  # Require "-File ...serve.ps1" rather than a bare "serve.ps1" substring:
  # any shell that merely mentions the name would otherwise be listed, and
  # this prints Stop-Process commands the user is expected to run.
  $stale = @(Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" |
    Where-Object { $_.ProcessId -ne $PID -and $_.CommandLine -like "*-File*serve.ps1*" })

  if ($stale) {
    Write-Host "  An older serve.ps1 is still running. Stop it with:" -ForegroundColor Yellow
    foreach ($p in $stale) { Write-Host "      Stop-Process -Id $($p.ProcessId) -Force" -ForegroundColor Cyan }
    Write-Host "  Then run .\serve.ps1 again." -ForegroundColor Yellow
  } else {
    Write-Host "  It isn't another serve.ps1 - check what else uses this port." -ForegroundColor Yellow
  }

  # Deliberately NOT suggesting -Port <other>: the GitHub token and settings
  # live in localStorage, which is scoped to http://localhost:$Port. Serving
  # on a different port makes the app look signed out, and leaves the token
  # sitting on the old origin. Free this port instead of moving off it.
  Write-Host "  Avoid switching ports - the saved token is tied to this one." -ForegroundColor DarkGray
  Write-Host ""
  exit 1
}

Write-Host ""
Write-Host "  Fitness app serving at " -NoNewline
Write-Host "http://localhost:$Port/" -ForegroundColor Cyan
Write-Host "  Root: $Root"
Write-Host "  Press Ctrl+C to stop."
Write-Host ""

if (-not $NoBrowser) { Start-Process "http://localhost:$Port/" }

$mime = @{
  ".html" = "text/html; charset=utf-8"
  ".js"   = "application/javascript; charset=utf-8"
  ".css"  = "text/css; charset=utf-8"
  ".json" = "application/json; charset=utf-8"
  ".svg"  = "image/svg+xml"
  ".png"  = "image/png"
  ".ico"  = "image/x-icon"
  ".woff2" = "font/woff2"
}

while ($listener.IsListening) {
  $context = $listener.GetContext()
  $req = $context.Request
  $res = $context.Response
  try {
    $path = [System.Uri]::UnescapeDataString($req.Url.AbsolutePath)
    if ($path -eq "/") { $path = "/index.html" }

    $filePath = Join-Path $Root ($path.TrimStart("/"))

    # Keep requests inside the served folder.
    $fullRoot = [System.IO.Path]::GetFullPath($Root)
    $fullReq  = [System.IO.Path]::GetFullPath($filePath)
    if (-not $fullReq.StartsWith($fullRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
      $res.StatusCode = 403
      return
    }

    if (Test-Path $filePath -PathType Leaf) {
      $ext = [System.IO.Path]::GetExtension($filePath).ToLower()
      $contentType = $mime[$ext]
      if (-not $contentType) { $contentType = "application/octet-stream" }
      $bytes = [System.IO.File]::ReadAllBytes($filePath)
      $res.ContentType = $contentType
      # Data files change often; don't let the browser serve a stale copy.
      $res.Headers.Add("Cache-Control", "no-cache")
      $res.ContentLength64 = $bytes.Length
      $res.OutputStream.Write($bytes, 0, $bytes.Length)
      Write-Host "  200  $path" -ForegroundColor DarkGray
    } else {
      $res.StatusCode = 404
      $msg = [System.Text.Encoding]::UTF8.GetBytes("Not found: $path")
      $res.OutputStream.Write($msg, 0, $msg.Length)
      Write-Host "  404  $path" -ForegroundColor DarkYellow
    }
  } catch {
    $res.StatusCode = 500
  } finally {
    $res.OutputStream.Close()
  }
}
