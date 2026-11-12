package main

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"syscall"
	"time"
)

func readReceipts(path string) (map[string]time.Time, error) {
	data, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return map[string]time.Time{}, nil
	}
	if err != nil {
		return nil, err
	}
	var receipts map[string]time.Time
	if err = json.Unmarshal(data, &receipts); err != nil {
		return nil, err
	}
	if receipts == nil {
		receipts = map[string]time.Time{}
	}
	return receipts, nil
}
func (r *Reader) loadReceipts() error {
	if r.receiptPath == "" {
		return nil
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	receipts, err := readReceipts(r.receiptPath)
	if err != nil {
		return err
	}
	r.accepted = receipts
	return nil
}
func (r *Reader) acknowledge(home, key string, asked time.Time) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	id := home + "\x00" + key
	if r.accepted == nil {
		r.accepted = map[string]time.Time{}
	}
	r.accepted[id] = asked
	if r.receiptPath == "" {
		return nil
	}
	if err := os.MkdirAll(filepath.Dir(r.receiptPath), 0700); err != nil {
		return err
	}
	lock, err := os.OpenFile(r.receiptPath+".lock", os.O_CREATE|os.O_RDWR, 0600)
	if err != nil {
		return err
	}
	defer lock.Close()
	if err = syscall.Flock(int(lock.Fd()), syscall.LOCK_EX); err != nil {
		return err
	}
	defer syscall.Flock(int(lock.Fd()), syscall.LOCK_UN)
	receipts, err := readReceipts(r.receiptPath)
	if err != nil {
		return err
	}
	receipts[id] = asked
	if err = writePrivateJSON(r.receiptPath, receipts); err != nil {
		return err
	}
	r.accepted = receipts
	return nil
}
