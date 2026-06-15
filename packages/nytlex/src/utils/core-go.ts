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
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import Console from "../api/console"; // Importa o seu arquivo Console.ts

export class CoreGoManager {
  private currentNytlexVersion: string;
  private registryUrl: string;
  private s3BaseUrl: string;
  private binDir: string;
  private versionFilePath: string;

  constructor(currentNytlexVersion: string, customBinDir?: string) {
    this.currentNytlexVersion = currentNytlexVersion;
    this.registryUrl = "https://s3-server.br-1.mfraz.ovh/nytlex-go/registry.json";
    this.s3BaseUrl = "https://s3-server.br-1.mfraz.ovh/nytlex-go/";

    // Pasta onde o binário será salvo (padrão: mesma pasta desse script, mas pode ser node_modules)
    this.binDir = customBinDir || path.join(__dirname, '..', '..', 'core-go-bin');
    this.versionFilePath = path.join(this.binDir, "core-go.version.json");
  }

  /**
   * Verifica se estamos no ambiente de desenvolvimento (fora do node_modules)
   */
  private isDevelopment(): boolean {
    return !this.binDir.includes("node_modules") && !__dirname.includes("node_modules");
  }

  /**
   * Retorna o caminho completo do arquivo binário baixado (.node)
   */
  public getFile(): string {
    // Se o diretório não tiver "node_modules", assumimos que é ambiente de desenvolvimento
    if (this.isDevelopment()) {
      const { platform, arch } = this.getSystemInfo();
      // Puxa direto da pasta services/core-go/binaries usando o OS e arquitetura correta
      const path1= path.join(__dirname, "..", "..", "..", "..", "services", "core-go", "binaries", `core-${platform}-${arch}.node`);
      console.log(path1)
      return path1;
    }

    // Caso contrário (produção), pega o genérico baixado na pasta configurada
    return path.join(this.binDir, "core-go.node");
  }

  /**
   * Identifica o SO e a arquitetura para montar a URL corretamente
   */
  private getSystemInfo() {
    const platform = os.platform() === "win32" ? "win" : "linux"; // Trata Mac como linux pra esse contexto, ou ajusta se precisar

    let arch = os.arch();
    // Garante o mapeamento correto pra ARM e x64
    if (arch === "arm" || arch === "arm64") {
      arch = "arm64";
    } else {
      arch = "x64";
    }

    return { platform, arch };
  }

  /**
   * Compara duas versões semânticas (ex: 1.1.0 > 1.0.0)
   */
  private compareVersions(v1: string, v2: string): number {
    const p1 = v1.split(".").map(Number);
    const p2 = v2.split(".").map(Number);
    for (let i = 0; i < Math.max(p1.length, p2.length); i++) {
      const n1 = p1[i] || 0;
      const n2 = p2[i] || 0;
      if (n1 > n2) return 1;
      if (n1 < n2) return -1;
    }
    return 0;
  }

  /**
   * Pega a versão recomendada do core-go baseada no registry.json
   */
  private async getLatestCompatibleVersion(): Promise<string | null> {
    try {
      const response = await fetch(this.registryUrl);
      if (!response.ok) throw new Error(`Erro HTTP: ${response.status}`);
      const registry = await response.json();

      let bestCoreGo = null;
      let highestNytlex = "0.0.0";

      for (const [coreGoVer, nytlexReqVer] of Object.entries(registry)) {
        if (this.compareVersions(nytlexReqVer as string, this.currentNytlexVersion) <= 0) {
          if (this.compareVersions(nytlexReqVer as string, highestNytlex) > 0) {
            highestNytlex = nytlexReqVer as string;
            bestCoreGo = coreGoVer;
          } else if (this.compareVersions(nytlexReqVer as string, highestNytlex) === 0) {
            if (!bestCoreGo || this.compareVersions(coreGoVer, bestCoreGo) > 0) {
              bestCoreGo = coreGoVer;
            }
          }
        }
      }
      return bestCoreGo;
    } catch (error) {
      Console.error(`Failed to read registry.json: ${error}`);
      return null;
    }
  }

  /**
   * Retorna a versão atualmente instalada lendo o arquivo local .version.json
   */
  private getInstalledVersion(): string | null {
    if (!fs.existsSync(this.versionFilePath)) return null;
    try {
      const data = JSON.parse(fs.readFileSync(this.versionFilePath, "utf-8"));
      return data.version || null;
    } catch {
      return null;
    }
  }

