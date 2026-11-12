package main

import (
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

type homeSource struct{ Alias, Path string }

func homeSources(home string) ([]homeSource, error) {
	home, err := filepath.Abs(home)
	if err != nil {
		return nil, err
	}
	home, err = filepath.EvalSymlinks(home)
	if err != nil {
		return nil, err
	}
	out := []homeSource{{Alias: "main", Path: home}}
	visited := map[string]bool{home: true}
	for _, line := range lines(filepath.Join(home, "data", "secondmates.md")) {
		match := mateRe.FindStringSubmatch(line)
		if match == nil || !slugRe.MatchString(match[1]) {
			continue
		}
		_, tail, ok := strings.Cut(match[2], "(home:")
		if !ok {
			continue
		}
		path, _, _ := strings.Cut(tail, ";")
		path, _, _ = strings.Cut(path, ")")
		path = strings.TrimSpace(path)
		if path == "" {
			continue
		}
		if !filepath.IsAbs(path) {
			path = filepath.Join(home, path)
		}
		path, err = filepath.EvalSymlinks(path)
		if err != nil {
			return nil, fmt.Errorf("registered home %s unavailable: %w", match[1], err)
		}
		if visited[path] {
			continue
		}
		visited[path] = true
		out = append(out, homeSource{Alias: match[1], Path: path})
	}
	return out, nil
}

// LoadFleet reads main and registered homes, plus optional local lane drop-ins.
func (r *Reader) LoadFleet(home string) ([]Lane, error) {
	if err := r.loadReceipts(); err != nil {
		return nil, err
	}
	sources, err := homeSources(home)
	if err != nil {
		return nil, err
	}
	var out []Lane
	for _, source := range sources {
		lanes, err := r.Load(source.Path)
		if err != nil {
			return nil, fmt.Errorf("read home %s: %w", source.Alias, err)
		}
		for _, lane := range lanes {
			lane.Home = source.Alias
			if source.Alias != "main" {
				lane.ID = source.Alias + "/" + lane.ID
				lane.SecondMate = source.Alias
			}
			out = append(out, lane)
		}
	}
	if r.DropIn != "" {
		if _, err := os.Stat(filepath.Join(r.DropIn, "lanes")); err == nil {
			local, err := LoadLaneDropins(r.DropIn)
			if err != nil {
				return nil, err
			}
			for i := range local {
				local[i].ID = "local/" + local[i].ID
				local[i].Home = "local"
				local[i].OwnerDir = ""
			}
			out = append(out, local...)
		} else if !os.IsNotExist(err) {
			return nil, err
		}
	}
	r.removeAccepted(out)
	sort.SliceStable(out, func(i, j int) bool { return out[i].ID < out[j].ID })
	return out, nil
}

func (r *Reader) removeAccepted(lanes []Lane) {
	r.mu.Lock()
	defer r.mu.Unlock()
	for i := range lanes {
		lane := &lanes[i]
		if lane.Record != nil {
			kept := lane.Record.Asks[:0]
			for _, ask := range lane.Record.Asks {
				if at, ok := r.accepted[receiptID(lane.OwnerDir, lane.ID, ask.Key)]; !ok || !at.Equal(ask.Asked) {
					kept = append(kept, ask)
				}
			}
			lane.Record.Asks = kept
		}
		kept := lane.Decisions[:0]
		for _, ask := range lane.Decisions {
			if at, ok := r.accepted[receiptID(lane.OwnerDir, lane.ID, ask.Key)]; !ok || !at.Equal(ask.At) {
				kept = append(kept, ask)
			}
		}
		lane.Decisions = kept
	}
}
