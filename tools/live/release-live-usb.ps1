<#
.SYNOPSIS
Builds the DevOs Live USB image end to end and (only after a typed confirmation) writes it to the Live USB.

.DESCRIPTION
One repeatable entry point for the steps that were run by hand: tests, OpenEmbedded image, kernel bundle (optional),
staging (prepare + diagnose), image build, check, export, QEMU boot check and the USB write. It reuses live-usb.ps1,
distro/oe/build.sh, distro/usb/run-write.ps1 and write-usb.ps1; it only orchestrates them and adds logging, a lock
check, archiving of the previous image and the confirmation flow. Windows PowerShell 5.1 compatible.

Stages (in order): Test, Kernel, Image, Prepare, Build, Check, Export, QemuCheck, Write

  -All          Test, Image, Prepare, Build, Check, Export, QemuCheck. Kernel only with -IncludeKernel. Never writes the
                USB unless -Write is also given; without -Write it validates the USB and PAUSES.
  -Stage a,b    Run exactly these stages.
  -From X       Start at stage X (resume after a failure). Without -All/-Stage it runs X and everything after it.
  -Skip a,b     Leave stages out.
  -DryRun       (alias -WhatIf) print every stage's exact commands and paths; execute nothing, touch no disk.
  -Write        Allow the Write stage to erase and write the USB after the confirmation text matches.
  -ConfirmErase The exact text the Write stage prints, for unattended runs. Without it you type it.
  -RecordTarget Deliberately re-record usb-target.json for the single connected USB (asks for a typed confirmation).

Nothing here builds or writes anything unless you run it. The Write stage refuses non-USB, boot/system and read-only
disks, a disk whose UniqueId differs from build/live-usb/usb-target.json, and any situation where exactly one USB disk
cannot be identified. write-usb.ps1 itself always targets Disk 1, so a USB that is not Disk 1 is refused.

.EXAMPLE
.\tools\live\release-live-usb.ps1 -All -DryRun
.\tools\live\release-live-usb.ps1 -All -Label camera
.\tools\live\release-live-usb.ps1 -From Check
.\tools\live\release-live-usb.ps1 -Stage Write -Write
#>
[CmdletBinding()]
param(
    [ValidateSet('Test', 'Kernel', 'Image', 'Prepare', 'Build', 'Check', 'Export', 'QemuCheck', 'Write')][string[]]$Stage,
    [switch]$All,
    [ValidateSet('Test', 'Kernel', 'Image', 'Prepare', 'Build', 'Check', 'Export', 'QemuCheck', 'Write')][string]$From,
    [ValidateSet('Test', 'Kernel', 'Image', 'Prepare', 'Build', 'Check', 'Export', 'QemuCheck', 'Write')][string[]]$Skip,
    [Alias('WhatIf')][switch]$DryRun,
    [ValidatePattern('^[A-Za-z0-9][A-Za-z0-9._-]{0,40}$')][string]$Label = 'release',
    [switch]$IncludeKernel,
    [switch]$CameraCandidate,
    [bool]$Diagnostic = $true,
    [string]$BuildDistribution = 'Ubuntu',
    [string]$KernelBundle,
    [string]$FirmwareDirectory,
    [string]$StagingDirectory,
    [string]$StagingRoot = '/var/tmp/devos-usb',
    [string]$KernelProject,
    [string]$BoardFixesSource = '/var/tmp/devos-live-build/linux-qcom-x1e-7.3.0',
    [string]$BoardFixesBundle = '/var/tmp/devos-kernel-x2/bundle-suspend-20261023',
    [string]$Dtc = '/var/tmp/devos-kernel-x2/build-latest-20261023/scripts/dtc/dtc',
    [switch]$Write,
    [string]$ConfirmErase,
    [switch]$RecordTarget,
    [string]$ConfirmRecord,
    [int]$QemuTimeout = 180,
    [string]$BuildDirectory
)
$ErrorActionPreference = 'Stop'
$taskAllStages = @('Test', 'Kernel', 'Image', 'Prepare', 'Build', 'Check', 'Export', 'QemuCheck', 'Write')
$taskLogNames = @{ Test = 'test'; Kernel = 'kernel'; Image = 'image'; Prepare = 'prepare'; Build = 'build'; Check = 'check'; Export = 'export'; QemuCheck = 'qemu'; Write = 'write' }
$taskRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$taskDefaultBuild = [IO.Path]::GetFullPath((Join-Path $taskRoot 'build/live-usb'))
if (-not $BuildDirectory) { $BuildDirectory = $taskDefaultBuild }
$BuildDirectory = [IO.Path]::GetFullPath($BuildDirectory)
if (-not $KernelProject) { $KernelProject = Join-Path (Split-Path $taskRoot -Parent) 'DevOsLinuxKernel' }
$taskImageName = 'devos-live-arm64-ux3407na.img'
$taskStamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$taskWslPath = '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin'
$taskWslPyPath = "/home/ondev/.local/bin:$taskWslPath"
# Windows System32 first, so tar.exe is bsdtar and not Git's GNU tar.
$taskSystem32 = Join-Path $env:SystemRoot 'System32'
$env:PATH = "$taskSystem32;$env:SystemRoot;$(Join-Path $taskSystem32 'WindowsPowerShell\v1.0');$env:PATH"
$taskWsl = Join-Path $taskSystem32 'wsl.exe'
$taskPowerShell = Join-Path $taskSystem32 'WindowsPowerShell\v1.0\powershell.exe'
# Test hooks (validation path only; they can never cause a write, see Invoke-ElevatedWrite).
$taskHookInventory = $env:DEVOS_RELEASE_DISK_INVENTORY
$taskHookTarget = $env:DEVOS_RELEASE_USB_TARGET
$taskHook = [bool]$taskHookInventory

