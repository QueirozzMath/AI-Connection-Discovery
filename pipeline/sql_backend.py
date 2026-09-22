"""Small DB-API adapter; the same SQL and transactions serve SQLite and PostgreSQL."""
import sqlite3

class Row(dict):
    def __getitem__(self, key):
        return list(self.values())[key] if isinstance(key, int) else super().__getitem__(key)
    def __iter__(self):
        return iter(self.values())

def pg_row(cursor):
    names = [column.name for column in cursor.description] if cursor.description else []
    return lambda values: Row(zip(names,values))

def sql_pg(sql):
    return sql.replace("?", "%s").replace(" WITHOUT ROWID", "")

class Postgres:
    def __init__(self, dsn):
        import psycopg
        self.db = psycopg.connect(dsn, row_factory=pg_row)
    def execute(self, sql, params=()):
        if sql.startswith("PRAGMA"): return self.db.cursor()
        return self.db.execute(sql_pg(sql), params)
    def executemany(self, sql, params):
        cursor = self.db.cursor(); cursor.executemany(sql_pg(sql), params); return cursor
    def executescript(self, sql):
        for statement in sql.split(";"):
            if statement.strip(): self.execute(statement.strip())
        self.db.commit()
    def commit(self): self.db.commit()
    def close(self): self.db.close()
    def __enter__(self): return self
    def __exit__(self, kind, value, traceback):
        self.db.rollback() if kind else self.db.commit()

def connect_database(path):
    if str(path).startswith(("postgresql://", "postgres://")):
        return Postgres(str(path))
    db = sqlite3.connect(path, timeout=60)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA foreign_keys=ON")
    return db
