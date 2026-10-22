param([string]$RequestBase64 = '')
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
try {
    $request = if ($RequestBase64) { [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($RequestBase64)) | ConvertFrom-Json } else { @{ action = 'scan' } }
    if ($request.action -eq 'settings') {
        $pages = @{ wifi = 'ms-settings:network-wifi'; vpn = 'ms-settings:network-vpn'; hotspot = 'ms-settings:network-mobilehotspot'; airplane = 'ms-settings:network-airplanemode'; proxy = 'ms-settings:network-proxy'; advanced = 'ms-settings:network-advancedsettings' }
        $page = if ($request.page) { [string]$request.page } else { 'wifi' }
        if (-not $pages.ContainsKey($page)) { throw 'Unsupported network settings page.' }
        Start-Process $pages[$page]
        @{ ok = $true } | ConvertTo-Json -Compress
        exit 0
    }
    if ($request.action -notin @('scan', 'connect')) { throw 'Unsupported Wi-Fi action.' }
    Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Text;
public static class DevOsWifi {
    [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
    struct Interface { public Guid id; [MarshalAs(UnmanagedType.ByValTStr, SizeConst=256)] public string description; public uint state; }
    [StructLayout(LayoutKind.Sequential)]
    struct Ssid { public uint length; [MarshalAs(UnmanagedType.ByValArray, SizeConst=32)] public byte[] bytes; }
    [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
    struct Network {
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst=256)] public string profile;
        public Ssid ssid; public uint bssType, bssCount; public int connectable; public uint reason, phyCount;
        [MarshalAs(UnmanagedType.ByValArray, SizeConst=8)] public uint[] phyTypes;
        public int morePhy; public uint signal; public int security; public uint auth, cipher, flags, reserved;
    }
    [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
    struct Connection { public uint mode; [MarshalAs(UnmanagedType.LPWStr)] public string profile; public IntPtr ssid, bssid; public uint bssType, flags; }
    public class Item { public string ssid, profile, adapter, interfaceId; public uint signal; public bool secure, connected, connectable; }
    [DllImport("wlanapi.dll")] static extern uint WlanOpenHandle(uint version, IntPtr reserved, out uint negotiated, out IntPtr handle);
    [DllImport("wlanapi.dll")] static extern uint WlanCloseHandle(IntPtr handle, IntPtr reserved);
    [DllImport("wlanapi.dll")] static extern void WlanFreeMemory(IntPtr memory);
    [DllImport("wlanapi.dll")] static extern uint WlanEnumInterfaces(IntPtr handle, IntPtr reserved, out IntPtr list);
    [DllImport("wlanapi.dll")] static extern uint WlanGetAvailableNetworkList(IntPtr handle, ref Guid id, uint flags, IntPtr reserved, out IntPtr list);
    [DllImport("wlanapi.dll")] static extern uint WlanScan(IntPtr handle, ref Guid id, IntPtr ssid, IntPtr data, IntPtr reserved);
    [DllImport("wlanapi.dll", CharSet=CharSet.Unicode)] static extern uint WlanConnect(IntPtr handle, ref Guid id, ref Connection parameters, IntPtr reserved);
    static void Check(uint result) { if (result != 0) throw new Win32Exception((int)result); }
    public static Item[] Scan() {
        IntPtr handle; uint version; Check(WlanOpenHandle(2, IntPtr.Zero, out version, out handle));
        try {
            IntPtr interfaces; Check(WlanEnumInterfaces(handle, IntPtr.Zero, out interfaces));
            try {
                var items = new List<Item>(); int count = Marshal.ReadInt32(interfaces);
                for (int i=0; i<count; i++) {
                    var device = (Interface)Marshal.PtrToStructure(IntPtr.Add(interfaces, 8+i*Marshal.SizeOf(typeof(Interface))), typeof(Interface));
                    // Trigger a refresh; the list is the most recent Windows scan cache.
                    // WlanScan is asynchronous, so a later refresh can show newer results.
                    WlanScan(handle, ref device.id, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero);
                    IntPtr networks; Check(WlanGetAvailableNetworkList(handle, ref device.id, 0, IntPtr.Zero, out networks));
                    try {
                        int length = Marshal.ReadInt32(networks);
                        for (int j=0; j<length; j++) {
                            var network = (Network)Marshal.PtrToStructure(IntPtr.Add(networks, 8+j*Marshal.SizeOf(typeof(Network))), typeof(Network));
                            if (network.ssid.length > 32) continue;
                            items.Add(new Item { ssid=Encoding.UTF8.GetString(network.ssid.bytes, 0, (int)network.ssid.length),
                                profile=network.profile, adapter=device.description, interfaceId=device.id.ToString(), signal=network.signal,
                                secure=network.security!=0, connected=(network.flags&1)!=0, connectable=network.connectable!=0 });
                        }
                    } finally { WlanFreeMemory(networks); }
                }
                return items.ToArray();
            } finally { WlanFreeMemory(interfaces); }
        } finally { WlanCloseHandle(handle, IntPtr.Zero); }
    }
    public static void Connect(string interfaceId, string profile) {
        if (String.IsNullOrEmpty(profile) || profile.Length>256) throw new ArgumentException("Choose a saved Windows Wi-Fi profile.");
        Guid id = Guid.Parse(interfaceId); IntPtr handle; uint version;
        Check(WlanOpenHandle(2, IntPtr.Zero, out version, out handle));
        try { var parameters = new Connection { mode=0, profile=profile, bssType=3 }; Check(WlanConnect(handle, ref id, ref parameters, IntPtr.Zero)); }
        finally { WlanCloseHandle(handle, IntPtr.Zero); }
    }
}
'@
    if ($request.action -eq 'connect') {
        [DevOsWifi]::Connect([string]$request.interfaceId, [string]$request.profile)
        @{ ok = $true } | ConvertTo-Json -Compress
    } else {
        @{ ok = $true; networks = @([DevOsWifi]::Scan()) } | ConvertTo-Json -Depth 4 -Compress
    }
} catch {
    $errorCode = $_.Exception.GetBaseException().NativeErrorCode
    @{ ok = $false; error = $_.Exception.GetBaseException().Message; accessDenied = ($errorCode -eq 5) } | ConvertTo-Json -Compress
    exit 1
}
