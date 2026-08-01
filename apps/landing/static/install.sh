#!/bin/sh
set -eu
repo=zulfaza/mtunnel
os=$(uname -s | tr '[:upper:]' '[:lower:]')
arch=$(uname -m)
case "$arch" in x86_64|amd64) arch=amd64;; arm64|aarch64) arch=arm64;; *) echo "unsupported architecture: $arch" >&2; exit 1;; esac
case "$os" in darwin|linux) ;; *) echo "unsupported OS: $os" >&2; exit 1;; esac
asset="mt-$os-$arch.tar.gz"
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
curl -fsSL "https://github.com/$repo/releases/latest/download/$asset" -o "$tmp/mt.tar.gz"
curl -fsSL "https://github.com/$repo/releases/latest/download/$asset.sha256" -o "$tmp/mt.tar.gz.sha256"
expected=$(awk '{print $1}' "$tmp/mt.tar.gz.sha256")
if command -v sha256sum >/dev/null 2>&1; then actual=$(sha256sum "$tmp/mt.tar.gz" | awk '{print $1}'); else actual=$(shasum -a 256 "$tmp/mt.tar.gz" | awk '{print $1}'); fi
if [ "$expected" != "$actual" ]; then echo "checksum mismatch for $asset" >&2; exit 1; fi
tar -xzf "$tmp/mt.tar.gz" -C "$tmp"
dest="${INSTALL_DIR:-$HOME/.local/bin}"
mkdir -p "$dest"
install -m 0755 "$tmp/mt" "$dest/mt"
echo "installed mt to $dest/mt"
