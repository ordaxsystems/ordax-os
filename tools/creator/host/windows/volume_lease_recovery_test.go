package windowsadapter

import (
	"errors"
	"strings"
	"testing"
)

func TestAcquireTargetVolumeLeaseInternalAcceptsPhysicalRecoveryWithoutDriveLetter(t *testing.T) {
	events := []string{}
	runtime, target := successfulLeaseRuntime(t, &events)
	target.DriveLetter = ""
	target.DriveType = "physical-unmounted"
	target.ConfirmationToken = ConfirmationToken(target)
	runtime.mountErr = errors.New("ResolveMountVolume must not be called for physical recovery")

	lease, err := acquireTargetVolumeLeaseInternal(runtime, target)
	if err != nil {
		t.Fatal(err)
	}
	defer lease.Close()

	for _, event := range events {
		if strings.HasPrefix(event, "resolve:") {
			t.Fatalf("physical recovery unexpectedly depended on a drive letter: %v", events)
		}
	}
	if findEvent(events, "lock:") < 0 || findEvent(events, "dismount:") < 0 {
		t.Fatalf("physical recovery did not preserve the target-volume lease boundary: %v", events)
	}
}

func TestAcquireTargetVolumeLeaseInternalRejectsMissingDriveLetterOutsideRecovery(t *testing.T) {
	events := []string{}
	runtime, target := successfulLeaseRuntime(t, &events)
	target.DriveLetter = ""
	target.DriveType = "removable"
	target.ConfirmationToken = ConfirmationToken(target)

	_, err := acquireTargetVolumeLeaseInternal(runtime, target)
	if err == nil || !strings.Contains(err.Error(), "requires a drive letter") {
		t.Fatalf("missing drive letter outside recovery must fail closed, got %v", err)
	}
	if findEvent(events, "lock:") >= 0 {
		t.Fatalf("invalid recovery identity reached the lock boundary: %v", events)
	}
}
