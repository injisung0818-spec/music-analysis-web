package main

import (
	"archive/zip"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"mime"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"strings"
	"unicode"
)

var stems = []string{"vocals", "drums", "bass", "guitar", "piano", "other"}
var assetName = regexp.MustCompile(`^(stems/[a-z]+\.(wav|flac|m4a)|midi/[a-z_]+\.mid)$`)
var formParts = []string{"http", "https"}

func (s *server) routes() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/health", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Music-Backend", "go")
		s.proxy.ServeHTTP(w, r)
	})
	mux.HandleFunc("POST /api/jobs", s.upload)
	mux.HandleFunc("GET /api/jobs", func(w http.ResponseWriter, r *http.Request) {
		entries := s.list()
		result := make([]job, 0, len(entries))
		for _, entry := range entries {
			result = append(result, entry.job)
		}
		respond(w, 200, result)
	})
	mux.HandleFunc("GET /api/jobs/{id}", func(w http.ResponseWriter, r *http.Request) {
		if entry, ok := s.requireJob(w, r); ok {
			respond(w, 200, entry.job)
		}
	})
	mux.HandleFunc("DELETE /api/jobs/{id}", s.delete)
	mux.HandleFunc("POST /api/jobs/{id}/{action}", s.jobAction)
	mux.HandleFunc("GET /api/jobs/{id}/analysis", s.delegate)
	mux.HandleFunc("GET /api/jobs/{id}/assets/{asset...}", s.asset)
	mux.HandleFunc("GET /api/jobs/{id}/export/mix", s.delegate)
	mux.HandleFunc("GET /api/jobs/{id}/export/instrumental", s.delegate)
	mux.HandleFunc("GET /api/jobs/{id}/export/stems", s.exportStems)
	mux.HandleFunc("OPTIONS /api/{remaining...}", func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(204) })
	if s.frontend != "" {
		// Only the production React bundle is served from this root.
		mux.Handle("GET /", http.FileServer(http.Dir(s.frontend)))
	}
	return cors(mux)
}

func (s *server) jobAction(w http.ResponseWriter, r *http.Request) {
	if r.PathValue("id") == "delete" {
		r.SetPathValue("id", r.PathValue("action"))
		s.delete(w, r)
		return
	}
	switch r.PathValue("action") {
	case "delete":
		s.delete(w, r)
	case "cancel":
		s.cancel(w, r)
	default:
		fail(w, 404, "작업 동작을 찾을 수 없습니다.")
	}
}

func cors(next http.Handler) http.Handler {
	config := strings.Split(os.Getenv("CORS_ORIGINS"), ",")
	for i := range config {
		config[i] = strings.TrimSpace(config[i])
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")
		if origin != "" {
			w.Header().Add("Vary", "Origin")
			allowed := slices.Contains(config, origin)
			if len(config) == 1 && config[0] == "" {
				u, e := url.Parse(origin)
				allowed = e == nil && slices.Contains(formParts, u.Scheme) &&
					(u.Hostname() == "localhost" || u.Hostname() == "127.0.0.1") &&
					u.User == nil && u.Path == "" && u.RawQuery == "" && u.Fragment == ""
			}
			if allowed {
				w.Header().Set("Access-Control-Allow-Origin", origin)
				w.Header().Set("Access-Control-Allow-Credentials", "true")
				w.Header().Set("Access-Control-Allow-Methods", "GET, HEAD, POST, DELETE, OPTIONS")
				w.Header().Set("Access-Control-Allow-Headers", r.Header.Get("Access-Control-Request-Headers"))
				w.Header().Set("Access-Control-Expose-Headers", "Content-Disposition")
			}
		}
		next.ServeHTTP(w, r)
	})
}

func (s *server) requireJob(w http.ResponseWriter, r *http.Request) (manifest, bool) {
	entry, err := s.read(r.PathValue("id"))
	if errors.Is(err, os.ErrNotExist) {
		fail(w, 404, "작업을 찾을 수 없습니다.")
		return manifest{}, false
	}
	if err != nil {
		log.Print(err)
		fail(w, 500, "작업 정보를 읽을 수 없습니다.")
		return manifest{}, false
	}
	return entry, true
}

