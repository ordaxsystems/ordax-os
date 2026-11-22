package creatorcore

import (
	"errors"
	"fmt"
	"testing"
)

type portableExecutorFakeRuntime struct {
	events []string
	failOn string
}

func (runtime *portableExecutorFakeRuntime) record(event string) error {
	runtime.events = append(runtime.events, event)
	if runtime.failOn == event {
		return errors.New("injected failure")
	}
	return nil
}

func (runtime *portableExecutorFakeRuntime) WriteGPT(partitions []PortableApplicationPartition, targetBytes uint64) error {
	if len(partitions) != 2 || targetBytes == 0 {
		return errors.New("invalid GPT input")
	}
	return runtime.record("gpt")
}

func (runtime *portableExecutorFakeRuntime) Format(partition PortableApplicationPartition) error {
	return runtime.record("format:" + partition.Name)
}

func (runtime *portableExecutorFakeRuntime) Materialize(operation PortableApplicationOperation, source PortableApplicationSource) error {
	if operation.ArtifactID != source.ArtifactID ||
		operation.SHA256 != source.SHA256 ||
		operation.SizeBytes != source.SizeBytes {
		return errors.New("source binding mismatch")
	}
	return runtime.record("materialize:" + source.ArtifactID)
}

func (runtime *portableExecutorFakeRuntime) Flush() error {
	return runtime.record("flush")
}

func (runtime *portableExecutorFakeRuntime) Readback(operation PortableApplicationOperation) error {
	return runtime.record("readback:" + operation.ArtifactID)
}

func (runtime *portableExecutorFakeRuntime) VerifyLayout(partitions []PortableApplicationPartition, targetBytes uint64) error {
	if len(partitions) != 2 || targetBytes == 0 {
		return errors.New("invalid layout verification input")
	}
	return runtime.record("verify-layout")
}

func portableExecutionFixture(t *testing.T) (PortableApplicationPlan, []PortableApplicationSource, PortableApplicationExecutionGrant) {
	t.Helper()
	media, err := PlanPortableMedia(8<<30, "0123456789abcdef0123456789abcdef01234567", portableBindingsFixture())
	if err != nil {
		t.Fatal(err)
	}
	plan, err := PlanPortableApplication(media)
	if err != nil {
		t.Fatal(err)
	}
	sources := make([]PortableApplicationSource, 0, 17)
	for _, op := range plan.Operations {
		if op.Kind != "materialize-artifact" {
			continue
		}
		sources = append(sources, PortableApplicationSource{
			ArtifactID: op.ArtifactID,
			SHA256: op.SHA256,
			SizeBytes: op.SizeBytes,
		})
	}
	digest, err := PortableApplicationPlanSHA256(plan)
	if err != nil {
		t.Fatal(err)
	}
	return plan, sources, PortableApplicationExecutionGrant{
		ApplicationPlanSHA256: digest,
		PhysicalWriteAuthorized: true,
	}
}

func TestExecutePortableApplicationRunsExact39OperationPolicy(t *testing.T) {
	plan, sources, grant := portableExecutionFixture(t)
	runtime := &portableExecutorFakeRuntime{}
	receipt, err := ExecutePortableApplication(plan, sources, grant, runtime)
	if err != nil {
		t.Fatal(err)
	}
	if receipt.Schema != PortableApplicationExecutionReceiptSchema ||
		receipt.Status != "pass" ||
		receipt.OperationCount != 39 ||
		receipt.MaterializedArtifacts != 17 ||
		receipt.ReadbackArtifacts != 17 ||
		receipt.WholeDiskRawImageUsed {
		t.Fatalf("unexpected execution receipt: %#v", receipt)
	}
	if len(runtime.events) != 39 {
		t.Fatalf("runtime event count=%d want=39", len(runtime.events))
	}
	if runtime.events[0] != "gpt" ||
		runtime.events[1] != "format:ORDAX-ESP" ||
		runtime.events[2] != "format:ORDAX-DATA" ||
		runtime.events[20] != "flush" ||
		runtime.events[38] != "verify-layout" {
		t.Fatalf("unexpected operation order: %#v", runtime.events)
	}
}

