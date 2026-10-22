param(
    [ValidateSet('base','desktop')][string]$Mode = 'desktop',
    [switch]$Test,
    [switch]$Headless,
    [switch]$Check,
    [ValidateRange(256,65536)][int]$Memory = 0,
    [ValidateRange(1,32)][int]$Cpus = 2,
    [ValidateRange(1,3600)][int]$Timeout = 120,
    [string]$BuildDistribution = 'Ubuntu',
    [string]$ImageDirectory,
    [string]$Kernel,
    [string]$Rootfs,
    [string]$Log
)
$ErrorActionPreference = 'Stop'
$taskProject = (& wsl -d $BuildDistribution --exec wslpath -a $PSScriptRoot).Trim()
if ($LASTEXITCODE -ne 0) { throw 'Cannot resolve the DevOs project in WSL.' }
function Convert-QemuPath([string]$Value) {
    if ($Value.StartsWith('/')) { return $Value }
    $taskConverted = (& wsl -d $BuildDistribution --exec wslpath -a $Value).Trim()
    if ($LASTEXITCODE -ne 0) { throw "Cannot resolve path: $Value" }
    return $taskConverted
}
$taskQemuArgs = @($Mode, '--cpus', "$Cpus", '--timeout', "$Timeout")
if ($Test) { $taskQemuArgs += '--test' }
if ($Headless) { $taskQemuArgs += '--headless' }
if ($Check) { $taskQemuArgs += '--check' }
if ($Memory) { $taskQemuArgs += @('--memory', "$Memory") }
foreach ($taskPair in @(@('--image-dir',$ImageDirectory),@('--kernel',$Kernel),@('--rootfs',$Rootfs),@('--log',$Log))) {
    if ($taskPair[1]) { $taskQemuArgs += @($taskPair[0], (Convert-QemuPath $taskPair[1])) }
}
$taskDevlang = (& wsl -d $BuildDistribution --exec sh -lc 'command -v d || echo $HOME/.local/bin/d').Trim()
if ($LASTEXITCODE -ne 0) { throw 'Cannot resolve the DevLang runtime (d) on the Linux build host.' }
& wsl -d $BuildDistribution --exec "$taskDevlang" "$taskProject/distro/qemu.dev" -- @taskQemuArgs
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
