#!/usr/bin/env python3
from __future__ import annotations

import argparse
import os
from pathlib import Path

def _migration_files(migrations_dir: Path) -> list[Path]:
    return sorted(p for p in migrations_dir.glob('*.sql') if p.is_file())


def apply_migrations(database_url: str, migrations_dir: Path) -> None:
    import psycopg

    files = _migration_files(migrations_dir)
    if not files:
        print(f"No migration files found in {migrations_dir}")
        return

    with psycopg.connect(database_url) as conn, conn.cursor() as cur:
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS schema_migrations (
                filename TEXT PRIMARY KEY,
                applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
            """
        )

        for path in files:
            cur.execute("SELECT 1 FROM schema_migrations WHERE filename = %s", (path.name,))
            if cur.fetchone() is not None:
                print(f"Skipping already-applied migration: {path.name}")
                continue

            sql = path.read_text(encoding='utf-8')
            print(f"Applying migration: {path.name}")
            cur.execute(sql)
            cur.execute("INSERT INTO schema_migrations (filename) VALUES (%s)", (path.name,))


def main() -> None:
    parser = argparse.ArgumentParser(description='Apply SQL migrations in-order')
    parser.add_argument('--database-url', default=os.environ.get('DATABASE_URL', ''), help='Postgres connection string')
    parser.add_argument('--migrations-dir', default='migrations', help='Directory containing *.sql files')
    args = parser.parse_args()

    if not args.database_url:
        print('DATABASE_URL or --database-url is not set; skipping migrations')
        return

    apply_migrations(args.database_url, Path(args.migrations_dir))


if __name__ == '__main__':
    main()