function ConvertTo-WslPath([string]$Path) {
    $taskFull = [IO.Path]::GetFullPath($Path)
    if ($taskFull -notmatch '^([A-Za-z]):\\(.*)$') { throw "Only drive-letter paths can be converted for WSL: $Path" }
    return '/mnt/' + $Matches[1].ToLowerInvariant() + '/' + ($Matches[2] -replace '\\', '/')
}
$taskRootWsl = ConvertTo-WslPath $taskRoot
$taskKernelWsl = ConvertTo-WslPath $KernelProject

function ConvertTo-ProcessArgument([string]$Value) {
    if ($Value.Length -gt 0 -and $Value -notmatch '[\s"]') { return $Value }
    $taskEscaped = [regex]::Replace($Value, '(\\*)"', '$1$1\"')
    $taskEscaped = [regex]::Replace($taskEscaped, '(\\+)$', '$1$1')
    return '"' + $taskEscaped + '"'
}
function Format-Command([string]$File, [string[]]$Arguments) {
    $taskName = if ($File -eq $taskWsl) { 'wsl.exe' } elseif ($File -eq $taskPowerShell) { 'powershell.exe' } else { Split-Path $File -Leaf }
    return (@($taskName) + @($Arguments | ForEach-Object { ConvertTo-ProcessArgument $_ })) -join ' '
}
function Write-Log([string]$Text) {
    Write-Host $Text
    if ($script:taskLog) { Add-Content -LiteralPath $script:taskLog -Value $Text -Encoding UTF8 }
}
# Runs a native program with stdout and stderr both redirected, so stderr text is just log text and never a
# terminating PowerShell error. Output is streamed to the console and the stage log. Returns exit code and output.
function Invoke-Native([string]$File, [string[]]$Arguments, [string]$WorkingDirectory = $taskRoot, [int]$TimeoutSeconds = 0, [int[]]$AllowedExitCodes = @(0)) {
    Write-Log ('$ ' + (Format-Command $File $Arguments))
    $taskInfo = [Diagnostics.ProcessStartInfo]::new()
    $taskInfo.FileName = $File
    $taskInfo.Arguments = (@($Arguments | ForEach-Object { ConvertTo-ProcessArgument $_ })) -join ' '
    $taskInfo.WorkingDirectory = $WorkingDirectory
    $taskInfo.UseShellExecute = $false
    $taskInfo.RedirectStandardOutput = $true
    $taskInfo.RedirectStandardError = $true
    $taskInfo.CreateNoWindow = $true
    $taskInfo.StandardOutputEncoding = [Text.Encoding]::UTF8
    $taskInfo.StandardErrorEncoding = [Text.Encoding]::UTF8
    $taskInfo.EnvironmentVariables['PATH'] = $env:PATH
    $taskProcess = [Diagnostics.Process]::new()
    $taskProcess.StartInfo = $taskInfo
    $taskOutput = [Text.StringBuilder]::new()
    $null = $taskProcess.Start()
    $taskTimer = [Diagnostics.Stopwatch]::StartNew()
    try {
        $taskOut = $taskProcess.StandardOutput.ReadLineAsync()
        $taskErr = $taskProcess.StandardError.ReadLineAsync()
        while ($taskOut -or $taskErr) {
            $taskMoved = $false
            foreach ($taskKind in @('out', 'err')) {
                $taskRead = if ($taskKind -eq 'out') { $taskOut } else { $taskErr }
                if (-not $taskRead -or -not $taskRead.IsCompleted) { continue }
                $taskMoved = $true
                $taskLine = $taskRead.Result
                $taskNext = $null
                if ($null -ne $taskLine) {
                    $taskLine = $taskLine -replace "`0", ''
                    Write-Log $taskLine
                    $null = $taskOutput.AppendLine($taskLine)
                    $taskNext = if ($taskKind -eq 'out') { $taskProcess.StandardOutput.ReadLineAsync() } else { $taskProcess.StandardError.ReadLineAsync() }
                }
                if ($taskKind -eq 'out') { $taskOut = $taskNext } else { $taskErr = $taskNext }
            }
            if ($TimeoutSeconds -gt 0 -and $taskTimer.Elapsed.TotalSeconds -gt $TimeoutSeconds) {
                try { $taskProcess.Kill() } catch { }
                throw "Timed out after $TimeoutSeconds s: $(Format-Command $File $Arguments)"
            }
            if (-not $taskMoved) { Start-Sleep -Milliseconds 40 }
        }
        $taskProcess.WaitForExit()
        $taskCode = $taskProcess.ExitCode
    } finally {
        if (-not $taskProcess.HasExited) { try { $taskProcess.Kill() } catch { } }
        $taskProcess.Dispose()
    }
    if ($AllowedExitCodes -notcontains $taskCode) { throw "Command failed with exit code ${taskCode}: $(Format-Command $File $Arguments)" }
    return [pscustomobject]@{ ExitCode = $taskCode; Output = $taskOutput.ToString() }
}

