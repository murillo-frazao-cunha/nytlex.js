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

package utils

import (
	"bufio"
	"fmt"
	"os"
	"strings"
	"sync"
	"time"

	"golang.org/x/term"
)

// --- Colors Enum ---

const (
	Reset      = "\x1b[0m"
	Bright     = "\x1b[1m"
	Dim        = "\x1b[2m"
	Underscore = "\x1b[4m"
	Blink      = "\x1b[5m"
	Reverse    = "\x1b[7m"
	Hidden     = "\x1b[8m"

	FgBlack       = "\x1b[30m"
	FgRed         = "\x1b[31m"
	FgGreen       = "\x1b[32m"
	FgYellow      = "\x1b[33m"
	FgBlue        = "\x1b[34m"
	FgMagenta     = "\x1b[35m"
	FgCyan        = "\x1b[36m"
	FgWhite       = "\x1b[37m"
	FgGray        = "\x1b[90m"
	FgAlmostWhite = "\x1b[38;2;220;220;220m"

	BgBlack   = "\x1b[40m"
	BgRed     = "\x1b[41m"
	BgGreen   = "\x1b[42m"
	BgYellow  = "\x1b[43m"
	BgBlue    = "\x1b[44m"
	BgMagenta = "\x1b[45m"
	BgCyan    = "\x1b[46m"
	BgWhite   = "\x1b[47m"
	BgGray    = "\x1b[100m"
)

// --- Levels Enum ---

type Level string

const (
	LevelError   Level = "ERROR"
	LevelWarn    Level = "WARN"
	LevelInfo    Level = "INFO"
	LevelDebug   Level = "DEBUG"
	LevelSuccess Level = "SUCCESS"
	LevelWait    Level = "WAIT"
)

// --- Dynamic Line ---

type DynamicLine struct {
	id int // Simula o Symbol() usando um ID único
}

func NewDynamicLine(initialContent string) *DynamicLine {
	dl := &DynamicLine{id: generateID()}
	consoleInstance.registerDynamicLine(dl.id, initialContent)
	return dl
}

func (d *DynamicLine) Update(newContent string) {
	consoleInstance.updateDynamicLine(d.id, newContent)
}

func (d *DynamicLine) End(finalContent string) {
	consoleInstance.endDynamicLine(d.id, finalContent)
}

// --- Console Logic ---

type activeLine struct {
	id      int
	content string
}

type console struct {
	activeLines       []*activeLine
	lastRenderedLines int
	mu                sync.Mutex // Mutex para thread-safety em Go
}

var consoleInstance = &console{
	activeLines: make([]*activeLine, 0),
}

// Global ID counter for "Symbols"
var idCounter = 0
var idMu sync.Mutex

func generateID() int {
	idMu.Lock()
	defer idMu.Unlock()
	idCounter++
	return idCounter
}

// --- Renderização ---

func (c *console) redrawDynamicLines() {
	c.mu.Lock()
	defer c.mu.Unlock()

	// Move cursor up if needed
	if c.lastRenderedLines > 0 {
		fmt.Printf("\x1b[%dA", c.lastRenderedLines)
	}
	// Cursor to column 0 and clear screen down
	fmt.Print("\r\x1b[J")

	if len(c.activeLines) > 0 {
		var output strings.Builder
		for _, line := range c.activeLines {
			output.WriteString(c.formatLogInternal(LevelWait, line.content, nil) + "\n")
		}
		fmt.Print(output.String())
	}
	c.lastRenderedLines = len(c.activeLines)
}

func (c *console) writeStatic(content string) {
	c.mu.Lock()
	// Move cursor up
	if c.lastRenderedLines > 0 {
		fmt.Printf("\x1b[%dA", c.lastRenderedLines)
		fmt.Print("\r\x1b[J")
	}

	// Print static content
	fmt.Println(strings.TrimRight(content, "\n"))

	// Redraw dynamic lines below
	if len(c.activeLines) > 0 {
		var output strings.Builder
		for _, line := range c.activeLines {
			output.WriteString(c.formatLogInternal(LevelWait, line.content, nil) + "\n")
		}
		fmt.Print(output.String())
		c.lastRenderedLines = len(c.activeLines)
	} else {
		c.lastRenderedLines = 0
	}
	c.mu.Unlock()
}

func (c *console) formatLogInternal(level Level, message string, color *string) string {
	icon := "•"
	baseColor := FgWhite

	switch level {
	case LevelError:
		icon = "✕"
		baseColor = FgRed
	case LevelWarn:
		icon = "▲"
		baseColor = FgYellow
	case LevelInfo:
		icon = "ⓘ"
		baseColor = FgCyan
	case LevelSuccess:
		icon = "✓"
		baseColor = FgGreen
	case LevelDebug:
		icon = "›"
		baseColor = FgGray
	case LevelWait:
		icon = "○"
		baseColor = FgCyan
	default:
		icon = ""
		if color != nil {
			baseColor = *color
		}
	}

	gray := FgGray
	bold := Bright
	rst := Reset

	timeStr := time.Now().Format("15:04:05")
	levelStr := ""
	if level != LevelWait {
		levelStr = fmt.Sprintf(" %s%s%s", bold, level, rst)
	}

	return fmt.Sprintf(" %s%s%s  %s%s%s%s  %s", gray, timeStr, rst, baseColor, icon, levelStr, rst, message)
}

