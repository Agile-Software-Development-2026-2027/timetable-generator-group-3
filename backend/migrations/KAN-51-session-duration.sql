-- KAN-51: Configurable course session duration
-- Brian: Apply once in Supabase SQL Editor.
-- Existing courses retain the default 60-minute duration.

BEGIN;

ALTER TABLE public.course
    ADD COLUMN session_duration_minutes INTEGER
    NOT NULL DEFAULT 60;

ALTER TABLE public.course
    ADD CONSTRAINT ck_course_session_duration_positive
    CHECK (session_duration_minutes > 0);

ALTER TABLE public.course
    ADD CONSTRAINT ck_course_session_duration_divides_week
    CHECK (
        (weekly_hours * 60) % session_duration_minutes = 0
    );

COMMIT;
