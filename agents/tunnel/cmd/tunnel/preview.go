package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"mime"
	"mime/multipart"
	"net/http"
	"net/textproto"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"text/tabwriter"
	"time"

	"github.com/spf13/cobra"
)

const maxPreviewBytes = 5 * 1024 * 1024

type preview struct {
	Key        string    `json:"key"`
	URL        string    `json:"url"`
	Visibility string    `json:"visibility"`
	Size       int64     `json:"size"`
	UploadedAt time.Time `json:"uploadedAt"`
}

type previewLocation struct {
	organizationID string
	userID         string
	name           string
}

func parsePreviewKey(key string) (previewLocation, error) {
	parts := strings.Split(key, "/")
	if len(parts) != 3 || parts[0] == "" || parts[1] == "" || parts[2] == "" {
		return previewLocation{}, fmt.Errorf("invalid preview key %q; use a key from mt preview list", key)
	}
	return previewLocation{organizationID: parts[0], userID: parts[1], name: parts[2]}, nil
}

func previewEndpoint(server string, location *previewLocation) (string, error) {
	target, err := url.Parse(server)
	if err != nil || target.Scheme == "" || target.Host == "" {
		return "", fmt.Errorf("invalid server URL")
	}
	target.Path = strings.TrimRight(target.Path, "/") + "/api/v1/previews"
	if location != nil {
		target.Path += "/" + location.organizationID + "/" + location.userID + "/" + location.name
	}
	target.RawQuery = ""
	return target.String(), nil
}

func executePreviewHTTP(o *rootOptions, method, target string, body []byte, contentType string) ([]byte, error) {
	cfg, err := o.loadConfig()
	if err != nil {
		return nil, err
	}
	ctx := context.Background()
	resp, err := o.doAuthenticated(ctx, cfg, func(accessToken string) (*http.Request, error) {
		req, requestErr := http.NewRequestWithContext(ctx, method, target, bytes.NewReader(body))
		if requestErr != nil {
			return nil, requestErr
		}
		req.Header.Set("Authorization", "Bearer "+accessToken)
		if contentType != "" {
			req.Header.Set("Content-Type", contentType)
		}
		return req, nil
	})
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	response, err := io.ReadAll(io.LimitReader(resp.Body, maxPreviewBytes+(1<<20)))
	if err != nil {
		return nil, err
	}
	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusCreated && resp.StatusCode != http.StatusNoContent {
		return nil, fmt.Errorf("server returned status %d: %s", resp.StatusCode, strings.TrimSpace(string(response)))
	}
	return response, nil
}

func previewContentType(filename string) (string, error) {
	contentType := strings.Split(mime.TypeByExtension(filepath.Ext(filename)), ";")[0]
	if contentType == "text/html" || strings.HasPrefix(contentType, "image/") {
		return contentType, nil
	}
	return "", fmt.Errorf("only HTML and image files are supported")
}

func previewUploadBody(filename, visibility string) ([]byte, string, error) {
	if visibility != "organization" && visibility != "public" {
		return nil, "", fmt.Errorf("visibility must be organization or public")
	}
	info, err := os.Stat(filename)
	if err != nil {
		return nil, "", err
	}
	if !info.Mode().IsRegular() {
		return nil, "", fmt.Errorf("preview must be a regular file")
	}
	if info.Size() > maxPreviewBytes {
		return nil, "", fmt.Errorf("preview exceeds 5 MB")
	}
	contentType, err := previewContentType(filename)
	if err != nil {
		return nil, "", err
	}
	file, err := os.Open(filename)
	if err != nil {
		return nil, "", err
	}
	defer file.Close()
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	header := textproto.MIMEHeader{}
	header.Set("Content-Disposition", mime.FormatMediaType("form-data", map[string]string{"name": "file", "filename": filepath.Base(filename)}))
	header.Set("Content-Type", contentType)
	part, err := writer.CreatePart(header)
	if err != nil {
		return nil, "", err
	}
	if _, err := io.Copy(part, file); err != nil {
		return nil, "", err
	}
	if err := writer.WriteField("visibility", visibility); err != nil {
		return nil, "", err
	}
	if err := writer.Close(); err != nil {
		return nil, "", err
	}
	return body.Bytes(), writer.FormDataContentType(), nil
}

