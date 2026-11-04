Get-Disk | Where-Object BusType -eq 'USB' |
    Select-Object Number, FriendlyName, @{n='SizeGB';e={[math]::Round($_.Size/1GB,1)}},
        PartitionStyle, IsReadOnly, OperationalStatus |
    Format-Table -AutoSize | Out-String
