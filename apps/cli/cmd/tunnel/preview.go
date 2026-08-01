package main

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"mime"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"text/tabwriter"
	"time"

	"github.com/spf13/cobra"
)

const previewFileLimit = 100 * 1024 * 1024

type previewFile struct {
	Path        string `json:"path"`
	Size        int64  `json:"size"`
	ContentType string `json:"contentType"`
	SHA256      string `json:"sha256"`
	localPath   string
}
type previewResult struct {
	ID         string `json:"id"`
	Name       string `json:"name"`
	URL        string `json:"url"`
	TotalBytes int64  `json:"totalBytes"`
	FileCount  int    `json:"fileCount"`
	CreatedAt  int64  `json:"createdAt"`
	ExpiresAt  int64  `json:"expiresAt"`
	Visibility string `json:"visibility"`
}

func validatePreviewVisibility(visibility, accessCode string) error {
	switch visibility {
	case "public", "private":
		if accessCode != "" {
			return fmt.Errorf("--code is only allowed when visibility is code")
		}
	case "code":
		if accessCode == "" {
			return fmt.Errorf("--code is required when visibility is code")
		}
	default:
		return fmt.Errorf("invalid visibility %q (want public, private, or code)", visibility)
	}
	return nil
}

func previewOutputURL(base string, files []previewFile) (string, error) {
	if len(files) != 1 {
		return base, nil
	}
	parsed, err := url.Parse(base)
	if err != nil || parsed.Scheme == "" || parsed.Host == "" {
		return "", fmt.Errorf("invalid preview URL")
	}
	parsed.Path = strings.TrimRight(parsed.Path, "/") + "/" + files[0].Path
	return parsed.String(), nil
}

func previewContentType(path string) (string, error) {
	if contentType := mime.TypeByExtension(filepath.Ext(path)); contentType != "" {
		return contentType, nil
	}
	file, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer file.Close()
	buffer := make([]byte, 512)
	count, err := file.Read(buffer)
	if err != nil && err != io.EOF {
		return "", err
	}
	return http.DetectContentType(buffer[:count]), nil
}

func manifestFile(root, path string) (previewFile, error) {
	info, err := os.Stat(path)
	if err != nil {
		return previewFile{}, err
	}
	if !info.Mode().IsRegular() {
		return previewFile{}, fmt.Errorf("%s is not a regular file", path)
	}
	if info.Size() > previewFileLimit {
		return previewFile{}, fmt.Errorf("%s exceeds the 100 MiB preview file limit", path)
	}
	relative, err := filepath.Rel(root, path)
	if err != nil {
		return previewFile{}, err
	}
	if relative == "." {
		relative = filepath.Base(path)
	}
	relative = filepath.ToSlash(relative)
	file, err := os.Open(path)
	if err != nil {
		return previewFile{}, err
	}
	defer file.Close()
	hash := sha256.New()
	if _, err = io.Copy(hash, file); err != nil {
		return previewFile{}, err
	}
	contentType, err := previewContentType(path)
	if err != nil {
		return previewFile{}, err
	}
	return previewFile{Path: relative, Size: info.Size(), ContentType: contentType, SHA256: hex.EncodeToString(hash.Sum(nil)), localPath: path}, nil
}

func buildPreviewManifest(input string) (string, []previewFile, error) {
	info, err := os.Lstat(input)
	if err != nil {
		return "", nil, err
	}
	if info.Mode()&os.ModeSymlink != 0 {
		return "", nil, fmt.Errorf("preview path must not be a symlink")
	}
	name := filepath.Base(filepath.Clean(input))
	files := make([]previewFile, 0)
	if !info.IsDir() {
		file, fileErr := manifestFile(filepath.Dir(input), input)
		if fileErr != nil {
			return "", nil, fileErr
		}
		return name, []previewFile{file}, nil
	}
	err = filepath.WalkDir(input, func(path string, entry os.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if entry.Type()&os.ModeSymlink != 0 {
			if entry.IsDir() {
				return filepath.SkipDir
			}
			return nil
		}
		if entry.IsDir() {
			return nil
		}
		file, fileErr := manifestFile(input, path)
		if fileErr != nil {
			return fileErr
		}
		files = append(files, file)
		return nil
	})
	if err != nil {
		return "", nil, err
	}
	sort.Slice(files, func(left, right int) bool { return files[left].Path < files[right].Path })
	return name, files, nil
}

func previewEndpoint(server, path string) (string, error) { return domainEndpoint(server, path) }

