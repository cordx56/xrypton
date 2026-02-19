ALTER TABLE profiles
    ADD COLUMN display_name_signature TEXT NOT NULL DEFAULT '';

ALTER TABLE profiles
    ADD COLUMN status_signature TEXT NOT NULL DEFAULT '';

ALTER TABLE profiles
    ADD COLUMN bio_signature TEXT NOT NULL DEFAULT '';

ALTER TABLE profiles
    ADD COLUMN icon_signature TEXT NOT NULL DEFAULT '';
