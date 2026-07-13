package update

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
)

func Apply(ctx context.Context, client *http.Client, manifest Manifest) error {
	return apply(ctx, client, manifest, releaseURL, os.Executable)
}

func apply(ctx context.Context, client *http.Client, manifest Manifest, release func(string, string) string, executable func() (string, error)) error {
	asset := "mt-" + runtime.GOOS + "-" + runtime.GOARCH + ".tar.gz"
	expected, ok := manifest.Assets[asset]
	if !ok {
		return fmt.Errorf("release does not contain %s", asset)
	}
	archive, err := fetch(ctx, client, release(manifest.Version, asset))
	if err != nil {
		return fmt.Errorf("download %s: %w", asset, err)
	}
	checksum := sha256.Sum256(archive)
	if hex.EncodeToString(checksum[:]) != expected {
		return fmt.Errorf("checksum mismatch for %s", asset)
	}
	directory, err := os.MkdirTemp("", "mt-update-*")
	if err != nil {
		return err
	}
	defer os.RemoveAll(directory)
	candidate := filepath.Join(directory, "mt")
	if err := extractBinary(archive, candidate); err != nil {
		return err
	}
	target, err := executable()
	if err != nil {
		return fmt.Errorf("find executable: %w", err)
	}
	target, err = filepath.EvalSymlinks(target)
	if err != nil {
		return fmt.Errorf("resolve executable: %w", err)
	}
	newTarget := target + ".new"
	if err := copyFile(candidate, newTarget); err != nil {
		return fmt.Errorf("stage update: %w", err)
	}
	defer os.Remove(newTarget)
	if err := os.Chmod(newTarget, 0o755); err != nil {
		return fmt.Errorf("chmod update: %w", err)
	}
	if err := os.Rename(newTarget, target); err != nil {
		return fmt.Errorf("install update: %w", err)
	}
	return nil
}

func extractBinary(archive []byte, destination string) error {
	gzipReader, err := gzip.NewReader(bytes.NewReader(archive))
	if err != nil {
		return fmt.Errorf("open archive: %w", err)
	}
	defer gzipReader.Close()
	tarReader := tar.NewReader(gzipReader)
	for {
		header, err := tarReader.Next()
		if err == io.EOF {
			return fmt.Errorf("archive does not contain mt")
		}
		if err != nil {
			return fmt.Errorf("read archive: %w", err)
		}
		if header.Name != "mt" || !header.FileInfo().Mode().IsRegular() {
			continue
		}
		file, err := os.OpenFile(destination, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o755)
		if err != nil {
			return err
		}
		_, copyErr := io.Copy(file, tarReader)
		closeErr := file.Close()
		if copyErr != nil {
			return copyErr
		}
		return closeErr
	}
}

func copyFile(source, destination string) error {
	input, err := os.Open(source)
	if err != nil {
		return err
	}
	defer input.Close()
	output, err := os.OpenFile(destination, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, 0o755)
	if err != nil {
		return err
	}
	_, copyErr := io.Copy(output, input)
	closeErr := output.Close()
	if copyErr != nil {
		return copyErr
	}
	return closeErr
}
