param(
    [ValidateSet('base', 'base-test', 'desktop-prepare', 'desktop-check', 'desktop-kernel-check', 'desktop-build')]
    [string]$Mode = 'base',
    [string]$BuildDistribution = 'Ubuntu',
    [string]$KernelProject = (Join-Path $PSScriptRoot 'packages/devos-linux-kernel')
)
$ErrorActionPreference = 'Stop'
# This WSL distribution supplies build tools only. Its rootfs is never used as
# the independent DevOs image. Select another build host with -BuildDistribution.
$taskRoot = (& wsl -d $BuildDistribution --exec wslpath -a $PSScriptRoot).Trim()
if ($LASTEXITCODE -ne 0) { throw 'Cannot access the project from the Linux build host.' }
$taskKernelRoot = (& wsl -d $BuildDistribution --exec wslpath -a $KernelProject).Trim()
if ($LASTEXITCODE -ne 0) { throw 'Cannot resolve the DevOsLinuxKernel project path.' }
$taskDevlang = (& wsl -d $BuildDistribution --exec sh -lc 'command -v d || echo $HOME/.local/bin/d').Trim()
if ($LASTEXITCODE -ne 0) { throw 'Cannot resolve the DevLang runtime (d) on the Linux build host.' }
$taskScript = "$taskRoot/distro/base/build.sh"
$taskArguments = @()
if ($Mode -eq 'base-test') {
    $taskScript = "$taskRoot/distro/base/test-qemu.sh"
} elseif ($Mode.StartsWith('desktop-')) {
    & wsl -d $BuildDistribution --exec "$taskDevlang" "$taskRoot/distro/oe/check-active-build.dev"
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    Push-Location $PSScriptRoot
    try {
        & npm run build
        if ($LASTEXITCODE -ne 0) { throw 'Desktop build failed.' }
    } finally { Pop-Location }
    $taskScript = "$taskRoot/distro/oe/build.sh"
    $taskArguments = @('--prepare')
    if ($Mode -eq 'desktop-check') { $taskArguments = @('--parse') }
    if ($Mode -eq 'desktop-kernel-check') { $taskArguments = @('--kernel-check') }
    if ($Mode -eq 'desktop-build') { $taskArguments = @('--build') }
}
& wsl -d $BuildDistribution --exec env 'PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin' "DEVOS_KERNEL_PROJECT=$taskKernelRoot" bash $taskScript @taskArguments
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
if ($Mode -in @('base', 'base-test')) {
    New-Item -ItemType Directory -Force -Path "$PSScriptRoot/build/devos-base" | Out-Null
    & wsl -d $BuildDistribution --exec cp -a /var/tmp/devos-base/output/. "$taskRoot/build/devos-base/"
    if ($LASTEXITCODE -ne 0) { throw 'Could not copy the base artifacts to the project.' }
    Write-Host "DevOs base artifacts: $PSScriptRoot/build/devos-base"
}
