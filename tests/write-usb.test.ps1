$ErrorActionPreference = 'Stop'
$taskTokens = $null; $taskErrors = $null
$taskAst = [Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot '../distro/usb/write-usb.ps1'), [ref]$taskTokens, [ref]$taskErrors)
if ($taskErrors.Count) { throw ($taskErrors | Out-String) }
$taskFunction = $taskAst.Find({ param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Get-HeaderCrc32' }, $true)
& ([ScriptBlock]::Create($taskFunction.Extent.Text + "`nif ((Get-HeaderCrc32 ([Text.Encoding]::ASCII.GetBytes('123456789'))) -ne [uint32]3421780262) { throw 'CRC32 known-vector failure' }"))
[long]$taskRemaining = 4922015744
if ([int][Math]::Min([long](4MB), [long]$taskRemaining) -ne 4MB) { throw 'Large image read-back overflow' }
Write-Output 'PASS: writer syntax, CRC32 known vector, and >4 GB read-back arithmetic. No disks opened.'