func printPreviewList(out io.Writer, previews []preview) error {
	if len(previews) == 0 {
		_, err := fmt.Fprintln(out, "No previews.")
		return err
	}
	writer := tabwriter.NewWriter(out, 0, 4, 2, ' ', 0)
	if _, err := fmt.Fprintln(writer, "KEY\tVISIBILITY\tSIZE\tUPLOADED\tURL"); err != nil {
		return err
	}
	for _, preview := range previews {
		if _, err := fmt.Fprintf(writer, "%s\t%s\t%d\t%s\t%s\n", preview.Key, preview.Visibility, preview.Size, preview.UploadedAt.Local().Format(time.RFC3339), preview.URL); err != nil {
			return err
		}
	}
	return writer.Flush()
}

func newPreviewCmd(o *rootOptions) *cobra.Command {
	previewCmd := &cobra.Command{Use: "preview", Short: "Manage preview files"}
	var visibility string
	upload := &cobra.Command{Use: "upload <file>", Short: "Upload an HTML or image preview", Args: exactArgsWithHelp(1), RunE: func(cmd *cobra.Command, args []string) error {
		body, contentType, err := previewUploadBody(args[0], visibility)
		if err != nil {
			return fmt.Errorf("upload preview: %w", err)
		}
		cfg, err := o.loadConfig()
		if err != nil {
			return err
		}
		target, err := previewEndpoint(cfg.Server, nil)
		if err != nil {
			return err
		}
		response, err := executePreviewHTTP(o, http.MethodPost, target, body, contentType)
		if err != nil {
			return fmt.Errorf("upload preview: %w", err)
		}
		var result preview
		if err := json.Unmarshal(response, &result); err != nil || result.URL == "" {
			return fmt.Errorf("decode preview upload response")
		}
		_, err = fmt.Fprintln(cmd.OutOrStdout(), result.URL)
		return err
	}}
	upload.Flags().StringVar(&visibility, "visibility", "organization", "organization or public")
	previewCmd.AddCommand(upload,
		&cobra.Command{Use: "list", Aliases: []string{"ls"}, Short: "List uploaded previews", Args: cobra.NoArgs, RunE: func(cmd *cobra.Command, _ []string) error {
			cfg, err := o.loadConfig()
			if err != nil {
				return err
			}
			target, err := previewEndpoint(cfg.Server, nil)
			if err != nil {
				return err
			}
			response, err := executePreviewHTTP(o, http.MethodGet, target, nil, "")
			if err != nil {
				return fmt.Errorf("list previews: %w", err)
			}
			var result struct {
				Previews []preview `json:"previews"`
			}
			if err := json.Unmarshal(response, &result); err != nil {
				return fmt.Errorf("decode preview list: %w", err)
			}
			return printPreviewList(cmd.OutOrStdout(), result.Previews)
		}},
		&cobra.Command{Use: "delete <key>", Aliases: []string{"rm"}, Short: "Delete an uploaded preview", Args: exactArgsWithHelp(1), RunE: func(cmd *cobra.Command, args []string) error {
			location, err := parsePreviewKey(args[0])
			if err != nil {
				return err
			}
			cfg, err := o.loadConfig()
			if err != nil {
				return err
			}
			target, err := previewEndpoint(cfg.Server, &location)
			if err != nil {
				return err
			}
			if _, err := executePreviewHTTP(o, http.MethodDelete, target, nil, ""); err != nil {
				return fmt.Errorf("delete preview: %w", err)
			}
			_, err = fmt.Fprintln(cmd.OutOrStdout(), "Deleted preview.")
			return err
		}},
		&cobra.Command{Use: "visibility <key> <organization|public>", Aliases: []string{"set-visibility"}, Short: "Set preview visibility", Args: exactArgsWithHelp(2), RunE: func(cmd *cobra.Command, args []string) error {
			location, err := parsePreviewKey(args[0])
			if err != nil {
				return err
			}
			if args[1] != "organization" && args[1] != "public" {
				return fmt.Errorf("visibility must be organization or public")
			}
			cfg, err := o.loadConfig()
			if err != nil {
				return err
			}
			target, err := previewEndpoint(cfg.Server, &location)
			if err != nil {
				return err
			}
			body, err := json.Marshal(struct {
				Visibility string `json:"visibility"`
			}{Visibility: args[1]})
			if err != nil {
				return err
			}
			if _, err := executePreviewHTTP(o, http.MethodPatch, target, body, "application/json"); err != nil {
				return fmt.Errorf("update preview visibility: %w", err)
			}
			_, err = fmt.Fprintln(cmd.OutOrStdout(), "Updated preview visibility.")
			return err
		}},
	)
	return previewCmd
}
