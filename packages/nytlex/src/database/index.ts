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
import { BaseTable, DatabaseConnector, DbConfig } from "./OrmDatabase";

export default class Database {
  public db: DatabaseConnector;
  public ready: Promise<void>;

  constructor(config: DbConfig, tables: Array<BaseTable<any, any, any>> = []) {
    this.db = new DatabaseConnector(config);

    // auto-init
    this.ready = this.initializeTables(tables);
  }

  public async initializeTables(tables: Array<BaseTable<any, any, any>>) {
    for (const table of tables) {
      table.setConnector(this.db);
      await table.syncSchema();
    }
  }
}

export * from "./OrmDatabase";