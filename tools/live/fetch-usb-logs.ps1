<#
Copies the diagnostic logs a Live USB wrote on the laptop (DEVOS-LOGS on its EFI partition) to this computer.

It only READS the USB: the EFI partition is given a temporary Windows mount point, DEVOS-LOGS is copied to
build/live-usb/hardware-logs-<time>/, and the mount point is removed again. Nothing is written to the USB and no disk
is erased. The disk is identified by the UniqueId recorded in build/live-usb/usb-target.json (the same identity the
writer checks); any other disk is refused.

  .\tools\live\fetch-usb-logs.ps1 -Check   # shows which USB/partition it would use; changes nothing, no Administrator needed
  .\tools\live\fetch-usb-logs.ps1          # copies the logs; run from an Administrator PowerShell
#>
[CmdletBinding()]
param([switch]$Check, [string]$Destination)
$ErrorActionPreference = 'Stop'
$taskRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$taskTarget = Get-Content -LiteralPath (Join-Path $taskRoot 'build/live-usb/usb-target.json') -Raw | ConvertFrom-Json
$taskDisk = Get-Disk | Where-Object { $_.BusType -eq 'USB' -and $_.UniqueId -eq $taskTarget.UniqueId } | Select-Object -First 1
if (-not $taskDisk) { throw "The recorded USB ($($taskTarget.FriendlyName)) is not connected, so there is nothing to read." }
if ($taskDisk.IsBoot -or $taskDisk.IsSystem) { throw 'Refusing to use a boot or system disk.' }
$taskPartition = Get-Partition -DiskNumber $taskDisk.Number | Where-Object { $_.Type -eq 'System' } | Select-Object -First 1
if (-not $taskPartition) { throw "Disk $($taskDisk.Number) has no EFI system partition." }
Write-Host "USB: Disk $($taskDisk.Number) / $($taskDisk.FriendlyName) / $([math]::Round($taskDisk.Size / 1GB, 1)) GB"
Write-Host "EFI partition: number $($taskPartition.PartitionNumber), $([math]::Round($taskPartition.Size / 1MB)) MB"
if ($Check) { Write-Host 'Check only: nothing was mounted or copied.'; return }
$taskPrincipal = [Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $taskPrincipal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'Run this script from an Administrator PowerShell (Windows needs it to mount the EFI partition).' }

$taskLetter = $taskPartition.DriveLetter
$taskMounted = $false
if (-not $taskLetter) {
    $taskUsed = (Get-PSDrive -PSProvider FileSystem).Name
    $taskLetter = [char[]]'ZYXWVUTSRQPONMLKJIHGFED' | Where-Object { $taskUsed -notcontains [string]$_ } | Select-Object -First 1
    if (-not $taskLetter) { throw 'No free drive letter.' }
    try { Add-PartitionAccessPath -DiskNumber $taskDisk.Number -PartitionNumber $taskPartition.PartitionNumber -AccessPath "${taskLetter}:\" }
    catch {
        # Windows may refuse letters on EFI partitions through the storage cmdlets; mountvol accepts the volume path.
        $taskVolumePath = $taskPartition.AccessPaths | Where-Object { $_ -like '\\?\Volume{*' } | Select-Object -First 1
        if (-not $taskVolumePath) { throw }
        & mountvol "${taskLetter}:" $taskVolumePath
        if ($LASTEXITCODE -ne 0) { throw 'Could not mount the EFI partition.' }
    }
    $taskMounted = $true
}
try {
    $taskVolume = Get-Volume -DriveLetter $taskLetter
    if ($taskVolume.FileSystemLabel -ne 'DEVOS_EFI') { throw "Volume ${taskLetter}: is labelled '$($taskVolume.FileSystemLabel)', not DEVOS_EFI. Nothing was copied." }
    $taskSource = "${taskLetter}:\DEVOS-LOGS"
    if (-not (Test-Path -LiteralPath $taskSource)) {
        Write-Host 'No DEVOS-LOGS folder on the EFI partition: the laptop has not written diagnostic logs from this USB.'
        Get-ChildItem -LiteralPath "${taskLetter}:\" | Select-Object Name | Format-Table -HideTableHeaders
        return
    }
    if (-not $Destination) { $Destination = Join-Path $taskRoot ('build/live-usb/hardware-logs-' + (Get-Date -Format 'yyyyMMdd-HHmm')) }
    if (Test-Path -LiteralPath $Destination) { throw "Refusing to overwrite $Destination" }
    Copy-Item -LiteralPath $taskSource -Destination $Destination -Recurse
    Write-Host "Copied to $Destination"
    Get-ChildItem -LiteralPath $Destination -Directory | Sort-Object LastWriteTime | ForEach-Object {
        $taskFiles = (Get-ChildItem -LiteralPath $_.FullName -File | Select-Object -ExpandProperty Name) -join ', '
        Write-Host ("  {0}  {1}" -f $_.Name, $taskFiles)
    }
} finally {
    if ($taskMounted) {
        try { Remove-PartitionAccessPath -DiskNumber $taskDisk.Number -PartitionNumber $taskPartition.PartitionNumber -AccessPath "${taskLetter}:\" -ErrorAction Stop }
        catch { & mountvol "${taskLetter}:" /D | Out-Null }
    }
}
