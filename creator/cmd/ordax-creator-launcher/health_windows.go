//go:build windows

package main

import (
	"bytes"
	"context"
	"fmt"
	"os/exec"
	"sync"
	"syscall"
	"time"

	appchannel "github.com/ordaxsystems/ordax-os/creator/appchannel"
)

const (
	launcherHealthTimeout = 30 * time.Second
	maxLauncherHealthOutputBytes = 8 << 10
	launcherHealthProof = "ORDAX_CREATOR_APP_HEALTH=PASS"
)

// cappedHealthOutput accepts all subprocess writes without retaining unbounded
// output in launcher memory. Any truncation invalidates the health proof.
// The mutex also protects against stdout/stderr writes made concurrently.
type cappedHealthOutput struct {
	mu sync.Mutex
	buf bytes.Buffer
	overflow bool
}

func (o *cappedHealthOutput) Write(p []byte) (int, error) {
	o.mu.Lock()
	defer o.mu.Unlock()
	remaining := maxLauncherHealthOutputBytes - o.buf.Len()
	if remaining > 0 {
		count := min(len(p), remaining)
		_, _ = o.buf.Write(p[:count])
	}
	if len(p) > remaining {
		o.overflow = true
	}
	return len(p), nil
}

func (o *cappedHealthOutput) result() ([]byte, bool) {
	o.mu.Lock()
	defer o.mu.Unlock()
	return bytes.Clone(o.buf.Bytes()), o.overflow
}

// The health proof is a complete output contract, not a substring that could
// be embedded in a warning, an error, or a fabricated longer marker.
func validLauncherHealthProof(output []byte) bool {
	return bytes.Equal(output, []byte(launcherHealthProof+"\n")) ||
		bytes.Equal(output, []byte(launcherHealthProof+"\r\n"))
}

// healthCheck runs only the already signed-and-hashed pending executable.
// Time, memory and proof syntax are bounded before it may be promoted to
// current; the existing publisher/manifest trust verification stays upstream.
func healthCheck(installed appchannel.Installed) error {
	ctx, cancel := context.WithTimeout(context.Background(), launcherHealthTimeout)
	defer cancel()
	command := exec.CommandContext(ctx, installed.Executable, "--launcher-healthcheck")
	command.Dir = installed.Directory
	command.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: createNoWindow}
	command.WaitDelay = 2 * time.Second
	output := &cappedHealthOutput{}
	command.Stdout = output
	command.Stderr = output
	if err := command.Run(); err != nil {
		if ctx.Err() != nil {
			return fmt.Errorf("Creator app startup health-check exceeded allowed time: %w", ctx.Err())
		}
		return fmt.Errorf("Creator app startup health-check failed: %w", err)
	}
	proof, overflow := output.result()
	if overflow {
		return fmt.Errorf("Creator app startup health-check exceeded allowed output size")
	}
	if !validLauncherHealthProof(proof) {
		return fmt.Errorf("Creator app startup health-check did not return the exact required proof marker")
	}
	return nil
}
