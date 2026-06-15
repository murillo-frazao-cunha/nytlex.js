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
import type { Client as LibSqlClient, ResultSet as LibSqlResultSet } from "@libsql/client";
import type { Pool as MysqlPool } from "mysql2/promise";
import type { Pool as PgPool } from "pg";

// ==========================================
// 1) TIPOS
// ==========================================

export enum DataType {
  STRING = "STRING",
  TEXT = "TEXT",
  INT = "INT",
  LONG = "LONG",
  BOOLEAN = "BOOLEAN",
  JSON = "JSON",
  UUID = "UUID",
}

export interface SchemaColumn {
  name: string;
  type: DataType;
  primaryKey?: boolean;
  nullable?: boolean;
  autoIncrement?: boolean;
  unique?: boolean;
  // Agora defaultValue suporta string, number, boolean, null, array ou object (JSON)
  defaultValue?: string | number | boolean | null | any[] | Record<string, any>;
}

export type DbConfig = {
  type: "sqlite" | "mysql" | "postgresql";
  
  // Opções locais / LibSQL:
  filepath?: string; 
  url?: string; 
  authToken?: string; 
  syncUrl?: string; 
  syncInterval?: number; 
  encryptionKey?: string; 

  // Opções remotas (MySQL / PostgreSQL):
  host?: string;
  port?: number;
  user?: string;
  password?: string;
  database?: string;
};

// ==========================================
// 2) ADAPTERS DE BANCO DE DADOS
// ==========================================

export interface DatabaseAdapter {
  query<T = any>(sql: string, params?: any[]): Promise<T[]>;
  execute(sql: string, params?: any[]): Promise<any>;
  formatPlaceholder(index?: number): string; // Recebe index para suportar $1, $2 do PG
  syncTable(tableName: string, schema: SchemaColumn[]): Promise<void>;
}

// ---- Funções Utilitárias ----
function toFileUrl(filepath: string) {
  if (filepath.startsWith("file:")) return filepath;
  const normalized = filepath.replace(/\\/g, "/");
  if (/^[a-zA-Z]:/.test(normalized) || normalized.startsWith("/")) {
    return `file:///${normalized.replace(/^\/+/, "")}`;
  }
  return `file:${normalized}`;
}

function getDefaultClause(col: SchemaColumn): string {
  if (col.defaultValue !== undefined) {
    if (col.defaultValue === null) return " DEFAULT NULL";
    else if (typeof col.defaultValue === "number") return ` DEFAULT ${col.defaultValue}`;
    else if (typeof col.defaultValue === "boolean") return ` DEFAULT ${col.defaultValue ? 1 : 0}`;
    else if (typeof col.defaultValue === "object") {
      // Trata arrays e objetos transformando em string JSON
      return ` DEFAULT '${JSON.stringify(col.defaultValue).replace(/'/g, "''")}'`;
    }
    else return ` DEFAULT '${String(col.defaultValue).replace(/'/g, "''")}'`;
  }
  return "";
}

function serializeJsonColumns(data: any, schema: SchemaColumn[]): any {
  const jsonCols = schema.filter((c) => c.type === DataType.JSON).map((c) => c.name);
  const serialized = { ...data };

  for (const col of jsonCols) {
    if (col in serialized && serialized[col] !== null && serialized[col] !== undefined) {
      if (typeof serialized[col] !== "string") {
        serialized[col] = JSON.stringify(serialized[col]);
      }
    }
  }

  return serialized;
}

function deserializeJsonColumns(row: any, schema: SchemaColumn[]): any {
  const jsonCols = schema.filter((c) => c.type === DataType.JSON).map((c) => c.name);

  for (const col of jsonCols) {
    if (typeof row[col] === "string") {
      try {
        row[col] = JSON.parse(row[col]);
      } catch {
        row[col] = [];
      }
    }
  }

  return row;
}

// ----------------------------------------------------
// ADAPTER: LibSQL / SQLite
// ----------------------------------------------------
export class LibSQLAdapter implements DatabaseAdapter {
  public client: LibSqlClient;

