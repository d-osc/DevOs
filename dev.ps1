param([ValidateSet('run', 'updated', 'check', 'smoke', 'doctor', 'bootstrap', 'build', 'demo')][string]$Mode = 'run')
$ErrorActionPreference = 'Stop'
if ($Mode -in @('run', 'check', 'smoke', 'build', 'demo')) {
    Push-Location $PSScriptRoot
    try {
        & node tools/build.ts
        if ($LASTEXITCODE -ne 0) { throw 'React build failed. Run npm ci first.' }
    } finally { Pop-Location }
    if ($Mode -eq 'build') { exit 0 }
}
$linuxRoot = (& wsl -d Ubuntu --exec wslpath -a $PSScriptRoot).Trim()
if ($LASTEXITCODE -ne 0) { throw 'Cannot resolve the source directory inside WSL Ubuntu.' }
$linuxPath = (& wsl -d Ubuntu -- printenv PATH).Trim()
$devPath = "$linuxRoot/build/wsl/bin:$linuxPath"
if ($Mode -in @('run', 'check', 'smoke')) {
    & wsl -d Ubuntu -- sh "$linuxRoot/tools/bootstrap-window-tracker.sh"
    if ($LASTEXITCODE -ne 0) { throw 'Wayland window tracker could not be built.' }
}
if ($Mode -eq 'updated') {
    $taskRuntimePath = ($linuxPath -split ':' | Where-Object { $_ -notmatch '^/mnt/[a-z]/' }) -join ':'
    $taskUpdatedEnv = @("PATH=$linuxRoot/build/wsl/bin:$taskRuntimePath", 'WLR_RENDERER=pixman')
    if (Test-Path -LiteralPath "$PSScriptRoot/build/wsl/vte") {
        $taskUpdatedEnv += "GI_TYPELIB_PATH=$linuxRoot/build/wsl/vte/usr/lib/x86_64-linux-gnu/girepository-1.0"
        $taskUpdatedEnv += "LD_LIBRARY_PATH=$linuxRoot/build/wsl/vte/usr/lib/x86_64-linux-gnu"
    }
    & wsl -d Ubuntu --exec env @taskUpdatedEnv sh "$linuxRoot/bin/dev-os-updated-session" --nested
} elseif ($Mode -eq 'bootstrap') {
    & wsl -d Ubuntu -- sh "$linuxRoot/tools/bootstrap-wsl.sh"
} elseif ($Mode -eq 'run') {
    # Upgrade the private compositor when a desktop integration patch is missing.
    $taskCompositorNeedsBuild = $false
    foreach ($taskCompositorFix in @('tab-drag-focus', 'tab-drag-escape', 'app-icons')) {
        & wsl -d Ubuntu -- git -C "$linuxRoot/build/wsl/labwc-source" apply --reverse --check "$linuxRoot/tools/patches/labwc-$taskCompositorFix.patch" 2>$null
        if ($LASTEXITCODE -ne 0) { $taskCompositorNeedsBuild = $true }
        & wsl -d Ubuntu -- test "$linuxRoot/tools/patches/labwc-$taskCompositorFix.patch" -nt "$linuxRoot/build/wsl/bin/labwc"
        if ($LASTEXITCODE -eq 0) { $taskCompositorNeedsBuild = $true }
    }
    if ($taskCompositorNeedsBuild) {
        & wsl -d Ubuntu -- sh "$linuxRoot/tools/bootstrap-wsl.sh"
        if ($LASTEXITCODE -ne 0) { throw 'Compositor desktop integration could not be prepared.' }
    }
    & wsl -d Ubuntu -- sh "$linuxRoot/tools/bootstrap-terminal.sh"
    if ($LASTEXITCODE -ne 0) { throw 'Terminal dependencies could not be prepared.' }
    & wsl -d Ubuntu -- sh "$linuxRoot/tools/bootstrap-panel-tools.sh"
    if ($LASTEXITCODE -ne 0) { Write-Warning 'Audio controls need pactl or wpctl.' }
    Write-Host 'Preparing desktop runtime on the Linux filesystem...'
    $taskRuntimeRoot = & "$PSScriptRoot/tools/stage-wsl-runtime.ps1" -ProjectRoot $PSScriptRoot
    if ($taskRuntimeRoot -notmatch '^/tmp/dev-os-runtime-[a-zA-Z0-9]+$') { throw 'Unexpected Linux runtime directory.' }
    # Missing optional Linux tools must not scan every imported Windows directory.
    $taskRuntimePath = ($linuxPath -split ':' | Where-Object { $_ -notmatch '^/mnt/[a-z]/' }) -join ':'
    try {
        & wsl -d Ubuntu --exec env "PATH=$taskRuntimeRoot/build/wsl/bin:$taskRuntimePath" WLR_RENDERER=pixman "$taskRuntimeRoot/bin/dev-os-session" --nested
        $taskSessionExit = $LASTEXITCODE
    } finally {
        & wsl -d Ubuntu --exec rm -rf -- $taskRuntimeRoot
    }
    exit $taskSessionExit
} elseif ($Mode -eq 'demo') {
    & wsl -d Ubuntu -- env GDK_BACKEND=wayland gjs -m "$linuxRoot/dist/react-demo.js"
} elseif ($Mode -eq 'check') {
    & wsl -d Ubuntu -- gjs -m "$linuxRoot/dist/config-test.js"
    if ($LASTEXITCODE -eq 0) { & wsl -d Ubuntu -- gjs -m "$linuxRoot/dist/extensions-test.js" }
    if ($LASTEXITCODE -eq 0) { & wsl -d Ubuntu -- gjs -m "$linuxRoot/dist/updates-test.js" }
} elseif ($Mode -eq 'smoke') {
    & wsl -d Ubuntu -- env "PATH=$devPath" python3 "$linuxRoot/tools/smoke.py" --keyboard --screenshots "$linuxRoot/build/screenshots"
} else {
    & wsl -d Ubuntu -- env "PATH=$devPath" sh "$linuxRoot/bin/dev-os-shell" doctor
}
exit $LASTEXITCODE
