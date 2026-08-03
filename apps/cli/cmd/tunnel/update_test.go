package main

import (
	"bytes"
	"context"
	"errors"
	"strings"
	"testing"
)

func TestRunUpdateShowsVersionsAndSuccess(t *testing.T) {
	var output bytes.Buffer
	installed := false
	err := runUpdate(context.Background(), &output, "v1.2.3", func(context.Context) (string, error) {
		return "v1.3.0", nil
	}, func(context.Context) error {
		installed = true
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	if !installed {
		t.Fatal("installer was not run")
	}
	want := "Updating mt from v1.2.3 to v1.3.0...\n✓ Updated mt from v1.2.3 to v1.3.0 successfully.\n"
	if output.String() != want {
		t.Fatalf("output = %q, want %q", output.String(), want)
	}
}

func TestRunUpdateSkipsInstalledVersion(t *testing.T) {
	var output bytes.Buffer
	err := runUpdate(context.Background(), &output, "v1.2.3", func(context.Context) (string, error) {
		return "v1.2.3", nil
	}, func(context.Context) error {
		t.Fatal("installer should not run")
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	if output.String() != "already up to date (v1.2.3)\n" {
		t.Fatalf("unexpected output: %q", output.String())
	}
}

func TestRunUpdateShowsFailureAfterProgress(t *testing.T) {
	var output bytes.Buffer
	err := runUpdate(context.Background(), &output, "v1.2.3", func(context.Context) (string, error) {
		return "v1.3.0", nil
	}, func(context.Context) error {
		return errors.New("installer failed")
	})
	if err == nil || !strings.Contains(err.Error(), "update: installer failed") {
		t.Fatalf("unexpected error: %v", err)
	}
	want := "Updating mt from v1.2.3 to v1.3.0...\nUpdate failed.\n"
	if output.String() != want {
		t.Fatalf("output = %q, want %q", output.String(), want)
	}
}

func TestRunUpdateRequiresTargetVersion(t *testing.T) {
	var output bytes.Buffer
	err := runUpdate(context.Background(), &output, "v1.2.3", func(context.Context) (string, error) {
		return "", errors.New("unavailable")
	}, func(context.Context) error {
		t.Fatal("installer should not run")
		return nil
	})
	if err == nil || !strings.Contains(err.Error(), "check latest version: unavailable") {
		t.Fatalf("unexpected error: %v", err)
	}
	if output.Len() != 0 {
		t.Fatalf("unexpected output: %q", output.String())
	}
}
