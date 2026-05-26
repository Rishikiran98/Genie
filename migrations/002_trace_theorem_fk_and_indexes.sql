-- Link traces to canonical theorem rows.
ALTER TABLE traces
ADD COLUMN IF NOT EXISTS theorem_id BIGINT REFERENCES theorems(id) ON DELETE SET NULL;

-- Backfill theorem_id from theorem_name where possible.
INSERT INTO theorems (theorem_name, theorem_family_tags, metadata)
SELECT DISTINCT t.theorem_name, t.theorem_family_tags, t.metadata
FROM traces t
ON CONFLICT (theorem_name) DO NOTHING;

UPDATE traces tr
SET theorem_id = th.id
FROM theorems th
WHERE tr.theorem_id IS NULL
  AND tr.theorem_name = th.theorem_name;

CREATE INDEX IF NOT EXISTS idx_traces_theorem_id ON traces(theorem_id);
CREATE INDEX IF NOT EXISTS idx_transitions_created_at ON transitions(created_at);
CREATE INDEX IF NOT EXISTS idx_traces_created_at ON traces(created_at);