# --- step model: every stage is a list of steps; the same list is printed by -DryRun and executed otherwise -----------
function New-NativeStep([string]$Title, [string]$File, [string[]]$Arguments, [int]$TimeoutSeconds = 0) {
    return [pscustomobject]@{ Title = $Title; File = $File; Arguments = $Arguments; Timeout = $TimeoutSeconds; Action = $null; Text = (Format-Command $File $Arguments) }
}
function New-ActionStep([string]$Title, [string]$Text, [scriptblock]$Action) {
    return [pscustomobject]@{ Title = $Title; File = $null; Arguments = $null; Timeout = 0; Action = $Action; Text = $Text }
}
function New-WslStep([string]$Title, [string[]]$Arguments, [int]$TimeoutSeconds = 0) {
    return New-NativeStep $Title $taskWsl (@('-d', $BuildDistribution) + $Arguments) $TimeoutSeconds
}
function New-ScriptStep([string]$Title, [string]$Script, [string[]]$Arguments, [int]$TimeoutSeconds = 0) {
    return New-NativeStep $Title $taskPowerShell (@('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $Script) + $Arguments) $TimeoutSeconds
}

function Invoke-ArchiveImage([string]$Directory, [string]$ArchiveLabel, [string]$ArchiveStamp, [string]$ImageName) {
    # Moves (never deletes or overwrites) an existing export to before-<label>-<stamp>-<name>; copies the sums and
    # candidate manifest the same way, because export rewrites them.
    $taskImagePath = Join-Path $Directory $ImageName
    if (-not (Test-Path -LiteralPath $taskImagePath)) { Write-Host "No previous image to archive: $taskImagePath"; return $null }
    $taskPrefix = "before-$ArchiveLabel-$ArchiveStamp-"
    $taskDestination = Join-Path $Directory ($taskPrefix + $ImageName)
    if (Test-Path -LiteralPath $taskDestination) { throw "Refusing to overwrite an existing archive: $taskDestination" }
    foreach ($taskCompanion in @('SHA256SUMS', 'candidate.json')) {
        $taskSource = Join-Path $Directory $taskCompanion
        $taskCopy = Join-Path $Directory ($taskPrefix + $taskCompanion)
        if ((Test-Path -LiteralPath $taskSource) -and (Test-Path -LiteralPath $taskCopy)) { throw "Refusing to overwrite an existing archive: $taskCopy" }
    }
    Move-Item -LiteralPath $taskImagePath -Destination $taskDestination
    foreach ($taskCompanion in @('SHA256SUMS', 'candidate.json')) {
        $taskSource = Join-Path $Directory $taskCompanion
        if (Test-Path -LiteralPath $taskSource) { Copy-Item -LiteralPath $taskSource -Destination (Join-Path $Directory ($taskPrefix + $taskCompanion)) }
    }
    Write-Host "Archived previous image: $taskDestination"
    return $taskDestination
}

function Read-State {
    $taskPath = Join-Path $BuildDirectory 'release-state.json'
    if (-not (Test-Path -LiteralPath $taskPath)) { return $null }
    return Get-Content -LiteralPath $taskPath -Raw | ConvertFrom-Json
}
function Save-State([hashtable]$Values) {
    $Values.TimeUTC = [DateTime]::UtcNow.ToString('o')
    $Values | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $BuildDirectory 'release-state.json') -Encoding UTF8
}

# --- stage selection ---------------------------------------------------------------------------------------------
$taskSelected = @()
if ($All) {
    $taskSelected = @('Test', 'Image', 'Prepare', 'Build', 'Check', 'Export', 'QemuCheck', 'Write')
    if ($IncludeKernel -or $CameraCandidate) { $taskSelected = @('Test', 'Kernel') + $taskSelected[1..($taskSelected.Count - 1)] }
} elseif ($Stage) {
    $taskSelected = @($taskAllStages | Where-Object { $Stage -contains $_ })
} elseif ($From) {
    $taskSelected = @($taskAllStages | Where-Object { $_ -ne 'Kernel' -or $IncludeKernel -or $CameraCandidate })
} elseif ($Write) {
    $taskSelected = @('Write')
}
if ($From) {
    $taskFromIndex = [Array]::IndexOf($taskAllStages, $From)
    $taskSelected = @($taskSelected | Where-Object { [Array]::IndexOf($taskAllStages, $_) -ge $taskFromIndex })
}
if ($Skip) { $taskSelected = @($taskSelected | Where-Object { $Skip -notcontains $_ }) }
if ($CameraCandidate -and ($taskSelected -notcontains 'Kernel') -and ($taskSelected -contains 'Prepare')) {
    throw '-CameraCandidate builds a new kernel bundle in the Kernel stage; select it (-IncludeKernel, or -Stage Kernel,...). Not silently ignoring the flag.'
}
if (-not $taskSelected.Count) {
    Get-Help $PSCommandPath | Out-String | Write-Host
    Write-Host 'No stage selected. Try: -All -DryRun'
    exit 0
}
if ($Write -and ($taskSelected -notcontains 'Write')) { $taskSelected += 'Write' }
if ($RecordTarget -and ($taskSelected -notcontains 'Write')) { throw '-RecordTarget belongs to the Write stage.' }
if ($ConfirmErase -and -not $Write) { throw '-ConfirmErase has no effect without -Write; refusing so a pasted confirmation cannot be misread as a write.' }

# --- staging directories -----------------------------------------------------------------------------------------
$taskState = Read-State
$taskBaseStage = $null
$taskUseDiagnostic = $Diagnostic
if ($taskSelected -contains 'Prepare') {
    $taskBaseStage = if ($StagingDirectory) { $StagingDirectory } else { "$StagingRoot/x2-$Label-$taskStamp" }
} elseif ($StagingDirectory) {
    $taskBaseStage = $StagingDirectory
} elseif ($taskState) {
    $taskBaseStage = [string]$taskState.BaseStaging
    if (-not $PSBoundParameters.ContainsKey('Diagnostic')) { $taskUseDiagnostic = [bool]$taskState.Diagnostic }
}
if ($taskBaseStage -and -not $taskBaseStage.StartsWith('/')) { throw 'Use an absolute Linux staging directory.' }
$taskNeedsStaging = @($taskSelected | Where-Object { $_ -in @('Build', 'Check', 'Export', 'QemuCheck') }).Count -gt 0
if ($taskNeedsStaging -and -not $taskBaseStage -and -not $DryRun) {
    throw 'No staging directory is recorded yet. Run the Prepare stage, or pass -StagingDirectory <base directory>.'
}
if (-not $taskBaseStage) { $taskBaseStage = "$StagingRoot/x2-<label>-<time of the Prepare stage>" }
$taskActiveStage = if ($taskUseDiagnostic) { "$taskBaseStage-diagnostic" } else { $taskBaseStage }
$taskBundle = $KernelBundle
$taskLiveUsb = Join-Path $taskRoot 'live-usb.ps1'
$taskImagePath = Join-Path $BuildDirectory $taskImageName

function Get-LiveUsbArguments([string]$Mode, [string]$Directory, [switch]$WithInputs) {
    $taskArgs = @('-Mode', $Mode, '-BuildDistribution', $BuildDistribution, '-OutputDirectory', $Directory)
    if ($WithInputs) {
        if ($taskBundle) { $taskArgs += @('-KernelBundle', $taskBundle) }
        if ($FirmwareDirectory) { $taskArgs += @('-FirmwareDirectory', $FirmwareDirectory) }
    }
    return $taskArgs
}

function Resolve-Tool([string]$Name) {
    $taskCommand = Get-Command $Name -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($taskCommand) { return $taskCommand.Source }
    return $Name
}

function Get-StageSteps([string]$Name) {
    $taskSteps = @()
    switch ($Name) {
        'Test' {
            $taskSteps += New-NativeStep 'TypeScript typecheck' (Resolve-Tool 'npx.cmd') @('tsc', '--noEmit')
            $taskSteps += New-NativeStep 'Desktop build (npm run build)' (Resolve-Tool 'npm.cmd') @('run', 'build')
            foreach ($taskTest in @('live-usb', 'hardware', 'drivers')) {
                $taskSteps += New-WslStep "Python test: $taskTest" @('--cd', $taskRootWsl, '--exec', 'env', "PATH=$taskWslPyPath", 'python3', "tests/$taskTest.test.py")
            }
            # This test drives powershell.exe with Windows temp paths, so it must run with Windows Python (under WSL it
            # hands PowerShell Linux paths and its write-refusal checks fail on the path instead of the confirmation).
            $taskSteps += New-NativeStep 'Python test: live-usb-release (Windows Python)' (Resolve-Tool 'python.exe') @('-I', (Join-Path $taskRoot 'tests\live-usb-release.test.py'))
            $taskSteps += New-ScriptStep 'Writer safety test (mock disks only)' (Join-Path $taskRoot 'tests\write-usb.test.ps1') @()
        }
        'Kernel' {
            $taskSteps += New-ScriptStep 'Kernel bundle (slow; only needed when the kernel or DTB changed)' $taskLiveUsb @('-Mode', 'kernel', '-BuildDistribution', $BuildDistribution, '-KernelProject', $KernelProject)
            if ($CameraCandidate) {
                $taskNewBundle = "/var/tmp/devos-kernel-x2/bundle-camera-candidate-$taskStamp"
                $taskSteps += New-ActionStep 'WARNING' 'warning: the camera sensor wiring is UNVERIFIED; the image carries an opt-in candidate graph' { Write-Log 'WARNING: the camera wiring is unverified. This image carries the candidate graph; it may fail to probe or log errors. Not a fix.' }
                $taskSteps += New-WslStep 'Compose board-fixes bundle with the camera candidate' @('--exec', 'env', "PATH=$taskWslPyPath", 'd', "$taskRootWsl/distro/usb/prepare-board-fixes.dev", '--', '--source', $BoardFixesSource, '--bundle', $BoardFixesBundle, '--output', $taskNewBundle, '--dtc', $Dtc, '--enable-camera-candidate')
                $script:taskBundle = $taskNewBundle
            }
        }
        'Image' {
            $taskSteps += New-ActionStep 'Lock check' 'wsl.exe -d Ubuntu --exec pgrep -a bitbake   (must find nothing)' {
                $taskResult = Invoke-Native $taskWsl @('-d', $BuildDistribution, '--exec', 'pgrep', '-a', 'bitbake') -AllowedExitCodes @(0, 1)
                if ($taskResult.ExitCode -eq 0) { throw 'A bitbake process is already running. Let it finish; a second build is never started.' }
            }
            if ($taskSelected -notcontains 'Test') {
                $taskSteps += New-NativeStep 'Desktop build (npm run build)' (Resolve-Tool 'npm.cmd') @('run', 'build')
            }
            $taskSteps += New-WslStep 'OpenEmbedded desktop image (resumable; finished tasks are cached)' @('--exec', 'env', "PATH=$taskWslPath", "DEVOS_KERNEL_PROJECT=$taskKernelWsl", 'bash', "$taskRootWsl/distro/oe/build.sh", '--build')
        }
        'Prepare' {
            $taskSteps += New-WslStep 'Staging directory must not exist' @('--exec', 'test', '!', '-e', $taskBaseStage)
            $taskSteps += New-ScriptStep 'Prepare staging' $taskLiveUsb (Get-LiveUsbArguments 'prepare' $taskBaseStage -WithInputs)
            if ($taskUseDiagnostic) {
                $taskSteps += New-ScriptStep 'Diagnose (writes DEVOS-LOGS on the ESP)' $taskLiveUsb (Get-LiveUsbArguments 'diagnose' $taskBaseStage -WithInputs)
            }
        }
        'Build' { $taskSteps += New-ScriptStep 'Build GPT image' $taskLiveUsb (Get-LiveUsbArguments 'build' $taskActiveStage) }
        'Check' { $taskSteps += New-ScriptStep 'Check staging' $taskLiveUsb (Get-LiveUsbArguments 'check' $taskActiveStage) }
        'Export' {
            $taskSteps += New-ActionStep 'Archive previous image' "MOVE $taskImagePath -> $(Join-Path $BuildDirectory "before-$Label-$taskStamp-$taskImageName")  (SHA256SUMS and candidate.json are copied)" {
                $script:taskArchived = Invoke-ArchiveImage $BuildDirectory $Label $taskStamp $taskImageName
            }
            $taskSteps += New-ScriptStep 'Export and verify image' $taskLiveUsb (Get-LiveUsbArguments 'export' $taskActiveStage)
        }
        'QemuCheck' {
            # The test tool re-reads this log while QEMU writes it; on the Windows drive (/mnt/c, 9P) that read fails and
            # aborts the check after ~15 s, so the log lives on the Linux filesystem and is copied back afterwards.
            $taskQemuLog = "/var/tmp/devos-usb/qemu-$Label-$taskStamp.log"
            $taskQemuLogCopy = "$taskRootWsl/build/live-usb/qemu-$Label-$taskStamp.log"
            $taskSteps += New-ActionStep 'Tool check' 'wsl.exe -d Ubuntu --exec sh -c "command -v qemu-system-aarch64 && command -v d"   (skips the stage if missing)' {
                $taskResult = Invoke-Native $taskWsl @('-d', $BuildDistribution, '--exec', 'env', "PATH=$taskWslPyPath", 'sh', '-c', 'command -v qemu-system-aarch64 && command -v d') -AllowedExitCodes @(0, 1)
                if ($taskResult.ExitCode -ne 0) { $script:taskSkipStage = 'qemu-system-aarch64 or the DevLang runtime d is missing in WSL; boot check skipped.' }
            }
            $taskSteps += New-WslStep 'QEMU boot check (headless, bounded)' @('--exec', 'env', "PATH=$taskWslPyPath", 'd', "$taskRootWsl/tools/test/live-usb-boot.dev", '--', '--staging', $taskActiveStage, '--desktop-check', '--timeout', [string]$QemuTimeout, '--log', $taskQemuLog) 900
            $taskSteps += New-WslStep 'Copy the QEMU log next to the other logs' @('--exec', 'cp', $taskQemuLog, $taskQemuLogCopy)
        }
        'Write' {
            $taskSteps += New-ActionStep 'USB target validation' "identify exactly one USB disk, compare with $(Join-Path $BuildDirectory 'usb-target.json'), run write-usb.ps1 (validation only)" { Invoke-WriteValidation }
            if ($Write) {
                $taskSteps += New-ActionStep 'Typed confirmation, elevated write and read-back' 'require the printed text (or -ConfirmErase); then elevated: distro\usb\run-write.ps1 -EraseDisk1, then run-write.ps1 -VerifyOnly' { Invoke-WriteConfirmed }
            } else {
                $taskSteps += New-ActionStep 'No write' 'validation only; add -Write to be asked for the typed confirmation' { Write-Log 'Write not requested: nothing was erased or written.' }
            }
        }
    }
    return $taskSteps
}

# --- Write stage -------------------------------------------------------------------------------------------------
function Format-Gb([long]$Bytes) { return ($Bytes / 1GB).ToString('0.0', [Globalization.CultureInfo]::InvariantCulture) }
function Get-UsbInventory {
    if ($taskHookInventory) {
        Write-Log "[TEST HOOK] Using fake disk inventory $taskHookInventory; no disk is touched and no write can happen."
        $taskParsed = Get-Content -LiteralPath $taskHookInventory -Raw | ConvertFrom-Json
        return @($taskParsed | ForEach-Object { $_ })
    }
    $taskList = @()
    foreach ($taskDisk in @(Get-Disk)) {
        $taskParts = @()
        try {
            foreach ($taskPart in @(Get-Partition -DiskNumber $taskDisk.Number -ErrorAction Stop)) {
                $taskVolume = $null
                try { $taskVolume = Get-Volume -Partition $taskPart -ErrorAction Stop } catch { }
                $taskParts += [pscustomobject]@{ PartitionNumber = $taskPart.PartitionNumber; Type = [string]$taskPart.Type; Size = [long]$taskPart.Size
                    FileSystem = if ($taskVolume) { [string]$taskVolume.FileSystem } else { '' }; Label = if ($taskVolume) { [string]$taskVolume.FileSystemLabel } else { '' } }
            }
        } catch { }
        $taskList += [pscustomobject]@{ Number = [int]$taskDisk.Number; FriendlyName = [string]$taskDisk.FriendlyName; UniqueId = [string]$taskDisk.UniqueId
            Size = [long]$taskDisk.Size; BusType = [string]$taskDisk.BusType; IsBoot = [bool]$taskDisk.IsBoot; IsSystem = [bool]$taskDisk.IsSystem
            IsReadOnly = [bool]$taskDisk.IsReadOnly; LogicalSectorSize = [int]$taskDisk.LogicalSectorSize; PartitionStyle = [string]$taskDisk.PartitionStyle; Partitions = $taskParts }
    }
    return $taskList
}
function Get-WriteTarget {
    # Returns the single USB disk, or throws. Never returns a boot/system/read-only disk.
    $taskDisks = @(Get-UsbInventory | Where-Object { $_.BusType -eq 'USB' })
    if ($taskDisks.Count -ne 1) {
        throw ("Exactly one USB disk must be connected to identify the target; found $($taskDisks.Count)." + ($taskDisks | ForEach-Object { "`n  Disk $($_.Number): $($_.FriendlyName) $(Format-Gb $_.Size) GB" }) -join '')
    }
    $taskDisk = $taskDisks[0]
    if ($taskDisk.IsBoot -or $taskDisk.IsSystem) { throw "Disk $($taskDisk.Number) is a boot/system disk. Refusing." }
    if ($taskDisk.IsReadOnly) { throw "Disk $($taskDisk.Number) is read-only. Refusing." }
    if ($taskDisk.Number -ne 1) { throw "The USB is Disk $($taskDisk.Number), but write-usb.ps1 only ever writes Disk 1 (a deliberate safety limit). Re-plug it so it becomes Disk 1 or ask for the writer to be extended; nothing was written." }
    return $taskDisk
}
function Get-TargetPath { if ($taskHookTarget) { return $taskHookTarget } else { return (Join-Path $BuildDirectory 'usb-target.json') } }
function Show-WriteTarget($Disk) {
    Write-Log "Target USB: Disk $($Disk.Number) | $($Disk.FriendlyName) | $(Format-Gb $Disk.Size) GB | $($Disk.PartitionStyle) | sector $($Disk.LogicalSectorSize)"
    Write-Log "UniqueId: $($Disk.UniqueId)"
    if (-not @($Disk.Partitions).Count) { Write-Log 'Currently on it: no partitions (blank or unrecognized).' }
    foreach ($taskPart in @($Disk.Partitions)) {
        Write-Log "  partition $($taskPart.PartitionNumber): $($taskPart.Type), $([math]::Round($taskPart.Size / 1MB)) MB, fs '$($taskPart.FileSystem)', label '$($taskPart.Label)'"
    }
}
function Get-EraseText($Disk) { return "ERASE DISK $($Disk.Number) $($Disk.FriendlyName) $(Format-Gb $Disk.Size) GB" }
function Read-TypedConfirmation([string]$Expected, [string]$Provided) {
    if ($Provided) {
        if ($Provided -cne $Expected) { throw "The confirmation text does not match. Expected exactly: $Expected" }
        return
    }
    if ([Console]::IsInputRedirected) { throw "No interactive input available. Pass -ConfirmErase '$Expected' for an unattended run." }
    $taskTyped = Read-Host "Type exactly [$Expected] to continue"
    if ($taskTyped -cne $Expected) { throw 'The typed text does not match. Nothing was written.' }
}
function Invoke-WriteValidation {
    $taskDisk = Get-WriteTarget
    Show-WriteTarget $taskDisk
    Write-Log "To write this USB add -Write; the confirmation text is exactly: $(Get-EraseText $taskDisk)"
    $taskTargetFile = Get-TargetPath
    $taskRecorded = if (Test-Path -LiteralPath $taskTargetFile) { Get-Content -LiteralPath $taskTargetFile -Raw | ConvertFrom-Json } else { $null }
    $script:taskIdentityOk = [bool]($taskRecorded -and $taskRecorded.UniqueId -eq $taskDisk.UniqueId)
    if ($script:taskIdentityOk) {
        Write-Log "Matches the recorded target in usb-target.json ($($taskRecorded.FriendlyName))."
    } else {
        $taskSaved = if ($taskRecorded) { "$($taskRecorded.FriendlyName) / $(Format-Gb $taskRecorded.Size) GB" } else { 'none' }
        if (-not $RecordTarget) {
            throw "This USB is NOT the recorded target (recorded: $taskSaved). Nothing was written. If this is the drive you want, run again with -RecordTarget (you will be asked to confirm)."
        }
        Write-Log "Recorded target: $taskSaved. Re-recording was requested for the disk shown above."
        $taskRecordText = "RECORD TARGET DISK $($taskDisk.Number) $($taskDisk.FriendlyName) $(Format-Gb $taskDisk.Size) GB"
        Read-TypedConfirmation $taskRecordText $ConfirmRecord
        if ($taskHook) { Write-Log '[TEST HOOK] usb-target.json is not modified.' }
        else {
            Invoke-Native $taskPowerShell @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', (Join-Path $taskRoot 'distro\usb\write-usb.ps1'), '-SelectTarget') | Out-Null
            Write-Log 'usb-target.json updated by write-usb.ps1 -SelectTarget (no disk change).'
        }
        $script:taskIdentityOk = $true
    }
    if ($taskHook) { Write-Log '[TEST HOOK] writer validation skipped.'; return }
    $taskResult = Invoke-Native $taskPowerShell @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', (Join-Path $taskRoot 'distro\usb\write-usb.ps1'))
    if ($taskResult.Output -notmatch 'Validation only') { throw 'write-usb.ps1 did not report validation-only mode; refusing to continue.' }
}
function Invoke-ElevatedWrite([string]$Disk) {
    if ($taskHook) { throw 'Internal guard: the test hook can never write.' }
    if ($BuildDirectory -ne $taskDefaultBuild) { throw 'The writer always uses build\live-usb; refusing to write with a different -BuildDirectory.' }
    $taskRunWrite = Join-Path $taskRoot 'distro\usb\run-write.ps1'
    $taskReceipt = Join-Path $BuildDirectory 'usb-write-receipt.json'
    $taskLogBase = Join-Path $BuildDirectory "usb-write-$Label-$taskStamp"
    $taskWrapper = Join-Path $BuildDirectory "release-write-$Label-$taskStamp.ps1"
    $taskQuoted = $taskRunWrite.Replace("'", "''")
    $taskLines = @(
        "`$ErrorActionPreference = 'Stop'",
        "& '$taskQuoted' -EraseDisk1",
        "`$taskCode = `$LASTEXITCODE",
        "Copy-Item -LiteralPath '$($BuildDirectory.Replace("'", "''"))\usb-write.log' -Destination '$($taskLogBase.Replace("'", "''"))-write.log' -ErrorAction SilentlyContinue",
        "Copy-Item -LiteralPath '$($taskReceipt.Replace("'", "''"))' -Destination '$($taskLogBase.Replace("'", "''"))-write-receipt.json' -ErrorAction SilentlyContinue",
        "if (`$taskCode -ne 0) { exit `$taskCode }",
        "& '$taskQuoted' -VerifyOnly",
        "exit `$LASTEXITCODE")
    Set-Content -LiteralPath $taskWrapper -Value $taskLines -Encoding ASCII
    $taskPrincipal = [Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent())
    $taskBefore = if (Test-Path -LiteralPath $taskReceipt) { (Get-Item -LiteralPath $taskReceipt).LastWriteTimeUtc } else { [DateTime]::MinValue }
    $taskArgs = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $taskWrapper)
    if ($taskPrincipal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
        Write-Log 'Already Administrator: running the writer directly.'
        $null = Invoke-Native $taskPowerShell $taskArgs
    } else {
        Write-Log 'Requesting elevation for the write step only; approve the UAC prompt to continue.'
        $taskElevated = Start-Process -FilePath $taskPowerShell -ArgumentList @($taskArgs | ForEach-Object { ConvertTo-ProcessArgument $_ }) -Verb RunAs -WindowStyle Hidden -Wait -PassThru
        if ($taskElevated.ExitCode -ne 0) { Write-Log "The elevated writer exited with code $($taskElevated.ExitCode)." }
    }
    foreach ($taskName in @('usb-write.log')) {
        $taskPath = Join-Path $BuildDirectory $taskName
        if (Test-Path -LiteralPath $taskPath) { Write-Log "--- $taskName (tail) ---"; Get-Content -LiteralPath $taskPath -Tail 25 | ForEach-Object { Write-Log $_ } }
    }
    if (-not (Test-Path -LiteralPath $taskReceipt) -or (Get-Item -LiteralPath $taskReceipt).LastWriteTimeUtc -le $taskBefore) { throw 'No new usb-write-receipt.json: the write or its read-back did not complete. Do not boot this USB.' }
    $taskResult = Get-Content -LiteralPath $taskReceipt -Raw | ConvertFrom-Json
    Write-Log "Receipt: Result=$($taskResult.Result) BytesVerified=$($taskResult.BytesVerified) SHA256=$($taskResult.SHA256) VerifyOnly=$($taskResult.VerifyOnly)"
    if ($taskResult.Result -ne 'Verified') { throw 'The receipt does not say Verified.' }
    if (-not $taskResult.VerifyOnly) { throw 'The final read-back pass did not run (receipt is not from -VerifyOnly).' }
    $script:taskWriteReceipt = $taskReceipt
}
function Invoke-WriteConfirmed {
    $taskDisk = Get-WriteTarget
    if (-not $script:taskIdentityOk) { throw 'Target identity not validated. Nothing was written.' }
    if (-not $taskHook) {
        foreach ($taskName in @($taskImageName, 'SHA256SUMS', 'candidate.json')) {
            if (-not (Test-Path -LiteralPath (Join-Path $BuildDirectory $taskName))) { throw "Missing $taskName in $BuildDirectory. Run Export first." }
        }
    }
    Show-WriteTarget $taskDisk
    $taskText = Get-EraseText $taskDisk
    Write-Log "This will ERASE the USB above and write $taskImageName."
    Read-TypedConfirmation $taskText $ConfirmErase
    if ($taskHook) { Write-Log '[TEST HOOK] confirmation accepted; the write is suppressed. Nothing was written.'; return }
    Invoke-ElevatedWrite $taskText
}

