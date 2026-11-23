package main

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"strconv"
	"sync"
	"syscall"
	"time"
)

type server struct {
	root, frontend string
	maxBytes       int64
	maxPending     int
	timeout        time.Duration
	client         *http.Client
	proxy          *httputil.ReverseProxy
	mu, zipMu      sync.Mutex
	files          sync.RWMutex
	active         map[string]*activeJob
	queue          chan string
	workers        sync.WaitGroup
	closing        bool
}

func main() {
	addr := flag.String("listen", "127.0.0.1:8000", "HTTP listen address")
	backend := flag.String("backend", ".", "Backend folder containing app/")
	python := flag.String("python", ".venv311/bin/python", "Python interpreter")
	flag.Parse()
	dir, err := filepath.Abs(*backend)
	if err != nil {
		log.Fatal(err)
	}
	root, err := filepath.Abs(valueOr(os.Getenv("MUSIC_APP_DATA_DIR"), filepath.Join(dir, "storage")))
	if err != nil {
		log.Fatal(err)
	}
	if err := run(*addr, dir, *python, root); err != nil {
		log.Fatal(err)
	}
}

func run(addr, backend, python, root string) error {
	for _, name := range []string{"jobs", "uploads", "exports"} {
		if err := os.MkdirAll(filepath.Join(root, name), 0700); err != nil {
			return err
		}
	}
	lock, err := os.OpenFile(filepath.Join(root, ".server.lock"), os.O_CREATE|os.O_RDWR, 0600)
	if err != nil {
		return err
	}
	defer lock.Close()
	if err := syscall.Flock(int(lock.Fd()), syscall.LOCK_EX|syscall.LOCK_NB); err != nil {
		return fmt.Errorf("storage is already in use (%s): %w", root, err)
	}
	if err := os.RemoveAll(filepath.Join(root, "exports")); err != nil {
		return err
	}
	if err := os.Mkdir(filepath.Join(root, "exports"), 0700); err != nil {
		return err
	}
	runtime, err := os.MkdirTemp("/tmp", "music-api-")
	if err != nil {
		return err
	}
	defer os.RemoveAll(runtime)

	socket := filepath.Join(runtime, "worker.sock")
	if !filepath.IsAbs(python) && filepath.Dir(python) != "." {
		python = filepath.Join(backend, python)
	}
	cmd := exec.Command(python, "-m", "app.hybrid_worker", socket, strconv.Itoa(os.Getpid()))
	cmd.Dir = backend
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	// Keep the storage lease until even an orphaned worker finishes cleanup.
	cmd.ExtraFiles = []*os.File{lock}
	cmd.Env = append(os.Environ(), "MUSIC_APP_DATA_DIR="+root)
	cmd.Stderr, cmd.Stdout = os.Stderr, os.Stderr
	if err := cmd.Start(); err != nil {
		return err
	}
	workerDone := make(chan error, 1)
	go func() { workerDone <- cmd.Wait() }()
	workerExited := false
	defer func() {
		if workerExited {
			return
		}
		_ = cmd.Process.Signal(syscall.SIGTERM)
		select {
		case <-workerDone:
		case <-time.After(5 * time.Second):
			_ = cmd.Process.Kill()
			<-workerDone
		}
	}()

	transport := &http.Transport{DialContext: func(ctx context.Context, _, _ string) (net.Conn, error) {
		return (&net.Dialer{}).DialContext(ctx, "unix", socket)
	}}
	frontend := os.Getenv("MUSIC_FRONTEND_DIR")
	if frontend != "" && !filepath.IsAbs(frontend) {
		frontend, err = filepath.Abs(frontend)
		if err != nil {
			return err
		}
	}
	s := &server{
		root: root, frontend: frontend,
		maxBytes:   int64(envInt("MUSIC_MAX_UPLOAD_MB", 150)) * 1024 * 1024,
		maxPending: envInt("MUSIC_MAX_PENDING_JOBS", 8),
		timeout:    time.Duration(envInt("MUSIC_JOB_TIMEOUT_SECONDS", 7500)) * time.Second,
		client:     &http.Client{Transport: transport},
		active:     make(map[string]*activeJob),
		queue:      make(chan string, envInt("MUSIC_MAX_PENDING_JOBS", 8)),
	}
	target, _ := url.Parse("http://worker")
	s.proxy = httputil.NewSingleHostReverseProxy(target)
	s.proxy.Transport = transport
	s.proxy.ErrorHandler = func(w http.ResponseWriter, _ *http.Request, err error) {
		fail(w, 502, "Python 워커에 연결할 수 없습니다.")
		log.Print(err)
	}
	if err := s.waitReady(); err != nil {
		return err
	}
	s.recoverJobs()
	for i := 0; i < min(s.maxPending, envInt("MUSIC_JOB_WORKERS", 1)); i++ {
		s.workers.Add(1)
		go s.work()
	}
	httpServer := &http.Server{Addr: addr, Handler: s.routes(), ReadHeaderTimeout: 10 * time.Second, IdleTimeout: 75 * time.Second}
	serverDone := make(chan error, 1)
	go func() { serverDone <- httpServer.ListenAndServe() }()
	sig, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	select {
	case <-sig.Done():
	case err = <-serverDone:
	case workerErr := <-workerDone:
		workerExited = true
		err = fmt.Errorf("Python worker exited: %v", workerErr)
	}
	s.stopQueue()
	shutdown, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	_ = httpServer.Shutdown(shutdown)
	s.workers.Wait()
	if errors.Is(err, http.ErrServerClosed) {
		return nil
	}
	return err
}

func (s *server) waitReady() error {
	deadline, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	for {
		r, _ := http.NewRequestWithContext(deadline, http.MethodGet, "http://worker/api/health", nil)
		if res, err := s.client.Do(r); err == nil {
			_, _ = io.Copy(io.Discard, res.Body)
			res.Body.Close()
			if res.StatusCode == 200 {
				return nil
			}
		}
		select {
		case <-deadline.Done():
			return fmt.Errorf("Python worker did not start: %w", deadline.Err())
		case <-time.After(150 * time.Millisecond):
		}
	}
}

func envInt(name string, fallback int) int {
	n, err := strconv.Atoi(os.Getenv(name))
	if err != nil || n <= 0 {
		return fallback
	}
	return n
}

func valueOr(value, fallback string) string {
	if value == "" {
		return fallback
	}
	return value
}

func respond(w http.ResponseWriter, status int, data any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(data); err != nil {
		log.Print(err)
	}
}

func fail(w http.ResponseWriter, status int, detail string) {
	respond(w, status, map[string]string{"detail": detail})
}
