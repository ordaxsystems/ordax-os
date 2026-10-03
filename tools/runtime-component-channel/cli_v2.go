package main

import (
	"errors"
	"flag"
	"fmt"
)

func signV2Command(args []string) error {
	flags := flag.NewFlagSet("sign-v2", flag.ContinueOnError)
	releasePath := flags.String("release", "", "runtime component release/2 descriptor")
	compatibilityPath := flags.String("compatibility", "", "runtime component compatibility sidecar")
	privatePath := flags.String("private-key", "", "external PKCS#8 Ed25519 private-key path")
	trustPath := flags.String("trust", "", "runtime component public trust")
	outputPath := flags.String("out", "", "new signed runtime component release/2 envelope")
	keyID := flags.String("key-id", "", "runtime component trust key id")
	if err := flags.Parse(args); err != nil {
		return err
	}
	if *releasePath == "" || *compatibilityPath == "" || *privatePath == "" || *trustPath == "" || *outputPath == "" || *keyID == "" || flags.NArg() != 0 {
		return errors.New("sign-v2 requires --release, --compatibility, --private-key, --trust, --out and --key-id")
	}
	release, err := signReleaseV2(
		*releasePath,
		*compatibilityPath,
		*privatePath,
		*trustPath,
		*outputPath,
		*keyID,
	)
	if err != nil {
		return err
	}
	fmt.Printf(
		"RUNTIME_COMPONENT_RELEASE_V2_SIGNED=YES\nCOMPONENT_ID=%s\nCOMPONENT_VERSION=%s\nSOURCE_COMMIT=%s\nDIRECT_ACTIVATION_ALLOWED=NO\nPRIVATE_KEY_PRINTED=NO\n",
		release.Component.ID,
		release.Component.Version,
		release.SourceCommit,
	)
	return nil
}

func verifyEnvelopeV2Command(args []string) error {
	flags := flag.NewFlagSet("verify-envelope-v2", flag.ContinueOnError)
	envelopePath := flags.String("envelope", "", "signed runtime component release/2 envelope")
	trustPath := flags.String("trust", "", "runtime component public trust")
	compatibilityPath := flags.String("compatibility", "", "runtime component compatibility sidecar")
	if err := flags.Parse(args); err != nil {
		return err
	}
	if *envelopePath == "" || *trustPath == "" || *compatibilityPath == "" || flags.NArg() != 0 {
		return errors.New("verify-envelope-v2 requires --envelope, --trust and --compatibility")
	}
	release, _, _, _, err := verifyEnvelopeV2Files(*envelopePath, *trustPath, *compatibilityPath)
	if err != nil {
		return err
	}
	fmt.Printf(
		"RUNTIME_COMPONENT_RELEASE_V2_VERIFIED=YES\nCOMPONENT_ID=%s\nCOMPONENT_VERSION=%s\nSOURCE_COMMIT=%s\nPENDING_HEALTH_REQUIRED=YES\nDIRECT_ACTIVATION_ALLOWED=NO\n",
		release.Component.ID,
		release.Component.Version,
		release.SourceCommit,
	)
	return nil
}

func stageV2Command(args []string) error {
	flags := flag.NewFlagSet("stage-v2", flag.ContinueOnError)
	envelopePath := flags.String("envelope", "", "signed runtime component release/2 envelope")
	trustPath := flags.String("trust", "", "runtime component public trust")
	packagePath := flags.String("package", "", "runtime component ZIP package")
	compatibilityPath := flags.String("compatibility", "", "runtime component compatibility sidecar")
	root := flags.String("root", defaultSlotRoot, "runtime component slot root")
	if err := flags.Parse(args); err != nil {
		return err
	}
	if *envelopePath == "" || *trustPath == "" || *packagePath == "" || *compatibilityPath == "" || flags.NArg() != 0 {
		return errors.New("stage-v2 requires --envelope, --trust, --package and --compatibility")
	}
	release, slot, changed, err := stageComponentV2(
		*envelopePath,
		*trustPath,
		*packagePath,
		*compatibilityPath,
		*root,
	)
	if err != nil {
		return err
	}
	fmt.Printf(
		"RUNTIME_COMPONENT_RELEASE_V2_STAGED=YES\nCOMPONENT_ID=%s\nCOMPONENT_VERSION=%s\nSOURCE_COMMIT=%s\nSLOT=%s\nSLOT_CHANGED=%t\nPENDING_HEALTH_REQUIRED=YES\nACTIVATED=NO\n",
		release.Component.ID,
		release.Component.Version,
		release.SourceCommit,
		slot,
		changed,
	)
	return nil
}

func verifySlotV2Command(args []string) error {
	flags := flag.NewFlagSet("verify-slot-v2", flag.ContinueOnError)
	slot := flags.String("slot", "", "installed runtime component release/2 slot")
	trustPath := flags.String("trust", "", "runtime component public trust")
	if err := flags.Parse(args); err != nil {
		return err
	}
	if *slot == "" || *trustPath == "" || flags.NArg() != 0 {
		return errors.New("verify-slot-v2 requires --slot and --trust")
	}
	trustBytes, err := readRegular(*trustPath, maxTrustBytes, false)
	if err != nil {
		return err
	}
	release, err := verifySlotV2WithTrustBytes(*slot, trustBytes)
	if err != nil {
		return err
	}
	fmt.Printf(
		"RUNTIME_COMPONENT_RELEASE_V2_SLOT_VERIFIED=YES\nCOMPONENT_ID=%s\nCOMPONENT_VERSION=%s\nSOURCE_COMMIT=%s\nDIRECT_ACTIVATION_ALLOWED=NO\n",
		release.Component.ID,
		release.Component.Version,
		release.SourceCommit,
	)
	return nil
}
