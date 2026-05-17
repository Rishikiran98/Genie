from __future__ import annotations

from dataclasses import dataclass, field
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

    def query_similar(
        self,
        goal: str,
        top_k: int = 5,
        success: bool | None = None,
        theorem_family_tags: list[str] | None = None,
    ) -> list[dict[str, Any]]:
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

    def upsert_trace(
        self,
        theorem_name: str,
        theorem_family_tags: list[str] | None = None,
        metadata: dict[str, Any] | None = None,
        trace_id: int | None = None,
    ) -> int:
        theorem_family_tags = theorem_family_tags or []
        metadata = metadata or {}

        with psycopg.connect(self.dsn) as conn, conn.cursor() as cur:
            if trace_id is None:
                cur.execute(
                    """
                    INSERT INTO traces (theorem_name, theorem_family_tags, metadata)
                    VALUES (%s, %s, %s)
                    RETURNING id
                    """,
                    (theorem_name, theorem_family_tags, metadata),
                )
                return int(cur.fetchone()[0])

            cur.execute(
                """
                UPDATE traces
                SET theorem_name = %s,
                    theorem_family_tags = %s,
                    metadata = %s,
                    updated_at = NOW()
                WHERE id = %s
                RETURNING id
                """,
                (theorem_name, theorem_family_tags, metadata, trace_id),
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

    def query_similar(
        self,
        goal: str,
        top_k: int = 5,
        success: bool | None = None,
        theorem_family_tags: list[str] | None = None,
    ) -> list[dict[str, Any]]:
        theorem_family_tags = theorem_family_tags or []
        params: list[Any] = [embed_text(goal)]

        where_clauses: list[str] = []
        if success is not None:
            where_clauses.append("t.success = %s")
            params.append(success)
        if theorem_family_tags:
            where_clauses.append("tr.theorem_family_tags @> %s")
            params.append(theorem_family_tags)

        where_sql = ""
        if where_clauses:
            where_sql = "WHERE " + " AND ".join(where_clauses)

        params.append(top_k)
        query = f"""
            SELECT
                t.state_text,
                t.tactic,
                t.success,
                t.trace_id,
                tr.theorem_name,
                tr.theorem_family_tags,
                t.metadata,
                (t.state_embedding <=> %s::vector) AS distance
            FROM transitions t
            JOIN traces tr ON tr.id = t.trace_id
            {where_sql}
            ORDER BY t.state_embedding <=> %s::vector
            LIMIT %s
        """

        params.insert(-1, params[0])

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
