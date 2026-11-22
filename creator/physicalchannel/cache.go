package physicalchannel

import (
	"errors"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"reflect"
	"runtime"
	"strings"
	"time"

	"github.com/ordaxsystems/ordax-os/creator/internal/atomicfile"
	"github.com/ordaxsystems/ordax-os/creator/internal/cachepath"
	"github.com/ordaxsystems/ordax-os/creator/internal/safefile"
)

const currentEnvelopeName = "current-envelope.json"

func physicalRoot(root string) (string, error) {
	if strings.TrimSpace(root) != "" {
		return filepath.Clean(root), nil
	}
	if runtime.GOOS == "windows" {
		if profile := strings.TrimSpace(os.Getenv("USERPROFILE")); profile != "" {
			return filepath.Join(profile, "OrdaX-Creator", "physical"), nil
		}
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(home, ".ordax-creator-physical"), nil
}


// Current is deliberately strict: offline use is allowed only when the cached
// pointer is itself the exact signed envelope, the referenced candidate still
// passes every file hash/size binding, and its bound provenance contains a
// valid positive monotonic release sequence. No unsigned local metadata can
// promote a physical writer.
func Current(root string, trustBytes []byte, expectedTrustSHA256 string) (Installed, error) {
	root, err := physicalRoot(root)
	if err != nil {
		return Installed{}, err
	}
	envelopePath := filepath.Join(root, currentEnvelopeName)
	envelopeBytes, err := safefile.ReadBoundedRegular(envelopePath, maxEnvelopeBytes)
	if err != nil {
		return Installed{}, err
	}
	manifest, err := VerifyEnvelope(envelopeBytes, trustBytes, expectedTrustSHA256)
	if err != nil {
		return Installed{}, err
	}
	if _, err := cachepath.Versions(root); err != nil {
		return Installed{}, err
	}
	directory := filepath.Join(root, "versions", manifest.SourceCommit)
	dirInfo, err := os.Lstat(directory)
	if err != nil || !dirInfo.IsDir() || dirInfo.Mode()&os.ModeSymlink != 0 {
		return Installed{}, errors.New("cached physical candidate directory is unavailable or unsafe")
	}
	installed := Installed{SourceCommit: manifest.SourceCommit, Directory: directory, Manifest: manifest}
	if _, err := ReleaseSequence(installed); err != nil {
		return Installed{}, err
	}
	return installed, nil
}

// AcquireCached first lets the canonical online acquisition path install and
// verify a candidate. Before that candidate can be returned to the GUI, its
// signed-and-bound release sequence is compared against the last accepted
// physical release so replaying an older correctly-signed envelope fails
// closed. It then performs a second independent read of the signed envelope.
// The cache pointer is committed only if that second envelope still names the
// same commit, all installed bytes still match its bindings, and the monotonic
// sequence check still passes. This prevents both rollback and a moving release
// pointer from creating an unsafe offline cache.
func AcquireCached(client *http.Client, root, envelopeURL string, trustBytes []byte, expectedTrustSHA256 string) (Installed, bool, error) {
	installed, changed, err := Acquire(client, root, envelopeURL, trustBytes, expectedTrustSHA256)
	if err != nil {
		return Installed{}, false, err
	}
	actualRoot, err := physicalRoot(root)
	if err != nil {
		return Installed{}, false, err
	}
	if err := ensureNotRollback(actualRoot, installed, trustBytes, expectedTrustSHA256); err != nil {
		return Installed{}, false, err
	}
	if envelopeURL == "" {
		envelopeURL = DefaultEnvelopeURL
	}
	separator := "?"
	if strings.Contains(envelopeURL, "?") {
		separator = "&"
	}
	verifyURL := envelopeURL + separator + "ordax_cache_verify=" + fmt.Sprint(time.Now().UnixNano())
	envelopeBytes, err := fetchBytes(client, verifyURL, maxEnvelopeBytes)
	if err != nil {
		return Installed{}, false, fmt.Errorf("confirm physical signed release pointer before activation: %w", err)
	}
	manifest, err := VerifyEnvelope(envelopeBytes, trustBytes, expectedTrustSHA256)
	if err != nil {
		return Installed{}, false, fmt.Errorf("confirm physical signed release envelope before activation: %w", err)
	}
	// A repeated source commit alone is insufficient: the signed archive,
	// bindings, and Portable payload must all be unchanged between reads.
	if !reflect.DeepEqual(manifest, installed.Manifest) {
		return Installed{}, false, errors.New("physical signed release manifest changed while preparing candidate")
	}
	verified := Installed{SourceCommit: manifest.SourceCommit, Directory: installed.Directory, Manifest: manifest}
	if err := VerifyInstalled(verified.Directory, verified.Manifest); err != nil {
		return Installed{}, false, err
	}
	if err := ensureNotRollback(actualRoot, verified, trustBytes, expectedTrustSHA256); err != nil {
		return Installed{}, false, err
	}
	if err := atomicfile.Replace(filepath.Join(actualRoot, currentEnvelopeName), envelopeBytes); err != nil {
		return Installed{}, false, fmt.Errorf("activate verified physical release cache: %w", err)
	}
	return verified, changed, nil
}