  /**
   * VERIFY: Checa se tem atualização disponível comparando o local com o S3
   */
  public async verify(): Promise<{ hasUpdate: boolean; installed: string | null; target: string | null }> {
    Console.debug("Checking core versions...");
    const targetVersion = await this.getLatestCompatibleVersion();
    const installedVersion = this.getInstalledVersion();

    // Checa se o arquivo binário .node realmente existe no disco
    const binaryExists = fs.existsSync(this.getFile());

    if (!targetVersion) {
      Console.warn("No compatible version found in the registry.");
      return { hasUpdate: false, installed: installedVersion, target: null };
    }

    // hasUpdate será true APENAS SE:
    // 1. Não houver versão registrada no JSON
    // 2. O arquivo .node não existir fisicamente
    // 3. A versão target for ESTRITAMENTE MAIOR que a instalada (impede downgrade/re-download se o nytlex mudar mas o core já for igual ou mais novo)
    const hasUpdate = !installedVersion || !binaryExists || this.compareVersions(targetVersion, installedVersion) > 0;

    return { hasUpdate, installed: installedVersion, target: targetVersion };
  }

  /**
   * DOWNLOAD: Baixa a versão informada com progresso interativo
   */
  public async downloadLatest(targetVersion: string): Promise<boolean> {
    if (this.isDevelopment()) {
      Console.debug("Development mode detected: ignoring download to avoid duplication.");
      return true;
    }

    const { platform, arch } = this.getSystemInfo();
    const binName = `core-${platform}-${arch}`;
    const url = `${this.s3BaseUrl}${targetVersion}/${binName}.node`;

    // Agora sempre usa .node independente do SO, pegando direto do novo método getFile()
    const destPath = this.getFile();
    const destDir = path.dirname(destPath);

    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`Status ${response.status} ao baixar ${url}`);

      const totalBytes = parseInt(response.headers.get("content-length") || "0", 10);
      const totalMB = (totalBytes / (1024 * 1024)).toFixed(2);

      let loadedBytes = 0;

      // Garante que a pasta existe, seja a de produção ou de desenvolvimento
      if (!fs.existsSync(destDir)) {
        fs.mkdirSync(destDir, { recursive: true });
      }

      const fileStream = fs.createWriteStream(destPath);
      const dynamicLine = Console.dynamicLine(`Baixando ${binName} (v${targetVersion})... 0.00MB / ${totalMB}MB (0%)`);

      // Usa o body como stream pra ler os chunks e atualizar a UI
      for await (const chunk of response.body as unknown as AsyncIterable<Buffer>) {
        loadedBytes += chunk.length;
        fileStream.write(chunk);

        const loadedMB = (loadedBytes / (1024 * 1024)).toFixed(2);
        const percent = totalBytes > 0 ? Math.round((loadedBytes / totalBytes) * 100) : 0;

        dynamicLine.update(`Baixando ${binName} (v${targetVersion})... ${loadedMB}MB / ${totalMB}MB (${percent}%)`);
      }

      fileStream.end();
      dynamicLine.end(`Download do core-go v${targetVersion} concluído com sucesso! (${totalMB}MB)`);

      // Dá permissão de execução no Linux/Mac
      if (platform !== "win") {
        fs.chmodSync(destPath, 0o755);
      }

      // Salva a versão instalada no arquivo local (garantindo na pasta de destino base)
      fs.writeFileSync(this.versionFilePath, JSON.stringify({ version: targetVersion }));

      return true;
    } catch (error) {
      Console.error(`Erro ao baixar o core-go: ${error}`);
      return false;
    }
  }

  /**
   * UPDATE: Junta o verify() com o downloadLatest()
   */
  public async update(): Promise<void> {
    if (this.isDevelopment()) {
      Console.info("Development environment detected. Using native local binaries from 'services/core-go/binaries'.");
      return;
    }

    const { hasUpdate, installed, target } = await this.verify();

    if (!target) {
      Console.error("Canceling update: No target version defined.");
      return;
    }

    if (!hasUpdate) {
      // Adicionado um log extra caso ele pule a att por já estar numa versão mais nova
      if (installed && this.compareVersions(installed, target) > 0) {
        Console.success(`O core-go já está numa versão mais recente (${installed}) do que a pedida pelo Nytlex (${target}). Nenhuma atualização necessária.`);
      } else {
        Console.success(`O core já está na versão recomendada (${installed}).`);
      }
      return;
    }

    if (installed) {
      Console.info(`Updating core: ${installed} -> ${target}`);
    } else {
      Console.info(`Installing core for the first time (v${target}).`);
    }

    const success = await this.downloadLatest(target);
    if (success) {
      Console.success("Update completed successfully!");
    } else {
      Console.error("Failed to update the core.");
    }
  }
}