# --- runner ------------------------------------------------------------------------------------------------------
$taskResults = [Collections.Generic.List[object]]::new()
function Get-ImageSha {
    $taskSums = Join-Path $BuildDirectory 'SHA256SUMS'
    if (Test-Path -LiteralPath $taskSums) { return (Get-Content -LiteralPath $taskSums -Raw).Split()[0] }
    return ''
}
function Show-Summary {
    Write-Host ''
    Write-Host '=== Summary ==='
    $taskResults | ForEach-Object { [pscustomobject]@{ Stage = $_.Stage; Status = $_.Status; Seconds = $_.Seconds; Log = $_.Log; Artifacts = $_.Artifacts } } |
        Format-Table -AutoSize -Wrap | Out-String -Width 200 | Write-Host
    $taskSha = Get-ImageSha
    if ($taskSha) { Write-Host "Image SHA256: $taskSha  ($taskImagePath)" }
}

$taskMode = if ($DryRun) { 'DRY RUN (nothing is executed)' } else { 'RUN' }
Write-Host "[$((Get-Date).ToString('HH:mm:ss'))] DevOs Live USB release | $taskMode | label '$Label' | stamp $taskStamp"
Write-Host "Stages: $($taskSelected -join ' -> ')"
Write-Host "Project: $taskRoot  (WSL: $taskRootWsl, distribution $BuildDistribution)"
Write-Host "Logs and artifacts: $BuildDirectory"
if ($taskSelected | Where-Object { $_ -in @('Prepare', 'Build', 'Check', 'Export', 'QemuCheck') }) {
    Write-Host "Staging: $taskBaseStage  (active: $taskActiveStage, diagnostic=$taskUseDiagnostic)"
}
if ($taskSelected -contains 'Kernel' -and $CameraCandidate) { Write-Host 'WARNING: -CameraCandidate adds the UNVERIFIED camera graph. Camera may still not work.' }
if ($All -and -not $Write) { Write-Host 'Write: not requested; -All stops before the write (validation only).' }

