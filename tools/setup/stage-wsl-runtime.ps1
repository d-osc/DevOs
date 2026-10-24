param([Parameter(Mandatory = $true)][string]$ProjectRoot)
$ErrorActionPreference = 'Stop'

# Read the Windows checkout natively, then stream one archive into Linux.
# Loading GJS modules and GTK assets directly through /mnt/c incurs many 9P calls.
$taskArchive = Join-Path ([IO.Path]::GetTempPath()) ('dev-os-runtime-' + [guid]::NewGuid().ToString('N') + '.tar')
$taskStage = $null
try {
    $taskEntries = @('bin', 'lib', 'config', 'data', 'dist', 'extensions', 'native', 'build/native', 'build/wsl/bin')
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
    $taskDevlang = (& wsl -d Ubuntu --exec which d).Trim()
    if ($LASTEXITCODE -ne 0 -or -not $taskDevlang) { throw 'Install DevLang d 0.5.5 or newer in WSL before starting DevOs.' }
    $taskDevlang = (& wsl -d Ubuntu --exec readlink -f $taskDevlang).Trim()
    $taskDevlangDirectory = $taskDevlang.Substring(0, $taskDevlang.LastIndexOf('/'))
    & wsl -d Ubuntu --exec cp -- $taskDevlang "$taskDevlangDirectory/devrun" "$taskStage/build/wsl/bin/"
    if ($LASTEXITCODE -ne 0) { throw 'Cannot stage the DevLang d/devrun runtime.' }
    & wsl -d Ubuntu --exec chmod -R +x "$taskStage/bin" "$taskStage/build/native" "$taskStage/build/wsl/bin"
    if ($LASTEXITCODE -ne 0) { throw 'Cannot prepare Linux runtime executables.' }
    Write-Output $taskStage
} catch {
    if ($taskStage -match '^/tmp/dev-os-runtime-[a-zA-Z0-9]+$') { & wsl -d Ubuntu --exec rm -rf -- $taskStage }
    throw
} finally {
    if (Test-Path -LiteralPath $taskArchive) { Remove-Item -LiteralPath $taskArchive }
}
