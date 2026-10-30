param([Parameter(Mandatory = $true)][string]$ProjectRoot)
$ErrorActionPreference = 'Stop'

# Read the Windows checkout natively, then stream one archive into Linux.
# Loading GJS modules and GTK assets directly through /mnt/c incurs many 9P calls.
$taskArchive = Join-Path ([IO.Path]::GetTempPath()) ('dev-os-runtime-' + [guid]::NewGuid().ToString('N') + '.tar')
$taskStage = $null
try {
    $taskNativeRoot = (& wsl -d Ubuntu --exec wslpath -a $ProjectRoot).Trim()
    if ($LASTEXITCODE -ne 0 -or -not $taskNativeRoot) { throw 'Cannot resolve native app sources in Linux.' }
    & wsl -d Ubuntu --exec sh "$taskNativeRoot/tools/build/native-apps.sh" | ForEach-Object { Write-Host $_ }
    if ($LASTEXITCODE -ne 0) { throw 'Cannot build native DevLang apps before staging.' }
    $taskEntries = @('bin', 'lib', 'config', 'data', 'dist', 'src/apps', 'src/system', 'src/extensions', 'src/services', 'native', 'build/native', 'build/wsl/bin')
    if (Test-Path -LiteralPath (Join-Path $ProjectRoot 'build/wsl/vte')) { $taskEntries += 'build/wsl/vte' }
    & tar.exe -C $ProjectRoot --exclude=build/wsl/vte/usr/share/doc -cf $taskArchive @taskEntries
    if ($LASTEXITCODE -ne 0) { throw 'Cannot package the desktop runtime.' }
    $taskStage = (& wsl -d Ubuntu --exec mktemp -d /tmp/dev-os-runtime-XXXXXXXX).Trim()
    if ($LASTEXITCODE -ne 0 -or $taskStage -notmatch '^/tmp/dev-os-runtime-[a-zA-Z0-9]+$') { throw 'Cannot create the Linux runtime directory.' }

    # Extract from the single archive file; piping it through wsl.exe stdin can arrive corrupted.
    $taskLinuxArchive = (& wsl -d Ubuntu --exec wslpath -a $taskArchive).Trim()
    if ($LASTEXITCODE -ne 0 -or -not $taskLinuxArchive) { throw 'Cannot resolve the runtime archive in Linux.' }
    & wsl -d Ubuntu --exec tar -xf $taskLinuxArchive -C $taskStage
    if ($LASTEXITCODE -ne 0) { throw 'Cannot extract the desktop runtime in Linux.' }
    # Keep the source runtime available when launching under another Linux user.
    $taskDevlang = (& wsl -d Ubuntu --exec sh "$taskNativeRoot/packages/react-devlang/tools/toolchain.sh" --runtime).Trim()
    if ($LASTEXITCODE -ne 0 -or -not $taskDevlang) { throw 'Install DevLang d 0.5.5 or newer in WSL before starting DevOs.' }
    $taskDevlang = (& wsl -d Ubuntu --exec readlink -f $taskDevlang).Trim()
    $taskDevlangDirectory = $taskDevlang.Substring(0, $taskDevlang.LastIndexOf('/'))
    & wsl -d Ubuntu --exec cp -- $taskDevlang "$taskDevlangDirectory/devrun" "$taskStage/build/wsl/bin/"
    if ($LASTEXITCODE -ne 0) { throw 'Cannot stage the DevLang d/devrun runtime.' }
    & wsl -d Ubuntu --exec chmod -R +x "$taskStage/bin" "$taskStage/build/native" "$taskStage/build/wsl/bin"
    if ($LASTEXITCODE -ne 0) { throw 'Cannot prepare Linux runtime executables.' }
    # tar.exe from Windows packs files without the execute bit; every native program in dist/native has no dot in its name
    # (the .so, .css and .o files do), so all of them are made executable, not only a fixed list that misses new ones.
    & wsl -d Ubuntu --exec find "$taskStage/dist/native" -maxdepth 1 -type f '!' -name '*.*' -exec chmod +x '{}' '+'
    if ($LASTEXITCODE -ne 0) { throw 'Cannot make the native programs executable.' }
    & wsl -d Ubuntu --exec chmod +x "$taskStage/dist/native/taskmanager" "$taskStage/dist/native/diskmanager" "$taskStage/dist/native/installer" "$taskStage/dist/native/system-displaycare" "$taskStage/dist/native/boot-splash"
    if ($LASTEXITCODE -ne 0) { throw 'Cannot prepare the native app/system executables.' }
    Write-Output $taskStage
} catch {
    if ($taskStage -match '^/tmp/dev-os-runtime-[a-zA-Z0-9]+$') { & wsl -d Ubuntu --exec rm -rf -- $taskStage }
    throw
} finally {
    if (Test-Path -LiteralPath $taskArchive) { Remove-Item -LiteralPath $taskArchive }
}
