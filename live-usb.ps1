param(
    [ValidateSet('kernel','prepare','check','build','export','diagnose')][string]$Mode = 'prepare',
    [string]$BuildDistribution = 'Ubuntu',
    [string]$OutputDirectory = '/var/tmp/devos-usb/x2-live',
    [string]$KernelBundle = '/var/tmp/devos-kernel-x2/bundle',
    [string]$FirmwareDirectory,
    [string]$KernelProject = (Join-Path (Split-Path $PSScriptRoot -Parent) 'DevOsLinuxKernel')
)
$ErrorActionPreference = 'Stop'
$taskRoot = (& wsl -d $BuildDistribution --exec wslpath -a $PSScriptRoot).Trim()
if ($LASTEXITCODE -ne 0) { throw 'Cannot resolve project path.' }
if ($Mode -eq 'kernel') {
    $taskKernelRoot = (& wsl -d $BuildDistribution --exec wslpath -a $KernelProject).Trim()
    if ($LASTEXITCODE -ne 0) { throw 'Cannot resolve DevOsLinuxKernel.' }
    & wsl -d $BuildDistribution --exec bash "$taskKernelRoot/scripts/build-snapdragon-x2.sh"
    exit $LASTEXITCODE
}
if (-not $OutputDirectory.StartsWith('/')) { throw 'Use an absolute Linux staging directory.' }
if ($Mode -eq 'export') {
    # Read WSL through Windows-native file I/O and verify the Windows copy.
    $taskDirectory = Join-Path $PSScriptRoot 'build/live-usb'
    New-Item -ItemType Directory -Force -Path $taskDirectory | Out-Null
    $taskName = 'devos-live-arm64-ux3407na.img'
    $taskTarget = Join-Path $taskDirectory $taskName
    if (Test-Path -LiteralPath $taskTarget) { throw "Refusing to overwrite $taskTarget" }
    & wsl -d $BuildDistribution --exec python3 "$taskRoot/distro/usb/prepare.py" check --output $OutputDirectory
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    $taskSourceDirectory = "\\wsl.localhost\$BuildDistribution" + $OutputDirectory.Replace('/', '\')
    $taskExpected = (Get-Content -LiteralPath (Join-Path $taskSourceDirectory 'SHA256SUMS') -Raw).Split()[0]
    if ($taskExpected -notmatch '^[a-f0-9]{64}$') { throw 'Invalid source checksum.' }
    $taskSource = [IO.File]::OpenRead((Join-Path $taskSourceDirectory $taskName))
    $taskDestination = [IO.FileStream]::new($taskTarget, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
    try { $taskSource.CopyTo($taskDestination, 4MB); $taskDestination.Flush($true) }
    finally { $taskDestination.Dispose(); $taskSource.Dispose() }
    $taskActual = (Get-FileHash -LiteralPath $taskTarget -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($taskActual -ne $taskExpected) { throw 'Exported image checksum mismatch. Do not flash it.' }
    [IO.File]::WriteAllText((Join-Path $taskDirectory 'SHA256SUMS'), "$taskActual  $taskName`n", [Text.UTF8Encoding]::new($false))
    Copy-Item -LiteralPath (Join-Path $taskSourceDirectory 'manifest.json') -Destination (Join-Path $taskDirectory 'candidate.json')
    Write-Host "Exported and verified: $taskTarget"
    return
}
if ($Mode -in @('prepare','diagnose')) {
    & wsl -d $BuildDistribution --exec bash "$taskRoot/distro/usb/busybox.sh"
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}
$taskUsbArgs = @($Mode, '--output', $OutputDirectory)
if ($KernelBundle) { $taskUsbArgs += @('--kernel-bundle', $KernelBundle) }
if ($FirmwareDirectory) { $taskUsbArgs += @('--firmware', $FirmwareDirectory) }
if ($Mode -eq 'export') { $taskUsbArgs += @('--export-directory', "$taskRoot/build/live-usb") }
& wsl -d $BuildDistribution --exec python3 "$taskRoot/distro/usb/prepare.py" @taskUsbArgs
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
