-- An invite with no role named grants researcher: what the app and createInvite (invites.ts) have
-- always used. The column said 'reader' since 0001, so the two disagreed; they now match.

ALTER TABLE invites ALTER COLUMN role SET DEFAULT 'researcher';
