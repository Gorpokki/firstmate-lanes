package main

import (
	"encoding/json"
	"io"
	"net/http"
	"strings"
)

func answerHandler(service *AnswerService) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			w.Header().Set("Allow", "POST")
			http.Error(w, "POST required", http.StatusMethodNotAllowed)
			return
		}
		if r.Header.Get("X-Fleet-Action") != "confirm" || !strings.HasPrefix(r.Header.Get("Content-Type"), "application/json") {
			http.Error(w, "explicit JSON confirmation required", http.StatusBadRequest)
			return
		}
		r.Body = http.MaxBytesReader(w, r.Body, 64<<10)
		var request struct {
			Confirmed bool            `json:"confirmed"`
			Answers   []SittingAnswer `json:"answers"`
		}
		decoder := json.NewDecoder(r.Body)
		decoder.DisallowUnknownFields()
		if err := decoder.Decode(&request); err != nil {
			http.Error(w, "invalid sitting", http.StatusBadRequest)
			return
		}
		var extra any
		if err := decoder.Decode(&extra); err != io.EOF {
			http.Error(w, "invalid sitting", http.StatusBadRequest)
			return
		}
		results, err := service.Send(r.Context(), request.Confirmed, request.Answers)
		if err != nil {
			http.Error(w, "cannot send sitting: "+err.Error(), http.StatusBadRequest)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Cache-Control", "no-store")
		json.NewEncoder(w).Encode(results)
	})
}
