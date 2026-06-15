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

import readline from "node:readline";

/**
 * Handle for dynamic lines.
 */
export class DynamicLine {
    private readonly _id = Symbol();

    constructor(initialContent: string) {
        Console["registerDynamicLine"](this._id, initialContent);
    }

    update(newContent: string): void {
        Console["updateDynamicLine"](this._id, newContent);
    }

    end(finalContent: string): void {
        Console["endDynamicLine"](this._id, finalContent);
    }
}

export enum Colors {
    Reset = "\x1b[0m",
    Bright = "\x1b[1m",
    Dim = "\x1b[2m",
    Underscore = "\x1b[4m",
    Blink = "\x1b[5m",
    Reverse = "\x1b[7m",
    Hidden = "\x1b[8m",

    FgBlack = "\x1b[30m",
    FgRed = "\x1b[31m",
    FgGreen = "\x1b[32m",
    FgYellow = "\x1b[33m",
    FgBlue = "\x1b[34m",
    FgMagenta = "\x1b[35m",
    FgCyan = "\x1b[36m",
    FgWhite = "\x1b[37m",
    FgGray = "\x1b[90m",
    FgAlmostWhite = "\x1b[38;2;220;220;220m",

    BgBlack = "\x1b[40m",
    BgRed = "\x1b[41m",
    BgGreen = "\x1b[42m",
    BgYellow = "\x1b[43m",
    BgBlue = "\x1b[44m",
    BgMagenta = "\x1b[45m",
    BgCyan = "\x1b[46m",
    BgWhite = "\x1b[47m",
    BgGray = "\x1b[100m",
}

export enum Levels {
    ERROR = "ERROR",
    WARN = "WARN",
    INFO = "INFO",
    DEBUG = "DEBUG",
    SUCCESS = "SUCCESS",
}

export default class Console {
    private static activeLines: Map<symbol, { offset: number }> = new Map();
    private static originalStdoutWrite = process.stdout.write.bind(process.stdout);
    private static isHooked = false;
    private static isWriting = false;

    // --- UTILITIES ---

