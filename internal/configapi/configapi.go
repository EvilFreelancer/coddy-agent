// Package configapi serves the routes the settings form of the web UI reads and
// saves the configuration through - its schema, the configuration as a
// document, a dry validation and the save - for every surface that offers the
// form: the HTTP server of an agent, and a swarm relay for its own deployment
// (issue #401). The surfaces differ in what the form shows (the schema), in how
// a saved configuration is put in place, and in the credentials they report as
// set; the transaction in between is the same, and lives here once.
package configapi

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"os"
	"strings"

	"github.com/EvilFreelancer/coddy-agent/internal/config"
)

// Backend is one surface's configuration editor.
type Backend struct {
	// Live returns the configuration running now. Required.
	Live func() *config.Config
	// Install puts a configuration that was just written and loaded again in
	// place: the session manager's ReplaceConfig on an agent, the runtime's on
	// a relay. It runs under the process-wide config file lock. Required.
	Install func(*config.Config) error
	// Schema renders the JSON Schema the settings form is drawn from. Required.
	Schema func() ([]byte, error)
	// Decorate adjusts a document a read serves, after it is built from the live
	// configuration: the effective state of credentials the file does not
	// carry (a token given by flag or environment). Optional.
	Decorate func(dto *config.ConfigJSON)
	// Revisions remembers the configurations the reads handed out, so a save is
	// measured against what its client read. Optional: without it a save is
	// measured against the configuration live when it arrives.
	Revisions *Revisions
	// Log records the failures a client is only told about in general terms.
	Log *slog.Logger
}

// Register mounts the four routes on mux.
func (b *Backend) Register(mux *http.ServeMux) {
	mux.HandleFunc("GET /coddy/config/schema", b.schemaGet)
	mux.HandleFunc("GET /coddy/config", b.configGet)
	mux.HandleFunc("POST /coddy/config/validate", b.validatePost)
	mux.HandleFunc("PUT /coddy/config", b.configPut)
}

func (b *Backend) log() *slog.Logger {
	if b.Log != nil {
		return b.Log
	}
	return slog.Default()
}

// Sentinel failures of the save, mapped to distinct HTTP replies.
var (
	errUnavailable = errors.New("coddy config unavailable")
	errParse       = errors.New("coddy config parse failed")
	errSerialize   = errors.New("coddy config serialize failed")
	errBackup      = errors.New("coddy config backup failed")
	errWrite       = errors.New("coddy config write failed")
)

func (b *Backend) schemaGet(w http.ResponseWriter, _ *http.Request) {
	data, err := b.Schema()
	if err != nil {
		b.log().Error("coddy config schema", "error", err)
		WriteError(w, http.StatusInternalServerError, "schema generation failed")
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_, _ = w.Write(data)
}

func (b *Backend) configGet(w http.ResponseWriter, _ *http.Request) {
	c := b.Live()
	if c == nil {
		WriteError(w, http.StatusInternalServerError, "config unavailable")
		return
	}
	dto := config.ConfigToJSONDTO(c)
	// The document names the configuration it was read from, and a PUT that
	// sends it back is measured against that one.
	if b.Revisions != nil {
		dto.Revision = b.Revisions.Revision(c)
	}
	if b.Decorate != nil {
		b.Decorate(dto)
	}
	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(dto); err != nil {
		b.log().Error("coddy config get encode", "error", err)
	}
}

func (b *Backend) validatePost(w http.ResponseWriter, r *http.Request) {
	c := b.Live()
	if c == nil {
		WriteError(w, http.StatusInternalServerError, "config unavailable")
		return
	}
	body, err := io.ReadAll(r.Body)
	if err != nil {
		WriteError(w, http.StatusBadRequest, "read body")
		return
	}
	if _, err := config.ParseConfigJSONPreservingSecrets(body, c.Paths, c); err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		_ = json.NewEncoder(w).Encode(map[string]interface{}{
			"ok":    false,
			"error": err.Error(),
		})
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]interface{}{"ok": true})
}

