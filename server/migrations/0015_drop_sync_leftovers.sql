-- 0015_drop_sync_leftovers — what the first, offline-first design left behind and nothing uses.
--
--   users.local_id   a device identity minted before sign-in, bound to the account later. Research
--                    lives only in the account now, so there is no device to bind.
--   sync_cursors     where a client's position in the pull streams would have been kept. The app
--                    reads the community live (GET /community/readings, GET /claims); the pull
--                    endpoint is gone.

ALTER TABLE users DROP COLUMN IF EXISTS local_id;
DROP TABLE IF EXISTS sync_cursors;
