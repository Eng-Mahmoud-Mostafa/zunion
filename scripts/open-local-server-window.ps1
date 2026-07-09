$ErrorActionPreference = "Stop"

$bat = Join-Path (Split-Path -Parent $PSScriptRoot) "scripts\open-local-server.bat"
Start-Process -FilePath "cmd.exe" -ArgumentList @("/k", "`"$bat`"") -WindowStyle Normal
