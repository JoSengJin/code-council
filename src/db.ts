import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import type { CallMetric, Project, Session } from './types.js';

mkdirSync(resolve('data'), { recursive: true });
export const db = new DatabaseSync(resolve('data/system.sqlite'));
db.exec('PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, path TEXT NOT NULL UNIQUE, value TEXT NOT NULL); CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, value TEXT NOT NULL); CREATE TABLE IF NOT EXISTS metrics (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, value TEXT NOT NULL); CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL, value TEXT NOT NULL)');
export function saveProject(project: Project) { db.prepare('INSERT INTO projects VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET value=excluded.value').run(project.id, project.path, JSON.stringify(project)); }
export function deleteProject(id: string) { db.prepare('DELETE FROM projects WHERE id=?').run(id); }
export function getProject(id: string): Project | null { const row = db.prepare('SELECT value FROM projects WHERE id=?').get(id) as { value: string } | undefined; return row ? JSON.parse(row.value) as Project : null; }
export function projectByPath(path: string): Project | null { const row = db.prepare('SELECT value FROM projects WHERE path=?').get(path) as { value: string } | undefined; return row ? JSON.parse(row.value) as Project : null; }
export function projects(): Project[] { return (db.prepare('SELECT value FROM projects ORDER BY rowid DESC').all() as { value: string }[]).map(r => JSON.parse(r.value) as Project); }
export function saveSession(session: Session) { db.prepare('INSERT INTO sessions VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET value=excluded.value').run(session.id, JSON.stringify(session)); }
export function getSession(id: string): Session | null { const row = db.prepare('SELECT value FROM sessions WHERE id=?').get(id) as { value: string } | undefined; return row ? JSON.parse(row.value) as Session : null; }
export function sessions(): Session[] { return (db.prepare('SELECT value FROM sessions ORDER BY rowid DESC').all() as { value: string }[]).map(r => JSON.parse(r.value) as Session); }
export function deleteSession(id: string) { db.exec('BEGIN'); try { db.prepare('DELETE FROM events WHERE session_id=?').run(id); db.prepare('DELETE FROM metrics WHERE session_id=?').run(id); db.prepare('DELETE FROM sessions WHERE id=?').run(id); db.exec('COMMIT'); } catch (error) { db.exec('ROLLBACK'); throw error; } }
export function saveMetric(metric: CallMetric) { db.prepare('INSERT INTO metrics VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET value=excluded.value').run(metric.id, metric.sessionId, JSON.stringify(metric)); }
export function metrics(sessionId?: string): CallMetric[] { const rows = sessionId ? db.prepare('SELECT value FROM metrics WHERE session_id=?').all(sessionId) : db.prepare('SELECT value FROM metrics').all(); return (rows as { value: string }[]).map(r => JSON.parse(r.value) as CallMetric); }
export function saveEvent(sessionId: string, event: unknown) { db.prepare('INSERT INTO events(session_id,value) VALUES (?,?)').run(sessionId, JSON.stringify(event)); }
export function events(sessionId: string) { return (db.prepare('SELECT value FROM events WHERE session_id=? ORDER BY id').all(sessionId) as {value:string}[]).map(r => JSON.parse(r.value) as unknown); }