if (-not $DryRun) {
    New-Item -ItemType Directory -Force -Path $BuildDirectory | Out-Null
    $script:taskLog = $null
    if ($taskSelected | Where-Object { $_ -ne 'Write' }) {
        Write-Host "[$((Get-Date).ToString('HH:mm:ss'))] Preflight: WSL"
        try {
            $null = Invoke-Native $taskWsl @('-d', $BuildDistribution, '--exec', 'true') -TimeoutSeconds 180
            $taskWslRoot = (Invoke-Native $taskWsl @('-d', $BuildDistribution, '--exec', 'wslpath', '-a', $taskRoot) -TimeoutSeconds 60).Output.Trim()
            if ($taskWslRoot -ne $taskRootWsl) { throw "wslpath says $taskWslRoot but the script computed $taskRootWsl." }
            $taskFree = (Invoke-Native $taskWsl @('-d', $BuildDistribution, '--exec', 'df', '-Pk', '/var/tmp') -TimeoutSeconds 60).Output
            if ($taskFree -match '(?m)^\S+\s+\d+\s+\d+\s+(\d+)\s') {
                if ([long]$Matches[1] -lt 25GB / 1KB) { Write-Host "WARNING: only $([math]::Round([long]$Matches[1] / 1MB, 1)) GB free in WSL /var/tmp; a build needs roughly 25 GB or more." }
            }
        } catch {
            Write-Host "WSL is not usable: $($_.Exception.Message)"
            Write-Host 'If WSL timed out starting, run: wsl.exe --shutdown   then try again. Nothing was built or written.'
            exit 1
        }
    }
}

