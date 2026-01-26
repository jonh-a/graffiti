-- Create users table
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ink INTEGER NOT NULL DEFAULT 200,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Create canvas_state table
CREATE TABLE canvas_state (
  id INTEGER PRIMARY KEY DEFAULT 1,
  pixels JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (id = 1)
);

-- Create pixel_changes table (optional, for analytics)
CREATE TABLE pixel_changes (
  id BIGSERIAL PRIMARY KEY,
  x INTEGER NOT NULL,
  y INTEGER NOT NULL,
  color TEXT NOT NULL,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_pixel_changes_time ON pixel_changes(changed_at);
CREATE INDEX idx_pixel_changes_user ON pixel_changes(user_id);

-- Enable RLS
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE canvas_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE pixel_changes ENABLE ROW LEVEL SECURITY;

-- Policies
CREATE POLICY "Anyone can read canvas" ON canvas_state FOR SELECT USING (true);
CREATE POLICY "Anyone can update canvas" ON canvas_state FOR UPDATE USING (true) WITH CHECK (true);

CREATE POLICY "Users can read own data" ON users FOR SELECT USING (true);
CREATE POLICY "Users can update own ink" ON users FOR UPDATE USING (true) WITH CHECK (true);

CREATE POLICY "Anyone can read pixel changes" ON pixel_changes FOR SELECT USING (true);
CREATE POLICY "Anyone can insert pixel changes" ON pixel_changes FOR INSERT WITH CHECK (true);

-- Initialize canvas
INSERT INTO canvas_state (id, pixels) 
VALUES (1, '{}'::jsonb)
ON CONFLICT (id) DO NOTHING;