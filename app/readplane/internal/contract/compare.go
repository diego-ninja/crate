package contract

import (
	"bytes"
	"encoding/json"
	"fmt"
	"math/big"
	"reflect"
	"sort"
	"strings"
	"time"
)

var timeKeys = map[string]struct{}{
	"built_at":    {},
	"followed_at": {},
	"liked_at":    {},
	"played_at":   {},
	"saved_at":    {},
	"stale_after": {},
	"created_at":  {},
	"expires_at":  {},
}

type normalizedNumber string

func NormalizeJSON(raw []byte) (any, error) {
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.UseNumber()
	var value any
	if err := decoder.Decode(&value); err != nil {
		return nil, fmt.Errorf("decode json: %w", err)
	}
	return normalizeValue("", value), nil
}

func EqualJSON(left []byte, right []byte) (bool, string, error) {
	leftValue, err := NormalizeJSON(left)
	if err != nil {
		return false, "", fmt.Errorf("left: %w", err)
	}
	rightValue, err := NormalizeJSON(right)
	if err != nil {
		return false, "", fmt.Errorf("right: %w", err)
	}
	if reflect.DeepEqual(leftValue, rightValue) {
		return true, "", nil
	}
	return false, firstDiff("$", leftValue, rightValue), nil
}

func normalizeValue(key string, value any) any {
	switch typed := value.(type) {
	case map[string]any:
		out := make(map[string]any, len(typed))
		for childKey, childValue := range typed {
			out[childKey] = normalizeValue(childKey, childValue)
		}
		return out
	case []any:
		out := make([]any, len(typed))
		for index, childValue := range typed {
			out[index] = normalizeValue("", childValue)
		}
		return out
	case string:
		if _, ok := timeKeys[key]; ok {
			return normalizeTimeString(typed)
		}
		return typed
	case json.Number:
		return normalizeNumber(typed)
	default:
		return typed
	}
}

func normalizeNumber(value json.Number) normalizedNumber {
	rat := new(big.Rat)
	if _, ok := rat.SetString(value.String()); ok {
		return normalizedNumber(rat.String())
	}
	return normalizedNumber(value.String())
}

func normalizeTimeString(value string) string {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return trimmed
	}
	for _, layout := range []string{
		time.RFC3339Nano,
		"2006-01-02T15:04:05.999999-07:00",
		"2006-01-02T15:04:05.999999Z07:00",
		"2006-01-02T15:04:05-07:00",
	} {
		parsed, err := time.Parse(layout, trimmed)
		if err == nil {
			return parsed.UTC().Format(time.RFC3339Nano)
		}
	}
	return value
}

func firstDiff(path string, left any, right any) string {
	switch leftTyped := left.(type) {
	case map[string]any:
		rightTyped, ok := right.(map[string]any)
		if !ok {
			return formatDiff(path, left, right)
		}
		keys := make([]string, 0, len(leftTyped)+len(rightTyped))
		seen := make(map[string]struct{}, len(leftTyped)+len(rightTyped))
		for key := range leftTyped {
			keys = append(keys, key)
			seen[key] = struct{}{}
		}
		for key := range rightTyped {
			if _, ok := seen[key]; !ok {
				keys = append(keys, key)
			}
		}
		sort.Strings(keys)
		for _, key := range keys {
			leftChild, leftOK := leftTyped[key]
			rightChild, rightOK := rightTyped[key]
			childPath := path + "." + key
			if !leftOK || !rightOK {
				return formatDiff(childPath, presence(leftOK, leftChild), presence(rightOK, rightChild))
			}
			if !reflect.DeepEqual(leftChild, rightChild) {
				return firstDiff(childPath, leftChild, rightChild)
			}
		}
	case []any:
		rightTyped, ok := right.([]any)
		if !ok {
			return formatDiff(path, left, right)
		}
		if len(leftTyped) != len(rightTyped) {
			return formatDiff(path+".length", len(leftTyped), len(rightTyped))
		}
		for index := range leftTyped {
			if !reflect.DeepEqual(leftTyped[index], rightTyped[index]) {
				return firstDiff(fmt.Sprintf("%s[%d]", path, index), leftTyped[index], rightTyped[index])
			}
		}
	default:
		if !reflect.DeepEqual(left, right) {
			return formatDiff(path, left, right)
		}
	}
	return formatDiff(path, left, right)
}

func presence(ok bool, value any) any {
	if ok {
		return value
	}
	return "<missing>"
}

func formatDiff(path string, left any, right any) string {
	return fmt.Sprintf("%s: left=%s right=%s", path, compactValue(left), compactValue(right))
}

func compactValue(value any) string {
	raw, err := json.Marshal(value)
	if err != nil {
		return fmt.Sprintf("%v", value)
	}
	const limit = 320
	if len(raw) <= limit {
		return string(raw)
	}
	return string(raw[:limit]) + "..."
}
