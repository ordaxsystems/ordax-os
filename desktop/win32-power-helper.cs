// Owned by the OrdaX Desktop Windows host; OS owns the power-status contract.
// A short-lived Win32 sensor reader, compiled once into the verified NSIS.
// No PowerShell, resident process, account/session access or synthetic battery.
using System;
using System.Runtime.InteropServices;

internal static class OrdaXWin32Power {
    [StructLayout(LayoutKind.Sequential, Pack = 1)]
    private struct SystemPowerStatus {
        public byte ACLineStatus;
        public byte BatteryFlag;
        public byte BatteryLifePercent;
        public byte SystemStatusFlag;
        public uint BatteryLifeTime;
        public uint BatteryFullLifeTime;
    }

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GetSystemPowerStatus(out SystemPowerStatus status);

    private static int Main() {
        SystemPowerStatus status;
        if (!GetSystemPowerStatus(out status)) return 2;
        Console.Out.WriteLine("{0},{1},{2}", status.ACLineStatus,
            status.BatteryFlag, status.BatteryLifePercent);
        return 0;
    }
}
