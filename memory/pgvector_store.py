from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

from memory.embeddings import embed_text

try:
    import psycopg
except ImportError:  # pragma: no cover - optional dependency for local dev fallback
    psycopg = None


@dataclass
class TransitionRecord:
    state_text: str
    tactic: str
    success: bool
    next_state_text: str
    theorem_name: str | None = None
    theorem_family_tags: list[str] = field(default_factory=list)
    trace_id: int | None = None
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass
class InMemoryVectorStore:
    records: list[TransitionRecord] = field(default_factory=list)

    def upsert_transition(self, rec: TransitionRecord) -> None:
        self.records.append(rec)

    def upsert_trace_with_transitions(
        self,
        theorem_name: str,
        transitions: list[TransitionRecord],
        theorem_family_tags: list[str] | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> int:
        trace_id = len(self.records) + 1
        theorem_family_tags = theorem_family_tags or []
        metadata = metadata or {}
        for rec in transitions:
            rec.trace_id = trace_id
            rec.theorem_name = rec.theorem_name or theorem_name
            rec.theorem_family_tags = rec.theorem_family_tags or theorem_family_tags
            rec.metadata = {**metadata, **rec.metadata}
            self.upsert_transition(rec)
        return trace_id

    def query_similar(
        self,
        goal: str,
        top_k: int = 5,
        success: bool | None = None,
        theorem_family_tags: list[str] | None = None,
        date_from: datetime | None = None,
        date_to: datetime | None = None,
    ) -> list[dict[str, Any]]:
        del date_from, date_to
        scored = []
        goal_terms = set(goal.split())
        theorem_family_tags = theorem_family_tags or []
        for r in self.records:
            if success is not None and r.success != success:
                continue
            if theorem_family_tags and not set(theorem_family_tags).issubset(set(r.theorem_family_tags)):
                continue
            overlap = len(goal_terms.intersection(set(r.state_text.split())))
            scored.append((overlap, r))
        scored.sort(key=lambda x: x[0], reverse=True)
        return [
            {
                "goal": r.state_text,
                "tactic": r.tactic,
                "success": r.success,
                "trace_id": r.trace_id,
                "theorem_name": r.theorem_name,
                "theorem_family_tags": r.theorem_family_tags,
                "metadata": r.metadata,
            }
            for _, r in scored[:top_k]
        ]


class PgVectorStore:
    def __init__(self, dsn: str):
        if psycopg is None:
            raise RuntimeError("psycopg is required for PgVectorStore")
        self.dsn = dsn

    def upsert_theorem(
        self,
        theorem_name: str,
        theorem_family_tags: list[str] | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> int:
        theorem_family_tags = theorem_family_tags or []
        metadata = metadata or {}
        with psycopg.connect(self.dsn) as conn, conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO theorems (theorem_name, theorem_family_tags, metadata)
                VALUES (%s, %s, %s)
                ON CONFLICT (theorem_name)
                DO UPDATE SET theorem_family_tags = EXCLUDED.theorem_family_tags,
                              metadata = EXCLUDED.metadata,
                              updated_at = NOW()
                RETURNING id
                """,
                (theorem_name, theorem_family_tags, metadata),
            )
            return int(cur.fetchone()[0])

    def upsert_trace(
        self,
        theorem_name: str,
        theorem_family_tags: list[str] | None = None,
        metadata: dict[str, Any] | None = None,
        trace_id: int | None = None,
    ) -> int:
        theorem_id = self.upsert_theorem(theorem_name, theorem_family_tags, metadata)
        with psycopg.connect(self.dsn) as conn, conn.cursor() as cur:
            if trace_id is None:
                cur.execute(
                    """
                    INSERT INTO traces (theorem_id, theorem_name, theorem_family_tags, metadata)
                    VALUES (%s, %s, %s, %s)
                    RETURNING id
                    """,
                    (theorem_id, theorem_name, theorem_family_tags or [], metadata or {}),
                )
                return int(cur.fetchone()[0])

            cur.execute(
                """
                UPDATE traces
                SET theorem_id = %s,
                    theorem_name = %s,
                    theorem_family_tags = %s,
                    metadata = %s,
                    updated_at = NOW()
                WHERE id = %s
                RETURNING id
                """,
                (theorem_id, theorem_name, theorem_family_tags or [], metadata or {}, trace_id),
            )
            row = cur.fetchone()
            if row is None:
                raise ValueError(f"trace_id={trace_id} does not exist")
            return int(row[0])

    def upsert_transition(self, rec: TransitionRecord) -> int:
        if rec.trace_id is None:
            raise ValueError("trace_id is required for PgVectorStore transitions")

        embedding = embed_text(rec.state_text)

        with psycopg.connect(self.dsn) as conn, conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO transitions (trace_id, state_text, state_embedding, tactic, success, next_state_text, metadata)
                VALUES (%s, %s, %s::vector, %s, %s, %s, %s)
                RETURNING id
                """,
                (rec.trace_id, rec.state_text, embedding, rec.tactic, rec.success, rec.next_state_text, rec.metadata),
            )
            return int(cur.fetchone()[0])

    def upsert_trace_with_transitions(
        self,
        theorem_name: str,
        transitions: list[TransitionRecord],
        theorem_family_tags: list[str] | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> int:
        theorem_family_tags = theorem_family_tags or []
        metadata = metadata or {}
        if not transitions:
            raise ValueError("at least one transition is required")

        with psycopg.connect(self.dsn) as conn, conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO theorems (theorem_name, theorem_family_tags, metadata)
                VALUES (%s, %s, %s)
                ON CONFLICT (theorem_name)
                DO UPDATE SET theorem_family_tags = EXCLUDED.theorem_family_tags,
                              metadata = EXCLUDED.metadata,
                              updated_at = NOW()
                RETURNING id
                """,
                (theorem_name, theorem_family_tags, metadata),
            )
            theorem_id = int(cur.fetchone()[0])

            cur.execute(
                """
                INSERT INTO traces (theorem_id, theorem_name, theorem_family_tags, metadata)
                VALUES (%s, %s, %s, %s)
                RETURNING id
                """,
                (theorem_id, theorem_name, theorem_family_tags, metadata),
            )
            trace_id = int(cur.fetchone()[0])

            for rec in transitions:
                rec.trace_id = trace_id
                embedding = embed_text(rec.state_text)
                cur.execute(
                    """
                    INSERT INTO transitions (trace_id, state_text, state_embedding, tactic, success, next_state_text, metadata)
                    VALUES (%s, %s, %s::vector, %s, %s, %s, %s)
                    """,
                    (trace_id, rec.state_text, embedding, rec.tactic, rec.success, rec.next_state_text, rec.metadata),
                )

            return trace_id

    def query_similar(
        self,
        goal: str,
        top_k: int = 5,
        success: bool | None = None,
        theorem_family_tags: list[str] | None = None,
        date_from: datetime | None = None,
        date_to: datetime | None = None,
    ) -> list[dict[str, Any]]:
        theorem_family_tags = theorem_family_tags or []
        query_embedding = embed_text(goal)
        params: list[Any] = [query_embedding]

        where_clauses: list[str] = []
        if success is not None:
            where_clauses.append("t.success = %s")
            params.append(success)
        if theorem_family_tags:
            where_clauses.append("th.theorem_family_tags @> %s")
            params.append(theorem_family_tags)
        if date_from is not None:
            where_clauses.append("t.created_at >= %s")
            params.append(date_from)
        if date_to is not None:
            where_clauses.append("t.created_at <= %s")
            params.append(date_to)

        where_sql = ""
        if where_clauses:
            where_sql = "WHERE " + " AND ".join(where_clauses)

        params.extend([query_embedding, top_k])
        query = f"""
            SELECT
                t.state_text,
                t.tactic,
                t.success,
                t.trace_id,
                tr.theorem_name,
                th.theorem_family_tags,
                t.metadata,
                (t.state_embedding <=> %s::vector) AS distance
            FROM transitions t
            JOIN traces tr ON tr.id = t.trace_id
            JOIN theorems th ON th.id = tr.theorem_id
            {where_sql}
            ORDER BY t.state_embedding <=> %s::vector
            LIMIT %s
        """

        with psycopg.connect(self.dsn) as conn, conn.cursor() as cur:
            cur.execute(query, params)
            rows = cur.fetchall()

        return [
            {
                "goal": row[0],
                "tactic": row[1],
                "success": row[2],
                "trace_id": row[3],
                "theorem_name": row[4],
                "theorem_family_tags": row[5],
                "metadata": row[6],
                "distance": float(row[7]),
            }
            for row in rows
        ]
