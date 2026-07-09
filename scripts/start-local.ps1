$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$logDir = Join-Path $root ".local"
New-Item -ItemType Directory -Path $logDir -Force | Out-Null
$stdout = Join-Path $logDir "local.out.log"

$info = New-Object System.Diagnostics.ProcessStartInfo
$info.FileName = "cmd.exe"
$info.Arguments = "/c npx.cmd vite preview --host 127.0.0.1 --port 5195 --strictPort --configLoader native > ""$stdout"" 2>&1"
$info.WorkingDirectory = $root
$info.UseShellExecute = $true
$info.WindowStyle = [System.Diagnostics.ProcessWindowStyle]::Hidden

$process = New-Object System.Diagnostics.Process
$process.StartInfo = $info
$process.Start() | Out-Null
$process.Id | Set-Content -Path (Join-Path $logDir "vite.pid")
