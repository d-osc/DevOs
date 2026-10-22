param([Parameter(Mandatory = $true)][ValidatePattern('^[a-z][a-z0-9_-]{0,30}$')][string]$User)
$ErrorActionPreference = 'Stop'
if ($User -in @('root', 'devos-greeter', 'nobody')) { throw 'Select a personal Linux user.' }
$taskProject = Split-Path -Parent $PSScriptRoot
$taskScript = Join-Path $taskProject 'dev.ps1'
$taskLogs = Join-Path $taskProject 'build/user-sessions'
New-Item -ItemType Directory -Force -Path $taskLogs | Out-Null
$taskPowerShell = (Get-Process -Id $PID).Path
$taskArguments = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ('"' + $taskScript + '"'), '-Mode', 'run', '-User', $User)
Start-Process -FilePath $taskPowerShell -ArgumentList $taskArguments -WindowStyle Hidden -RedirectStandardOutput (Join-Path $taskLogs "$User.log") -RedirectStandardError (Join-Path $taskLogs "$User.error.log") | Out-Null