func TestExecutePortableApplicationRequiresSeparateExactGrant(t *testing.T) {
	plan, sources, grant := portableExecutionFixture(t)
	runtime := &portableExecutorFakeRuntime{}

	grant.PhysicalWriteAuthorized = false
	if _, err := ExecutePortableApplication(plan, sources, grant, runtime); err == nil {
		t.Fatal("execution accepted a non-authorizing grant")
	}
	if len(runtime.events) != 0 {
		t.Fatal("runtime was invoked before authorization")
	}

	grant.PhysicalWriteAuthorized = true
	grant.ApplicationPlanSHA256 = fmt.Sprintf("%064x", 1)
	if _, err := ExecutePortableApplication(plan, sources, grant, runtime); err == nil {
		t.Fatal("execution accepted a grant for a different plan")
	}
	if len(runtime.events) != 0 {
		t.Fatal("runtime was invoked after plan-hash mismatch")
	}
}

func TestExecutePortableApplicationRejectsMutatedPlanAndSourceSet(t *testing.T) {
	plan, sources, grant := portableExecutionFixture(t)
	runtime := &portableExecutorFakeRuntime{}

	mutated := plan
	mutated.Operations = append([]PortableApplicationOperation(nil), plan.Operations...)
	mutated.Operations[3].TargetPath = "/wrong"
	digest, err := PortableApplicationPlanSHA256(mutated)
	if err != nil {
		t.Fatal(err)
	}
	grant.ApplicationPlanSHA256 = digest
	if _, err := ExecutePortableApplication(mutated, sources, grant, runtime); err == nil {
		t.Fatal("mutated application plan was accepted")
	}
	if len(runtime.events) != 0 {
		t.Fatal("runtime was invoked for mutated plan")
	}

	plan, sources, grant = portableExecutionFixture(t)
	sources[0].SHA256 = fmt.Sprintf("%064x", 2)
	if _, err := ExecutePortableApplication(plan, sources, grant, runtime); err == nil {
		t.Fatal("mutated artifact source was accepted")
	}
	if len(runtime.events) != 0 {
		t.Fatal("runtime was invoked for mutated source binding")
	}
}

func TestExecutePortableApplicationRejectsOvercommittedPlanBeforeDiskIO(t *testing.T) {
	plan, sources, grant := portableExecutionFixture(t)
	layout, err := PlanPortableTargetStorage(plan.TargetBytes)
	if err != nil { t.Fatal(err) }
	var changedID string
	for i := range plan.Operations {
		op := &plan.Operations[i]
		if op.Kind == "materialize-artifact" && op.ArtifactID == "surface-runtime-image" {
			op.SizeBytes = layout.PayloadBytes
			changedID = op.ArtifactID
		}
	}
	for i := range plan.Operations {
		if plan.Operations[i].Kind == "readback-sha256-size" && plan.Operations[i].ArtifactID == changedID {
			plan.Operations[i].SizeBytes = layout.PayloadBytes
		}
	}
	for i := range sources {
		if sources[i].ArtifactID == changedID { sources[i].SizeBytes = layout.PayloadBytes }
	}
	grant.ApplicationPlanSHA256, err = PortableApplicationPlanSHA256(plan)
	if err != nil { t.Fatal(err) }
	runtime := &portableExecutorFakeRuntime{}
	if _, err := ExecutePortableApplication(plan, sources, grant, runtime); err == nil {
		t.Fatal("executor accepted the overcommitted data partition")
	}
	if len(runtime.events) != 0 {
		t.Fatalf("executor touched disk before capacity rejection: %v", runtime.events)
	}
}

func TestExecutePortableApplicationStopsOnFirstRuntimeFailure(t *testing.T) {
	plan, sources, grant := portableExecutionFixture(t)
	runtime := &portableExecutorFakeRuntime{failOn: "format:ORDAX-DATA"}
	if _, err := ExecutePortableApplication(plan, sources, grant, runtime); err == nil {
		t.Fatal("runtime failure did not fail closed")
	}
	if len(runtime.events) != 3 {
		t.Fatalf("executor continued after failure: %#v", runtime.events)
	}
}
