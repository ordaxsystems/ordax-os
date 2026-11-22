package windowsadapter

import (
	"bytes"
	"errors"
	"io"
	"reflect"
	"testing"

	creatorcore "github.com/ordaxsystems/ordax-os/creator/core"
)

type memoryRawDiskDevice struct {
	data        []byte
	events      *[]string
	corruptRead bool
	closed      bool
}

func (d *memoryRawDiskDevice) WriteAt(p []byte, off int64) (int, error) {
	*d.events = append(*d.events, "write")
	if off < 0 || off > int64(len(d.data)) {
		return 0, errors.New("write offset outside fake device")
	}
	if int64(len(p)) > int64(len(d.data))-off {
		return 0, errors.New("write exceeds fake device")
	}
	return copy(d.data[off:], p), nil
}

func (d *memoryRawDiskDevice) ReadAt(p []byte, off int64) (int, error) {
	*d.events = append(*d.events, "read")
	if off < 0 || off >= int64(len(d.data)) {
		return 0, io.EOF
	}
	n := copy(p, d.data[off:])
	if d.corruptRead && n > 0 {
		p[0] ^= 0xff
	}
	if n < len(p) {
		return n, io.EOF
	}
	return n, nil
}

func (d *memoryRawDiskDevice) Sync() error {
	*d.events = append(*d.events, "sync")
	return nil
}

func (d *memoryRawDiskDevice) Close() error {
	*d.events = append(*d.events, "close")
	d.closed = true
	return nil
}

type fakeRawVolumeLease struct {
	events *[]string
	closed bool
}

func (l *fakeRawVolumeLease) Close() error {
	*l.events = append(*l.events, "unlock")
	l.closed = true
	return nil
}

type fakeRawDiskRuntime struct {
	elevated       bool
	elevationErr   error
	targets        []Target
	enumerateErr   error
	device         rawDiskDevice
	openErr        error
	openCount      int
	openedTarget   Target
	openedLease    rawVolumeLease
	lease          rawVolumeLease
	leaseErr       error
	leaseCount     int
	leasedTarget   Target
	leaseEvents    *[]string
}

func (r *fakeRawDiskRuntime) IsElevated() (bool, error) {
	return r.elevated, r.elevationErr
}

func (r *fakeRawDiskRuntime) EnumerateTargets() ([]Target, error) {
	if r.enumerateErr != nil {
		return nil, r.enumerateErr
	}
	return append([]Target(nil), r.targets...), nil
}

func (r *fakeRawDiskRuntime) AcquireTargetVolumeLease(expected Target) (rawVolumeLease, error) {
	r.leaseCount++
	r.leasedTarget = expected
	if r.leaseErr != nil {
		return nil, r.leaseErr
	}
	if r.leaseEvents != nil {
		*r.leaseEvents = append(*r.leaseEvents, "lock")
	}
	if r.lease != nil {
		return r.lease, nil
	}
	return &fakeRawVolumeLease{events: r.leaseEvents}, nil
}

func (r *fakeRawDiskRuntime) OpenVerifiedPhysicalDrive(expected Target, lease rawVolumeLease) (rawDiskDevice, error) {
	r.openCount++
	r.openedTarget = expected
	r.openedLease = lease
	if r.openErr != nil {
		return nil, r.openErr
	}
	return r.device, nil
}

func authorizedRawApplyRequest(t *testing.T, data []byte) (RawDiskApplyRequest, Target) {
	t.Helper()
	image := writeRawFixture(t, data)
	target := targetForRawImage(image)
	return RawDiskApplyRequest{
		Target:                   target,
		ConfirmationToken:        target.ConfirmationToken,
		Image:                    image,
		CanonicalTrustResolved:   true,
		DestructiveAuthorization: DestructiveAuthorizationToken(target, image),
	}, target
}

func eventIndex(events []string, value string) int {
	for i, event := range events {
		if event == value {
			return i
		}
	}
	return -1
}

func runtimeWithLease(target Target, device rawDiskDevice, events *[]string) *fakeRawDiskRuntime {
	lease := &fakeRawVolumeLease{events: events}
	return &fakeRawDiskRuntime{
		elevated:    true,
		targets:     []Target{target},
		device:      device,
		lease:       lease,
		leaseEvents: events,
	}
}

