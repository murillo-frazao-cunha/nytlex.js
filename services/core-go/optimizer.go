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
package main

import "C"
import (
	"bufio"
	"compress/gzip"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/andybalholm/brotli"
	"github.com/evanw/esbuild/pkg/api"
)

//export Optimize
func Optimize(targetDirC *C.char, outputDirC *C.char, ignoredPatternsC *C.char, sslC *C.char) *C.char {
	targetDir := C.GoString(targetDirC)
	outputDir := C.GoString(outputDirC)
	ignoredPatternsStr := C.GoString(ignoredPatternsC)
	ssl := C.GoString(sslC)
	var ignoredList []string
	if ignoredPatternsStr != "" {
		ignoredList = strings.Split(ignoredPatternsStr, ",")
	}

	if outputDir == "" {
		outputDir = filepath.Join(targetDir, "optimized")
	}

	var entryPoints []string

	err := filepath.Walk(targetDir, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return nil
		}

		if strings.Contains(path, "node_modules") {
			if info.IsDir() {
				return filepath.SkipDir
			}
			return nil
		}

		for _, ignoreItem := range ignoredList {
			cleanIgnore := strings.TrimSpace(ignoreItem)
			if cleanIgnore != "" && strings.Contains(path, cleanIgnore) {
				if info.IsDir() {
					return filepath.SkipDir
				}
				return nil
			}
		}

		if info.IsDir() {
			return nil
		}

		if strings.Contains(path, outputDir) || strings.Contains(path, "optimized") {
			return nil
		}

		if strings.HasSuffix(info.Name(), ".js") {
			entryPoints = append(entryPoints, path)
		}
		return nil
	})

	if len(entryPoints) == 0 {
		msg := fmt.Sprintf("No .js files found in: %s", targetDir)
		return C.CString(msg)
	}

	result := api.Build(api.BuildOptions{
		EntryPoints:       entryPoints,
		Outdir:            outputDir,
		Outbase:           targetDir,              // Mantém a estrutura original de pastas
		ChunkNames:        "chunks/[name]-[hash]", // Garante os chunks dentro de /chunks
		Bundle:            true,
		Splitting:         true,
		Format:            api.FormatESModule,
		TreeShaking:       api.TreeShakingTrue,
		MinifyWhitespace:  true,
		MinifyIdentifiers: true,
		MinifySyntax:      true,
		LegalComments:     api.LegalCommentsNone,
		Define: map[string]string{
			"process.env.NODE_ENV":            "\"production\"",
			"import.meta.env.MODE":            "\"production\"",
			"import.meta.env.DEV":             "false",
			"import.meta.env.PROD":            "true",
			"__DEV__":                         "false",
			"__PROD__":                        "true",
			"__VUE_OPTIONS_API__":             "false",
			"__VUE_PROD_DEVTOOLS__":           "false",
			"globalThis.process.env.NODE_ENV": "\"production\"",
		},
		Target: api.ES2020,
		Write:  true,
		External: []string{
			"*.vue", "*.css", "*.woff2", "*.woff", "*.ttf", "*.eot", "*.svg", "*.png", "*.jpg", "*.jpeg", "*.gif",
			"react", "react-dom", "scheduler",
			"vue", "@vue/*",
		},
	})

	if len(result.Errors) > 0 {
		var sb strings.Builder
		sb.WriteString("Error in optimization (esbuild):\n")
		for _, err := range result.Errors {
			line := fmt.Sprintf("%s:%d: %s\n", err.Location.File, err.Location.Line, err.Text)
			sb.WriteString(line)
		}
		return C.CString(sb.String())
	}

	// --- OTIMIZAÇÃO: PROCESSAMENTO CONCORRENTE DE COMPRESSÃO ---

	var filesToCompress []string
	err = filepath.Walk(outputDir, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		if !info.IsDir() && strings.HasSuffix(info.Name(), ".js") {
			filesToCompress = append(filesToCompress, path)
		}
		return nil
	})

	if err != nil {
		return C.CString(fmt.Sprintf(" Error walking output dir: %v", err))
	}

	var wg sync.WaitGroup
	errCh := make(chan error, len(filesToCompress)+1)

	for _, file := range filesToCompress {
		wg.Add(1)

		go func(filePath string) {
			defer wg.Done()
			fileName := filepath.Base(filePath)

			if ssl == "true" {
				if err := compressToBrotli(filePath); err != nil {
					errCh <- fmt.Errorf("brotli failure %s: %v", fileName, err)
					return
				}
			} else {
				if err := compressToGzip(filePath); err != nil {
					errCh <- fmt.Errorf("gzip failure %s: %v", fileName, err)
					return
				}
			}

			// Primeira tentativa de deleção
			os.Remove(filePath)
		}(file)
	}

	wg.Wait()
	close(errCh)

	// --- GARANTIA MÁXIMA (DOUBLE-TAP NO WINDOWS) ---
	// O Windows costuma segurar o lock do arquivo e a goroutine pode falhar.
	// Então forçamos a deleção de tudo novamente após todas as threads fecharem.
	for _, file := range filesToCompress {
		os.Remove(file)
	}
	time.Sleep(500 * time.Millisecond) // Pequena pausa para garantir que o sistema operacional libere os locks
	// Pente fino final: varre a pasta novamente e extermina qualquer .js teimoso
	err = filepath.Walk(targetDir, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return nil
		}

		if !info.IsDir() && strings.HasSuffix(info.Name(), ".js") {
			os.Remove(path)
		}

		return nil
	})

	var errs []string
	for e := range errCh {
		errs = append(errs, e.Error())
	}
	if len(errs) > 0 {
		return C.CString(" Compression errors:\n" + strings.Join(errs, "\n"))
	}

	os.RemoveAll(filepath.Join(outputDir, "temp"))

	return nil
}

func compressToGzip(srcPath string) error {
	srcFile, err := os.Open(srcPath)
	if err != nil {
		return err
	}
	defer srcFile.Close()

	dstFile, err := os.Create(srcPath + ".gz")
	if err != nil {
		return err
	}
	defer dstFile.Close()

	bufReader := bufio.NewReader(srcFile)
	bufWriter := bufio.NewWriter(dstFile)
	defer bufWriter.Flush()

	writer, _ := gzip.NewWriterLevel(bufWriter, gzip.BestCompression)
	defer writer.Close()

	_, err = io.Copy(writer, bufReader)
	return err
}

func compressToBrotli(srcPath string) error {
	srcFile, err := os.Open(srcPath)
	if err != nil {
		return err
	}
	defer srcFile.Close()

	dstFile, err := os.Create(srcPath + ".br")
	if err != nil {
		return err
	}
	defer dstFile.Close()

	bufReader := bufio.NewReader(srcFile)
	bufWriter := bufio.NewWriter(dstFile)
	defer bufWriter.Flush()

	writer := brotli.NewWriterLevel(bufWriter, brotli.BestCompression)
	defer writer.Close()

	_, err = io.Copy(writer, bufReader)
	return err
}
