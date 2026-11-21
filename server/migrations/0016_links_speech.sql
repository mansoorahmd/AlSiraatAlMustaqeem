-- 0016_links_speech — two more kinds of research, private to the account like the rest
-- (row-level security, the one own_rows policy of 0010).
--
--   links   a link the reader saves between two places in the Book: a word span in one āyah and a
--           word span in another, with what they share, a kind, a note, and an optional label
--           that groups links (one image, one theme). A link with only its first end is a LEAD:
--           something noticed, the other end still to find.
--   speech  who speaks in a span of an āyah, and to whom, as the reader tags it. The corpus does
--           not say; this is the reader's own reading, so it lives with their research.
--
-- Word spans are 1-based word positions, the same positions the corpus uses (word_position).

CREATE TABLE IF NOT EXISTS research.links (
  user_id uuid NOT NULL DEFAULT research.current_user_id() REFERENCES public.users(id) ON DELETE CASCADE,
  id TEXT COLLATE "C" NOT NULL,
  a_verse TEXT COLLATE "C" NOT NULL, a_word BIGINT NOT NULL, a_words BIGINT NOT NULL DEFAULT 1,
  b_verse TEXT COLLATE "C", b_word BIGINT, b_words BIGINT,
  kind TEXT COLLATE "C" NOT NULL DEFAULT '',
  marker_kind TEXT COLLATE "C", marker_key TEXT COLLATE "C", marker_text TEXT COLLATE "C",
  label TEXT COLLATE "C" NOT NULL DEFAULT '', note TEXT COLLATE "C" NOT NULL DEFAULT '',
  status TEXT COLLATE "C" NOT NULL DEFAULT 'kept', source TEXT COLLATE "C" NOT NULL DEFAULT 'me',
  created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL,
  author_id TEXT COLLATE "C", origin TEXT COLLATE "C" NOT NULL DEFAULT 'local',
  PRIMARY KEY (user_id, id)
);
CREATE INDEX IF NOT EXISTS idx_links_a ON research.links(user_id, a_verse);
CREATE INDEX IF NOT EXISTS idx_links_b ON research.links(user_id, b_verse);
CREATE INDEX IF NOT EXISTS idx_links_marker ON research.links(user_id, marker_kind, marker_key);
CREATE INDEX IF NOT EXISTS idx_links_label ON research.links(user_id, label);

CREATE TABLE IF NOT EXISTS research.speech (
  user_id uuid NOT NULL DEFAULT research.current_user_id() REFERENCES public.users(id) ON DELETE CASCADE,
  id TEXT COLLATE "C" NOT NULL,
  verse_key TEXT COLLATE "C" NOT NULL, word BIGINT NOT NULL DEFAULT 1, words BIGINT,
  speaker TEXT COLLATE "C" NOT NULL DEFAULT '', addressee TEXT COLLATE "C" NOT NULL DEFAULT '',
  note TEXT COLLATE "C" NOT NULL DEFAULT '', source TEXT COLLATE "C" NOT NULL DEFAULT 'me',
  created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL,
  author_id TEXT COLLATE "C", origin TEXT COLLATE "C" NOT NULL DEFAULT 'local',
  PRIMARY KEY (user_id, id)
);
CREATE INDEX IF NOT EXISTS idx_speech_verse ON research.speech(user_id, verse_key);
CREATE INDEX IF NOT EXISTS idx_speech_speaker ON research.speech(user_id, speaker);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['links','speech'] LOOP
    EXECUTE format('ALTER TABLE research.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE research.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS own_rows ON research.%I', t);
    EXECUTE format(
      'CREATE POLICY own_rows ON research.%I USING (user_id = research.current_user_id()) WITH CHECK (user_id = research.current_user_id())', t);
  END LOOP;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON research.links, research.speech TO mqrg_research;

-- the two plan features that go with them (server/src/plan-features.ts): interaction features,
-- so Pro by default like notes; a maintainer changes that in Admin → Access
INSERT INTO resource_access (kind, "key", min_plan)
  VALUES ('feature', 'links', 'pro'), ('feature', 'speakers', 'pro')
  ON CONFLICT (kind, "key") DO NOTHING;
