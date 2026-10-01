package llm

import (
	"encoding/json"
	"strings"
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
			_, got := p.splitMessages([]Message{{Role: RoleUser, Content: "first"}, tc.assist, {Role: RoleUser, Content: "second"}})
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
