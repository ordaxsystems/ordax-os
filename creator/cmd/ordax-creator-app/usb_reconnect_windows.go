//go:build windows

package main

// Windows broadcasts these notifications to the existing top-level Creator
// window. No polling service, second USB enumerator, or device access is needed.
const (
    wmDeviceChange         = 0x0219
    dbtDevNodesChanged     = 0x0007
    dbtDeviceArrival       = 0x8000
    dbtDeviceRemoveComplete = 0x8004
)

// UI-thread only: the physical writer always revalidates the live selected
// target and requires its independent authorization. A hotplug event NEVER
// selects a drive or starts a physical write.
var (
    pendingUSBRefresh bool
    pendingOwnerUSBStage bool
    creatorServicesStarted bool
)

func usbTopologyChanged(event uintptr) bool {
    switch event {
    case dbtDevNodesChanged, dbtDeviceArrival, dbtDeviceRemoveComplete:
        return true
    default:
        return false
    }
}

func reconcileUSBDeviceChange(event uintptr) {
    if !creatorServicesStarted || !usbTopologyChanged(event) || writeInProgress() || ownerUSBUpdateInProgress() {
        return
    }
    failed, succeeded := physicalWriteTerminalFlags()
    if failed || succeeded {
        return
    }
    if event == dbtDeviceArrival { pendingOwnerUSBStage = true }
    if refreshInProgress {
        pendingUSBRefresh = true
        return
    }
    beginRefresh() // Existing serial-bound discovery, no implicit selection.
    if event == dbtDeviceArrival {
        beginUpdateCheck(false) // Existing Owner release checker, no installer.
    }
}