func (b *Backend) configPut(w http.ResponseWriter, r *http.Request) {
	body, err := io.ReadAll(r.Body)
	if err != nil {
		WriteError(w, http.StatusBadRequest, "read body")
		return
	}
	// The whole transaction - reading the current config the secret-preserving
	// parse merges into, backup, write, reload, and installing the result - runs
	// under the process-wide config file lock shared with the agent's
	// config_commit / config_rollback tools. Anything less lets two writers
	// interleave and install runtime state that no longer matches the file.
	var cfgPath string
	txErr := config.WithConfigFileLock(func() error {
		c := b.Live()
		if c == nil {
			return errUnavailable
		}
		paths := c.Paths
		cfgPath = paths.ConfigPath
		newCfg, err := config.ParseConfigJSONPreservingSecrets(body, paths, c)
		if err != nil {
			return fmt.Errorf("%w: %s", errParse, err.Error())
		}
		// What the client read: the configuration its document names by
		// revision, or the live one for a document without it (another client,
		// a script) or from further back than this process remembers.
		served := c
		if b.Revisions != nil {
			var read struct {
				Revision string `json:"revision"`
			}
			if json.Unmarshal(body, &read) == nil {
				if old := b.Revisions.Lookup(read.Revision); old != nil {
					served = old
				}
			}
		}
		// Rendered over the file that is there, so the operator's comments, the
		// editor schema modeline and the spelling of every value the form did not
		// change survive a save from the settings screen. A value sent back as it
		// was served keeps what the file says now - not what this process made of
		// it, and not what the client was shown before another save replaced it.
		yb, err := config.MarshalConfigYAMLForEdit(newCfg, served, c, cfgPath)
		if err != nil {
			return errSerialize
		}
		if err := config.BackupCurrent(cfgPath); err != nil {
			b.log().Error("coddy config backup", "error", err)
			return errBackup
		}
		if err := config.AtomicWriteConfigYAML(cfgPath, yb); err != nil {
			b.log().Error("coddy config write", "error", err)
			return errWrite
		}
		reloaded, err := config.LoadWithPaths(paths)
		if err == nil {
			err = b.Install(reloaded)
		}
		if err != nil {
			b.log().Error("coddy config reload after write", "error", err)
			if bak, er2 := os.ReadFile(config.BackupPath(cfgPath)); er2 == nil {
				if er3 := config.AtomicWriteConfigYAML(cfgPath, bak); er3 != nil {
					b.log().Error("coddy config rollback", "error", er3)
				}
			}
			return err
		}
		return nil
	})
	switch {
	case errors.Is(txErr, errUnavailable):
		WriteError(w, http.StatusInternalServerError, "config unavailable")
		return
	case errors.Is(txErr, errParse):
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		_ = json.NewEncoder(w).Encode(map[string]interface{}{
			"ok":    false,
			"error": strings.TrimPrefix(txErr.Error(), errParse.Error()+": "),
		})
		return
	case errors.Is(txErr, errSerialize):
		WriteError(w, http.StatusInternalServerError, "serialize yaml")
		return
	case errors.Is(txErr, errBackup):
		WriteError(w, http.StatusInternalServerError, "backup failed")
		return
	case errors.Is(txErr, errWrite):
		WriteError(w, http.StatusInternalServerError, "write failed")
		return
	case txErr != nil:
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		_ = json.NewEncoder(w).Encode(map[string]interface{}{
			"ok":    false,
			"error": txErr.Error(),
		})
		return
	}
	b.log().Info("config updated", "path", cfgPath)
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]interface{}{"ok": true})
}

// WriteError answers with the error document of the configuration routes:
// `{"ok": false, "error": msg}`.
func WriteError(w http.ResponseWriter, code int, msg string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(map[string]interface{}{
		"ok":    false,
		"error": msg,
	})
}
