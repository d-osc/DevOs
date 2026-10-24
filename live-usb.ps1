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
if ($Mode -in @('build','check','export','diagnose')) {
    & wsl -d $BuildDistribution --exec test -f "$OutputDirectory/manifest.json"
    if ($LASTEXITCODE -ne 0) {
        throw "Staging is missing or incomplete: $OutputDirectory/manifest.json. Run prepare successfully first. For diagnostic staging, run diagnose on the prepared base directory before using its -diagnostic directory. Changing the PowerShell variable alone does not create staging."
    }
}
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
    $taskPartial = "$taskTarget.$([Guid]::NewGuid().ToString('N')).partial"
    try {
        $taskSource = [IO.File]::OpenRead((Join-Path $taskSourceDirectory $taskName))
        try {
            $taskDestination = [IO.FileStream]::new($taskPartial, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
            try { $taskSource.CopyTo($taskDestination, 4MB); $taskDestination.Flush($true) }
            finally { $taskDestination.Dispose() }
        } finally { $taskSource.Dispose() }
        $taskActual = (Get-FileHash -LiteralPath $taskPartial -Algorithm SHA256).Hash.ToLowerInvariant()
        if ($taskActual -ne $taskExpected) { throw 'Exported image checksum mismatch. Nothing was published for flashing.' }
        Move-Item -LiteralPath $taskPartial -Destination $taskTarget
    } finally {
        if (Test-Path -LiteralPath $taskPartial) { Remove-Item -LiteralPath $taskPartial }
    }
    [IO.File]::WriteAllText((Join-Path $taskDirectory 'SHA256SUMS'), "$taskActual  $taskName`n", [Text.UTF8Encoding]::new($false))
    Copy-Item -LiteralPath (Join-Path $taskSourceDirectory 'manifest.json') -Destination (Join-Path $taskDirectory 'candidate.json')
    Write-Host "Exported and verified: $taskTarget"
    return
}
if ($Mode -eq 'prepare') {
    if (-not $FirmwareDirectory) {
        foreach ($taskCandidate in @('firmware-oem-wifi-verified', 'firmware')) {
            $taskManifestPath = Join-Path $PSScriptRoot "build/live-usb/$taskCandidate/manifest.json"
            if (-not (Test-Path -LiteralPath $taskManifestPath)) { continue }
            $taskManifest = Get-Content -LiteralPath $taskManifestPath -Raw | ConvertFrom-Json
            if ($taskManifest.wireless.pci -eq '17cb:1112' -and $taskManifest.wireless.subsystem -eq '105b:e14f' -and
                $taskManifest.wireless.boardData -eq 'ath12k/QCC2072/hw1.0/board.bin') {
                $FirmwareDirectory = "$taskRoot/build/live-usb/$taskCandidate"
                break
            }
        }
        if (-not $FirmwareDirectory) { throw 'Collect a fresh UX3407NA firmware bundle with distro/usb/stage-x2-firmware.ps1 into a new directory, then pass -FirmwareDirectory. The old DSP-only bundle cannot initialize Wi-Fi.' }
    }
    # Validate before any BusyBox build or rootfs/image staging.
    & wsl -d $BuildDistribution --exec python3 "$taskRoot/distro/usb/prepare.py" firmware-check --firmware $FirmwareDirectory
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
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
