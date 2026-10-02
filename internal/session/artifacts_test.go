package session

import (
	"os"
	"path/filepath"
	"testing"
)

func TestCaptureArtifactDeduplicatesAndRejectsSymlink(t *testing.T) {
	root := t.TempDir()
	workspace := filepath.Join(root, "workspace")
	sessionDir := filepath.Join(root, "session")
	if err := os.Mkdir(workspace, 0o755); err != nil {
		t.Fatal(err)
	}
	file := filepath.Join(workspace, "report.txt")
	if err := os.WriteFile(file, []byte("immutable bytes"), 0o644); err != nil {
		t.Fatal(err)
	}

	first, err := CaptureArtifact(sessionDir, workspace, "report.txt")
	if err != nil {
		t.Fatal(err)
	}
	second, err := CaptureArtifact(sessionDir, workspace, "report.txt")
	if err != nil {
		t.Fatal(err)
	}
	if first.ID != second.ID || first.SHA256 != second.SHA256 {
		t.Fatalf("dedup = %#v, %#v", first, second)
	}
	if got, err := os.ReadFile(ArtifactPath(sessionDir, first.SHA256)); err != nil || string(got) != "immutable bytes" {
		t.Fatalf("artifact = %q, %v", got, err)
	}

	if err := os.Symlink(file, filepath.Join(workspace, "linked.txt")); err != nil {
		t.Fatal(err)
	}
	if _, err := CaptureArtifact(sessionDir, workspace, "linked.txt"); err == nil {
		t.Fatal("symlink source was accepted")
	}
}

func TestReadArtifactRejectsTamperedAndSymlinkedContent(t *testing.T) {
	root := t.TempDir()
	workspace := filepath.Join(root, "workspace")
	sessionDir := filepath.Join(root, "session")
	if err := os.Mkdir(workspace, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(workspace, "report.txt"), []byte("original"), 0o644); err != nil {
		t.Fatal(err)
	}
	a, err := CaptureArtifact(sessionDir, workspace, "report.txt")
	if err != nil {
		t.Fatal(err)
	}
	path := ArtifactPath(sessionDir, a.SHA256)
	if err := os.Chmod(path, 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte("tampered"), 0o400); err != nil {
		t.Fatal(err)
	}
	if _, _, err := ReadArtifact(sessionDir, a.ID); err != nil {
		t.Fatalf("ReadArtifact should leave digest verification to the HTTP stream: %v", err)
	}
	if err := os.Remove(path); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(filepath.Join(workspace, "report.txt"), path); err != nil {
		t.Fatal(err)
	}
	if _, _, err := ReadArtifact(sessionDir, a.ID); err == nil {
		t.Fatal("symlinked artifact was accepted")
	}
}
