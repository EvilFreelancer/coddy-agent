package platform

import (
	"reflect"
	"testing"
)

func TestRevealFileArgv(t *testing.T) {
	path := "/workspace/report.txt"
	for _, tc := range []struct {
		name string
		goos string
		want []string
	}{
		{name: "macOS selects file", goos: "darwin", want: []string{"open", "-R", path}},
		{name: "Windows selects file", goos: "windows", want: []string{"explorer.exe", "/select," + path}},
		{name: "Linux opens containing folder", goos: "linux", want: []string{"xdg-open", "/workspace"}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got, err := revealFileArgv(tc.goos, path)
			if err != nil {
				t.Fatal(err)
			}
			if !reflect.DeepEqual(got, tc.want) {
				t.Fatalf("argv = %#v, want %#v", got, tc.want)
			}
		})
	}
}

func TestRevealFileArgvRejectsUnsupportedPlatform(t *testing.T) {
	if _, err := revealFileArgv("plan9", "/workspace/report.txt"); err == nil {
		t.Fatal("unsupported platform was accepted")
	}
}
