.PHONY: build test vet clean

VERSION ?= dev

build:
	go build -ldflags "-X main.version=$(VERSION)" -o bin/ztunnel ./cmd/tunnel

test:
	go test ./...

vet:
	go vet ./...

clean:
	rm -rf bin
