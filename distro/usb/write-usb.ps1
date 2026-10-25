[CmdletBinding()]
param([switch]$EraseDisk1, [switch]$VerifyOnly, [switch]$SelectTarget)
$ErrorActionPreference = 'Stop'
if (($EraseDisk1 -and $VerifyOnly) -or ($SelectTarget -and ($EraseDisk1 -or $VerifyOnly))) {
    throw 'Choose only one of -SelectTarget, -EraseDisk1 or -VerifyOnly. Selecting a USB never authorizes writing it.'
}
$taskDirectory = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../../build/live-usb'))
$taskImage = Join-Path $taskDirectory 'devos-live-arm64-ux3407na.img'
$taskTargetPath = Join-Path $taskDirectory 'usb-target.json'
$taskTarget = if (Test-Path -LiteralPath $taskTargetPath) { Get-Content -LiteralPath $taskTargetPath -Raw | ConvertFrom-Json } else { $null }
$taskCandidate = Get-Content -LiteralPath (Join-Path $taskDirectory 'candidate.json') -Raw | ConvertFrom-Json
if (-not $taskCandidate.imageReady) { throw 'The candidate has no integrated board boot components.' }
$taskExpected = (Get-Content -LiteralPath (Join-Path $taskDirectory 'SHA256SUMS') -Raw).Split()[0]
if ($taskExpected -notmatch '^[a-f0-9]{64}$') { throw 'Invalid expected image checksum.' }
$taskLength = (Get-Item -LiteralPath $taskImage).Length
# Get-FileHash may be unavailable in the noninteractive Windows PowerShell 5.1 host.
$taskImageHasher = [Security.Cryptography.SHA256]::Create()
$taskImageStream = [IO.File]::OpenRead($taskImage)
try { $taskImageHash = [BitConverter]::ToString($taskImageHasher.ComputeHash($taskImageStream)).Replace('-', '').ToLowerInvariant() }
finally { $taskImageStream.Dispose(); $taskImageHasher.Dispose() }
if ($taskImageHash -ne $taskExpected) { throw 'Image checksum mismatch.' }
function Assert-UsbTarget([switch]$IdentityOptional) {
    $taskDisk = Get-Disk -Number 1
    $taskReasons = @()
    if ($taskDisk.IsBoot -or $taskDisk.IsSystem) { $taskReasons += 'Disk 1 is a boot/system disk.' }
    if ($taskDisk.BusType -ne 'USB') { $taskReasons += 'Disk 1 is not a USB disk.' }
    if ($taskDisk.IsReadOnly) { $taskReasons += 'Disk 1 is read-only.' }
    if ($taskDisk.Size -le $taskLength) { $taskReasons += "The USB is too small for the $taskLength-byte image." }
    if ($taskDisk.LogicalSectorSize -ne 512) { $taskReasons += 'Only 512-byte logical sectors are supported.' }
    if ([string]::IsNullOrWhiteSpace([string]$taskDisk.UniqueId)) { $taskReasons += 'Disk 1 has no stable UniqueId.' }
    if (-not $IdentityOptional -and (-not $taskTarget -or
        $taskDisk.UniqueId -ne $taskTarget.UniqueId -or $taskDisk.FriendlyName -ne $taskTarget.FriendlyName -or
        $taskDisk.Size -ne $taskTarget.Size)) {
        $taskReasons += "Saved USB: $($taskTarget.FriendlyName) / $($taskTarget.Size) bytes. Current Disk 1: $($taskDisk.FriendlyName) / $($taskDisk.Size) bytes."
        $taskReasons += 'To select the current Disk 1, run this script with -SelectTarget first. That updates the local selection only; it does not erase or write the USB.'
    }
    if ($taskReasons.Count) { throw ("USB disk identity/safety check failed. Nothing was written.`n" + ($taskReasons -join "`n")) }
    return $taskDisk
}
$taskDisk = Assert-UsbTarget -IdentityOptional:$SelectTarget
$taskDriveLetter = [IO.Path]::GetPathRoot($taskImage)[0]
$taskLogical = Get-CimInstance Win32_LogicalDisk -Filter "DeviceID='${taskDriveLetter}:'"
$taskSourcePartition = @(Get-CimAssociatedInstance -InputObject $taskLogical -Association Win32_LogicalDiskToPartition)
if ($taskSourcePartition.Count -ne 1) { throw 'Cannot identify the disk containing the source image.' }
if ($taskSourcePartition[0].DiskIndex -eq 1) { throw 'The source image cannot be stored on the target USB.' }
Write-Host "Image: $taskImage ($taskLength bytes)"
Write-Host "Target: Disk 1 / $($taskDisk.FriendlyName) / $($taskDisk.Size) bytes"
if ($SelectTarget) {
    @{ Number = 1; FriendlyName = $taskDisk.FriendlyName; UniqueId = $taskDisk.UniqueId; Size = $taskDisk.Size } |
        ConvertTo-Json | Set-Content -LiteralPath $taskTargetPath -Encoding UTF8
    Write-Host 'USB selection saved locally. No disk changes. Run without switches to validate, or use -EraseDisk1 only when you intend to erase this exact USB.'
    return
}
if (-not $EraseDisk1 -and -not $VerifyOnly) { Write-Host 'Validation only. No disk changes. -EraseDisk1 authorizes erasing this USB.'; return }
$taskPrincipal = [Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $taskPrincipal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'Run this script from an Administrator PowerShell to write the USB.' }
. (Join-Path $PSScriptRoot 'volume-lock.ps1')
$taskDevice = $null; $taskSource = $null; $taskHash = $null; $taskRawHash = $null; $taskVolumeLocks = $null
function Get-HeaderCrc32([byte[]]$Bytes) {
    [uint32]$taskCrc = [uint32]::MaxValue
    foreach ($taskByte in $Bytes) {
        $taskCrc = $taskCrc -bxor $taskByte
        for ($taskBit = 0; $taskBit -lt 8; $taskBit++) {
            if ($taskCrc -band 1) { $taskCrc = ($taskCrc -shr 1) -bxor [uint32]3988292384 }
            else { $taskCrc = $taskCrc -shr 1 }
        }
    }
    return $taskCrc -bxor [uint32]::MaxValue
}
try {
    $null = Assert-UsbTarget
    $taskVolumeLocks = Lock-UsbVolumes -DiskNumber 1
    $null = Assert-UsbTarget
    $taskAccess = if ($VerifyOnly) { [IO.FileAccess]::Read } else { [IO.FileAccess]::ReadWrite }
    $taskDevice = [IO.FileStream]::new('\\.\PhysicalDrive1', [IO.FileMode]::Open, $taskAccess, [IO.FileShare]::ReadWrite)
    $taskSource = [IO.File]::OpenRead($taskImage)
    $taskBuffer = [byte[]]::new(4MB)
    [long]$taskWritten = 0
    while (-not $VerifyOnly -and ($taskCount = $taskSource.Read($taskBuffer, 0, $taskBuffer.Length)) -gt 0) {
        $taskDevice.Write($taskBuffer, 0, $taskCount)
        $taskWritten += $taskCount
        Write-Progress -Activity 'Writing DevOs Live USB' -PercentComplete (100 * $taskWritten / $taskLength)
    }
    if (-not $VerifyOnly) { $taskDevice.Flush($true) }
    $taskDevice.Position = 0
    $taskHash = [Security.Cryptography.SHA256]::Create()
    $taskRawHash = [Security.Cryptography.SHA256]::Create()
    $taskExpectedHeader = [byte[]]::new(512)
    $taskSource.Position = 512; $null = $taskSource.Read($taskExpectedHeader, 0, 512)
    $taskNormalized = $false
    [long]$taskRemaining = $taskLength
    while ($taskRemaining -gt 0) {
        $taskCount = $taskDevice.Read($taskBuffer, 0, [int][Math]::Min([long]$taskBuffer.Length, [long]$taskRemaining))
        if ($taskCount -eq 0) { throw 'Unexpected end of USB during verification.' }
        $null = $taskRawHash.TransformBlock($taskBuffer, 0, $taskCount, $taskBuffer, 0)
        if ($taskRemaining -eq $taskLength) {
            $taskActualHeader = [byte[]]::new(512)
            [Array]::Copy($taskBuffer, 512, $taskActualHeader, 0, 512)
            for ($taskIndex = 0; $taskIndex -lt 512; $taskIndex++) {
                if ($taskActualHeader[$taskIndex] -ne $taskExpectedHeader[$taskIndex]) {
                    if (-not (($taskIndex -ge 16 -and $taskIndex -le 19) -or ($taskIndex -ge 32 -and $taskIndex -le 39) -or ($taskIndex -ge 48 -and $taskIndex -le 55))) { throw 'Unexpected USB GPT header modification.' }
                    $taskNormalized = $true
                }
            }
            if ($taskNormalized) {
                [long]$taskLastSector = $taskDisk.Size / 512 - 1
                [long]$taskTableSectors = [Math]::Ceiling(([long][BitConverter]::ToUInt32($taskExpectedHeader, 80) * [BitConverter]::ToUInt32($taskExpectedHeader, 84)) / 512.0)
                if ([BitConverter]::ToInt64($taskActualHeader, 32) -ne $taskLastSector -or [BitConverter]::ToInt64($taskActualHeader, 48) -ne ($taskLastSector - $taskTableSectors - 1)) { throw 'Unexpected Windows GPT capacity adjustment.' }
                [int]$taskHeaderSize = [BitConverter]::ToUInt32($taskActualHeader, 12)
                if ($taskHeaderSize -ne 92) { throw 'Unexpected GPT header size.' }
                $taskCrcBytes = [byte[]]::new($taskHeaderSize)
                [Array]::Copy($taskActualHeader, $taskCrcBytes, $taskHeaderSize)
                [Array]::Clear($taskCrcBytes, 16, 4)
                if ((Get-HeaderCrc32 $taskCrcBytes) -ne [BitConverter]::ToUInt32($taskActualHeader, 16)) { throw 'Invalid GPT header CRC.' }
                [Array]::Copy($taskExpectedHeader, 0, $taskBuffer, 512, 512)
            }
        }
        $null = $taskHash.TransformBlock($taskBuffer, 0, $taskCount, $taskBuffer, 0)
        $taskRemaining -= $taskCount
        Write-Progress -Activity 'Verifying DevOs Live USB' -PercentComplete (100 * ($taskLength - $taskRemaining) / $taskLength)
    }
    $null = $taskHash.TransformFinalBlock([byte[]]@(), 0, 0)
    $null = $taskRawHash.TransformFinalBlock([byte[]]@(), 0, 0)
    $taskActual = [BitConverter]::ToString($taskHash.Hash).Replace('-', '').ToLowerInvariant()
    if ($taskActual -ne $taskExpected) { throw 'USB read-back checksum mismatch. Do not boot this USB.' }
    @{ Result = 'Verified'; Image = $taskImage; BytesVerified = $taskLength; SHA256 = $taskActual;
       RawSHA256 = [BitConverter]::ToString($taskRawHash.Hash).Replace('-', '').ToLowerInvariant(); WindowsGptCapacityNormalized = $taskNormalized;
       VerifyOnly = [bool]$VerifyOnly; DiskNumber = 1; UniqueId = $taskTarget.UniqueId; TimeUTC = [DateTime]::UtcNow.ToString('o') } |
        ConvertTo-Json | Set-Content -LiteralPath (Join-Path $taskDirectory 'usb-write-receipt.json') -Encoding UTF8
    Write-Host 'PASS: USB write and complete image read-back checksum.'
} finally {
    if ($taskHash) { $taskHash.Dispose() }
    if ($taskRawHash) { $taskRawHash.Dispose() }
    if ($taskSource) { $taskSource.Dispose() }
    if ($taskDevice) { $taskDevice.Dispose() }
    if ($taskVolumeLocks) { foreach ($taskLock in $taskVolumeLocks) { $taskLock.Dispose() } }
    if ($taskDevice) { Update-HostStorageCache -ErrorAction Continue }
    Write-Progress -Activity 'Writing DevOs Live USB' -Completed
    Write-Progress -Activity 'Verifying DevOs Live USB' -Completed
}
