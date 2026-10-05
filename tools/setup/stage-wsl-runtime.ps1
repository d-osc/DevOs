param([Parameter(Mandatory = $true)][string]$ProjectRoot)
$ErrorActionPreference = 'Stop'

# Read the Windows checkout natively, then stream one archive into Linux.
# Loading GJS modules and GTK assets directly through /mnt/c incurs many 9P calls.
$taskArchive = Join-Path ([IO.Path]::GetTempPath()) ('dev-os-runtime-' + [guid]::NewGuid().ToString('N') + '.tar')
$taskStage = $null
try {
    $taskEntries = @('bin', 'config', 'data', 'dist', 'extensions', 'build/native', 'build/wsl/bin')
    if (Test-Path -LiteralPath (Join-Path $ProjectRoot 'build/wsl/vte')) { $taskEntries += 'build/wsl/vte' }
    & tar.exe -C $ProjectRoot --exclude=build/wsl/vte/usr/share/doc -cf $taskArchive @taskEntries
    if ($LASTEXITCODE -ne 0) { throw 'Cannot package the desktop runtime.' }
    $taskStage = (& wsl -d Ubuntu --exec mktemp -d /tmp/dev-os-runtime-XXXXXXXX).Trim()
    if ($LASTEXITCODE -ne 0 -or $taskStage -notmatch '^/tmp/dev-os-runtime-[a-zA-Z0-9]+$') { throw 'Cannot create the Linux runtime directory.' }

    $taskInfo = [Diagnostics.ProcessStartInfo]::new()
    $taskInfo.FileName = 'wsl.exe'
    $taskInfo.Arguments = "-d Ubuntu --exec tar -xf - -C $taskStage"
    $taskInfo.UseShellExecute = $false
    $taskInfo.CreateNoWindow = $true
    $taskInfo.RedirectStandardInput = $true
    $taskProcess = [Diagnostics.Process]::Start($taskInfo)
    $taskInput = [IO.File]::OpenRead($taskArchive)
    try { $taskInput.CopyTo($taskProcess.StandardInput.BaseStream) }
    finally { $taskInput.Dispose(); $taskProcess.StandardInput.Close() }
    $taskProcess.WaitForExit()
    if ($taskProcess.ExitCode -ne 0) { throw 'Cannot extract the desktop runtime in Linux.' }
    & wsl -d Ubuntu --exec chmod -R +x "$taskStage/bin" "$taskStage/build/native" "$taskStage/build/wsl/bin"
    if ($LASTEXITCODE -ne 0) { throw 'Cannot prepare Linux runtime executables.' }
    Write-Output $taskStage
} catch {
    if ($taskStage -match '^/tmp/dev-os-runtime-[a-zA-Z0-9]+$') { & wsl -d Ubuntu --exec rm -rf -- $taskStage }
    throw
} finally {
    if (Test-Path -LiteralPath $taskArchive) { Remove-Item -LiteralPath $taskArchive }
}
