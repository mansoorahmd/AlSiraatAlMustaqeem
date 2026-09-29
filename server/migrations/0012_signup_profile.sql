-- 0012_signup_profile — open sign-up. Anyone may now create an account (POST /signup); it starts
-- as a reader on the free plan, and a maintainer promotes it (Admin → users). The sign-up form
-- asks for a date of birth (age is derived from it, never stored twice), a region (ISO 3166-1
-- alpha-2 country code) and, optionally, a gender. Accounts made before this — by invite or the
-- CLIs — have none of these, so all three stay nullable.

ALTER TABLE users ADD COLUMN IF NOT EXISTS birth_date date;
ALTER TABLE users ADD COLUMN IF NOT EXISTS region text CHECK (region ~ '^[A-Z]{2}$');
ALTER TABLE users ADD COLUMN IF NOT EXISTS gender text CHECK (gender IN ('female', 'male'));
