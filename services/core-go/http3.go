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

/*
#include <stdlib.h>

// Callback para quando dados chegam: ID da conexão + Ponteiro binário + Tamanho
typedef void (*OnDataCallback)(int connID, void* data, int length);

// Callback para quando uma conexão fecha
typedef void (*OnCloseCallback)(int connID);

// Helper para chamar o ponteiro de função do C passando tamanho
static void dispatch_data(OnDataCallback cb, int connID, void* msg, int len) {
    if (cb) {
        cb(connID, msg, len);
    }
}

static void dispatch_close(OnCloseCallback cb, int connID) {
    if (cb) {
        cb(connID);
    }
}
*/
import "C"

import (
	"bufio"
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httputil"
	"os"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"
	"unsafe"

	"github.com/quic-go/quic-go/http3"

	"core-go/cache"
	"core-go/security"
	"core-go/traffic"
	"core-go/utils"
)

type ProxyConnection interface {
	Write(p []byte) (n int, err error)
	Close() error
}

var (
	conns        = make(map[int]ProxyConnection)
	nextID int64 = 0
	mutex  sync.Mutex
)

/* -----------------------------
    Helpers (ports)
------------------------------ */

func normalizeAddrPort(p string) string {
	p = strings.TrimSpace(p)
	if p == "" {
		return ""
	}
	if !strings.Contains(p, ":") {
		return ":" + p
	}
	return p
}

func extractPortOnly(addr string) string {
	addr = strings.TrimSpace(addr)
	if addr == "" {
		return ""
	}
	if !strings.Contains(addr, ":") {
		return addr
	}
	_, port, err := net.SplitHostPort(addr)
	if err == nil && port != "" {
		return port
	}
	parts := strings.Split(addr, ":")
	return parts[len(parts)-1]
}

// getFreePort verifica se a porta está livre. Se não estiver, tenta até 10 portas à frente.
func getFreePort(network, addr string) (string, error) {
	host, portStr, err := net.SplitHostPort(addr)
	if err != nil {
		host = ""
		portStr = strings.TrimPrefix(addr, ":")
	}
	port, err := strconv.Atoi(portStr)
	if err != nil {
		return "", fmt.Errorf("invalid port format: %s", portStr)
	}

	for i := 0; i < 10; i++ {
		tryAddr := fmt.Sprintf("%s:%d", host, port+i)
		if network == "tcp" {
			ln, err := net.Listen("tcp", tryAddr)
			if err == nil {
				ln.Close() // Fecha para o ListenAndServe poder usar logo em seguida
				return tryAddr, nil
			}
		} else if network == "udp" {
			pc, err := net.ListenPacket("udp", tryAddr)
			if err == nil {
				pc.Close()
				return tryAddr, nil
			}
		}
	}
	return "", fmt.Errorf("could not find an available %s port starting from %s", network, addr)
}

