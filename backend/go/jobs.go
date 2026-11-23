package main

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"time"
)

var jobIDPattern = regexp.MustCompile("^[a-f0-9]{32}$")

type job struct {
	ID              string             `json:"id"`
	Status          string             `json:"status"`
	Progress        float64            `json:"progress"`
	Message         string             `json:"message"`
	Created         string             `json:"created_at"`
	Updated         string             `json:"updated_at"`
	Filename        string             `json:"original_filename"`
	Warnings        []string           `json:"warnings"`
	Error           *string            `json:"error"`
	Quality         string             `json:"separation_quality"`
	Separation      string             `json:"separation_status"`
	SeparationError *string            `json:"separation_error"`
	Engine          string             `json:"separation_engine"`
	ActualEngine    *string            `json:"actual_separation_engine"`
	Reused          bool               `json:"separation_cache_hit"`
	Music           bool               `json:"music_analysis"`
	MIDI            bool               `json:"midi"`
	Timings         map[string]float64 `json:"timings"`
	MusicReused     bool               `json:"music_cache_hit"`
}

type manifest struct {
	job
	Source        string `json:"source_path"`
	Dir           string `json:"job_dir"`
	Digest        string `json:"audio_digest"`
	CacheKey      string `json:"separation_cache_key"`
	MusicCacheKey string `json:"music_cache_key"`
}

type activeJob struct {
	signature string
	running   bool
	cancelled bool
}

func now() string                         { return time.Now().UTC().Format("2006-01-02T15:04:05.000000000Z") }
func (s *server) jobDir(id string) string { return filepath.Join(s.root, "jobs", id) }

func (s *server) read(id string) (manifest, error) {
	if !jobIDPattern.MatchString(id) {
		return manifest{}, os.ErrNotExist
	}
	data, err := os.ReadFile(filepath.Join(s.jobDir(id), "job.json"))
	if err != nil {
		return manifest{}, err
	}
	entry := manifest{job: job{Warnings: []string{}, Quality: "standard", Separation: "unverified", Engine: "torch", Music: true, MIDI: true, Timings: map[string]float64{}}}
	err = json.Unmarshal(data, &entry)
	if err == nil && entry.ID != id {
		err = fmt.Errorf("job manifest ID mismatch")
	}
	// Python uses null for the optional cache key and digest; null strings decode as empty.
	return entry, err
}

func (s *server) write(entry manifest) error {
	entry.Updated = now()
	data, err := json.Marshal(entry)
	if err != nil {
		return err
	}
	p := filepath.Join(s.jobDir(entry.ID), "job.json")
	tmp, err := os.CreateTemp(filepath.Dir(p), ".job-*")
	if err != nil {
		return err
	}
	defer os.Remove(tmp.Name())
	_, err = tmp.Write(data)
	closeErr := tmp.Close()
	if err != nil {
		return err
	}
	if closeErr != nil {
		return closeErr
	}
	return os.Rename(tmp.Name(), p)
}

func (s *server) list() []manifest {
	entries, err := os.ReadDir(filepath.Join(s.root, "jobs"))
	if err != nil {
		log.Print(err)
	}
	result := make([]manifest, 0, len(entries))
	for _, dir := range entries {
		if dir.IsDir() {
			if entry, err := s.read(dir.Name()); err == nil {
				result = append(result, entry)
			} else if !errors.Is(err, os.ErrNotExist) {
				log.Print(err)
			}
		}
	}
	sort.Slice(result, func(i, j int) bool {
		a, _ := time.Parse(time.RFC3339Nano, result[i].Created)
		b, _ := time.Parse(time.RFC3339Nano, result[j].Created)
		return a.After(b)
	})
	return result
}