  constructor(config: DbConfig) {
    const url =
      config.url ??
      (config.filepath ? toFileUrl(config.filepath) : ":memory:");

    // Import dinâmico (peer dependency approach)
    const { createClient } = require("@libsql/client");

    this.client = createClient({
      url,
      authToken: config.authToken,
      syncUrl: config.syncUrl,
      syncInterval: config.syncInterval,
      encryptionKey: config.encryptionKey,
    });
  }

  formatPlaceholder(): string {
    return "?";
  }

  async execute(sql: string, params: any[] = []): Promise<LibSqlResultSet> {
    return await this.client.execute({ sql, args: params });
  }

  async query<T = any>(sql: string, params: any[] = []): Promise<T[]> {
    const rs = await this.client.execute({ sql, args: params });
    return rs.rows as unknown as T[];
  }

  private mapType(type: DataType): string {
    switch (type) {
      case DataType.STRING: return "TEXT";
      case DataType.INT: return "INTEGER";
      case DataType.LONG: return "BIGINT";
      case DataType.BOOLEAN: return "INTEGER";
      case DataType.JSON: return "TEXT";
      default: return "TEXT";
    }
  }

  private buildColumnDef(col: SchemaColumn) {
    if (col.autoIncrement) return `${col.name} INTEGER PRIMARY KEY AUTOINCREMENT`;

    let def = `${col.name} ${this.mapType(col.type)}`;
    if (col.primaryKey) def += " PRIMARY KEY";
    if (col.unique) def += " UNIQUE";
    if (!col.nullable && !col.primaryKey) def += " NOT NULL";
    def += getDefaultClause(col);

    return def;
  }

  async syncTable(tableName: string, schema: SchemaColumn[]): Promise<void> {
    const columnsSql = schema.map((c) => this.buildColumnDef(c)).join(", ");
    await this.execute(`CREATE TABLE IF NOT EXISTS ${tableName} (${columnsSql})`);

    const existingInfo = await this.query(`PRAGMA table_info(${tableName})`);
    const existingCols = existingInfo.map((r: any) => r.name);

    for (const col of schema) {
      if (!existingCols.includes(col.name)) {
        await this.execute(`ALTER TABLE ${tableName} ADD COLUMN ${this.buildColumnDef(col)}`);
      }
      // SQLite não suporta MODIFY COLUMN nativamente de forma simples
    }
  }
}

// ----------------------------------------------------
// ADAPTER: MySQL
// ----------------------------------------------------
export class MysqlAdapter implements DatabaseAdapter {
  public pool: MysqlPool;

  constructor(config: DbConfig) {
    // Import dinâmico (peer dependency approach)
    const mysql = require("mysql2/promise");

    this.pool = mysql.createPool({
      host: config.host,
      port: config.port || 3306,
      user: config.user,
      password: config.password,
      database: config.database,
    });
  }

  formatPlaceholder(): string {
    return "?";
  }

  async execute(sql: string, params: any[] = []): Promise<any> {
    const [result] = await this.pool.execute(sql, params);
    return result;
  }

  async query<T = any>(sql: string, params: any[] = []): Promise<T[]> {
    const [rows] = await this.pool.execute(sql, params);
    return rows as T[];
  }

  private mapType(type: DataType): string {
    switch (type) {
      case DataType.STRING: return "VARCHAR(255)";
      case DataType.TEXT: return "LONGTEXT";
      case DataType.INT: return "INT";
      case DataType.LONG: return "BIGINT";
      case DataType.BOOLEAN: return "TINYINT(1)";
      case DataType.JSON: return "LONGTEXT";
      case DataType.UUID: return "CHAR(36)";
      default: return "VARCHAR(255)";
    }
  }

  private buildColumnDef(col: SchemaColumn) {
    let def = `${col.name} ${this.mapType(col.type)}`;
    
    if (col.autoIncrement) def += " AUTO_INCREMENT";
    if (col.primaryKey) def += " PRIMARY KEY";
    if (col.unique) def += " UNIQUE";
    if (!col.nullable && !col.primaryKey) def += " NOT NULL";
    def += getDefaultClause(col);

    return def;
  }

