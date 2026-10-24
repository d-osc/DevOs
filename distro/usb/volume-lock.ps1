# Native volume locks work on removable media, which Windows cannot offline.
# Loading this file compiles declarations only; no device is opened here.
if (-not ('DevOs.UsbVolumeLock' -as [type])) {
    Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;
namespace DevOs {
    public sealed class UsbVolumeLock : IDisposable {
        private SafeFileHandle handle;
        [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
        private static extern SafeFileHandle CreateFileW(string path, uint access, uint share,
            IntPtr security, uint disposition, uint flags, IntPtr template);
        [DllImport("kernel32.dll", SetLastError=true)]
        private static extern bool DeviceIoControl(SafeFileHandle file, uint code,
            IntPtr input, uint inputSize, IntPtr output, uint outputSize,
            out uint returned, IntPtr overlapped);
        public UsbVolumeLock(string path) {
            handle = CreateFileW(path, 0xC0000000, 3, IntPtr.Zero, 3, 0, IntPtr.Zero);
            try {
                if (handle.IsInvalid) throw new Win32Exception(Marshal.GetLastWin32Error(), "Cannot open USB volume " + path);
                Control(0x00090018, "Cannot lock USB volume " + path + ". Close Explorer, terminals and apps using the USB, then retry.");
                Control(0x00090020, "Cannot dismount locked USB volume " + path);
            } catch { handle.Dispose(); throw; }
        }
        private void Control(uint code, string message) {
            uint returned;
            if (!DeviceIoControl(handle, code, IntPtr.Zero, 0, IntPtr.Zero, 0, out returned, IntPtr.Zero))
                throw new Win32Exception(Marshal.GetLastWin32Error(), message);
        }
        public void Dispose() { handle.Dispose(); } // Closing the handle releases its lock.
    }
}
'@
}
function Open-UsbVolumeLock([string]$Path) { return [DevOs.UsbVolumeLock]::new($Path) }
function Lock-UsbVolumes([int]$DiskNumber) {
    $taskLocks = [Collections.Generic.List[IDisposable]]::new()
    try {
        $taskPaths = @(Get-Partition -DiskNumber $DiskNumber -ErrorAction Stop | ForEach-Object {
            # Prefer GUIDs, including mounted volumes that have no drive letter.
            $taskAccessPaths = @($_.AccessPaths | Where-Object { $_ })
            $taskGuid = @($taskAccessPaths | Where-Object { $_.StartsWith('\\?\Volume{') -and $_.EndsWith('}\') })
            if ($taskGuid.Count) { $taskGuid[0].TrimEnd('\') }
            elseif ($_.DriveLetter) { '\\.\' + $_.DriveLetter + ':' }
            elseif ($taskAccessPaths.Count) { throw 'Cannot identify a target volume for locking. Nothing was written.' }
            # Unrecognized/unformatted partitions have no mounted Windows volume.
        } | Sort-Object -Unique)
        foreach ($taskPath in $taskPaths) { $taskLocks.Add((Open-UsbVolumeLock $taskPath)) }
        return ,$taskLocks
    } catch {
        foreach ($taskLock in $taskLocks) { $taskLock.Dispose() }
        throw
    }
}
