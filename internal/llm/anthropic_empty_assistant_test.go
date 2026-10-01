package llm

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
)

func TestAnthropicSplitMessagesOmitsUnreplayableAssistant(t *testing.T) {
	for _, tc := range []struct {
		name   string
		assist Message
	}{
		{name: "empty", assist: Message{Role: RoleAssistant}},
		{name: "signature without thinking", assist: Message{Role: RoleAssistant, ReasoningSignature: "sig"}},
		{name: "unsigned thinking", assist: Message{Role: RoleAssistant, Reasoning: "private thought"}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			p := newAnthropicProvider("test-model", "", "", nil, 8192, 0, "high")
			_, got, err := p.splitMessages([]Message{{Role: RoleUser, Content: "first"}, tc.assist, {Role: RoleUser, Content: "second"}})
			if err != nil {
				t.Fatal(err)
			}
			if len(got) != 2 {
				t.Fatalf("messages = %d, want two user messages: %+v", len(got), got)
			}
			raw, err := json.Marshal(got)
			if err != nil {
				t.Fatal(err)
			}
			if strings.Contains(string(raw), `"role":"assistant"`) || strings.Contains(string(raw), `"text":""`) {
				t.Fatalf("unreplayable assistant entered request: %s", raw)
			}
		})
	}
}

func TestAnthropicRejectsTrailingUnreplayableAssistantBeforeRequest(t *testing.T) {
	for _, tc := range []struct {
		name     string
		messages []Message
	}{
		{name: "only empty assistant", messages: []Message{{Role: RoleAssistant}}},
		{name: "after user", messages: []Message{{Role: RoleUser, Content: "question"}, {Role: RoleAssistant, ReasoningSignature: "sig"}}},
		{name: "after assistant", messages: []Message{{Role: RoleUser, Content: "question"}, {Role: RoleAssistant, Content: "partial"}, {Role: RoleAssistant}}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var calls atomic.Int32
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
				calls.Add(1)
				w.WriteHeader(http.StatusOK)
			}))
			defer srv.Close()
			p := newAnthropicProvider("test-model", "key", srv.URL, nil, 8192, 0, "high")
			if _, err := p.Complete(context.Background(), tc.messages, nil); err == nil || !strings.Contains(err.Error(), "no replayable content") {
				t.Errorf("Complete error = %v, want explicit unreplayable assistant error", err)
			}
			if _, err := p.Stream(context.Background(), tc.messages, nil, func(StreamChunk) {}); err == nil || !strings.Contains(err.Error(), "no replayable content") {
				t.Errorf("Stream error = %v, want explicit unreplayable assistant error", err)
			}
			if got := calls.Load(); got != 0 {
				t.Errorf("provider calls = %d, want zero", got)
			}
		})
	}
}
