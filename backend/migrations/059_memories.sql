-- 059: Baaton Memory Layer

CREATE TABLE IF NOT EXISTS memories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id TEXT NOT NULL,
    project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
    source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'api', 'ai_chat', 'tldr', 'github', 'slack', 'email', 'memory_store')),
    kind TEXT NOT NULL DEFAULT 'fact' CHECK (kind IN ('fact', 'decision', 'learning', 'constraint', 'risk', 'handoff', 'integration', 'note')),
    content TEXT NOT NULL CHECK (length(trim(content)) > 0),
    tags TEXT[] NOT NULL DEFAULT '{}',
    confidence DOUBLE PRECISION NOT NULL DEFAULT 0.80 CHECK (confidence >= 0 AND confidence <= 1),
    external_url TEXT,
    embedding JSONB,
    metadata JSONB NOT NULL DEFAULT '{}',
    created_by TEXT,
    created_by_name TEXT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_memories_org_project_created ON memories(org_id, project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_memories_org_kind ON memories(org_id, kind);
CREATE INDEX IF NOT EXISTS idx_memories_source ON memories(source);
CREATE INDEX IF NOT EXISTS idx_memories_tags ON memories USING GIN(tags);
CREATE INDEX IF NOT EXISTS idx_memories_content_search ON memories USING GIN(to_tsvector('simple', content));

CREATE OR REPLACE FUNCTION set_memories_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_memories_updated_at ON memories;
CREATE TRIGGER trg_memories_updated_at
    BEFORE UPDATE ON memories
    FOR EACH ROW
    EXECUTE FUNCTION set_memories_updated_at();
