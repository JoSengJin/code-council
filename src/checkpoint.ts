import { DatabaseSync } from 'node:sqlite';
import { MemorySaver } from '@langchain/langgraph';

// shortcut: saves the full graph snapshot each step; use row-level storage if session volume grows.
export class SqliteCheckpoint extends MemorySaver {
  private db: DatabaseSync;
  constructor(path: string) {
    super();
    this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS graph_state (id INTEGER PRIMARY KEY CHECK(id=1), value TEXT NOT NULL)');
    const row = this.db.prepare('SELECT value FROM graph_state WHERE id=1').get() as {value:string}|undefined;
    if(row){const state=JSON.parse(row.value,(key,value)=>value?.__bytes?Uint8Array.from(Buffer.from(value.__bytes,'base64')):value);this.storage=state.storage;this.writes=state.writes;}
  }
  private persist(){
    const value=JSON.stringify({storage:this.storage,writes:this.writes},(key,value)=>value instanceof Uint8Array?{__bytes:Buffer.from(value).toString('base64')}:value);
    this.db.prepare('INSERT INTO graph_state(id,value) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value').run(value);
  }
  override async put(...args:Parameters<MemorySaver['put']>){const result=await super.put(...args);this.persist();return result;}
  override async putWrites(...args:Parameters<MemorySaver['putWrites']>){await super.putWrites(...args);this.persist();}
  override async deleteThread(...args:Parameters<MemorySaver['deleteThread']>){await super.deleteThread(...args);this.persist();}
}