  async syncTable(tableName: string, schema: SchemaColumn[]): Promise<void> {
    const columnsSql = schema.map((c) => this.buildColumnDef(c)).join(", ");
    await this.execute(`CREATE TABLE IF NOT EXISTS ${tableName} (${columnsSql})`);

    const existingInfo = await this.query(`SHOW COLUMNS FROM ${tableName}`);
    const existingCols = existingInfo.map((r: any) => r.Field);

    for (const col of schema) {
      const def = this.buildColumnDef(col);
      if (!existingCols.includes(col.name)) {
        await this.execute(`ALTER TABLE ${tableName} ADD COLUMN ${def}`);
      } else {
        // Atualiza a coluna caso ela já exista
        await this.execute(`ALTER TABLE ${tableName} MODIFY COLUMN ${def}`);
      }
    }
  }
}

// ----------------------------------------------------
// ADAPTER: PostgreSQL
// ----------------------------------------------------
export class PostgresAdapter implements DatabaseAdapter {
  public pool: PgPool;

  constructor(config: DbConfig) {
    // Import dinâmico (peer dependency approach)
    const { Pool } = require("pg");

    this.pool = new Pool({
      host: config.host,
      port: config.port || 5432,
      user: config.user,
      password: config.password,
      database: config.database,
    });
  }

  formatPlaceholder(index?: number): string {
    return `$${index}`;
  }

  async execute(sql: string, params: any[] = []): Promise<any> {
    const res = await this.pool.query(sql, params);
    return { rowsAffected: res.rowCount };
  }

  async query<T = any>(sql: string, params: any[] = []): Promise<T[]> {
    const res = await this.pool.query(sql, params);
    return res.rows as T[];
  }

  private mapType(type: DataType): string {
    switch (type) {
      case DataType.STRING: return "VARCHAR(255)";
      case DataType.TEXT: return "TEXT";
      case DataType.INT: return "INTEGER";
      case DataType.LONG: return "BIGINT";
      case DataType.BOOLEAN: return "BOOLEAN";
      case DataType.JSON: return "TEXT";
      case DataType.UUID: return "UUID";
      default: return "VARCHAR(255)";
    }
  }

  private buildColumnDef(col: SchemaColumn) {
    if (col.autoIncrement) return `${col.name} SERIAL PRIMARY KEY`;

    let def = `${col.name} ${this.mapType(col.type)}`;
    if (col.primaryKey) def += " PRIMARY KEY";
    if (col.unique) def += " UNIQUE";
    if (!col.nullable && !col.primaryKey) def += " NOT NULL";
    def += getDefaultClause(col);

    return def;
  }

  async syncTable(tableName: string, schema: SchemaColumn[]): Promise<void> {
    const columnsSql = schema.map((c) => this.buildColumnDef(c)).join(", ");
    await this.execute(`CREATE TABLE IF NOT EXISTS ${tableName} (${columnsSql})`);

    const existingInfo = await this.query(
      `SELECT column_name FROM information_schema.columns WHERE table_name = $1`,
      [tableName]
    );
    const existingCols = existingInfo.map((r: any) => r.column_name);

    for (const col of schema) {
      if (!existingCols.includes(col.name)) {
        await this.execute(`ALTER TABLE ${tableName} ADD COLUMN ${this.buildColumnDef(col)}`);
      } else {
        // Atualiza o tipo da coluna caso ela já exista
        const mappedType = this.mapType(col.type);
        if (!col.autoIncrement && !col.primaryKey) {
          try {
            await this.execute(
              `ALTER TABLE ${tableName} ALTER COLUMN ${col.name} TYPE ${mappedType} USING ${col.name}::${mappedType}`
            );
          } catch { /* Ignora falhas de cast complexo do Postgres */ }
        }
      }
    }
  }
}

