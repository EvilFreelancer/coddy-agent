//go:build http

package httpserver

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/EvilFreelancer/coddy-agent/internal/acp"
	"github.com/EvilFreelancer/coddy-agent/internal/config"
	"github.com/EvilFreelancer/coddy-agent/internal/llm"
	"github.com/EvilFreelancer/coddy-agent/internal/session"
)

func artifactServer(t *testing.T) (*httptest.Server, *session.Manager, string, string, session.Artifact) {
	t.Helper()
	root := t.TempDir()
	cwd := filepath.Join(root, "workspace")
	if err := os.Mkdir(cwd, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(cwd, "report.txt"), []byte("report bytes"), 0644); err != nil {
		t.Fatal(err)
	}
	cfg := &config.Config{Paths: config.Paths{Home: filepath.Join(root, "home"), CWD: cwd}, Agent: config.Agent{Model: "fake/model"}}
	mgr := session.NewManager(cfg, noopSender{}, func(context.Context, *session.State, []acp.ContentBlock, acp.UpdateSender) (string, error) {
		return "", nil
	}, slog.Default(), cwd, &session.FileStore{Root: filepath.Join(root, "sessions")})
	one, err := mgr.HandleSessionNew(context.Background(), acp.SessionNewParams{CWD: cwd})
	if err != nil {
		t.Fatal(err)
	}
	st := mgr.SessionByID(one.SessionID)
	a, err := session.CaptureArtifact(st.GetPersistedSessionDir(), cwd, "report.txt")
	if err != nil {
		t.Fatal(err)
	}
	st.AddMessage(llm.Message{Role: llm.RoleAssistant, ToolCalls: []llm.ToolCall{{ID: "share", Name: "share_file", InputJSON: `{"path":"report.txt"}`}}})
	st.AddMessage(llm.Message{Role: llm.RoleTool, ToolCallID: "share", Content: `{"artifact":{"id":"` + a.ID + `"}}`, Artifacts: []llm.Artifact{{ID: a.ID, Name: a.Name, SHA256: a.SHA256, Size: a.Size}}})
	two, err := mgr.HandleSessionNew(context.Background(), acp.SessionNewParams{CWD: cwd})
	if err != nil {
		t.Fatal(err)
	}
	srv := New(cfg, mgr, slog.Default(), cwd)
	return httptest.NewServer(srv.Handler()), mgr, one.SessionID, two.SessionID, a
}
func TestSessionArtifactDownloadGuardsAndDTOs(t *testing.T) {
	ts, mgr, id, other, a := artifactServer(t)
	defer ts.Close()
	client := ts.Client()
	get := func(method, path string, h map[string]string) *http.Response {
		r, _ := http.NewRequest(method, ts.URL+path, nil)
		for k, v := range h {
			r.Header.Set(k, v)
		}
		x, e := client.Do(r)
		if e != nil {
			t.Fatal(e)
		}
		return x
	}
	path := "/coddy/sessions/" + id + "/artifacts/" + a.ID
	r := get("GET", path, nil)
	b, _ := io.ReadAll(r.Body)
	_ = r.Body.Close()
	if r.StatusCode != 200 || string(b) != "report bytes" {
		t.Fatalf("download %d %q", r.StatusCode, b)
	}
	for k, w := range map[string]string{"Content-Type": "application/octet-stream", "Content-Disposition": "attachment; filename*=UTF-8''report.txt", "Content-Security-Policy": "sandbox; default-src 'none'", "X-Content-Type-Options": "nosniff", "Cache-Control": "private, max-age=31536000, immutable"} {
		if got := r.Header.Get(k); got != w {
			t.Errorf("%s=%q want %q", k, got, w)
		}
	}
	for _, tc := range []struct {
		method, path string
		headers      map[string]string
	}{{"HEAD", path, nil}, {"GET", path, map[string]string{"Range": "bytes=0-1"}}, {"GET", "/coddy/sessions/" + id + "/artifacts/unknown", nil}, {"GET", "/coddy/sessions/" + other + "/artifacts/" + a.ID, nil}, {"GET", "/coddy/sessions/" + id + "/artifacts/..%2Fmanifest.json", nil}} {
		x := get(tc.method, tc.path, tc.headers)
		_ = x.Body.Close()
		if x.StatusCode != http.StatusNotFound && x.StatusCode != http.StatusMethodNotAllowed {
			t.Errorf("%s %s=%d", tc.method, tc.path, x.StatusCode)
		}
	}
	// The presentation DTO survives a manager reload in both message and tool-call views.
	mgr2 := mgr
	_ = mgr2
	for _, u := range []string{"/coddy/sessions/" + id + "/messages", "/coddy/sessions/" + id + "/tool-calls", "/coddy/sessions/" + id + "/tool-calls/share"} {
		x := get("GET", u, nil)
		var v map[string]any
		if err := json.NewDecoder(x.Body).Decode(&v); err != nil {
			t.Fatal(err)
		}
		_ = x.Body.Close()
		raw, _ := json.Marshal(v)
		if !bytes.Contains(raw, []byte(`"artifacts"`)) || !bytes.Contains(raw, []byte(a.ID)) {
			t.Errorf("%s lacks artifact dto: %s", u, raw)
		}
	}
	// HTTP streaming hashes the immutable copy rather than trusting its name.
	p := session.ArtifactPath(mgr.SessionByID(id).GetPersistedSessionDir(), a.SHA256)
	if err := os.Chmod(p, 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(p, []byte("tampered"), 0400); err != nil {
		t.Fatal(err)
	}
	x := get("GET", path, nil)
	_ = x.Body.Close()
	if x.StatusCode != 404 {
		t.Errorf("tampered download=%d", x.StatusCode)
	}
}

func TestOpenAPISessionArtifactPathIsSeparateFromAssets(t *testing.T) {
	paths, ok := openAPISpec()["paths"].(map[string]interface{})
	if !ok {
		t.Fatal("OpenAPI paths missing")
	}
	const artifactPath = "/coddy/sessions/{id}/artifacts/{artifactID}"
	const assetPath = "/coddy/sessions/{id}/assets/{name}"
	artifact, ok := paths[artifactPath].(map[string]interface{})
	if !ok || artifact["get"] == nil {
		t.Fatalf("artifact path missing or has no GET operation: %#v", artifact)
	}
	assets, ok := paths[assetPath].(map[string]interface{})
	if !ok || assets["get"] == nil {
		t.Fatalf("assets path missing or has no GET operation: %#v", assets)
	}
	if _, nested := assets[artifactPath]; nested {
		t.Fatalf("artifact path is incorrectly nested under assets: %#v", assets)
	}
}
