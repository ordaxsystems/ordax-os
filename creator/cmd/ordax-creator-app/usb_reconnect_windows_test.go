//go:build windows

package main

import "testing"

func TestUSBDeviceChangeReconcilesOnlyTopologyNotifications(t *testing.T) {
    for _, event := range []uintptr{dbtDeviceArrival, dbtDeviceRemoveComplete, dbtDevNodesChanged} {
        if !usbTopologyChanged(event) {
            t.Fatalf("expected USB refresh on event 0x%x", event)
        }
    }
    for _, event := range []uintptr{0, 1, 0x8001, 0x8005, 0x0017} {
        if usbTopologyChanged(event) {
            t.Fatalf("unexpected USB refresh for event 0x%x", event)
        }
    }
}
