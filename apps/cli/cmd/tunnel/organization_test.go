package main

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"

	"github.com/zulfaza/mtunnel/apps/cli/internal/config"
)

func TestOrganizationManagementCommands(t *testing.T) {
	t.Helper()
	requests := make(map[string]map[string]string)
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		writer.Header().Set("Content-Type", "application/json")
		values := make(map[string]string)
		if request.ContentLength > 0 {
			if err := json.NewDecoder(request.Body).Decode(&values); err != nil {
				http.Error(writer, err.Error(), http.StatusBadRequest)
				return
			}
		}
		requests[request.Method+" "+request.URL.Path] = values
		switch {
		case request.Method == http.MethodGet:
			writer.Write([]byte(`{"members":[{"membershipId":"om_2","name":"Ada Lovelace","email":"ada@acme.test","role":"member","status":"active"}]}`))
		case request.Method == http.MethodPut:
			writer.Write([]byte(`{"id":"org_acme","name":"Acme Labs"}`))
		case request.Method == http.MethodPost:
			writer.WriteHeader(http.StatusCreated)
			writer.Write([]byte(`{"id":"invitation_1","email":"member@acme.test","state":"pending"}`))
		case request.Method == http.MethodDelete && strings.HasSuffix(request.URL.Path, "/membership"):
			writer.Write([]byte(`{"nextOrganizationId":"org_personal","currentOrganizationId":"org_personal"}`))
		case request.Method == http.MethodDelete:
			writer.Write([]byte(`{"membershipId":"om_2"}`))
		default:
			http.NotFound(writer, request)
		}
	}))
	defer server.Close()

	configPath := filepath.Join(t.TempDir(), "config.json")
	if err := config.Save(configPath, config.Config{
		Server:         server.URL,
		AccessToken:    "access",
		OrganizationID: "org_acme",
	}); err != nil {
		t.Fatal(err)
	}
	options := rootOptions{config: configPath}

	rename := newOrganizationCmd(&options)
	var output bytes.Buffer
	rename.SetOut(&output)
	rename.SetArgs([]string{"rename", "org_acme", "Acme Labs"})
	if err := rename.Execute(); err != nil {
		t.Fatal(err)
	}

	invite := newOrganizationCmd(&options)
	invite.SetOut(&output)
	invite.SetArgs([]string{"invite", "org_acme", "member@acme.test"})
	if err := invite.Execute(); err != nil {
		t.Fatal(err)
	}

	members := newOrganizationCmd(&options)
	members.SetOut(&output)
	members.SetArgs([]string{"members", "org_acme"})
	if err := members.Execute(); err != nil {
		t.Fatal(err)
	}

	removeMember := newOrganizationCmd(&options)
	removeMember.SetOut(&output)
	removeMember.SetArgs([]string{"remove-member", "org_acme", "om_2"})
	if err := removeMember.Execute(); err != nil {
		t.Fatal(err)
	}

	leave := newOrganizationCmd(&options)
	leave.SetOut(&output)
	leave.SetArgs([]string{"leave", "org_acme"})
	if err := leave.Execute(); err != nil {
		t.Fatal(err)
	}

	if requests["PUT /api/v1/organizations/org_acme"]["name"] != "Acme Labs" {
		t.Fatalf("rename request = %#v", requests)
	}
	if requests["POST /api/v1/organizations/org_acme/invitations"]["email"] != "member@acme.test" {
		t.Fatalf("invite request = %#v", requests)
	}
	if _, ok := requests["DELETE /api/v1/organizations/org_acme/membership"]; !ok {
		t.Fatalf("leave request = %#v", requests)
	}
	if _, ok := requests["GET /api/v1/organizations/org_acme/members"]; !ok {
		t.Fatalf("member list request = %#v", requests)
	}
	if _, ok := requests["DELETE /api/v1/organizations/org_acme/members/om_2"]; !ok {
		t.Fatalf("member removal request = %#v", requests)
	}
	saved, err := config.Load(configPath)
	if err != nil {
		t.Fatal(err)
	}
	if saved.OrganizationID != "org_personal" {
		t.Fatalf("organization = %q, want org_personal", saved.OrganizationID)
	}
}
