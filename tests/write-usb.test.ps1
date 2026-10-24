$ErrorActionPreference = 'Stop'
$taskTokens = $null; $taskErrors = $null
$taskAst = [Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot '../distro/usb/write-usb.ps1'), [ref]$taskTokens, [ref]$taskErrors)
if ($taskErrors.Count) { throw ($taskErrors | Out-String) }
$taskFunction = $taskAst.Find({ param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Get-HeaderCrc32' }, $true)
& ([ScriptBlock]::Create($taskFunction.Extent.Text + "`nif ((Get-HeaderCrc32 ([Text.Encoding]::ASCII.GetBytes('123456789'))) -ne [uint32]3421780262) { throw 'CRC32 known-vector failure' }"))
[long]$taskRemaining = 4922015744
if ([int][Math]::Min([long](4MB), [long]$taskRemaining) -ne 4MB) { throw 'Large image read-back overflow' }
Write-Output 'PASS: writer syntax, CRC32 known vector, and >4 GB read-back arithmetic. No disks opened.'
$taskAssertion = $taskAst.Find({ param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Assert-UsbTarget' }, $true)
& {
    param($taskDefinition)
    . ([ScriptBlock]::Create($taskDefinition))
    $taskLength = 5GB
    $taskTarget = [pscustomobject]@{UniqueId='old-usb'; FriendlyName='Old USB'; Size=128GB}
    $taskMock = [pscustomobject]@{Number=1; IsBoot=$false; IsSystem=$false; BusType='USB'; UniqueId='new-usb'; FriendlyName='New USB'; Size=16GB; IsReadOnly=$false; LogicalSectorSize=512}
    function Get-Disk { param($Number) if ($Number -ne 1) { throw 'Unexpected disk number' }; return $taskMock }
    $taskRejected = $false
    try { $null = Assert-UsbTarget } catch {
        $taskRejected = $_.Exception.Message.Contains('Saved USB: Old USB') -and $_.Exception.Message.Contains('Current Disk 1: New USB') -and $_.Exception.Message.Contains('-SelectTarget')
    }
    if (-not $taskRejected) { throw 'A changed device must fail with actionable identity details.' }
    $null = Assert-UsbTarget -IdentityOptional
    $taskTarget = $taskMock
    $null = Assert-UsbTarget
    foreach ($taskCase in @(@{IsBoot=$true}, @{IsSystem=$true}, @{BusType='NVMe'}, @{IsReadOnly=$true}, @{Size=4GB}, @{LogicalSectorSize=4096}, @{UniqueId=''})) {
        $taskKey = @($taskCase.Keys)[0]; $taskOld = $taskMock.$taskKey; $taskMock.$taskKey = $taskCase[$taskKey]
        try {
            $taskRejected = $false
            try { $null = Assert-UsbTarget -IdentityOptional } catch { $taskRejected = $true }
            if (-not $taskRejected) { throw "Selection bypassed safety check: $taskKey" }
        } finally { $taskMock.$taskKey = $taskOld }
    }
} $taskAssertion.Extent.Text
Write-Output 'PASS: changed/matching USB identities, selection-only identity replacement, and all disk safety guards. Mock disks only.'
. (Join-Path $PSScriptRoot '../distro/usb/volume-lock.ps1')
& {
    $taskOpened = [Collections.Generic.List[string]]::new()
    $taskHandles = [Collections.Generic.List[IO.MemoryStream]]::new()
    $taskFail = $false
    function Open-UsbVolumeLock([string]$Path) {
        $taskOpened.Add($Path)
        if ($taskFail -and $taskOpened.Count -eq 2) { throw 'Mock volume is busy' }
        $taskHandle = [IO.MemoryStream]::new(); $taskHandles.Add($taskHandle); return $taskHandle
    }
    function Get-Partition {
        param($DiskNumber, $ErrorAction)
        if ($DiskNumber -ne 1) { throw 'Unexpected disk number' }
        [pscustomobject]@{AccessPaths=@('E:\', '\\?\Volume{11111111-1111-1111-1111-111111111111}\'); DriveLetter='E'}
        [pscustomobject]@{AccessPaths=@('\\?\Volume{22222222-2222-2222-2222-222222222222}\'); DriveLetter=$null}
        [pscustomobject]@{AccessPaths=$null; DriveLetter=$null}
    }
    $taskLocks = Lock-UsbVolumes -DiskNumber 1
    if ($taskLocks.Count -ne 2 -or $taskOpened[0] -ne '\\?\Volume{11111111-1111-1111-1111-111111111111}' -or
        $taskOpened[1] -ne '\\?\Volume{22222222-2222-2222-2222-222222222222}') { throw 'Incorrect volume lock paths' }
    foreach ($taskLock in $taskLocks) { if (-not $taskLock.CanRead) { throw 'Lock released too early' }; $taskLock.Dispose() }
    $taskOpened.Clear(); $taskHandles.Clear(); $taskFail = $true
    $taskRejected = $false
    try { $null = Lock-UsbVolumes -DiskNumber 1 } catch { $taskRejected = $_.Exception.Message -eq 'Mock volume is busy' }
    if (-not $taskRejected -or $taskHandles[0].CanRead) { throw 'Busy volume did not abort and release acquired locks' }
    function Get-Partition { param($DiskNumber, $ErrorAction) [pscustomobject]@{AccessPaths=@('F:\'); DriveLetter='F'} }
    $taskFail = $false; $taskOpened.Clear()
    $taskLocks = Lock-UsbVolumes -DiskNumber 1
    if ($taskOpened[0] -ne '\\.\F:') { throw 'Drive-letter volume fallback failed' }
    foreach ($taskLock in $taskLocks) { $taskLock.Dispose() }
}
Write-Output 'PASS: native lock declarations compile; GUID/letter volumes, unmounted partitions, retained locks and failure cleanup tested. No physical disks opened.'
