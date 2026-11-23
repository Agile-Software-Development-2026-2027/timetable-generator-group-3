-- KAN-71: Draft and published timetable separation
-- Brian applies this migration to Supabase.
-- Do not copy draft sessions automatically.

BEGIN;

CREATE TABLE published_session (
    id SERIAL PRIMARY KEY,
    degree_id INTEGER NOT NULL
        REFERENCES degree(id) ON DELETE CASCADE,
    course_id INTEGER NOT NULL
        REFERENCES course(id) ON DELETE CASCADE,
    room_id INTEGER
        REFERENCES room(id) ON DELETE SET NULL,
    weekday INTEGER NOT NULL,
    start_time TIME WITHOUT TIME ZONE NOT NULL,
    end_time TIME WITHOUT TIME ZONE NOT NULL,

    CONSTRAINT ck_published_weekday
        CHECK (weekday BETWEEN 0 AND 6),
    CONSTRAINT ck_published_time_order
        CHECK (start_time < end_time)
);

CREATE INDEX ix_published_session_degree
    ON published_session(degree_id);

CREATE TABLE timetable_publication (
    degree_id INTEGER PRIMARY KEY
        REFERENCES degree(id) ON DELETE CASCADE,
    published_at TIMESTAMP WITH TIME ZONE
        NOT NULL DEFAULT now(),
    published_by UUID NOT NULL
        REFERENCES app_user(id) ON DELETE RESTRICT
);

COMMIT;