// ==========================================
// 3) CONECTOR
// ==========================================

export class DatabaseConnector {
  public adapter!: DatabaseAdapter;
  public config: DbConfig;
  public static defaultInstance?: DatabaseConnector; // Fallback para hot reload

  constructor(config: DbConfig) {
    this.config = config;
    this.connect();
    DatabaseConnector.defaultInstance = this;
  }

  public connect() {
    switch (this.config.type) {
      case "sqlite":
        this.adapter = new LibSQLAdapter(this.config);
        break;
      case "mysql":
        this.adapter = new MysqlAdapter(this.config);
        break;
      case "postgresql":
        this.adapter = new PostgresAdapter(this.config);
        break;
      default:
        throw new Error(`Database type '${(this.config as any).type}' is not supported.`);
    }
  }
}

// ==========================================
// 4) BASE ENTITY / TABLE
// ==========================================

export class BaseEntity<ID_TYPE, TData> {
  public data: TData;
  public _table?: any; // Referência injetada automaticamente para o .save() funcionar
  public _idField: string = "id"; // Nome padrão do campo de ID

  constructor(data: TData) {
    this.data = data;
    Object.assign(this, data);
  }

  toJSON(): TData {
    const result: any = {};
    for (const key of Object.keys(this.data as any)) {
      result[key] = (this as any)[key];
    }
    return result as TData;
  }

  async save(idField?: string): Promise<this> {
    const targetIdField = idField || this._idField;
    const targetTable = this._table;

    if (!targetTable) {
      throw new Error("Table reference not set. The entity must be created or found via BaseTable to use save().");
    }

    const idValue = (this as any)[targetIdField];
    const patch = this.toJSON();
    
    // Se não tem ID, cria direto
    if (idValue === undefined || idValue === null) {
      const createdEntity = await targetTable.create(patch);
      this.data = createdEntity.data;
      Object.assign(this, createdEntity.data);
    } else {
      // Tem ID, então tenta atualizar
      const affectedRows = await targetTable.updateMany({ [targetIdField]: idValue }, patch);
      
      // Se não atualizou nada, é porque não existia no banco, então cria
      if (affectedRows === 0) {
        const createdEntity = await targetTable.create(patch);
        this.data = createdEntity.data;
        Object.assign(this, createdEntity.data);
      } else {
        // Se atualizou, apenas faz o merge na própria instância
        this.data = { ...this.data, ...patch };
        Object.assign(this, patch);
      }
    }
    
    return this;
  }

  async delete(idField?: string): Promise<boolean> {
    const targetIdField = idField || this._idField;
    const targetTable = this._table;

    if (!targetTable) {
      throw new Error("Table reference not set. The entity must be created or found via BaseTable to use delete().");
    }

    const idValue = (this as any)[targetIdField];
    if (idValue === undefined || idValue === null) {
      throw new Error(`Cannot delete: ID field '${targetIdField}' is missing on entity.`);
    }

    const affectedRows = await targetTable.deleteMany({ [targetIdField]: idValue });
    return affectedRows > 0;
  }
}

type WhereInput<T> = Partial<T>;

export abstract class BaseTable<ID_TYPE, TEntity extends BaseEntity<ID_TYPE, any>, TData> {
  abstract tableName: string;
  protected abstract entityConstructor: new (data: TData) => TEntity;
  abstract defineSchema(): SchemaColumn[];

  protected connector?: DatabaseConnector;

  setConnector(connector: DatabaseConnector) {
    this.connector = connector;
  }

  protected get adapter() {
    if (!this.connector && DatabaseConnector.defaultInstance) {
      this.connector = DatabaseConnector.defaultInstance;
    }

    if (!this.connector) {
      throw new Error("Database not connected! Use Database(tables) or initializeTables().");
    }

    // Verifica se a conexão foi encerrada no SQLite/LibSQL
    const clientClosed = (this.connector.adapter as any)?.client?.closed;
    if (!this.connector.adapter || clientClosed) {
      this.connector.connect();
    }

    return this.connector.adapter;
  }

