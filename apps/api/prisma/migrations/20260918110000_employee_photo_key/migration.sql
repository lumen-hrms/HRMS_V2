-- Module 03 gap: photoUrl was a hand-typed external URL with no upload
-- widget. Replaces it with a real upload path — the column now holds an
-- object-storage key (private bucket, same as documents), resolved to a
-- short-lived presigned URL on read. Any existing hand-typed URLs in this
-- dev-only column are not valid storage keys and will simply fail to
-- resolve — acceptable since nothing in this environment depends on them.
ALTER TABLE "public"."employees" RENAME COLUMN "photo_url" TO "photo_key";
