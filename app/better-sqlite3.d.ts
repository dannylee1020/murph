declare module 'better-sqlite3' {
  namespace Database {
    interface Statement {
      run(...params: any[]): { changes: number };
      get(...params: any[]): unknown;
      all(...params: any[]): unknown[];
    }

    interface Database {
      exec(sql: string): void;
      prepare(sql: string): Statement;
    }
  }

  interface DatabaseConstructor {
    new (filename: string): Database.Database;
  }

  const Database: DatabaseConstructor;
  export default Database;
}
