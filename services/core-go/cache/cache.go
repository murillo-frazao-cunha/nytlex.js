/*
 * This file is part of the Nytlex.js Project.
 * Copyright (c) 2026 mfraz
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
package cache

import (
	"net/http"
	"strings"
	"sync"
	"time"
)

const (
	TTL             = 5 * time.Minute
	CleanupInterval = 1 * time.Minute
	MaxItems        = 5000
	MaxFileSize     = 5 * 1024 * 1024
)

type Item struct {
	Body        []byte
	ContentType string
	Encoding    string
	Headers     http.Header
	Expiration  time.Time
}

var Store = struct {
	sync.RWMutex
	Items map[string]*Item
}{
	Items: make(map[string]*Item),
}

func StartJanitor() {
	go func() {
		for {
			time.Sleep(CleanupInterval)
			now := time.Now()
			Store.Lock()
			for key, item := range Store.Items {
				if now.After(item.Expiration) {
					delete(Store.Items, key)
				}
			}
			Store.Unlock()
		}
	}()
}

func IsCacheable(path string) bool {
	exts := []string{".js", ".css", ".png", ".jpg", ".jpeg", ".gif", ".svg", ".woff2", ".ttf", ".ico"}
	for _, ext := range exts {
		if strings.HasSuffix(path, ext) {
			return true
		}
	}
	return strings.Contains(path, "/_nytlex/")
}
