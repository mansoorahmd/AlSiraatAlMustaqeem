-- 0013_plan_features — plans unlock FEATURES, one rule each (server/src/plan-features.ts), in three
-- groups a maintainer sets in Admin → Access. The single corpus switch and the community switch go:
-- the corpus is now split into its read-assist tools, and the community is one feature among the
-- research ones.
--
-- Defaults: every read-assist tool (the text, translations, search, roots, meanings, trails,
-- echoes, similar āyāt, spellings, patterns, where roots meet, the āyah lens, compare) is free to
-- any signed-in account; the interaction features (notes, indications, my meanings, motifs) and the
-- research & publication ones (cases, publish, divergences, the AI assistant) need Pro. The
-- community keeps whatever its rule was.

ALTER TABLE resource_access DROP CONSTRAINT IF EXISTS resource_key_shape;
ALTER TABLE resource_access DROP CONSTRAINT IF EXISTS resource_access_kind_check;

INSERT INTO resource_access (kind, "key", min_plan)
  SELECT 'feature', f.key, f.min_plan
    FROM (VALUES
      ('text', 'free'), ('translations', 'free'), ('search', 'free'), ('roots', 'free'),
      ('meanings', 'free'), ('follow-root', 'free'), ('follow-word', 'free'), ('echoes', 'free'),
      ('similar', 'free'), ('spelling', 'free'), ('wazn', 'free'), ('linkages', 'free'),
      ('lens', 'free'), ('compare', 'free'),
      ('notes', 'pro'), ('indications', 'pro'), ('my-meanings', 'pro'), ('motifs', 'pro'),
      ('cases', 'pro'), ('publish', 'pro'), ('divergences', 'pro'), ('ai', 'pro')
    ) AS f(key, min_plan)
  ON CONFLICT (kind, "key") DO NOTHING;

-- the community's rule carries over as a feature (pro when it never had one)
INSERT INTO resource_access (kind, "key", min_plan)
  SELECT 'feature', 'community',
         CASE WHEN EXISTS (SELECT 1 FROM resource_access WHERE kind = 'community' AND "key" = '*')
              THEN (SELECT min_plan FROM resource_access WHERE kind = 'community' AND "key" = '*')
              ELSE 'pro' END
  ON CONFLICT (kind, "key") DO NOTHING;

DELETE FROM resource_access WHERE kind IN ('corpus', 'community');

ALTER TABLE resource_access ADD CONSTRAINT resource_access_kind_check
  CHECK (kind IN ('feature', 'translation', 'lexicon'));
-- the feature keys themselves are checked in code (plan-features.ts), so a new feature needs no
-- migration; here only their shape
ALTER TABLE resource_access ADD CONSTRAINT resource_key_shape CHECK (
  (kind = 'feature' AND "key" ~ '^[a-z][a-z-]{0,31}$') OR
  (kind IN ('translation', 'lexicon') AND "key" <> '*'));
