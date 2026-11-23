package main

import (
	"bytes"
	"encoding/json"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func testServer(t *testing.T) *server {
	t.Helper()
	s := &server{root: t.TempDir(), maxBytes: 64, maxPending: 2, queue: make(chan string, 2), active: make(map[string]*activeJob)}
	for _, folder := range []string{"jobs", "uploads", "exports"} {
		if e := os.Mkdir(filepath.Join(s.root, folder), 0700); e != nil {
			t.Fatal(e)
		}
	}
	return s
}

func submit(t *testing.T, handler http.Handler, name, content string) *httptest.ResponseRecorder {
	t.Helper()
	var body bytes.Buffer
	form := multipart.NewWriter(&body)
	part, err := form.CreateFormFile("file", name)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = part.Write([]byte(content)); err != nil {
		t.Fatal(err)
	}
	if err = form.Close(); err != nil {
		t.Fatal(err)
	}
	req := httptest.NewRequest("POST", "/api/jobs", &body)
	req.Header.Set("Content-Type", form.FormDataContentType())
	resp := httptest.NewRecorder()
	handler.ServeHTTP(resp, req)
	return resp
}

func TestUploadDedupeCancelAndLegacyDelete(t *testing.T) {
	s := testServer(t)
	handler := s.routes()
	initial := submit(t, handler, "sample.wav", "test")
	duplicate := submit(t, handler, "sample.wav", "test")
	var a, b job
	if initial.Code != 200 || duplicate.Code != 200 || json.Unmarshal(initial.Body.Bytes(), &a) != nil ||
		json.Unmarshal(duplicate.Body.Bytes(), &b) != nil || a.ID != b.ID || len(s.queue) != 1 {
		t.Fatalf("duplicate upload %d %s / %d %s", initial.Code, initial.Body, duplicate.Code, duplicate.Body)
	}
	if resp := submit(t, handler, "large.wav", strings.Repeat("0", 65)); resp.Code != 413 {
		t.Fatalf("size limit returned %d", resp.Code)
	}
	s.active[a.ID].running = true
	path := "/api/jobs/" + a.ID
	resp := httptest.NewRecorder()
	handler.ServeHTTP(resp, httptest.NewRequest("DELETE", path, nil))
	if resp.Code != 409 {
		t.Fatalf("running delete returned %d", resp.Code)
	}
	resp = httptest.NewRecorder()
	handler.ServeHTTP(resp, httptest.NewRequest("POST", path+"/cancel", nil))
	if resp.Code != 202 {
		t.Fatalf("running cancel returned %d", resp.Code)
	}
	if _, err := os.Stat(filepath.Join(s.jobDir(a.ID), ".cancel")); err != nil {
		t.Fatal(err)
	}
	s.active[a.ID].running = false
	resp = httptest.NewRecorder()
	handler.ServeHTTP(resp, httptest.NewRequest("POST", "/api/jobs/delete/"+a.ID, nil))
	if resp.Code != 204 {
		t.Fatalf("legacy delete returned %d", resp.Code)
	}
}
