//go:build http

package httpserver

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"testing"

	"github.com/cucumber/godog"
)

type artifactFeatureState struct {
	t                            *testing.T
	tsURL, sessionID, artifactID string
	body                         string
	close                        func()
}

func (s *artifactFeatureState) reset() error {
	if s.close != nil {
		s.close()
	}
	s.tsURL = ""
	s.body = ""
	return nil
}
func (s *artifactFeatureState) shared(name string) error {
	if name != "report.txt" {
		return fmt.Errorf("unexpected artifact %q", name)
	}
	ts, _, id, _, a := artifactServer(s.t)
	s.tsURL, s.sessionID, s.artifactID = ts.URL, id, a.ID
	s.close = ts.Close
	return nil
}
func (s *artifactFeatureState) download() error {
	r, e := http.Get(s.tsURL + "/coddy/sessions/" + s.sessionID + "/artifacts/" + s.artifactID)
	if e != nil {
		return e
	}
	defer func() { _ = r.Body.Close() }()
	b, _ := io.ReadAll(r.Body)
	if r.StatusCode != http.StatusOK {
		return fmt.Errorf("download status %d", r.StatusCode)
	}
	s.body = string(b)
	return nil
}
func (s *artifactFeatureState) contains(w string) error {
	if s.body != w {
		return fmt.Errorf("artifact body %q, want %q", s.body, w)
	}
	return nil
}
func TestFileArtifactsFeature(t *testing.T) {
	s := &artifactFeatureState{t: t}
	suite := godog.TestSuite{Name: "file_artifacts", ScenarioInitializer: func(sc *godog.ScenarioContext) {
		sc.Before(func(ctx context.Context, _ *godog.Scenario) (context.Context, error) { return ctx, s.reset() })
		sc.After(func(ctx context.Context, _ *godog.Scenario, _ error) (context.Context, error) {
			if s.close != nil {
				s.close()
			}
			return ctx, nil
		})
		sc.Step(`^a deterministic session has shared "([^"]*)"$`, s.shared)
		sc.Step(`^the client downloads the shared artifact$`, s.download)
		sc.Step(`^the artifact download contains "([^"]*)"$`, s.contains)
	}, Options: &godog.Options{Format: "pretty", Paths: []string{"../../features/file_artifacts.feature"}, TestingT: t, Strict: true}}
	if suite.Run() != 0 {
		t.Fatal("file artifact feature failed")
	}
}
