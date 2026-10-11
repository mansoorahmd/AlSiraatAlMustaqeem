-- 0007_resource_access — one rule for everything: FEATURES are role-based, RESOURCES are plan-based.
--
-- A feature is something you DO (publish, review, establish, administer) — gated by role alone.
-- A resource is something you READ — gated by a minimum plan tier, set here. Each row names a
-- resource and the lowest tier that may read it:
--
--   kind         key          means
--   corpus       *            the Qur'an corpus as a whole (text, words, roots, search, …)
--   community    *            the group's readings, dissents and divergence
--   translation  <id>         one translation (corpus.translation_resources.id) — on top of corpus
--   lexicon      <source>     one dictionary (corpus.root_meanings.source, e.g. lane) — on top of corpus
--
-- min_plan NULL means PUBLIC — anyone, no sign-in. 'free' means any signed-in account. Any other
-- tier means that tier or higher. A translation or lexicon with no row adds nothing beyond the
-- corpus requirement. Replaces 0006's corpus_policy and translation_access, carrying their values.

CREATE TABLE IF NOT EXISTS resource_access (
  kind       text NOT NULL CHECK (kind IN ('corpus', 'community', 'translation', 'lexicon')),
  "key"      text NOT NULL CHECK ("key" <> ''),
  min_plan   text REFERENCES plan_tiers(name) ON UPDATE CASCADE,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES users(id),
  PRIMARY KEY (kind, "key"),
  -- the whole-kind resources are keyed '*'; the per-item ones never are
  CONSTRAINT resource_key_shape CHECK (
    (kind IN ('corpus', 'community') AND "key" = '*') OR
    (kind IN ('translation', 'lexicon') AND "key" <> '*'))
);

-- carry 0006's corpus policy over: public → NULL, signed_in → free, plan → its tier
INSERT INTO resource_access (kind, "key", min_plan)
  SELECT 'corpus', '*', CASE access WHEN 'public' THEN NULL WHEN 'signed_in' THEN 'free' ELSE min_plan END
    FROM corpus_policy WHERE id = true
  ON CONFLICT (kind, "key") DO NOTHING;
INSERT INTO resource_access (kind, "key", min_plan) VALUES ('corpus', '*', 'pro')
  ON CONFLICT (kind, "key") DO NOTHING;
INSERT INTO resource_access (kind, "key", min_plan) VALUES ('community', '*', 'pro')
  ON CONFLICT (kind, "key") DO NOTHING;
INSERT INTO resource_access (kind, "key", min_plan)
  SELECT 'translation', resource_id::text, min_plan FROM translation_access
  ON CONFLICT (kind, "key") DO NOTHING;

DROP TABLE IF EXISTS translation_access;
DROP TABLE IF EXISTS corpus_policy;
