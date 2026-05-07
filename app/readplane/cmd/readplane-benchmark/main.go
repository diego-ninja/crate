package main

import (
	"context"
	"fmt"
	"log"
	"os"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/thecrateapp/crate/app/readplane/internal/contract"
)

type benchConfig struct {
	fastapiBase   string
	readplaneBase string
	email         string
	password      string
	path          string
	requests      int
	warmup        int
	timeout       time.Duration
}

type result struct {
	name      string
	durations []time.Duration
	source    string
}

func main() {
	cfg := loadConfig()
	ctx, cancel := context.WithTimeout(context.Background(), cfg.timeout*time.Duration(cfg.requests+cfg.warmup+4))
	defer cancel()

	fastapi := contract.NewClient(cfg.fastapiBase, cfg.timeout)
	readplane := contract.NewClient(cfg.readplaneBase, cfg.timeout)

	token, err := fastapi.Login(ctx, cfg.email, cfg.password)
	if err != nil {
		log.Fatalf("login failed: %v", err)
	}

	fastapiResult := runTarget(ctx, fastapi, "fastapi", cfg.path, token, cfg)
	readplaneResult := runTarget(ctx, readplane, "readplane", cfg.path, token, cfg)

	printResult(fastapiResult)
	printResult(readplaneResult)
	if len(fastapiResult.durations) > 0 && len(readplaneResult.durations) > 0 {
		fastP95 := percentile(fastapiResult.durations, 0.95)
		readP95 := percentile(readplaneResult.durations, 0.95)
		if readP95 > 0 {
			fmt.Printf("speedup p95 %.2fx\n", float64(fastP95)/float64(readP95))
		}
	}
}

func runTarget(ctx context.Context, client contract.Client, name string, path string, token string, cfg benchConfig) result {
	for i := 0; i < cfg.warmup; i++ {
		if _, _, err := client.Get(ctx, path, token); err != nil {
			log.Fatalf("%s warmup failed: %v", name, err)
		}
	}

	out := result{name: name, durations: make([]time.Duration, 0, cfg.requests)}
	for i := 0; i < cfg.requests; i++ {
		start := time.Now()
		_, headers, err := client.Get(ctx, path, token)
		elapsed := time.Since(start)
		if err != nil {
			log.Fatalf("%s request %d failed: %v", name, i+1, err)
		}
		if out.source == "" {
			out.source = headers.Get("X-Crate-Readplane")
		}
		out.durations = append(out.durations, elapsed)
	}
	return out
}

func printResult(r result) {
	if len(r.durations) == 0 {
		return
	}
	source := r.source
	if source == "" {
		source = "n/a"
	}
	fmt.Printf(
		"%s source=%s n=%d min=%s p50=%s p95=%s max=%s avg=%s\n",
		r.name,
		source,
		len(r.durations),
		roundMS(minDuration(r.durations)),
		roundMS(percentile(r.durations, 0.50)),
		roundMS(percentile(r.durations, 0.95)),
		roundMS(maxDuration(r.durations)),
		roundMS(avgDuration(r.durations)),
	)
}

func loadConfig() benchConfig {
	return benchConfig{
		fastapiBase:   env("FASTAPI_BASE", "http://127.0.0.1:8585"),
		readplaneBase: env("READPLANE_BASE", "http://127.0.0.1:8686"),
		email:         env("CRATE_AUTH_EMAIL", "admin@cratemusic.app"),
		password:      env("CRATE_AUTH_PASSWORD", "admin"),
		path:          env("READPLANE_BENCH_PATH", "/api/me/home/discovery"),
		requests:      intEnv("READPLANE_BENCH_REQUESTS", 50),
		warmup:        intEnv("READPLANE_BENCH_WARMUP", 5),
		timeout:       durationEnv("READPLANE_BENCH_TIMEOUT", 10*time.Second),
	}
}

func percentile(values []time.Duration, p float64) time.Duration {
	if len(values) == 0 {
		return 0
	}
	sorted := append([]time.Duration(nil), values...)
	sort.Slice(sorted, func(i, j int) bool { return sorted[i] < sorted[j] })
	if p <= 0 {
		return sorted[0]
	}
	if p >= 1 {
		return sorted[len(sorted)-1]
	}
	index := int(float64(len(sorted)-1)*p + 0.5)
	return sorted[index]
}

func minDuration(values []time.Duration) time.Duration {
	min := values[0]
	for _, value := range values[1:] {
		if value < min {
			min = value
		}
	}
	return min
}

func maxDuration(values []time.Duration) time.Duration {
	max := values[0]
	for _, value := range values[1:] {
		if value > max {
			max = value
		}
	}
	return max
}

func avgDuration(values []time.Duration) time.Duration {
	var total time.Duration
	for _, value := range values {
		total += value
	}
	return total / time.Duration(len(values))
}

func roundMS(value time.Duration) time.Duration {
	return value.Round(100 * time.Microsecond)
}

func env(key string, fallback string) string {
	value := strings.TrimSpace(os.Getenv(key))
	if value == "" {
		return fallback
	}
	return value
}

func intEnv(key string, fallback int) int {
	value := strings.TrimSpace(os.Getenv(key))
	if value == "" {
		return fallback
	}
	parsed, err := strconv.Atoi(value)
	if err != nil || parsed <= 0 {
		return fallback
	}
	return parsed
}

func durationEnv(key string, fallback time.Duration) time.Duration {
	value := strings.TrimSpace(os.Getenv(key))
	if value == "" {
		return fallback
	}
	parsed, err := time.ParseDuration(value)
	if err != nil || parsed <= 0 {
		return fallback
	}
	return parsed
}