func TestApplyRawDiskInternalWritesFlushesAndReadsBackExactImage(t *testing.T) {
	data := []byte("ordax internal raw writer fixture")
	request, target := authorizedRawApplyRequest(t, data)
	events := []string{}
	device := &memoryRawDiskDevice{data: make([]byte, len(data)), events: &events}
	runtime := runtimeWithLease(target, device, &events)

	result, err := applyRawDiskInternal(runtime, request)
	if err != nil {
		t.Fatal(err)
	}
	if result.DiskNumber != target.DiskNumber || result.BytesWritten != int64(len(data)) || result.SHA256 != request.Image.SHA256 {
		t.Fatalf("unexpected result: %#v", result)
	}
	if !reflect.DeepEqual(device.data, data) {
		t.Fatalf("fake physical bytes = %q, want %q", device.data, data)
	}
	if runtime.leaseCount != 1 || runtime.leasedTarget.ConfirmationToken != target.ConfirmationToken {
		t.Fatalf("writer leased unexpected target: count=%d target=%#v", runtime.leaseCount, runtime.leasedTarget)
	}
	if runtime.openCount != 1 || runtime.openedTarget.ConfirmationToken != target.ConfirmationToken {
		t.Fatalf("writer opened unexpected target: count=%d target=%#v", runtime.openCount, runtime.openedTarget)
	}
	if runtime.openedLease != runtime.lease {
		t.Fatal("physical device open did not receive the exact acquired target-volume lease")
	}
	lockAt := eventIndex(events, "lock")
	writeAt := eventIndex(events, "write")
	syncAt := eventIndex(events, "sync")
	readAt := eventIndex(events, "read")
	closeAt := eventIndex(events, "close")
	unlockAt := eventIndex(events, "unlock")
	if lockAt < 0 || writeAt <= lockAt || syncAt <= writeAt || readAt <= syncAt || closeAt <= readAt || unlockAt <= closeAt {
		t.Fatalf("unsafe I/O/lease order: %v", events)
	}
	if !device.closed {
		t.Fatal("device must be closed before success returns")
	}
	if lease, ok := runtime.lease.(*fakeRawVolumeLease); !ok || !lease.closed {
		t.Fatal("target volume lease must be released after device close")
	}
}

func TestApplyRawDiskInternalRequiresElevationBeforeOpening(t *testing.T) {
	request, target := authorizedRawApplyRequest(t, []byte("elevation gate"))
	events := []string{}
	runtime := runtimeWithLease(target, &memoryRawDiskDevice{data: make([]byte, request.Image.SizeBytes), events: &events}, &events)
	runtime.elevated = false
	if _, err := applyRawDiskInternal(runtime, request); err == nil {
		t.Fatal("non-elevated runtime must be blocked")
	}
	if runtime.leaseCount != 0 || runtime.openCount != 0 || len(events) != 0 {
		t.Fatalf("non-elevated runtime touched target: leases=%d opens=%d events=%v", runtime.leaseCount, runtime.openCount, events)
	}
}

func TestApplyRawDiskInternalReenumeratesAndRejectsSwappedTarget(t *testing.T) {
	request, target := authorizedRawApplyRequest(t, []byte("live target gate"))
	swapped := target
	swapped.DiskNumber++
	swapped.ConfirmationToken = ConfirmationToken(swapped)
	events := []string{}
	runtime := runtimeWithLease(swapped, &memoryRawDiskDevice{data: make([]byte, request.Image.SizeBytes), events: &events}, &events)
	if _, err := applyRawDiskInternal(runtime, request); err == nil {
		t.Fatal("swapped target must invalidate destructive boundary")
	}
	if runtime.leaseCount != 0 || runtime.openCount != 0 || len(events) != 0 {
		t.Fatalf("swapped target touched device: leases=%d opens=%d events=%v", runtime.leaseCount, runtime.openCount, events)
	}
}

func TestApplyRawDiskInternalRejectsTamperedRequestTargetWithOldToken(t *testing.T) {
	request, target := authorizedRawApplyRequest(t, []byte("tampered target gate"))
	request.Target.DiskNumber++
	events := []string{}
	runtime := runtimeWithLease(target, &memoryRawDiskDevice{data: make([]byte, request.Image.SizeBytes), events: &events}, &events)
	if _, err := applyRawDiskInternal(runtime, request); err == nil {
		t.Fatal("tampered request Target retaining an old token must fail")
	}
	if runtime.leaseCount != 0 || runtime.openCount != 0 || len(events) != 0 {
		t.Fatalf("tampered request touched device: leases=%d opens=%d events=%v", runtime.leaseCount, runtime.openCount, events)
	}
}

func TestApplyRawDiskInternalKeepsTrustGateAheadOfTargetLease(t *testing.T) {
	request, target := authorizedRawApplyRequest(t, []byte("trust gate"))
	request.CanonicalTrustResolved = false
	events := []string{}
	runtime := runtimeWithLease(target, &memoryRawDiskDevice{data: make([]byte, request.Image.SizeBytes), events: &events}, &events)
	if _, err := applyRawDiskInternal(runtime, request); err == nil {
		t.Fatal("unresolved canonical trust must block writer")
	}
	if runtime.leaseCount != 0 || runtime.openCount != 0 || len(events) != 0 {
		t.Fatalf("unresolved trust touched target: leases=%d opens=%d events=%v", runtime.leaseCount, runtime.openCount, events)
	}
}