  // --------------------------
  // CRUD
  // --------------------------

  async create(data: Partial<TData>): Promise<TEntity> {
    const columns = Object.keys(data as any);
    const values = Object.values(data as any);

    if (columns.length === 0) throw new Error("create() needs at least 1 column");

    const schema = this.defineSchema();
    const serializedData = serializeJsonColumns(data, schema);
    const serializedValues = Object.values(serializedData);

    const placeholders = columns.map((_, i) => this.adapter.formatPlaceholder(i + 1)).join(", ");
    const sql = `INSERT INTO ${this.tableName} (${columns.join(", ")}) VALUES (${placeholders})`;

    await this.adapter.execute(sql, serializedValues);
    
    const entity = new this.entityConstructor(serializedData as TData);
    (entity as any)._table = this; 
    return entity;
  }

  async findMany(conditions: WhereInput<TData> = {} as any): Promise<TEntity[]> {
    const keys = Object.keys(conditions as any);
    const values = Object.values(conditions as any);

    let sql = `SELECT * FROM ${this.tableName}`;
    if (keys.length > 0) {
      const whereClause = keys.map((k, i) => `${k} = ${this.adapter.formatPlaceholder(i + 1)}`).join(" AND ");
      sql += ` WHERE ${whereClause}`;
    }

    const rows = await this.adapter.query<TData>(sql, values);
    const schema = this.defineSchema();

    return rows.map((row: any) => {
      const deserializedRow = deserializeJsonColumns(row, schema);
      const entity = new this.entityConstructor(deserializedRow);
      (entity as any)._table = this;
      return entity;
    });
  }

  async findOne(conditions: WhereInput<TData>): Promise<TEntity | null> {
    const res = await this.findMany(conditions);
    return res[0] ?? null;
  }

  async deleteMany(conditions: WhereInput<TData>): Promise<number> {
    const keys = Object.keys(conditions as any);
    const values = Object.values(conditions as any);

    if (keys.length === 0) throw new Error("deleteMany requires conditions (safety).");

    const whereClause = keys.map((k, i) => `${k} = ${this.adapter.formatPlaceholder(i + 1)}`).join(" AND ");
    const sql = `DELETE FROM ${this.tableName} WHERE ${whereClause}`;
    const rs = await this.adapter.execute(sql, values);
    return Number((rs as any)?.rowsAffected) ?? 0;
  }

  async updateMany(conditions: WhereInput<TData>, patch: Partial<TData>): Promise<number> {
    const cKeys = Object.keys(conditions as any);
    const cVals = Object.values(conditions as any);
    const pKeys = Object.keys(patch as any);
    const pVals = Object.values(patch as any);

    if (cKeys.length === 0) throw new Error("updateMany requires conditions (safety).");
    if (pKeys.length === 0) return 0;

    const schema = this.defineSchema();
    const serializedPatch = serializeJsonColumns(patch, schema);
    const serializedPVals = Object.values(serializedPatch);

    const setClause = pKeys.map((k, i) => `${k} = ${this.adapter.formatPlaceholder(i + 1)}`).join(", ");
    const whereClause = cKeys
      .map((k, i) => `${k} = ${this.adapter.formatPlaceholder(pKeys.length + i + 1)}`)
      .join(" AND ");

    const sql = `UPDATE ${this.tableName} SET ${setClause} WHERE ${whereClause}`;
    const rs = await this.adapter.execute(sql, [...serializedPVals, ...cVals]);
    return Number((rs as any)?.rowsAffected) ?? 0;
  }

  // --------------------------
  // SCHEMA SYNC
  // --------------------------

  async syncSchema(): Promise<void> {
    const schema = this.defineSchema();
    if (!schema?.length) throw new Error(`defineSchema() returned empty schema for ${this.tableName}`);

    // Delegamos toda a lógica de atualização e criação de colunas para o adapter respectivo
    await this.adapter.syncTable(this.tableName, schema);
  }
}