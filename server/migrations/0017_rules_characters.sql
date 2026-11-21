-- 0017_rules_characters — more kinds of research, private to the account like the rest
-- (row-level security, the one own_rows policy of 0010).
--
--   rules       a rule the reader states about the Book ("every place this word is written this
--               way, …"), what would prove it wrong, and WHICH places it covers (a scope the
--               corpus can list: a marker, a written shape, a grammar pattern).
--   rule_marks  the reader's mark on one of those places: fits, exception, or not sure. A mark
--               an AI suggested (source 'ai') counts only once the reader accepts it.
--   characters  someone the reader names, with the names and titles they file under it.
--   mentions    a place that points to a character: a name, a title, a description or a pronoun,
--               'potential' until the reader establishes it. One mention per character per place.
--
-- and two existing tables gain fields:
--   speech      who else hears the speech, and whether the text itself states the speaker
--   links       a link of kind 'tension' ("these two seem to disagree, to me") is open until the
--               reader settles it and says how
--
-- Word positions are 1-based word positions, the same the corpus uses (word_position).

CREATE TABLE IF NOT EXISTS research.rules (
  user_id uuid NOT NULL DEFAULT research.current_user_id() REFERENCES public.users(id) ON DELETE CASCADE,
  id TEXT COLLATE "C" NOT NULL,
  title TEXT COLLATE "C" NOT NULL DEFAULT '', statement TEXT COLLATE "C" NOT NULL DEFAULT '',
  falsifier TEXT COLLATE "C" NOT NULL DEFAULT '',
  scope_kind TEXT COLLATE "C" NOT NULL, scope_key TEXT COLLATE "C" NOT NULL,
  scope_text TEXT COLLATE "C" NOT NULL DEFAULT '',
  -- a grammar pattern's query, as JSON (scope_kind 'construction' only)
  scope_query TEXT COLLATE "C",
  source TEXT COLLATE "C" NOT NULL DEFAULT 'me',
  created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL,
  author_id TEXT COLLATE "C", origin TEXT COLLATE "C" NOT NULL DEFAULT 'local',
  PRIMARY KEY (user_id, id)
);

CREATE TABLE IF NOT EXISTS research.rule_marks (
  user_id uuid NOT NULL DEFAULT research.current_user_id() REFERENCES public.users(id) ON DELETE CASCADE,
  rule_id TEXT COLLATE "C" NOT NULL,
  verse_key TEXT COLLATE "C" NOT NULL, word BIGINT NOT NULL,
  mark TEXT COLLATE "C" NOT NULL, note TEXT COLLATE "C" NOT NULL DEFAULT '',
  source TEXT COLLATE "C" NOT NULL DEFAULT 'me', updated_at BIGINT NOT NULL,
  PRIMARY KEY (user_id, rule_id, verse_key, word),
  FOREIGN KEY (user_id, rule_id) REFERENCES research.rules(user_id, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS research.characters (
  user_id uuid NOT NULL DEFAULT research.current_user_id() REFERENCES public.users(id) ON DELETE CASCADE,
  id TEXT COLLATE "C" NOT NULL,
  name TEXT COLLATE "C" NOT NULL DEFAULT '', note TEXT COLLATE "C" NOT NULL DEFAULT '',
  -- the names and titles filed under it, as JSON: [{ kind, key, text, query?, as }]
  designations TEXT COLLATE "C" NOT NULL DEFAULT '[]',
  source TEXT COLLATE "C" NOT NULL DEFAULT 'me',
  created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL,
  author_id TEXT COLLATE "C", origin TEXT COLLATE "C" NOT NULL DEFAULT 'local',
  PRIMARY KEY (user_id, id)
);

CREATE TABLE IF NOT EXISTS research.mentions (
  user_id uuid NOT NULL DEFAULT research.current_user_id() REFERENCES public.users(id) ON DELETE CASCADE,
  id TEXT COLLATE "C" NOT NULL,
  character_id TEXT COLLATE "C" NOT NULL,
  verse_key TEXT COLLATE "C" NOT NULL, word BIGINT NOT NULL, words BIGINT NOT NULL DEFAULT 1,
  kind TEXT COLLATE "C" NOT NULL DEFAULT 'name', designation TEXT COLLATE "C" NOT NULL DEFAULT '',
  status TEXT COLLATE "C" NOT NULL DEFAULT 'potential', note TEXT COLLATE "C" NOT NULL DEFAULT '',
  source TEXT COLLATE "C" NOT NULL DEFAULT 'me',
  created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL,
  PRIMARY KEY (user_id, id),
  UNIQUE (user_id, character_id, verse_key, word),
  FOREIGN KEY (user_id, character_id) REFERENCES research.characters(user_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_mentions_verse ON research.mentions(user_id, verse_key);
CREATE INDEX IF NOT EXISTS idx_mentions_character ON research.mentions(user_id, character_id, status);

ALTER TABLE research.speech
  ADD COLUMN IF NOT EXISTS listeners TEXT COLLATE "C" NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS basis TEXT COLLATE "C" NOT NULL DEFAULT '';

ALTER TABLE research.links
  ADD COLUMN IF NOT EXISTS resolved BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS resolution TEXT COLLATE "C" NOT NULL DEFAULT '';

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['rules','rule_marks','characters','mentions'] LOOP
    EXECUTE format('ALTER TABLE research.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE research.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS own_rows ON research.%I', t);
    EXECUTE format(
      'CREATE POLICY own_rows ON research.%I USING (user_id = research.current_user_id()) WITH CHECK (user_id = research.current_user_id())', t);
  END LOOP;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON research.rules, research.rule_marks, research.characters, research.mentions TO mqrg_research;

-- the two plan features that go with them (server/src/plan-features.ts): interaction features,
-- so Pro by default like notes; a maintainer changes that in Admin → Access
INSERT INTO resource_access (kind, "key", min_plan)
  VALUES ('feature', 'rules', 'pro'), ('feature', 'characters', 'pro')
  ON CONFLICT (kind, "key") DO NOTHING;