    private static ANSI_REGEX =
        /[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g;

    private static stripAnsi(text: string): string {
        return text.replace(this.ANSI_REGEX, "");
    }

    private static getTime(): string {
        return new Date().toLocaleTimeString("en-US", { hour12: false });
    }

    private static normalizeLevelName(level: any): string {
        if (level === null || level === undefined) return "";
        return String(level).trim();
    }

    private static levelColor(level: Levels | string): string {
        switch (level) {
            case Levels.ERROR:
                return Colors.FgRed;
            case Levels.WARN:
                return Colors.FgYellow;
            case Levels.INFO:
                return Colors.FgCyan; // Mantido ciano apenas para a tag [INFO]
            case Levels.SUCCESS:
                return Colors.FgGreen;
            case Levels.DEBUG:
                return Colors.FgGray;
            case "PROCESSING":
                return Colors.FgMagenta;
            default:
                return Colors.FgWhite;
        }
    }

    private static indentMultiline(msg: string, indent: string): string {
        return msg
            .split("\n")
            .map((line, i) => (i === 0 ? line : indent + line))
            .join("\n");
    }

    private static countRowsAdded(text: string): number {
        const columns = process.stdout.columns || 80;
        const clean = text.replace(this.ANSI_REGEX, "");

        let rowsAdded = 0;
        const lines = clean.split("\n");

        for (let i = 0; i < lines.length; i++) {
            const width = lines[i].length;
            if (width > 0) {
                rowsAdded += Math.floor((width - 1) / columns);
            }
            if (i < lines.length - 1) {
                rowsAdded++;
            }
        }
        return rowsAdded;
    }

    // --- HOOK SYSTEM ---

    private static hook(): void {
        if (this.isHooked) return;
        this.isHooked = true;

        process.stdout.write = (chunk: any, encoding?: any, callback?: any) => {
            if (this.isWriting) {
                return this.originalStdoutWrite(chunk, encoding, callback);
            }

            const text = chunk.toString();
            const rowsAdded = this.countRowsAdded(text);

            if (rowsAdded > 0) {
                for (const line of this.activeLines.values()) {
                    line.offset += rowsAdded;
                }
            }

            return this.originalStdoutWrite(chunk, encoding, callback);
        };
    }

    // --- FORMAT ---

    private static writeStatic(content: string): void {
        console.log(content.replace(/\n$/, ""));
    }

    private static formatLog(level: Levels | string, message: string, customColor?: Colors | null): string {
        if (message === "end_clear") return "";

        const reset = Colors.Reset;
        const dim = Colors.Dim;
        const bold = Colors.Bright;

        const timePart = `${dim}${Colors.FgGray}[${this.getTime()}]${reset}`;
        const normalizedLevel = this.normalizeLevelName(level).toUpperCase();

        if (!normalizedLevel) {
            return `${timePart} ${message}${Colors.Reset}`;
        }

        const activeColor = customColor ?? this.levelColor(level);

        const paddedLevel = normalizedLevel.length > 7
            ? normalizedLevel.slice(0, 7)
            : normalizedLevel.padEnd(7, " ");

        // O texto não herda a cor da tag, a menos que você mande customColor
        const prefix = `${timePart} ${activeColor}${bold}${paddedLevel}${reset} `;

        const indent = " ".repeat(this.stripAnsi(prefix).length);
        const prettyMsg = this.indentMultiline(message, indent);

        // Se tiver customColor, pinta o texto todo, senão deixa branco/padrão
        const textFormat = customColor ? activeColor : Colors.FgWhite;

        return `${prefix}${textFormat}${prettyMsg}${Colors.Reset}`;
    }

    // --- INTERACTIVE ---

    static async selection<T = string>(question: string, options: Record<string, T>): Promise<string> {
        const entries = Object.entries(options);
        let currentIndex = 0;
        const stream = process.stdout;
        let firstRender = true;

        stream.write("\x1b[?25l");

        const render = () => {
            if (!firstRender) {
                readline.moveCursor(stream, 0, -(entries.length + 1));
            }
            firstRender = false;

            readline.cursorTo(stream, 0);
            readline.clearScreenDown(stream);

            // Título mais elegante: ? (Verde) Pergunta (Branco Brilhante)
            const title = `${Colors.FgGreen}?${Colors.Reset} ${Colors.Bright}${Colors.FgWhite}${question}${Colors.Reset}`;
            let output = `${title}\n`;

            entries.forEach(([_key, label], i) => {
                const isSelected = i === currentIndex;
                const strLabel = String(label);

                if (isSelected) {
                    // Item selecionado ganha um cursor mais legal ❯ e leve tom em ciano
                    output += `${Colors.FgCyan} ❯ ${strLabel}${Colors.Reset}\n`;
                } else {
                    // Itens normais ficam sem interferência, respeitando as cores que já tenham
                    output += `   ${strLabel}${Colors.Reset}\n`;
                }
            });

            this.isWriting = true;
            this.originalStdoutWrite(output);
            this.isWriting = false;
        };

        render();

        return new Promise((resolve) => {
            const handleKey = (_chunk: any, key: any) => {
                if (!key) return;

                if (key.name === "up") {
                    currentIndex = (currentIndex - 1 + entries.length) % entries.length;
                    render();
                } else if (key.name === "down") {
                    currentIndex = (currentIndex + 1) % entries.length;
                    render();
                } else if (key.name === "return") {
                    process.stdin.removeListener("keypress", handleKey);
                    if (process.stdin.isTTY) process.stdin.setRawMode(false);
                    process.stdin.pause();
                    stream.write("\x1b[?25h");

                    readline.moveCursor(stream, 0, -(entries.length + 1));
                    readline.cursorTo(stream, 0);
                    readline.clearScreenDown(stream);

                    const [_selectedKey, selectedLabel] = entries[currentIndex];

                    // Finalizado: ✔ (Verde) Pergunta · Resposta (Cinza/Dim)
                    this.writeStatic(
                        `${Colors.FgGreen}✔${Colors.Reset} ${Colors.Bright}${Colors.FgWhite}${question}${Colors.Reset} ${Colors.Dim}· ${String(selectedLabel)}${Colors.Reset}`
                    );

                    resolve(_selectedKey);
                } else if (key.ctrl && key.name === "c") {
                    stream.write("\x1b[?25h");
                    process.exit();
                }
            };

            readline.emitKeypressEvents(process.stdin);
            if (process.stdin.isTTY) process.stdin.setRawMode(true);
            process.stdin.resume();
            process.stdin.on("keypress", handleKey);
        });
    }

    // --- PUBLIC METHODS ---

    static error(...args: any[]): void { this.log(Levels.ERROR, null, ...args); }
    static warn(...args: any[]): void { this.log(Levels.WARN, null, ...args); }
    static info(...args: any[]): void { this.log(Levels.INFO, null, ...args); }
    static success(...args: any[]): void { this.log(Levels.SUCCESS, null, ...args); }
    static default_log(...args: any[]): void { this.log(Levels.INFO, null, ...args); }
    static debug(...args: any[]): void { this.log(Levels.DEBUG, null, ...args); }

    static logCustomLevel(levelName: string, without: boolean = true, color?: Colors, ...args: any[]): void {
        const lvl = this.normalizeLevelName(levelName) as Levels;
        if (without) {
            this.logWithout(lvl, color, ...args);
        } else {
            this.log(lvl, color, ...args);
        }
    }

    static logWithout(level: Levels, colors?: Colors, ...args: any[]): void {
        this.log(level, colors, ...args);
    }

    static log(level: Levels, colors?: Colors | null, ...args: any[]): void {
        let output = "";
        for (const arg of args) {
            const msg = arg instanceof Error ? arg.stack : typeof arg === "string" ? arg : JSON.stringify(arg, null, 2);
            if (msg) output += this.formatLog(level, msg, colors) + "\n";
        }
        this.writeStatic(output);
    }

    static async ask(question: string, defaultValue?: string): Promise<string> {
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
        const defaultPart = defaultValue ? ` ${Colors.Dim}(${defaultValue})${Colors.Reset}` : "";

        // Padrão visual elegante: ? (Verde) Pergunta (Branco Brilhante)
        const prompt = `${Colors.FgGreen}?${Colors.Reset} ${Colors.Bright}${Colors.FgWhite}${question}${Colors.Reset}${defaultPart} ${Colors.Dim}❯${Colors.Reset} `;

        return new Promise((resolve) => {
            rl.question(prompt, (ans) => {
                rl.close();
                const value = ans.trim();
                const finalValue = value === "" && defaultValue !== undefined ? defaultValue : value;

                readline.moveCursor(process.stdout, 0, -1);
                readline.clearLine(process.stdout, 0);

                // Finalizado: ✔ (Verde) Pergunta · Resposta (Cinza/Dim)
                this.writeStatic(
                    `${Colors.FgGreen}✔${Colors.Reset} ${Colors.Bright}${Colors.FgWhite}${question}${Colors.Reset} ${Colors.Dim}· ${finalValue}${Colors.Reset}`
                );

                resolve(finalValue);
            });
        });
    }

    static async confirm(message: string, defaultYes = false): Promise<boolean> {
        const suffix = defaultYes ? "Y/n" : "y/N";
        const ans = (await this.ask(`${message} [${suffix}]`, defaultYes ? "y" : "n")).toLowerCase();
        return ["y", "yes"].includes(ans);
    }

    static table(data: Record<string, any> | Array<{ Field: string; Value: any }>): void {
        let rows: Array<{ Field: string; Value: any }>;
        if (Array.isArray(data)) {
            rows = data.map((row) => ({ Field: String(row.Field), Value: String(row.Value) }));
        } else {
            rows = Object.entries(data).map(([Field, Value]) => ({ Field, Value: String(Value) }));
        }

        const fieldLen = Math.max(...rows.map((r) => r.Field.length), "Field".length);
        const valueLen = Math.max(...rows.map((r) => r.Value.length), "Value".length);

        const h_line = "─".repeat(fieldLen + 2);
        const v_line = "─".repeat(valueLen + 2);

        const dim = Colors.Dim + Colors.FgGray;
        const reset = Colors.Reset;

        const top = `${dim}┌${h_line}┬${v_line}┐${reset}`;
        const mid = `${dim}├${h_line}┼${v_line}┤${reset}`;
        const bottom = `${dim}└${h_line}┴${v_line}┘${reset}`;

        let output = `\n${top}\n`;
        // Sem ciano/azul nas tabelas, apenas branco brilhante focado na informação
        output += `${dim}│${reset} ${Colors.Bright}${Colors.FgWhite}${"Field".padEnd(fieldLen)}${reset} ${dim}│${reset} ${Colors.Bright}${Colors.FgWhite}${"Value".padEnd(valueLen)}${reset} ${dim}│${reset}\n`;
        output += `${mid}\n`;

        for (const row of rows) {
            output += `${dim}│${reset} ${Colors.FgWhite}${row.Field.padEnd(fieldLen)}${reset} ${dim}│${reset} ${Colors.FgWhite}${row.Value.padEnd(valueLen)}${reset} ${dim}│${reset}\n`;
        }

        output += `${bottom}\n`;
        this.writeStatic(output);
    }

    static dynamicLine(initialContent: string): DynamicLine {
        return new DynamicLine(initialContent);
    }

    private static registerDynamicLine(id: symbol, content: string): void {
        this.hook();
        const formatted = this.formatLog("PROCESSING", content);
        const rows = this.countRowsAdded(formatted + "\n");
        this.writeStatic(formatted);
        this.activeLines.set(id, { offset: rows });
    }

    private static updateDynamicLine(id: symbol, newContent: string): void {
        this.editLine(id, newContent, "PROCESSING");
    }

    private static endDynamicLine(id: symbol, finalContent: string): void {
        if (this.activeLines.has(id)) {
            this.editLine(id, finalContent, Levels.SUCCESS);
            this.activeLines.delete(id);
        }
    }

    private static editLine(id: symbol, content: string, level: string | Levels): void {
        const line = this.activeLines.get(id);
        if (!line) return;

        const stream = process.stdout;
        const formatted = this.formatLog(level, content);

        this.isWriting = true;

        try {
            readline.moveCursor(stream, 0, -line.offset);
            readline.clearLine(stream, 0);
            readline.cursorTo(stream, 0);
            stream.write(formatted + "\n");

            const newRows = this.countRowsAdded(formatted + "\n");
            const rowsToMoveDown = line.offset - newRows;

            if (rowsToMoveDown !== 0) {
                readline.moveCursor(stream, 0, rowsToMoveDown);
            }
        } catch (e) {
            // ignore
        }

        this.isWriting = false;
    }
}