func (c *console) registerDynamicLine(id int, content string) {
	c.mu.Lock()
	c.activeLines = append(c.activeLines, &activeLine{id: id, content: content})
	c.mu.Unlock()
	c.redrawDynamicLines()
}

func (c *console) updateDynamicLine(id int, newContent string) {
	c.mu.Lock()
	found := false
	for _, l := range c.activeLines {
		if l.id == id {
			l.content = newContent
			found = true
			break
		}
	}
	c.mu.Unlock()
	if found {
		c.redrawDynamicLines()
	}
}

func (c *console) endDynamicLine(id int, finalContent string) {
	c.mu.Lock()
	idx := -1
	for i, l := range c.activeLines {
		if l.id == id {
			idx = i
			break
		}
	}
	if idx > -1 {
		// Remove from slice
		c.activeLines = append(c.activeLines[:idx], c.activeLines[idx+1:]...)
	}
	c.mu.Unlock() // Unlock before calling writeStatic to avoid deadlock
	c.writeStatic(c.formatLogInternal(LevelSuccess, finalContent, nil))
	c.redrawDynamicLines() // Redraw remaining active lines
}

// --- Métodos Públicos (Exportados) ---

// Log logs a generic message
func Log(level Level, color *string, args ...interface{}) {
	output := ""
	for _, arg := range args {
		if arg != "" {
			msg := fmt.Sprintf("%v", arg)
			output += consoleInstance.formatLogInternal(level, msg, color) + "\n"
		} else {
			output += "\n"
		}
	}
	consoleInstance.writeStatic(strings.TrimRight(output, "\n"))
}

func Error(args ...interface{})      { Log(LevelError, nil, args...) }
func Warn(args ...interface{})       { Log(LevelWarn, nil, args...) }
func Info(args ...interface{})       { Log(LevelInfo, nil, args...) }
func Success(args ...interface{})    { Log(LevelSuccess, nil, args...) }
func DefaultLog(args ...interface{}) { Log(LevelInfo, nil, args...) }
func Debug(args ...interface{})      { Log(LevelDebug, nil, args...) }

func LogCustomLevel(levelName string, without bool, color string, args ...interface{}) {
	c := color
	// Go doesn't allow casting string to enum directly if not matching,
	// but we treat levelName as string in formatLogInternal logic if adapted,
	// or just cast here since our logic uses string ultimately.
	Log(Level(levelName), &c, args...)
}

// Ask prompts the user for input
func Ask(question string, defaultValue string) string {
	defaultPart := ""
	if defaultValue != "" {
		defaultPart = fmt.Sprintf(" %s(%s)%s", FgGray, defaultValue, Reset)
	}

	prompt := fmt.Sprintf(" %s?%s %s%s%s%s\n %s❯%s ", FgCyan, Reset, Bright, question, Reset, defaultPart, FgCyan, Reset)

	// Ensure prompt is printed cleanly regarding dynamic lines
	consoleInstance.mu.Lock()
	if consoleInstance.lastRenderedLines > 0 {
		fmt.Printf("\x1b[%dA", consoleInstance.lastRenderedLines)
		fmt.Print("\r\x1b[J")
	}
	consoleInstance.lastRenderedLines = 0
	consoleInstance.mu.Unlock()

	fmt.Print(prompt)

	scanner := bufio.NewScanner(os.Stdin)
	if scanner.Scan() {
		val := strings.TrimSpace(scanner.Text())
		if val == "" && defaultValue != "" {
			return defaultValue
		}
		return val
	}
	return ""
}

// Confirm prompts for yes/no
func Confirm(message string, defaultYes bool) bool {
	suffix := "y/N"
	if defaultYes {
		suffix = "Y/n"
	}

	val := Ask(fmt.Sprintf("%s %s[%s]%s", message, FgGray, suffix, Reset), "")
	val = strings.ToLower(val)

	if val == "" {
		return defaultYes
	}
	return val == "y" || val == "yes" || val == "s" || val == "sim"
}

// TableItem helper struct for Table function
type TableItem struct {
	Field string
	Value interface{}
}

