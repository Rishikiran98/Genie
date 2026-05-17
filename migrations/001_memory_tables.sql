-- Enable pgvector extension for vector similarity search.
CREATE EXTENSION IF NOT EXISTS vector;

-- Per-theorem execution traces.
CREATE TABLE IF NOT EXISTS traces (
    id BIGSERIAL PRIMARY KEY,
    theorem_name TEXT NOT NULL,
    theorem_family_tags TEXT[] NOT NULL DEFAULT '{}',
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Individual state transitions within a trace.
CREATE TABLE IF NOT EXISTS transitions (
    id BIGSERIAL PRIMARY KEY,
    trace_id BIGINT NOT NULL REFERENCES traces(id) ON DELETE CASCADE,
    state_text TEXT NOT NULL,
    state_embedding vector(1) NOT NULL,
    tactic TEXT NOT NULL,
    success BOOLEAN NOT NULL,
    next_state_text TEXT NOT NULL,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Optional theorem-level rollups/annotations.
CREATE TABLE IF NOT EXISTS theorems (
    id BIGSERIAL PRIMARY KEY,
    theorem_name TEXT NOT NULL UNIQUE,
    theorem_family_tags TEXT[] NOT NULL DEFAULT '{}',
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_transitions_trace_id ON transitions(trace_id);
CREATE INDEX IF NOT EXISTS idx_transitions_success ON transitions(success);
CREATE INDEX IF NOT EXISTS idx_transitions_embedding_cosine
    ON transitions USING ivfflat (state_embedding vector_cosine_ops) WITH (lists = 100);
CREATE INDEX IF NOT EXISTS idx_traces_theorem_family_tags ON traces USING GIN (theorem_family_tags);
CREATE INDEX IF NOT EXISTS idx_theorems_theorem_family_tags ON theorems USING GIN (theorem_family_tags);