func (s *server) upload(w http.ResponseWriter, r *http.Request) {
	// Bound the entire body including multipart overhead, and the audio payload separately.
	r.Body = http.MaxBytesReader(w, r.Body, s.maxBytes+65536)
	reader, err := r.MultipartReader()
	if err != nil {
		fail(w, 400, "multipart 파일 업로드가 필요합니다.")
		return
	}
	id := hex.EncodeToString(makeRandom())
	uploads := filepath.Join(s.root, "uploads", id)
	accepted := false
	defer func() {
		if !accepted {
			os.RemoveAll(uploads)
			os.RemoveAll(s.jobDir(id))
		}
	}()
	if err = os.Mkdir(uploads, 0700); err != nil {
		fail(w, 500, "업로드 저장 공간을 준비할 수 없습니다.")
		return
	}
	fields := map[string]string{}
	digest := sha256.New()
	var filename, source string
	var size int64
	uploadLimit := func() { fail(w, 413, fmt.Sprintf("업로드 한도는 %dMB입니다.", s.maxBytes/(1024*1024))) }
	badBody := func(err error) {
		var limit *http.MaxBytesError
		if errors.As(err, &limit) {
			uploadLimit()
		} else {
			fail(w, 400, "업로드 본문을 읽을 수 없습니다.")
		}
	}
	for {
		part, nextErr := reader.NextPart()
		if nextErr == io.EOF {
			break
		}
		if nextErr != nil {
			badBody(nextErr)
			return
		}
		if part.FormName() != "file" {
			raw, e := io.ReadAll(io.LimitReader(part, 1025))
			if e != nil {
				badBody(e)
				return
			}
			if len(raw) > 1024 {
				fail(w, 400, "업로드 옵션이 너무 깁니다.")
				return
			}
			switch part.FormName() {
			case "quality", "engine", "music_analysis", "midi":
				fields[part.FormName()] = string(raw)
			}
			continue
		}
		if filename != "" {
			fail(w, 400, "한 작업에는 오디오 파일 하나만 업로드할 수 있습니다.")
			return
		}
		filename = filepath.Base(strings.ReplaceAll(part.FileName(), "\\", "/"))
		suffix := strings.ToLower(filepath.Ext(filename))
		if suffix != ".mp3" && suffix != ".wav" {
			fail(w, 400, "mp3와 wav 파일만 업로드할 수 있습니다.")
			return
		}
		source = filepath.Join(uploads, filename)
		file, e := os.OpenFile(source, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
		if e != nil {
			fail(w, 400, "업로드 파일을 저장할 수 없습니다.")
			return
		}
		size, e = io.Copy(io.MultiWriter(file, digest), io.LimitReader(part, s.maxBytes+1))
		closeErr := file.Close()
		if e != nil {
			badBody(e)
			return
		}
		if closeErr != nil {
			fail(w, 500, "업로드 파일을 저장할 수 없습니다.")
			return
		}
		if size > s.maxBytes {
			uploadLimit()
			return
		}
	}
	if size == 0 {
		fail(w, 400, "빈 오디오 파일은 업로드할 수 없습니다.")
		return
	}
	quality := valueOr(fields["quality"], "standard")
	engine := valueOr(fields["engine"], valueOr(os.Getenv("MUSIC_SEPARATION_ENGINE"), "torch"))
	music, okMusic := formBool(fields["music_analysis"])
	midi, okMIDI := formBool(fields["midi"])
	if (quality != "standard" && quality != "high") || (engine != "torch" && engine != "mps" && engine != "mlx") || !okMusic || !okMIDI {
		fail(w, 422, "지원하지 않는 품질, 분리 엔진 또는 분석 옵션입니다.")
		return
	}
	hash := hex.EncodeToString(digest.Sum(nil))
	signature := fmt.Sprintf("%s\x00%s\x00%s\x00%s\x00%t\x00%t", hash, filename, quality, engine, music, midi)
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.closing {
		fail(w, 503, "서버를 종료하는 중입니다.")
		return
	}
	for candidate, a := range s.active {
		if a.signature == signature && !a.cancelled {
			if existing, err := s.read(candidate); err == nil && (existing.Status == "queued" || existing.Status == "running") {
				respond(w, 200, existing.job)
				return
			}
		}
	}
	if len(s.active) >= s.maxPending || len(s.queue) >= cap(s.queue) {
		fail(w, 429, "작업 대기열이 가득 찼습니다. 잠시 후 다시 업로드하세요.")
		return
	}
	t := now()
	entry := manifest{job: job{ID: id, Status: "queued", Message: "대기열에 추가됨", Created: t, Updated: t, Filename: filename, Warnings: []string{}, Quality: quality, Separation: "pending", Engine: engine, Music: music, MIDI: midi, Timings: map[string]float64{}}, Source: source, Dir: s.jobDir(id), Digest: hash}
	if err = os.Mkdir(entry.Dir, 0700); err == nil {
		err = s.write(entry)
	}
	if err != nil {
		fail(w, 500, "작업을 저장할 수 없습니다.")
		return
	}
	s.active[id] = &activeJob{signature: signature}
	s.queue <- id
	accepted = true
	respond(w, 200, entry.job)
}

func makeRandom() []byte { b := make([]byte, 16); _, _ = rand.Read(b); return b }
func formBool(s string) (bool, bool) {
	switch strings.ToLower(s) {
	case "", "true", "1", "on", "yes", "t", "y":
		return true, true
	case "false", "0", "off", "no", "f", "n":
		return false, true
	default:
		return false, false
	}
}

func (s *server) recoverJobs() {
	for _, j := range s.list() {
		if j.Status != "queued" && j.Status != "running" {
			continue
		}
		if _, err := os.Stat(filepath.Join(s.jobDir(j.ID), "analysis.json")); err == nil {
			j.Status = "done"
			j.Progress = 1
			j.Message = "분석 완료"
			_ = s.write(j)
		} else {
			s.failJob(j, "서버가 재시작되어 작업이 중단되었습니다. 파일을 다시 업로드하세요.")
		}
	}
}

func (s *server) failJob(j manifest, message string) {
	dir := s.jobDir(j.ID)
	_ = os.RemoveAll(filepath.Join(s.root, "uploads", j.ID))
	for _, name := range []string{"stems", "midi", "source.wav", "analysis.json.tmp"} {
		_ = os.RemoveAll(filepath.Join(dir, name))
	}
	j.Status, j.Separation, j.Message = "error", "failed", message
	j.Error, j.SeparationError = &message, &message
	if err := s.write(j); err != nil {
		log.Print(err)
	}
}

func (s *server) work() {
	defer s.workers.Done()
	for id := range s.queue {
		s.mu.Lock()
		a := s.active[id]
		if a == nil || a.cancelled {
			s.mu.Unlock()
			continue
		}
		a.running = true
		s.mu.Unlock()
		s.runJob(id)
		s.mu.Lock()
		delete(s.active, id)
		s.mu.Unlock()
	}
}

func (s *server) runJob(id string) {
	j, err := s.read(id)
	if err != nil {
		log.Print(err)
		return
	}
	catalog := make(map[string][]string)
	for _, candidate := range s.list() {
		if candidate.Status != "done" {
			continue
		}
		if candidate.Separation == "succeeded" && candidate.CacheKey != "" {
			catalog[candidate.CacheKey] = append(catalog[candidate.CacheKey], candidate.ID)
		}
		if candidate.MusicCacheKey != "" {
			catalog[candidate.MusicCacheKey] = append(catalog[candidate.MusicCacheKey], candidate.ID)
		}
	}
	data, _ := json.Marshal(catalog)
	// Keep the HTTP request open until Python confirms cleanup after cancellation.
	ctx, cancel := context.WithTimeout(context.Background(), s.timeout+time.Minute)
	defer cancel()
	timer := time.AfterFunc(s.timeout, func() { s.requestRunningCancel(id) })
	defer timer.Stop()
	r, _ := http.NewRequestWithContext(ctx, http.MethodPost, "http://worker/internal/process/"+id, bytes.NewReader(data))
	r.Header.Set("Content-Type", "application/json")
	resp, err := s.client.Do(r)
	if err == nil {
		_, _ = io.Copy(io.Discard, resp.Body)
		resp.Body.Close()
		if resp.StatusCode == 200 {
			return
		}
		err = fmt.Errorf("worker returned %s", resp.Status)
	}
	log.Printf("job %s: %v", id, err)
	// On transport loss the worker may still be active. Keep its files protected
	// until a worker-written terminal state or server restart is observed.
	if latest, readErr := s.read(id); readErr == nil && latest.Status == "queued" {
		// The worker did not start this job (connection refused).
		var op *os.SyscallError
		if errors.As(err, &op) {
			s.failJob(j, "Python 워커에서 작업을 시작할 수 없습니다.")
		}
	}
}

func (s *server) requestRunningCancel(id string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if a := s.active[id]; a != nil && a.running && !a.cancelled {
		if err := s.markCancel(id); err != nil {
			log.Print(err)
			return
		}
		a.cancelled = true
	}
}

func (s *server) markCancel(id string) error {
	return os.WriteFile(filepath.Join(s.jobDir(id), ".cancel"), nil, 0600)
}

func (s *server) stopQueue() {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.closing = true
	for id, a := range s.active {
		if a.running {
			_ = s.markCancel(id)
			continue
		}
		if j, err := s.read(id); err == nil {
			s.failJob(j, "서버 종료로 대기 중인 작업이 취소되었습니다.")
		}
		delete(s.active, id)
	}
	close(s.queue)
}
