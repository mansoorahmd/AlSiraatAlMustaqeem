-- Research lives only in the account now: there is no research.db file to describe itself, so
-- the pieces that existed for files go.
--
--   • research.owner — a file's record of whose research it was. The account says that.
--   • the 'local_id' and 'local_file_brought_in' settings — a file's minted id, and the note that
--     a file had been brought in.
--   • authorship: a record's author_id was the file owner's derived id; it is now the account's
--     own id, the same as its user_id.
--
-- FORCE ROW LEVEL SECURITY applies to the tables' owner too, so it is lifted for the backfill and
-- restored straight after (a superuser bypasses it anyway).

DROP TABLE IF EXISTS research.owner;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['cases','trails','notes','user_root_meanings','motifs','word_indications',
    'compare_sets','settings'] LOOP
    EXECUTE format('ALTER TABLE research.%I NO FORCE ROW LEVEL SECURITY', t);
  END LOOP;

  FOREACH t IN ARRAY ARRAY['cases','trails','notes','user_root_meanings','motifs','word_indications',
    'compare_sets'] LOOP
    EXECUTE format('UPDATE research.%I SET author_id = user_id::text WHERE author_id IS DISTINCT FROM user_id::text', t);
  END LOOP;
  DELETE FROM research.settings WHERE key IN ('local_id', 'local_file_brought_in');

  FOREACH t IN ARRAY ARRAY['cases','trails','notes','user_root_meanings','motifs','word_indications',
    'compare_sets','settings'] LOOP
    EXECUTE format('ALTER TABLE research.%I FORCE ROW LEVEL SECURITY', t);
  END LOOP;
END $$;