func previewRequest(o *rootOptions, method, path string, body func() (io.ReadCloser, error), contentLength int64) (*http.Response, error) {
	cfg, err := o.loadConfig()
	if err != nil {
		return nil, err
	}
	target, err := previewEndpoint(cfg.Server, path)
	if err != nil {
		return nil, err
	}
	ctx := context.Background()
	return o.doAuthenticated(ctx, cfg, func(token string) (*http.Request, error) {
		var reader io.ReadCloser
		if body != nil {
			var bodyErr error
			reader, bodyErr = body()
			if bodyErr != nil {
				return nil, bodyErr
			}
		}
		request, requestErr := http.NewRequestWithContext(ctx, method, target, reader)
		if requestErr != nil {
			return nil, requestErr
		}
		request.Header.Set("Authorization", "Bearer "+token)
		if contentLength >= 0 {
			request.ContentLength = contentLength
		}
		return request, nil
	})
}

func createPreview(o *rootOptions, name string, files []previewFile, visibility, accessCode string) (previewResult, error) {
	if visibility == "public" {
		visibility, accessCode = "", ""
	}
	body, err := json.Marshal(struct {
		Name       string        `json:"name"`
		Files      []previewFile `json:"files"`
		Visibility string        `json:"visibility,omitempty"`
		AccessCode string        `json:"accessCode,omitempty"`
	}{name, files, visibility, accessCode})
	if err != nil {
		return previewResult{}, err
	}
	response, err := previewRequest(o, http.MethodPost, "/api/v1/previews", func() (io.ReadCloser, error) { return io.NopCloser(bytes.NewReader(body)), nil }, int64(len(body)))
	if err != nil {
		return previewResult{}, err
	}
	defer response.Body.Close()
	data, err := io.ReadAll(io.LimitReader(response.Body, 1<<20))
	if err != nil {
		return previewResult{}, err
	}
	if response.StatusCode != http.StatusCreated {
		return previewResult{}, fmt.Errorf("server returned status %d: %s", response.StatusCode, strings.TrimSpace(string(data)))
	}
	var result previewResult
	if err = json.Unmarshal(data, &result); err != nil {
		return previewResult{}, err
	}
	if result.ID == "" || result.URL == "" {
		return previewResult{}, fmt.Errorf("preview response missing required fields")
	}
	return result, nil
}

func uploadPreviewFile(o *rootOptions, id string, file previewFile) error {
	for attempt := 0; attempt < 2; attempt++ {
		response, requestErr := previewRequest(o, http.MethodPut, "/api/v1/previews/"+id+"/files/"+url.PathEscape(file.Path), func() (io.ReadCloser, error) { return os.Open(file.localPath) }, file.Size)
		if requestErr != nil {
			if attempt == 0 {
				continue
			}
			return requestErr
		}
		data, readErr := io.ReadAll(io.LimitReader(response.Body, 4096))
		response.Body.Close()
		if readErr != nil {
			return readErr
		}
		if response.StatusCode == http.StatusNoContent {
			return nil
		}
		if response.StatusCode >= 500 && attempt == 0 {
			continue
		}
		return fmt.Errorf("upload %s: server returned status %d: %s", file.Path, response.StatusCode, strings.TrimSpace(string(data)))
	}
	return fmt.Errorf("upload %s failed", file.Path)
}

func uploadPreview(o *rootOptions, id string, files []previewFile) error {
	jobs := make(chan previewFile)
	errors := make(chan error, len(files))
	var group sync.WaitGroup
	for worker := 0; worker < 4; worker++ {
		group.Add(1)
		go func() {
			defer group.Done()
			for file := range jobs {
				if err := uploadPreviewFile(o, id, file); err != nil {
					errors <- err
					continue
				}
				if o.logger != nil {
					o.logger.Info("preview uploaded", "file", file.Path, "bytes", file.Size)
				}
			}
		}()
	}
	for _, file := range files {
		jobs <- file
	}
	close(jobs)
	group.Wait()
	close(errors)
	for err := range errors {
		return err
	}
	return nil
}

func listPreviews(o *rootOptions) ([]previewResult, error) {
	response, err := previewRequest(o, http.MethodGet, "/api/v1/previews", nil, -1)
	if err != nil {
		return nil, err
	}
	defer response.Body.Close()
	data, err := io.ReadAll(io.LimitReader(response.Body, 1<<20))
	if err != nil {
		return nil, err
	}
	if response.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("server returned status %d: %s", response.StatusCode, strings.TrimSpace(string(data)))
	}
	var value struct {
		Previews []previewResult `json:"previews"`
	}
	if err = json.Unmarshal(data, &value); err != nil {
		return nil, err
	}
	return value.Previews, nil
}