// Table renders an ASCII table
func Table(data []TableItem) {
	if len(data) == 0 {
		return
	}

	// Calculate widths
	fieldLen := len("Field")
	valueLen := len("Value")

	rows := make([]struct{ F, V string }, len(data))

	for i, item := range data {
		fStr := item.Field
		vStr := fmt.Sprintf("%v", item.Value)

		if len(fStr) > fieldLen {
			fieldLen = len(fStr)
		}
		if len(vStr) > valueLen {
			valueLen = len(vStr)
		}
		rows[i] = struct{ F, V string }{fStr, vStr}
	}

	hLine := strings.Repeat("─", fieldLen+2)
	vLine := strings.Repeat("─", valueLen+2)

	top := fmt.Sprintf("┌%s┬%s┐", hLine, vLine)
	mid := fmt.Sprintf("├%s┼%s┤", hLine, vLine)
	bottom := fmt.Sprintf("└%s┴%s┘", hLine, vLine)

	var output strings.Builder
	output.WriteString(top + "\n")

	// Header
	output.WriteString(fmt.Sprintf("│ %s%s%-*s%s │ %s%s%-*s%s │\n",
		Bright, FgCyan, fieldLen, "Field", Reset,
		Bright, FgCyan, valueLen, "Value", Reset))

	output.WriteString(mid + "\n")

	for _, row := range rows {
		output.WriteString(fmt.Sprintf("│ %-*s │ %-*s │\n", fieldLen, row.F, valueLen, row.V))
	}
	output.WriteString(bottom + "\n")

	consoleInstance.writeStatic(output.String())
}

// Selection interactive menu
func Selection(question string, options map[string]string) string {
	// Convert map to slice to maintain order (map order is random in Go, so we sort or accept randomness)
	// For stability, let's extract keys and values.
	// Since original code iterates Object.entries, let's try to stabilize order or just iterate.
	type entry struct {
		key   string
		label string
	}
	var entries []entry
	for k, v := range options {
		entries = append(entries, entry{k, v})
	}
	// Note: In Go maps are unordered. You might want to pass a slice of structs if order matters.

	currentIndex := 0

	// Helper to render the menu
	render := func(clearCount int) {
		// Clear previous lines
		if clearCount > 0 {
			fmt.Printf("\x1b[%dA", clearCount)
		}
		fmt.Print("\r\x1b[J") // Clear down

		fmt.Printf(" %s?%s %s%s%s\n", FgCyan, Reset, Bright, question, Reset)
		for i, e := range entries {
			prefix := " "
			text := fmt.Sprintf("%s%s%s", FgGray, e.label, Reset)

			if i == currentIndex {
				prefix = fmt.Sprintf("%s❯%s", FgCyan, Reset)
				text = fmt.Sprintf("%s%s%s%s", FgCyan, Bright, e.label, Reset)
			}
			fmt.Printf("  %s %s\n", prefix, text)
		}
	}

	// Handle rendering clash with dynamic lines
	consoleInstance.mu.Lock()
	if consoleInstance.lastRenderedLines > 0 {
		fmt.Printf("\x1b[%dA", consoleInstance.lastRenderedLines)
		fmt.Print("\r\x1b[J")
	}
	consoleInstance.lastRenderedLines = 0
	consoleInstance.mu.Unlock()

	// Hide cursor
	fmt.Print("\x1b[?25l")

	firstRender := true
	linesRendered := len(entries) + 1

	// Raw mode for input
	oldState, err := term.MakeRaw(int(os.Stdin.Fd()))
	if err != nil {
		panic(err)
	}
	defer term.Restore(int(os.Stdin.Fd()), oldState)
	defer fmt.Print("\x1b[?25h") // Ensure cursor shows again

	reader := bufio.NewReader(os.Stdin)

	for {
		if firstRender {
			render(0)
			firstRender = false
		} else {
			render(linesRendered)
		}

		// Read key
		b := make([]byte, 3)
		n, err := reader.Read(b)
		if err != nil {
			break
		}

		// Arrow keys are typically 3 bytes: ESC [ A (up) or ESC [ B (down)
		if n == 3 && b[0] == 27 && b[1] == 91 {
			if b[2] == 65 { // Up
				currentIndex = (currentIndex - 1 + len(entries)) % len(entries)
			} else if b[2] == 66 { // Down
				currentIndex = (currentIndex + 1) % len(entries)
			}
		} else if n == 1 {
			if b[0] == 13 { // Enter
				// Restore terminal to print final log cleanly
				term.Restore(int(os.Stdin.Fd()), oldState)
				fmt.Print("\x1b[?25h") // Show cursor

				// Clear menu one last time
				fmt.Printf("\x1b[%dA", linesRendered)
				fmt.Print("\r\x1b[J")

				selected := entries[currentIndex]
				consoleInstance.writeStatic(fmt.Sprintf(" %s✓%s %s%s%s %s›%s %s",
					FgCyan, Reset, Bright, question, Reset, FgGray, Reset, selected.label))

				return selected.key
			} else if b[0] == 3 { // Ctrl+C
				term.Restore(int(os.Stdin.Fd()), oldState)
				fmt.Print("\x1b[?25h")
				os.Exit(0)
			}
		}
	}
	return ""
}
