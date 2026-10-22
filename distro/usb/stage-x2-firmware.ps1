param([string]$OutputDirectory = (Join-Path $PSScriptRoot '../../build/live-usb/firmware'))
$ErrorActionPreference = 'Stop'
$taskModel = (Get-CimInstance Win32_ComputerSystem).Model
if ($taskModel -notlike '*UX3407NA*') { throw 'This firmware collector targets only ASUS UX3407NA.' }
if (Test-Path -LiteralPath $OutputDirectory) { throw 'Choose a new firmware output directory.' }
$taskStore = 'C:/Windows/System32/DriverStore/FileRepository'
$taskAdsp = Get-ChildItem $taskStore -Directory -Filter 'qcsubsys_ext_adsp8480.inf_arm64_*' | Sort-Object LastWriteTime -Descending | Select-Object -First 1
$taskCdsp = Get-ChildItem $taskStore -Directory -Filter 'qcnspmcdm8480.inf_arm64_*' | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $taskAdsp -or -not $taskCdsp) { throw 'Required installed X2 firmware packages not found.' }
$taskRelative = 'qcom/glymur/ASUSTeK/UX3407NA'
$taskDestination = Join-Path $OutputDirectory $taskRelative
New-Item -ItemType Directory -Path $taskDestination -Force | Out-Null
$taskFiles = @{}
$taskSources = @{}
foreach ($taskPair in @(@($taskAdsp, @('qcadsp8480.mbn','adsp_dtbs.elf','adspr.jsn','adsps.jsn','adspua.jsn')), @($taskCdsp, @('qccdsp8480.mbn','cdsp_dtbs.elf')))) {
    foreach ($taskName in $taskPair[1]) {
        $taskInput = Join-Path $taskPair[0].FullName $taskName
        if (-not (Test-Path -LiteralPath $taskInput -PathType Leaf)) { throw "Missing firmware: $taskName" }
        Copy-Item -LiteralPath $taskInput -Destination (Join-Path $taskDestination $taskName)
        $taskFiles["$taskRelative/$taskName"] = (Get-FileHash -LiteralPath $taskInput -Algorithm SHA256).Hash.ToLowerInvariant()
        $taskSources[$taskName] = $taskInput
    }
}
# The installed OEM INF maps this exact PCI subsystem to this board ELF.
$taskWlanDevice = Get-PnpDevice -Class Net -PresentOnly | Where-Object { $_.InstanceId -like 'PCI\VEN_17CB&DEV_1112&SUBSYS_E14F105B*' } | Select-Object -First 1
if (-not $taskWlanDevice) { throw 'The installed Wi-Fi device does not match this calibration profile.' }
$taskWlan = Get-ChildItem $taskStore -Directory -Filter 'qcwlancol8480.inf_arm64_*' | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $taskWlan) { throw 'Installed QCC2072 calibration package not found.' }
$taskInf = Get-Content -LiteralPath (Join-Path $taskWlan.FullName 'qcwlancol8480.inf') -Raw
if ($taskInf -notmatch 'QcWlan_AS_NCM820A.ndi[^\r\n]+PCI\\VEN_17CB&DEV_1112&SUBSYS_E14F105B' -or $taskInf -notmatch 'BDFileName[^\r\n]+bdwlan_qcc2072_1p0_ncm820A.elf') { throw 'OEM calibration mapping does not match UX3407NA Wi-Fi.' }
$taskBoard = Join-Path $taskWlan.FullName 'bdwlan_qcc2072_1p0_ncm820A.elf'
$taskBytes = [IO.File]::ReadAllBytes($taskBoard)
if ($taskBytes.Length -lt 64 -or $taskBytes[0] -ne 127 -or $taskBytes[1] -ne 69 -or $taskBytes[2] -ne 76 -or $taskBytes[3] -ne 70) { throw 'Expected board calibration ELF.' }
$taskBoardRelative = 'ath12k/QCC2072/hw1.0/board.bin'
$taskBoardOutput = Join-Path $OutputDirectory $taskBoardRelative
New-Item -ItemType Directory -Path (Split-Path $taskBoardOutput -Parent) -Force | Out-Null
Copy-Item -LiteralPath $taskBoard -Destination $taskBoardOutput
$taskFiles[$taskBoardRelative] = (Get-FileHash -LiteralPath $taskBoard -Algorithm SHA256).Hash.ToLowerInvariant()
$taskSources[$taskBoardRelative] = $taskBoard
$taskManifest = @{ schemaVersion = 1; board = 'asus-ux3407na'; purpose = 'Local device firmware for personal hardware testing; no Windows executables copied'; files = $taskFiles; sources = $taskSources }
$taskManifest['wireless'] = @{ pci = '17cb:1112'; subsystem = '105b:e14f'; boardData = $taskBoardRelative; sourceInfSHA256 = (Get-FileHash -LiteralPath (Join-Path $taskWlan.FullName 'qcwlancol8480.inf') -Algorithm SHA256).Hash.ToLowerInvariant() }
$taskJson = $taskManifest | ConvertTo-Json -Depth 6
[IO.File]::WriteAllText((Join-Path ([IO.Path]::GetFullPath($OutputDirectory)) 'manifest.json'), $taskJson, [Text.UTF8Encoding]::new($false))
Write-Host "Staged board DSP firmware and exact OEM Wi-Fi calibration: $OutputDirectory"