func TestApplyRawDiskInternalBlocksDeviceOpenWhenTargetLeaseFails(t *testing.T) {
	request, target := authorizedRawApplyRequest(t, []byte("lease gate"))
	events := []string{}
	runtime := runtimeWithLease(target, &memoryRawDiskDevice{data: make([]byte, request.Image.SizeBytes), events: &events}, &events)
	runtime.leaseErr = errors.New("volume lock unavailable")

	if _, err := applyRawDiskInternal(runtime, request); err == nil {
		t.Fatal("target-volume lease failure must block device open")
	}
	if runtime.leaseCount != 1 || runtime.openCount != 0 || len(events) != 0 {
		t.Fatalf("lease failure crossed device-open boundary: leases=%d opens=%d events=%v", runtime.leaseCount, runtime.openCount, events)
	}
}

func TestApplyRawDiskInternalReleasesLeaseWhenDeviceOpenFails(t *testing.T) {
	request, target := authorizedRawApplyRequest(t, []byte("open failure"))
	events := []string{}
	runtime := runtimeWithLease(target, &memoryRawDiskDevice{data: make([]byte, request.Image.SizeBytes), events: &events}, &events)
	runtime.openErr = errors.New("physical drive unavailable")

	if _, err := applyRawDiskInternal(runtime, request); err == nil {
		t.Fatal("device-open failure must fail writer")
	}
	if runtime.leaseCount != 1 || runtime.openCount != 1 {
		t.Fatalf("unexpected boundary counts: leases=%d opens=%d", runtime.leaseCount, runtime.openCount)
	}
	if runtime.openedLease != runtime.lease {
		t.Fatal("failed physical-device open did not receive the exact acquired lease")
	}
	if !reflect.DeepEqual(events, []string{"lock", "unlock"}) {
		t.Fatalf("lease was not safely released after device-open failure: %v", events)
	}
}

func TestApplyRawDiskInternalFailsOnReadBackDigestMismatch(t *testing.T) {
	data := []byte("read-back verification")
	request, target := authorizedRawApplyRequest(t, data)
	events := []string{}
	device := &memoryRawDiskDevice{
		data:        make([]byte, len(data)),
		events:      &events,
		corruptRead: true,
	}
	runtime := runtimeWithLease(target, device, &events)
	if _, err := applyRawDiskInternal(runtime, request); err == nil {
		t.Fatal("corrupt physical read-back must fail")
	}
	if eventIndex(events, "sync") < 0 || eventIndex(events, "read") < 0 {
		t.Fatalf("read-back verification did not run: %v", events)
	}
	closeAt := eventIndex(events, "close")
	unlockAt := eventIndex(events, "unlock")
	if closeAt < 0 || unlockAt <= closeAt {
		t.Fatalf("target lease did not outlive device on read-back failure: %v", events)
	}
	if !device.closed {
		t.Fatal("device must close after read-back failure")
	}
}

type countingPreparedRawDevice struct {
	*memoryRawDiskDevice
	writeSizes []int
	readSizes  []int
}

func (d *countingPreparedRawDevice) WriteAt(p []byte, off int64) (int, error) {
	d.writeSizes = append(d.writeSizes, len(p))
	return d.memoryRawDiskDevice.WriteAt(p, off)
}

func (d *countingPreparedRawDevice) ReadAt(p []byte, off int64) (int, error) {
	d.readSizes = append(d.readSizes, len(p))
	return d.memoryRawDiskDevice.ReadAt(p, off)
}

func TestPreparedRawRegionsUseMiBTransfersWithFullSHAReadback(t *testing.T) {
	// The former io.Copy fallback issued approximately one 32 KiB I/O per
	// block. A 3 MiB + one sector region now requires four bounded calls.
	payload := bytes.Repeat([]byte{0x6b}, 3*rawPhysicalTransferBufferBytes+512)
	events := []string{}
	disk := &countingPreparedRawDevice{
		memoryRawDiskDevice: &memoryRawDiskDevice{data: make([]byte, len(payload)), events: &events},
	}
	plan := creatorcore.PhysicalWritePlan{
		TargetBytes:  uint64(len(payload)),
		BytesToWrite: int64(len(payload)),
		Regions: []creatorcore.PhysicalWriteRegion{
			{Role: "test-region", OffsetBytes: 0, LengthBytes: int64(len(payload))},
		},
	}
	proofs, written, err := writePreparedRegions(bytes.NewReader(payload), disk, plan, nil)
	if err != nil {
		t.Fatal(err)
	}
	if written != int64(len(payload)) || len(proofs) != 1 {
		t.Fatalf("physical write total/proofs = %d/%d", written, len(proofs))
	}
	verified, err := verifyPreparedRegions(disk, proofs, int64(len(payload)), nil)
	if err != nil {
		t.Fatal(err)
	}
	if verified != int64(len(payload)) || !bytes.Equal(disk.data, payload) {
		t.Fatal("physical readback does not match the exact prepared bytes")
	}
	for _, sizes := range [][]int{disk.writeSizes, disk.readSizes} {
		if len(sizes) != 4 {
			t.Fatalf("physical transfer uses %d calls, want 4 for 3 MiB + 512 bytes", len(sizes))
		}
		for _, size := range sizes {
			if size <= 0 || size > rawPhysicalTransferBufferBytes {
				t.Fatalf("physical I/O block outside 1 MiB bound: %d", size)
			}
		}
	}
}
