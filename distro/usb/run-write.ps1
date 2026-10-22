param([switch]$EraseDisk1, [switch]$VerifyOnly)
$ErrorActionPreference = 'Stop'
$taskDirectory = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../../build/live-usb'))
$taskStatus = Join-Path $taskDirectory 'usb-write-status.json'
$taskExit = 1
try {
    Start-Transcript -LiteralPath (Join-Path $taskDirectory 'usb-write.log') -Force | Out-Null
    @{ State = 'Running'; TimeUTC = [DateTime]::UtcNow.ToString('o') } | ConvertTo-Json |
        Set-Content -LiteralPath $taskStatus -Encoding UTF8
    & (Join-Path $PSScriptRoot 'write-usb.ps1') -EraseDisk1:$EraseDisk1 -VerifyOnly:$VerifyOnly
    @{ State = 'Completed'; TimeUTC = [DateTime]::UtcNow.ToString('o') } | ConvertTo-Json |
        Set-Content -LiteralPath $taskStatus -Encoding UTF8
    $taskExit = 0
} catch {
    @{ State = 'Failed'; Error = $_.Exception.Message; TimeUTC = [DateTime]::UtcNow.ToString('o') } | ConvertTo-Json |
        Set-Content -LiteralPath $taskStatus -Encoding UTF8
    Write-Error -Message $_.Exception.Message -ErrorAction Continue
} finally { Stop-Transcript -ErrorAction SilentlyContinue | Out-Null }
exit $taskExit