func (s *server) delete(w http.ResponseWriter, r *http.Request) {
	s.files.Lock()
	defer s.files.Unlock()
	s.mu.Lock()
	defer s.mu.Unlock()
	j, ok := s.requireJob(w, r)
	if !ok {
		return
	}
	a := s.active[j.ID]
	if j.Status == "running" || (a != nil && a.running) {
		fail(w, 409, "처리 중인 작업입니다. 취소 후 종료되면 삭제할 수 있습니다.")
		return
	}
	delete(s.active, j.ID)
	for _, path := range []string{s.jobDir(j.ID), filepath.Join(s.root, "uploads", j.ID)} {
		if err := os.RemoveAll(path); err != nil {
			log.Print(err)
			fail(w, 500, "작업을 삭제할 수 없습니다.")
			return
		}
	}
	w.WriteHeader(204)
}

func (s *server) cancel(w http.ResponseWriter, r *http.Request) {
	s.mu.Lock()
	defer s.mu.Unlock()
	j, ok := s.requireJob(w, r)
	if !ok {
		return
	}
	a := s.active[j.ID]
	if a == nil || (j.Status != "queued" && j.Status != "running") {
		fail(w, 409, "처리 중이거나 대기 중인 작업만 취소할 수 있습니다.")
		return
	}
	if a.running {
		if err := s.markCancel(j.ID); err != nil {
			log.Print(err)
			fail(w, 500, "취소 요청을 저장할 수 없습니다.")
			return
		}
		a.cancelled = true
		w.WriteHeader(202)
		return
	}
	s.failJob(j, "작업이 취소되었습니다.")
	delete(s.active, j.ID)
	w.WriteHeader(204)
}

func (s *server) delegate(w http.ResponseWriter, r *http.Request) {
	s.files.RLock()
	defer s.files.RUnlock()
	if j, ok := s.requireJob(w, r); ok {
		if j.Status != "done" {
			fail(w, 404, "분석 결과가 아직 준비되지 않았습니다.")
			return
		}
		s.proxy.ServeHTTP(w, r)
	}
}

