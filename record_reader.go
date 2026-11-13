package main

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
)

func loadLaneRecord(home, id string, lane *Lane) error {
	name := id + ".lane.json"
	data, err := os.ReadFile(filepath.Join(home, "state", name))
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return fmt.Errorf("read lane record %s: %w", name, err)
	}
	record, invalid, err := ParseLaneRecord(data)
	if err != nil {
		return fmt.Errorf("invalid lane record %s: %w", name, err)
	}
	applyLaneRecord(lane, &record, invalid)
	return nil
}

func applyLaneRecord(lane *Lane, record *LaneRecord, invalid int) {
	lane.Record = record
	lane.InvalidAsks = invalid
	lane.HadRecordAsks = len(record.Asks) > 0
	lane.Title = record.Name
	lane.State = record.State
	lane.UpdatedAt = record.Start
	lane.Events = nil
	lane.Decisions = nil
	for _, change := range record.History {
		lane.Events = append(lane.Events, Event{Verb: change.State, At: change.At, Text: change.Text})
		if change.At.After(lane.UpdatedAt) {
			lane.UpdatedAt = change.At
		}
	}
}