func newPreviewCmd(o *rootOptions) *cobra.Command {
	var visibility, accessCode string
	preview := &cobra.Command{
		Use:   "preview <path>",
		Short: "Upload and manage public previews",
		Args:  exactArgsWithHelp(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			if err := validatePreviewVisibility(visibility, accessCode); err != nil {
				return err
			}
			name, files, err := buildPreviewManifest(args[0])
			if err != nil {
				return fmt.Errorf("build preview: %w", err)
			}
			result, err := createPreview(o, name, files, visibility, accessCode)
			if err != nil {
				return fmt.Errorf("create preview: %w", err)
			}
			if err = uploadPreview(o, result.ID, files); err != nil {
				return fmt.Errorf("upload preview: %w", err)
			}
			outputURL, err := previewOutputURL(result.URL, files)
			if err != nil {
				return err
			}
			_, err = fmt.Fprintln(cmd.OutOrStdout(), outputURL)
			return err
		},
	}
	preview.Flags().StringVar(&visibility, "visibility", "public", "preview visibility: public, private, or code")
	preview.Flags().StringVar(&accessCode, "code", "", "access code for code visibility")
	var updateAccessCode string
	updateVisibility := &cobra.Command{Use: "visibility <id> <public|private|code>", Args: exactArgsWithHelp(2), RunE: func(cmd *cobra.Command, args []string) error {
		if err := validatePreviewVisibility(args[1], updateAccessCode); err != nil {
			return err
		}
		body, err := json.Marshal(struct {
			Visibility string `json:"visibility"`
			AccessCode string `json:"accessCode,omitempty"`
		}{args[1], updateAccessCode})
		if err != nil {
			return err
		}
		response, err := previewRequest(o, http.MethodPatch, "/api/v1/previews/"+url.PathEscape(args[0]), func() (io.ReadCloser, error) { return io.NopCloser(bytes.NewReader(body)), nil }, int64(len(body)))
		if err != nil {
			return fmt.Errorf("update preview visibility: %w", err)
		}
		defer response.Body.Close()
		if response.StatusCode != http.StatusOK {
			data, readErr := io.ReadAll(io.LimitReader(response.Body, 4096))
			if readErr != nil {
				return readErr
			}
			return fmt.Errorf("update preview visibility: server returned status %d: %s", response.StatusCode, strings.TrimSpace(string(data)))
		}
		_, err = fmt.Fprintf(cmd.OutOrStdout(), "Preview %s visibility set to %s.\n", args[0], args[1])
		return err
	}}
	updateVisibility.Flags().StringVar(&updateAccessCode, "code", "", "access code for code visibility")
	preview.AddCommand(&cobra.Command{Use: "list", Aliases: []string{"ls"}, Args: cobra.NoArgs, RunE: func(cmd *cobra.Command, _ []string) error {
		previews, err := listPreviews(o)
		if err != nil {
			return fmt.Errorf("list previews: %w", err)
		}
		writer := tabwriter.NewWriter(cmd.OutOrStdout(), 0, 4, 2, ' ', 0)
		if _, err = fmt.Fprintln(writer, "ID\tNAME\tVISIBILITY\tFILES\tEXPIRES"); err != nil {
			return err
		}
		for _, item := range previews {
			if _, err = fmt.Fprintf(writer, "%s\t%s\t%s\t%d\t%s\n", item.ID, item.Name, item.Visibility, item.FileCount, time.UnixMilli(item.ExpiresAt).Local().Format("2006-01-02 15:04:05 MST")); err != nil {
				return err
			}
		}
		return writer.Flush()
	}}, updateVisibility, &cobra.Command{Use: "delete <id>", Aliases: []string{"rm"}, Args: exactArgsWithHelp(1), RunE: func(cmd *cobra.Command, args []string) error {
		response, err := previewRequest(o, http.MethodDelete, "/api/v1/previews/"+url.PathEscape(args[0]), nil, -1)
		if err != nil {
			return fmt.Errorf("delete preview: %w", err)
		}
		defer response.Body.Close()
		if response.StatusCode != http.StatusOK {
			data, readErr := io.ReadAll(io.LimitReader(response.Body, 4096))
			if readErr != nil {
				return readErr
			}
			return fmt.Errorf("delete preview: server returned status %d: %s", response.StatusCode, strings.TrimSpace(string(data)))
		}
		_, err = fmt.Fprintf(cmd.OutOrStdout(), "Deleted preview %s.\n", args[0])
		return err
	}})
	return preview
}
