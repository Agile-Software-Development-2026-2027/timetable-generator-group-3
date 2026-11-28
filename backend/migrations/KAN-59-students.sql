-- KAN-59: Student profiles and extra course enrollments.
-- Apply before the KAN-69 account-linking migration.
-- The shared Supabase database is maintained by Brian.

BEGIN;

CREATE TABLE student (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    student_number VARCHAR(32) NOT NULL UNIQUE,
    degree_id INTEGER NOT NULL
        REFERENCES degree(id) ON DELETE RESTRICT,
    year_id INTEGER NOT NULL
        REFERENCES year(id) ON DELETE RESTRICT,

    CONSTRAINT ck_student_name_not_empty
        CHECK (length(trim(name)) > 0),
    CONSTRAINT ck_student_number_not_empty
        CHECK (length(trim(student_number)) > 0)
);

CREATE UNIQUE INDEX uq_student_number_ci
    ON student (lower(student_number));

CREATE TABLE enrollment (
    student_id INTEGER NOT NULL
        REFERENCES student(id) ON DELETE CASCADE,
    course_id INTEGER NOT NULL
        REFERENCES course(id) ON DELETE CASCADE,
    enrolled_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (student_id, course_id)
);

-- Access is restricted to the authorized backend.
ALTER TABLE student ENABLE ROW LEVEL SECURITY;
ALTER TABLE enrollment ENABLE ROW LEVEL SECURITY;

COMMIT;
