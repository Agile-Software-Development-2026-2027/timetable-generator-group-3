BEGIN;

-- KAN-72: optional teacher workload preferences.
CREATE TABLE teacher_preferences (
    teacher_id INTEGER PRIMARY KEY
        REFERENCES teacher(id) ON DELETE CASCADE,
    max_hours_per_day INTEGER,
    max_teaching_days INTEGER,
    max_consecutive_hours INTEGER,
    preferred_part_of_day VARCHAR(16),

    CONSTRAINT ck_teacher_preferences_daily_hours
        CHECK (max_hours_per_day > 0),
    CONSTRAINT ck_teacher_preferences_teaching_days
        CHECK (max_teaching_days BETWEEN 1 AND 6),
    CONSTRAINT ck_teacher_preferences_consecutive_hours
        CHECK (max_consecutive_hours > 0),
    CONSTRAINT ck_teacher_preferences_part_of_day
        CHECK (preferred_part_of_day IN ('morning', 'afternoon', 'none'))
);

-- Preferences are accessed through the authorized backend only.
ALTER TABLE teacher_preferences ENABLE ROW LEVEL SECURITY;

COMMIT;