//export StartServer
func StartServer(
	httpPortC *C.char,
	httpsPortC *C.char,
	certPathC *C.char,
	keyPathC *C.char,
	onData C.OnDataCallback,
	onClose C.OnCloseCallback,
	http3PortC *C.char,
	dev *C.char,
) *C.char {

	// Helper para retornar erro pro Node.js de forma estruturada (JSON)
	sendJSONError := func(msg string) *C.char {
		res := map[string]string{"error": msg}
		b, _ := json.Marshal(res)
		return C.CString(string(b))
	}

	httpPort := normalizeAddrPort(C.GoString(httpPortC))
	httpsPort := normalizeAddrPort(C.GoString(httpsPortC))
	certPath := C.GoString(certPathC)
	keyPath := C.GoString(keyPathC)
	http3Port := normalizeAddrPort(C.GoString(http3PortC))

	devMode := C.GoString(dev) == "true"
	useSSL := certPath != "" && keyPath != ""

	if useSSL && httpsPort == "" {
		return sendJSONError("HTTPS port required for SSL mode")
	}
	if !useSSL && httpPort == "" {
		return sendJSONError("HTTP port required for Non-SSL mode")
	}

	// Validação de certificados SSL ANTES de tentar rodar o servidor
	if useSSL {
		if _, err := os.Stat(certPath); err != nil {
			return sendJSONError(fmt.Sprintf("Certificate file not found at %s: %v", certPath, err))
		}
		if _, err := os.Stat(keyPath); err != nil {
			return sendJSONError(fmt.Sprintf("Key file not found at %s: %v", keyPath, err))
		}
	}

	// --- Verificação de Portas e Fallback (Profissional) ---
	var _ error
	if useSSL {
		if httpsPort != "" {
			newPort, err := getFreePort("tcp", httpsPort)
			if err != nil {
				return sendJSONError(fmt.Sprintf("HTTPS Port Error: %v", err))
			}
			if newPort != httpsPort {
				utils.Warn(fmt.Sprintf("[Port Fallback] HTTPS port %s in use, falling back to %s", httpsPort, newPort))
				httpsPort = newPort
			}
		}
		if httpPort != "" { // Redirect Port
			newPort, err := getFreePort("tcp", httpPort)
			if err != nil {
				return sendJSONError(fmt.Sprintf("HTTP Redirect Port Error: %v", err))
			}
			if newPort != httpPort {
				utils.Warn(fmt.Sprintf("[Port Fallback] HTTP redirect port %s in use, falling back to %s", httpPort, newPort))
				httpPort = newPort
			}
		}
		if http3Port != "" {
			newPort, err := getFreePort("udp", http3Port)
			if err != nil {
				return sendJSONError(fmt.Sprintf("HTTP/3 Port Error: %v", err))
			}
			if newPort != http3Port {
				utils.Warn(fmt.Sprintf("[Port Fallback] HTTP/3 port %s in use, falling back to %s", http3Port, newPort))
				http3Port = newPort
			}
		}
	} else {
		if httpPort != "" {
			newPort, err := getFreePort("tcp", httpPort)
			if err != nil {
				return sendJSONError(fmt.Sprintf("HTTP Port Error: %v", err))
			}
			if newPort != httpPort {
				utils.Warn(fmt.Sprintf("[Port Fallback] HTTP port %s in use, falling back to %s", httpPort, newPort))
				httpPort = newPort
			}
		}
	}

	// --- Preparação do Alt-Svc Header com as portas RESOLVIDAS ---
	var altSvcHeader string
	var debugH3Port string

	if http3Port != "" {
		h3PortOnly := extractPortOnly(http3Port)
		if h3PortOnly != "" {
			debugH3Port = h3PortOnly
			altSvcHeader = fmt.Sprintf(`h3=":%s"; ma=2592000, h3-29=":%s"; ma=2592000`, h3PortOnly, h3PortOnly)
		} else {
			utils.Warn("[Native] HTTP/3 Port string is invalid or empty.")
		}
	}

	cache.StartJanitor()

	nodeBridgeHandler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		id := int(atomic.AddInt64(&nextID, 1))

		isUpgrade := false
		if strings.ToLower(r.Header.Get("Connection")) == "upgrade" &&
			strings.ToLower(r.Header.Get("Upgrade")) == "websocket" {
			isUpgrade = true
		}

		if isUpgrade {
			hijacker, ok := w.(http.Hijacker)
			if !ok {
				http.Error(w, "Websocket not supported by server interface", http.StatusInternalServerError)
				return
			}

			clientConn, _, err := hijacker.Hijack()
			if err != nil {
				http.Error(w, err.Error(), http.StatusInternalServerError)
				return
			}

			mutex.Lock()
			conns[id] = clientConn
			mutex.Unlock()

			defer func() {
				mutex.Lock()
				delete(conns, id)
				mutex.Unlock()
				clientConn.Close()
				C.dispatch_close(onClose, C.int(id))
			}()

			r.Proto = "HTTP/1.1"
			r.ProtoMajor = 1
			r.ProtoMinor = 1

			dump, err := httputil.DumpRequest(r, false)
			if err == nil {
				cHeaders := C.CBytes(dump)
				C.dispatch_data(onData, C.int(id), cHeaders, C.int(len(dump)))
				C.free(cHeaders)
			}

			buf := make([]byte, 32*1024)
			for {
				clientConn.SetReadDeadline(time.Now().Add(60 * time.Minute))
				n, err := clientConn.Read(buf)
				if n > 0 {
					chunk := C.CBytes(buf[:n])
					C.dispatch_data(onData, C.int(id), chunk, C.int(n))
					C.free(chunk)
				}
				if err != nil {
					break
				}
			}
			return
		}

		pr, pw := io.Pipe()

		mutex.Lock()
		conns[id] = pw
		mutex.Unlock()

		defer func() {
			mutex.Lock()
			delete(conns, id)
			mutex.Unlock()
			pw.Close()
			C.dispatch_close(onClose, C.int(id))
		}()

		r.Proto = "HTTP/1.1"
		r.ProtoMajor = 1
		r.ProtoMinor = 1

		dump, err := httputil.DumpRequest(r, false)
		if err != nil {
			http.Error(w, "Internal Proxy Error", http.StatusInternalServerError)
			return
		}

		cHeaders := C.CBytes(dump)
		C.dispatch_data(onData, C.int(id), cHeaders, C.int(len(dump)))
		C.free(cHeaders)

		go func() {
			buf := make([]byte, 32*1024)
			for {
				n, err := r.Body.Read(buf)
				if n > 0 {
					chunk := C.CBytes(buf[:n])
					C.dispatch_data(onData, C.int(id), chunk, C.int(n))
					C.free(chunk)
				}
				if err != nil {
					break
				}
			}
		}()

		resp, err := http.ReadResponse(bufio.NewReader(pr), r)
		if err != nil {
			utils.Error("Error reading response from Node: ", err)
			return
		}
		defer resp.Body.Close()

		shouldCache := r.Method == "GET" && resp.StatusCode == 200 && cache.IsCacheable(r.URL.Path)
		var bodyReader io.Reader = resp.Body

		if shouldCache && !devMode {
			limitR := io.LimitReader(resp.Body, int64(cache.MaxFileSize)+1)
			b, err := io.ReadAll(limitR)
			if err == nil && len(b) <= cache.MaxFileSize {
				headerClone := make(http.Header)
				for k, vv := range resp.Header {
					lowerK := strings.ToLower(k)
					if lowerK == "connection" || lowerK == "keep-alive" || lowerK == "proxy-connection" ||
						lowerK == "transfer-encoding" || lowerK == "upgrade" || lowerK == "alt-svc" {
						continue
					}
					for _, v := range vv {
						headerClone.Add(k, v)
					}
				}

				cache.Store.Lock()
				cache.Store.Items[r.URL.String()] = &cache.Item{
					Body:       b,
					Headers:    headerClone,
					Expiration: time.Now().Add(cache.TTL),
				}
				cache.Store.Unlock()
				bodyReader = bytes.NewReader(b)
			} else {
				if len(b) > 0 {
					bodyReader = io.MultiReader(bytes.NewReader(b), resp.Body)
				}
			}
		}

		for k, v := range resp.Header {
			lowerK := strings.ToLower(k)
			if lowerK == "connection" || lowerK == "keep-alive" || lowerK == "proxy-connection" ||
				lowerK == "transfer-encoding" || lowerK == "upgrade" || lowerK == "alt-svc" {
				continue
			}
			for _, val := range v {
				w.Header().Add(k, val)
			}
		}

		if altSvcHeader != "" {
			w.Header().Set("Alt-Svc", altSvcHeader)
			if devMode && debugH3Port != "" {
				w.Header().Set("X-Nytlex-H3-Port", debugH3Port)
			}
		}

		w.WriteHeader(resp.StatusCode)
		io.Copy(w, bodyReader)
	})

	mainHandler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if err := security.AnalyzeRequest(r); err != nil {
			utils.Warn("[SECURITY] Blocked ", r.RemoteAddr, err)
			http.Error(w, "Nytlex Shield: Request Blocked", http.StatusForbidden)
			return
		}

		if r.Method == "GET" && r.Header.Get("Upgrade") == "" && cache.IsCacheable(r.URL.Path) {
			cache.Store.RLock()
			item, ok := cache.Store.Items[r.URL.String()]
			cache.Store.RUnlock()

			if ok {
				for k, v := range item.Headers {
					for _, val := range v {
						w.Header().Add(k, val)
					}
				}
				w.Header().Set("X-Nytlex-Cache", "HIT")

				if altSvcHeader != "" {
					w.Header().Set("Alt-Svc", altSvcHeader)
					if devMode && debugH3Port != "" {
						w.Header().Set("X-Nytlex-H3-Port", debugH3Port)
					}
				}

				w.WriteHeader(http.StatusOK)
				w.Write(item.Body)
				return
			}
		}

		if r.Header.Get("Upgrade") != "" {
			nodeBridgeHandler.ServeHTTP(w, r)
			return
		}

		traffic.ServeFusion(w, r, nodeBridgeHandler)
	})

	go func() {
		errChan := make(chan error, 3)

		if useSSL {
			if http3Port != "" {
				utils.Info("Starting HTTP/3 Server on " + http3Port + "...")
				go func() {
					serverH3 := http3.Server{
						Addr:    http3Port,
						Handler: mainHandler,
					}
					errChan <- serverH3.ListenAndServeTLS(certPath, keyPath)
				}()
			}

			go func() {
				errChan <- http.ListenAndServeTLS(httpsPort, certPath, keyPath, mainHandler)
			}()

			if httpPort != "" {
				go func() {
					redirectHandler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
						target := "https://" + r.Host + r.URL.Path
						if len(r.URL.RawQuery) > 0 {
							target += "?" + r.URL.RawQuery
						}
						if altSvcHeader != "" {
							w.Header().Set("Alt-Svc", altSvcHeader)
						}
						http.Redirect(w, r, target, http.StatusMovedPermanently)
					})
					errChan <- http.ListenAndServe(httpPort, redirectHandler)
				}()
			}
		} else {
			errChan <- http.ListenAndServe(httpPort, mainHandler)
		}

		err := <-errChan
		if err != nil {
			utils.Error("Server Error:", err)
		}
	}()

	// Em vez de retornar nil, retornamos JSON com as portas validadas pro Node.js!
	successResult := map[string]string{
		"status":    "ok",
		"httpPort":  httpPort,
		"httpsPort": httpsPort,
		"http3Port": http3Port,
	}
	b, _ := json.Marshal(successResult)
	return C.CString(string(b))
}

//export WriteToConn
func WriteToConn(connID C.int, dataPtr unsafe.Pointer, length C.int) *C.char {
	id := int(connID)
	data := C.GoBytes(dataPtr, length)

	mutex.Lock()
	conn, exists := conns[id]
	mutex.Unlock()

	if !exists {
		return C.CString("Connection not found (request ended)")
	}

	_, err := conn.Write(data)
	if err != nil {
		return C.CString(fmt.Sprintf("Write error: %v", err))
	}
	return nil
}

//export CloseConn
func CloseConn(connID C.int) {
	id := int(connID)

	mutex.Lock()
	conn, exists := conns[id]
	if exists {
		conn.Close()
		delete(conns, id)
	}
	mutex.Unlock()
}
