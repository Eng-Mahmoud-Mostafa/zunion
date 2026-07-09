$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$pidFile = Join-Path $root ".local\serve-local.pid"

$info = New-Object System.Diagnostics.ProcessStartInfo
$info.FileName = "C:\Program Files\nodejs\node.exe"
$info.Arguments = "scripts\serve-local.cjs"
$info.WorkingDirectory = $root
$info.UseShellExecute = $true
$info.WindowStyle = [System.Diagnostics.ProcessWindowStyle]::Hidden

$process = [System.Diagnostics.Process]::Start($info)
$process.Id | Set-Content -Path $pidFile
Write-Host "Started Zunion local server PID $($process.Id)"