$taskFailed = $null
$taskPaused = $false
foreach ($taskName in $taskSelected) {
    $taskStageStart = Get-Date
    $script:taskSkipStage = $null
    $script:taskArchived = $null
    $script:taskWriteReceipt = $null
    $script:taskIdentityOk = $false
    Write-Host ''
    Write-Host "[$($taskStageStart.ToString('HH:mm:ss'))] === Stage: $taskName ==="
    $taskLogPath = Join-Path $BuildDirectory "$($taskLogNames[$taskName])-$Label-$taskStamp.log"
    if ($DryRun) {
        $script:taskLog = $null
        foreach ($taskStep in (Get-StageSteps $taskName)) { Write-Host "  [$($taskStep.Title)]"; Write-Host "    $($taskStep.Text)" }
        $taskResults.Add([pscustomobject]@{ Stage = $taskName; Status = 'DryRun'; Seconds = 0; Log = $taskLogPath; Artifacts = '' })
        continue
    }
    $script:taskLog = $taskLogPath
    New-Item -ItemType File -Force -Path $taskLogPath | Out-Null
    $taskStatus = 'OK'
    $taskArtifacts = ''
    try {
        foreach ($taskStep in (Get-StageSteps $taskName)) {
            if ($script:taskSkipStage) { break }
            Write-Log "[$((Get-Date).ToString('HH:mm:ss'))] $($taskStep.Title)"
            if ($taskStep.Action) { & $taskStep.Action }
            else { $null = Invoke-Native $taskStep.File $taskStep.Arguments -TimeoutSeconds $taskStep.Timeout }
        }
        if ($script:taskSkipStage) { $taskStatus = 'Skipped'; Write-Log $script:taskSkipStage }
        switch ($taskName) {
            'Kernel' { if ($taskBundle) { $taskArtifacts = $taskBundle } }
            'Prepare' {
                Save-State @{ BaseStaging = $taskBaseStage; Diagnostic = $taskUseDiagnostic; Label = $Label; Stamp = $taskStamp; KernelBundle = [string]$taskBundle }
                $taskArtifacts = $taskActiveStage
            }
            'Export' { $taskArtifacts = $taskImagePath; if ($script:taskArchived) { $taskArtifacts += " (previous: $script:taskArchived)" } }
            'QemuCheck' { if ($taskStatus -eq 'OK') { $taskArtifacts = "build\live-usb\qemu-$Label-$taskStamp.log" } }
            'Write' {
                if ($script:taskWriteReceipt) { $taskArtifacts = $script:taskWriteReceipt }
                elseif ($Write) { $taskStatus = 'OK (hook, no write)' }
                else { $taskStatus = 'Validated only' }
            }
        }
    } catch {
        $taskMessage = $_.Exception.Message
        Write-Log "FAILED: $taskMessage"
        if ($taskName -eq 'Export' -and $script:taskArchived -and -not (Test-Path -LiteralPath $taskImagePath)) {
            Move-Item -LiteralPath $script:taskArchived -Destination $taskImagePath
            Write-Log "Restored the previous image to $taskImagePath"
        }
        if ($taskName -eq 'Write' -and $All -and -not $Write) {
            $taskStatus = 'Not validated'
            Write-Log 'The USB could not be validated (not a failure of the build). Fix it and run: -Stage Write -Write'
        } else {
            $taskStatus = 'FAILED'
            $taskFailed = $taskName
        }
    }
    $taskResults.Add([pscustomobject]@{ Stage = $taskName; Status = $taskStatus; Seconds = [int]((Get-Date) - $taskStageStart).TotalSeconds; Log = $taskLogPath; Artifacts = $taskArtifacts })
    if ($taskFailed) { break }
}
$script:taskLog = $null
if ($DryRun) {
    Write-Host ''
    Write-Host 'Dry run finished. Nothing was executed, written or erased.'
    exit 0
}
Show-Summary
if ($taskFailed) {
    $taskResume = ".\tools\live\release-live-usb.ps1 -From $taskFailed -Label $Label"
    if ($taskFailed -in @('Build', 'Check', 'Export', 'QemuCheck')) { $taskResume += " -StagingDirectory '$taskBaseStage'" }
    Write-Host "Stage $taskFailed failed. Fix the cause in its log, then resume with:"
    Write-Host "  $taskResume"
    exit 1
}
if ($All -and -not $Write) {
    Write-Host 'Paused before the USB write. To write after reviewing the target above:'
    Write-Host '  .\tools\live\release-live-usb.ps1 -Stage Write -Write'
}
exit 0
