export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS generations (
  id TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  prompt_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  settings_json TEXT NOT NULL,
  image_paths_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'pending',
  error TEXT,
  completed_at INTEGER,
  parent_id TEXT,
  downloaded_json TEXT NOT NULL DEFAULT '[]'
);

CREATE INDEX IF NOT EXISTS idx_generations_created_at ON generations(created_at DESC);

CREATE TABLE IF NOT EXISTS user_presets (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  layer TEXT NOT NULL,
  family_id TEXT,
  def_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_user_presets_layer ON user_presets(layer);

CREATE TABLE IF NOT EXISTS model_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  filename TEXT NOT NULL,
  model_type TEXT NOT NULL,
  dest_path TEXT NOT NULL UNIQUE,
  source_path TEXT NOT NULL,
  link_type TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_model_links_filename ON model_links(filename);
`;
