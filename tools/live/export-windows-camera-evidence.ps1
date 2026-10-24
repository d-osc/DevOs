# Exports this laptop's ACPI DSDT and camera PnP list for offline decoding (read-only).
# Run on the Windows install of the target machine. Output default: build/live-usb/research/camera-windows
param([string]$Output = (Join-Path $PSScriptRoot '..\..\build\live-usb\research\camera-windows'))
$ErrorActionPreference = 'Stop'
New-Item -ItemType Directory -Force $Output | Out-Null
foreach ($table in Get-ChildItem 'HKLM:\HARDWARE\ACPI\DSDT\*\*\*') {
    $bytes = (Get-ItemProperty $table.PSPath).'00000000'
    if ($bytes) { [IO.File]::WriteAllBytes((Join-Path $Output 'dsdt.aml'), $bytes) }
}
Get-PnpDevice -PresentOnly | Where-Object { $_.FriendlyName -match 'camera|Spectra|ISP' } |
    Select-Object Status, Class, FriendlyName, InstanceId | Format-List | Out-File (Join-Path $Output 'camera-pnp.txt')
Write-Output "Wrote $Output. Decode with: iasl -d dsdt.aml ; search for CAMP, CAMF, MPCS."
