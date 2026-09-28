package main

import (
	"testing"

	"github.com/EvilFreelancer/coddy-agent/internal/config"
)

// A relay reads its settings when it starts, so the supervisor rebuilds it on
// any of them that moved - except its listen address, which only a fresh
// process can take (the RestartKey), so a rebuild must not be asked for it
// (issue #401).
func TestSwarmFingerprintMovesWithEverySettingButTheAddress(t *testing.T) {
	base := func() *config.Config {
		c := &config.Config{}
		c.Swarm.Enabled = true
		c.Swarm.Host = "127.0.0.1"
		c.Swarm.Port = 12346
		c.Swarm.Name = "office"
		c.Swarm.AuthToken = "client"
		return c
	}
	want := swarmFingerprint(base())
	if want == "" {
		t.Fatal("empty fingerprint")
	}
	moved := base()
	moved.Swarm.Host, moved.Swarm.Port = "0.0.0.0", 12999
	if got := swarmFingerprint(moved); got != want {
		t.Errorf("the listen address moved the fingerprint: a rebuild cannot rebind it")
	}
	for name, edit := range map[string]func(c *config.Config){
		"cors": func(c *config.Config) {
			c.Swarm.CORS.Enabled = true
			c.Swarm.CORS.AllowedOrigins = []string{"http://laptop:12345"}
		},
		"client token":  func(c *config.Config) { c.Swarm.AuthToken = "rotated" },
		"name":          func(c *config.Config) { c.Swarm.Name = "office-2" },
		"pairing token": func(c *config.Config) { c.Swarm.PairingTokens = []string{"p"} },
		"upstream":      func(c *config.Config) { c.Swarm.Upstreams = []config.SwarmUpstream{{Name: "nas", URL: "http://nas:1"}} },
	} {
		c := base()
		edit(c)
		if swarmFingerprint(c) == want {
			t.Errorf("a change of the %s left the fingerprint as it was", name)
		}
	}
	if swarmFingerprint(nil) != "" {
		t.Error("a nil configuration has a fingerprint")
	}
}