func (s *server) asset(w http.ResponseWriter, r *http.Request) {
	s.files.RLock()
	defer s.files.RUnlock()
	entry, ok := s.requireJob(w, r)
	if !ok {
		return
	}
	name := r.PathValue("asset")
	if entry.Status != "done" || !assetName.MatchString(name) {
		fail(w, 404, "파일을 찾을 수 없습니다.")
		return
	}
	if entry.Separation == "unverified" {
		s.proxy.ServeHTTP(w, r)
		return
	}
	root, err := os.OpenRoot(s.jobDir(entry.ID))
	if err != nil {
		fail(w, 404, "파일을 찾을 수 없습니다.")
		return
	}
	defer root.Close()
	file, err := root.Open(name)
	if err != nil {
		fail(w, 404, "파일을 찾을 수 없습니다.")
		return
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil || !info.Mode().IsRegular() {
		fail(w, 404, "파일을 찾을 수 없습니다.")
		return
	}
	http.ServeContent(w, r, info.Name(), info.ModTime(), file)
}

type analysisInfo struct {
	Separation string  `json:"separation_status"`
	Error      *string `json:"separation_error"`
	Audio      *struct {
		Frames int64 `json:"frames"`
		Rate   int   `json:"sample_rate"`
	} `json:"stem_audio"`
	BPM  float64 `json:"bpm"`
	Key  string  `json:"key"`
	Mode string  `json:"mode"`
}

func (s *server) exportStems(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	if q.Get("mode") != "zip" || !slices.Contains([]string{"", "wav"}, q.Get("format")) {
		s.delegate(w, r)
		return
	}
	s.files.RLock()
	locked := true
	defer func() {
		if locked {
			s.files.RUnlock()
		}
	}()
	j, ok := s.requireJob(w, r)
	if !ok {
		return
	}
	if j.Status != "done" {
		fail(w, 404, "분석 결과가 아직 준비되지 않았습니다.")
		return
	}
	selected := q["stem"]
	if len(selected) == 0 {
		selected = stems
	}
	ordered := make([]string, 0, len(selected))
	for _, stem := range selected {
		if !slices.Contains(stems, stem) {
			fail(w, 400, "알 수 없는 스템 이름입니다.")
			return
		}
		if !slices.Contains(ordered, stem) {
			ordered = append(ordered, stem)
		}
	}
	req, _ := http.NewRequestWithContext(r.Context(), http.MethodGet, "http://worker/api/jobs/"+j.ID+"/analysis", nil)
	resp, err := s.client.Do(req)
	if err != nil {
		fail(w, 502, "Python 워커에 연결할 수 없습니다.")
		return
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(resp.StatusCode)
		_, _ = io.Copy(w, resp.Body)
		return
	}
	var info analysisInfo
	if err = json.NewDecoder(resp.Body).Decode(&info); err != nil {
		fail(w, 502, "스템 메타데이터를 읽을 수 없습니다.")
		return
	}
	if info.Separation != "succeeded" {
		detail := "확인된 스템 오디오가 없습니다."
		if info.Error != nil {
			detail = *info.Error
		}
		fail(w, 409, detail)
		return
	}
	if info.Audio == nil {
		s.proxy.ServeHTTP(w, r)
		return
	} // Legacy stem alignment uses FFmpeg.
	if info.Audio.Frames <= 0 || info.Audio.Rate <= 0 {
		fail(w, 500, "스템을 정렬할 오디오 길이 정보가 없습니다.")
		return
	}
	s.zipMu.Lock()
	out, err := s.buildZIP(r, j, info, ordered)
	s.zipMu.Unlock()
	if err != nil {
		log.Print(err)
		fail(w, 500, "스템 ZIP을 생성할 수 없습니다.")
		return
	}
	defer os.Remove(out.Name())
	defer out.Close()
	s.files.RUnlock() // The staged ZIP remains valid if the user deletes the job.
	locked = false
	w.Header().Set("Content-Type", "application/zip")
	w.Header().Set("Content-Disposition", mime.FormatMediaType("attachment", map[string]string{"filename": downloadBase(j.Filename) + "-stems.zip"}))
	stat, err := out.Stat()
	if err != nil {
		fail(w, 500, "스템 ZIP을 읽을 수 없습니다.")
		return
	}
	http.ServeContent(w, r, stat.Name(), stat.ModTime(), out)
}

func downloadBase(filename string) string {
	stem := strings.TrimSuffix(filename, filepath.Ext(filename))
	stem = strings.Map(func(r rune) rune {
		if unicode.IsLetter(r) || unicode.IsNumber(r) || strings.ContainsRune(" -_.", r) {
			return r
		}
		return '_'
	}, stem)
	chars := []rune(strings.TrimSpace(stem))
	return valueOr(string(chars[:min(80, len(chars))]), "song")
}

type cancelableReader struct {
	request *http.Request
	reader  io.Reader
}

func (r cancelableReader) Read(b []byte) (int, error) {
	if err := r.request.Context().Err(); err != nil {
		return 0, err
	}
	return r.reader.Read(b)
}

func (s *server) buildZIP(r *http.Request, j manifest, info analysisInfo, selected []string) (*os.File, error) {
	root, err := os.OpenRoot(s.jobDir(j.ID))
	if err != nil {
		return nil, err
	}
	defer root.Close()
	out, err := os.CreateTemp(filepath.Join(s.root, "exports"), "stems-*.zip")
	if err != nil {
		return nil, err
	}
	success := false
	defer func() {
		if !success {
			out.Close()
			os.Remove(out.Name())
		}
	}()
	zipper := zip.NewWriter(out)
	folder := downloadBase(j.Filename) + "-stems/"
	for _, stem := range selected {
		input, err := root.Open("stems/" + stem + ".wav")
		if err != nil {
			return nil, err
		}
		z, err := zipper.Create(folder + stem + ".wav")
		if err == nil {
			_, err = io.Copy(z, cancelableReader{r, input})
		}
		input.Close()
		if err != nil {
			return nil, err
		}
	}
	note, err := zipper.Create(folder + "tempo-info.txt")
	if err != nil {
		return nil, err
	}
	bpm := "--"
	if info.BPM > 0 {
		bpm = fmt.Sprintf("%.3f", info.BPM)
	}
	_, err = fmt.Fprintf(note, "Title: %s\nBPM: %s\nKey: %s\nDuration: %.6f seconds\nSample Count: %d samples at %d Hz\nFiles: aligned WAV stems.\nAbleton: set the project tempo to the BPM above and turn Warp OFF for all imported stems.\n",
		j.Filename, bpm, strings.TrimSpace(valueOr(info.Key, "--")+" "+info.Mode), float64(info.Audio.Frames)/float64(info.Audio.Rate), info.Audio.Frames, info.Audio.Rate)
	if err != nil {
		return nil, err
	}
	if err = zipper.Close(); err != nil {
		return nil, err
	}
	if _, err = out.Seek(0, io.SeekStart); err != nil {
		return nil, err
	}
	success = true
	return out, nil
}
