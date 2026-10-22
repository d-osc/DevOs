param([ValidateSet('run', 'updated', 'check', 'smoke', 'doctor', 'drivers', 'bootstrap', 'build', 'demo')][string]$Mode = 'run', [ValidatePattern('^$|^[a-z][a-z0-9_-]{0,30}$')][string]$User = '')
$ErrorActionPreference = 'Stop'
if ($Mode -in @('run', 'check', 'smoke', 'build', 'demo')) {
    Push-Location $PSScriptRoot
    try {
        if ($Mode -in @('run', 'demo')) { & node tools/build/build.ts --if-needed }
        else { & node tools/build/build.ts }
        if ($LASTEXITCODE -ne 0) { throw 'React build failed. Run npm ci first.' }
    } finally { Pop-Location }
    if ($Mode -eq 'build') { exit 0 }
}
$linuxRoot = (& wsl -d Ubuntu --exec wslpath -a $PSScriptRoot).Trim()
if ($LASTEXITCODE -ne 0) { throw 'Cannot resolve the source directory inside WSL Ubuntu.' }
$taskMachine = (& wsl -d Ubuntu --exec uname -m).Trim()
if ($LASTEXITCODE -ne 0 -or $taskMachine -notin @('aarch64', 'x86_64')) { throw 'Dev OS requires an ARM64 or x64 Linux distribution.' }
$taskMultiarch = "$taskMachine-linux-gnu"
$linuxPath = (& wsl -d Ubuntu -- printenv PATH).Trim()
$devPath = "$linuxRoot/build/wsl/bin:$linuxPath"
if ($Mode -in @('run', 'check', 'smoke')) {
    & wsl -d Ubuntu -- sh "$linuxRoot/tools/setup/bootstrap-window-tracker.sh"
    if ($LASTEXITCODE -ne 0) { throw 'Wayland window tracker could not be built.' }
}
if ($Mode -eq 'updated') {
    $taskRuntimePath = ($linuxPath -split ':' | Where-Object { $_ -notmatch '^/mnt/[a-z]/' }) -join ':'
    $taskUpdatedEnv = @("PATH=$linuxRoot/build/wsl/bin:$taskRuntimePath", 'WLR_RENDERER=pixman')
    if (Test-Path -LiteralPath "$PSScriptRoot/build/wsl/vte") {
        $taskUpdatedEnv += "GI_TYPELIB_PATH=$linuxRoot/build/wsl/vte/usr/lib/$taskMultiarch/girepository-1.0"
        $taskUpdatedEnv += "LD_LIBRARY_PATH=$linuxRoot/build/wsl/vte/usr/lib/$taskMultiarch"
    }
    & wsl -d Ubuntu --exec env @taskUpdatedEnv sh "$linuxRoot/bin/dev-os-updated-session" --nested
} elseif ($Mode -eq 'drivers') {
    & wsl -d Ubuntu -- env "PATH=$devPath" d "$linuxRoot/bin/dev-os-drivers"
} elseif ($Mode -eq 'bootstrap') {
    & wsl -d Ubuntu -- sh "$linuxRoot/tools/setup/bootstrap-wsl.sh"
} elseif ($Mode -eq 'run') {
    & wsl -d Ubuntu -u root -- sh "$linuxRoot/tools/setup/bootstrap-desktop-apps.sh"
    if ($LASTEXITCODE -ne 0) { throw 'DevOs desktop dependencies could not be prepared. See the bootstrap error above.' }
    # Missing sources are normal on a fresh checkout. Check inside Linux so
    # expected git diagnostics cannot become terminating PowerShell 5 errors.
    & wsl -d Ubuntu -- sh "$linuxRoot/tools/setup/check-wsl-compositor.sh"
    $taskCompositorNeedsBuild = $LASTEXITCODE -ne 0
    if ($taskCompositorNeedsBuild) {
        & wsl -d Ubuntu -- sh "$linuxRoot/tools/setup/bootstrap-wsl.sh"
        if ($LASTEXITCODE -ne 0) { throw 'Compositor desktop integration could not be prepared.' }
    }
    & wsl -d Ubuntu -- sh "$linuxRoot/tools/setup/bootstrap-terminal.sh"
    if ($LASTEXITCODE -ne 0) { throw 'Terminal dependencies could not be prepared.' }
    & wsl -d Ubuntu -- sh "$linuxRoot/tools/setup/bootstrap-lock.sh"
    if ($LASTEXITCODE -ne 0) { throw 'Lock screen dependency could not be installed.' }
    & wsl -d Ubuntu -- sh "$linuxRoot/tools/setup/bootstrap-panel-tools.sh"
    if ($LASTEXITCODE -ne 0) { Write-Warning 'Audio controls need pactl or wpctl.' }
    Write-Host 'Preparing desktop runtime on the Linux filesystem...'
    $taskRuntimeRoot = & "$PSScriptRoot/tools/setup/stage-wsl-runtime.ps1" -ProjectRoot $PSScriptRoot
    if ($taskRuntimeRoot -notmatch '^/tmp/dev-os-runtime-[a-zA-Z0-9]+$') { throw 'Unexpected Linux runtime directory.' }
    # Missing optional Linux tools must not scan every imported Windows directory.
    $taskRuntimePath = ($linuxPath -split ':' | Where-Object { $_ -notmatch '^/mnt/[a-z]/' }) -join ':'
    try {
        if ($User) {
            $taskSelectedUid = (& wsl -d Ubuntu -u root -- "$taskRuntimeRoot/build/wsl/bin/d" "$linuxRoot/tools/setup/prepare-wsl-user.dev" -- $User $taskRuntimeRoot).Trim()
            if ($LASTEXITCODE -ne 0 -or $taskSelectedUid -notmatch '^\d+$') { throw 'Cannot prepare the selected Linux user session.' }
            & wsl -d Ubuntu -u $User --exec env "PATH=$taskRuntimeRoot/build/wsl/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin" "XDG_RUNTIME_DIR=/run/user/$taskSelectedUid" WAYLAND_DISPLAY=/mnt/wslg/runtime-dir/wayland-0 "DEV_OS_WINDOWS_PROJECT=$PSScriptRoot" DEV_OS_LOGIN=0 WLR_RENDERER=pixman "$taskRuntimeRoot/bin/dev-os-session" --nested
        } else {
            & wsl -d Ubuntu --exec env "PATH=$taskRuntimeRoot/build/wsl/bin:$taskRuntimePath" "DEV_OS_WINDOWS_PROJECT=$PSScriptRoot" WLR_RENDERER=pixman "$taskRuntimeRoot/bin/dev-os-session" --nested
        }
        $taskSessionExit = $LASTEXITCODE
    } finally {
        if ($User) { & wsl -d Ubuntu -u root --exec rm -rf -- $taskRuntimeRoot }
        else { & wsl -d Ubuntu --exec rm -rf -- $taskRuntimeRoot }
    }
    exit $taskSessionExit
} elseif ($Mode -eq 'demo') {
    & wsl -d Ubuntu -- env GDK_BACKEND=wayland gjs -m "$linuxRoot/dist/react-demo.js"
} elseif ($Mode -eq 'check') {
    & wsl -d Ubuntu -- gjs -m "$linuxRoot/dist/config-test.js"
    if ($LASTEXITCODE -eq 0) { & wsl -d Ubuntu -- gjs -m "$linuxRoot/dist/extensions-test.js" }
    if ($LASTEXITCODE -eq 0) { & wsl -d Ubuntu -- gjs -m "$linuxRoot/dist/updates-test.js" }
    if ($LASTEXITCODE -eq 0) { & wsl -d Ubuntu -- gjs -m "$linuxRoot/dist/store-test.js" }
    if ($LASTEXITCODE -eq 0) { & wsl -d Ubuntu -- gjs -m "$linuxRoot/dist/wifi-test.js" }
} elseif ($Mode -eq 'smoke') {
    & wsl -d Ubuntu -- env "PATH=$devPath" d "$linuxRoot/tools/test/smoke.dev" -- --keyboard --screenshots "$linuxRoot/build/screenshots"
} else {
    & wsl -d Ubuntu -- env "PATH=$devPath" sh "$linuxRoot/bin/dev-os-shell" doctor
}
exit $LASTEXITCODE
