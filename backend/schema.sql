-- Timetable Generator — database schema (PostgreSQL / Supabase)
--
-- This is the versioned reference of the schema that lives in Supabase.
-- The schema is owned and applied by the project maintainer directly in
-- Supabase; this file documents its exact shape so the whole team can write
-- queries and CRUD against it. It is generated from the SQLAlchemy models in
-- app/models.py (the single source of truth).
--
-- To apply it to a fresh database you can run this file with psql, or paste it
-- into the Supabase SQL editor.

CREATE TABLE degree (
	id SERIAL NOT NULL, 
	name VARCHAR(255) NOT NULL, 
	PRIMARY KEY (id), 
	CONSTRAINT ck_degree_name_not_empty CHECK (length(trim(name)) > 0), 
	UNIQUE (name)
);

CREATE TABLE room (
	id SERIAL NOT NULL, 
	code VARCHAR(255) NOT NULL, 
	capacity INTEGER NOT NULL, 
	has_projector BOOLEAN DEFAULT '0' NOT NULL, 
	has_computers BOOLEAN DEFAULT '0' NOT NULL, 
	is_lab BOOLEAN DEFAULT '0' NOT NULL, 
	PRIMARY KEY (id), 
	CONSTRAINT ck_room_capacity_positive CHECK (capacity > 0), 
	CONSTRAINT ck_room_code_not_empty CHECK (length(trim(code)) > 0), 
	UNIQUE (code)
);

CREATE TABLE slot_config (
	id INTEGER NOT NULL, 
	working_days VARCHAR(32) NOT NULL, 
	start_time TIME WITHOUT TIME ZONE NOT NULL, 
	end_time TIME WITHOUT TIME ZONE NOT NULL, 
	block_minutes INTEGER NOT NULL, 
	PRIMARY KEY (id), 
	CONSTRAINT ck_slot_block_minutes_positive CHECK (block_minutes > 0), 
	CONSTRAINT ck_slot_config_singleton CHECK (id = 1)
);

CREATE TABLE teacher (
	id SERIAL NOT NULL, 
	name VARCHAR(255) NOT NULL, 
	identifier VARCHAR(255) NOT NULL, 
	PRIMARY KEY (id), 
	CONSTRAINT ck_teacher_name_not_empty CHECK (length(trim(name)) > 0), 
	CONSTRAINT ck_teacher_identifier_not_empty CHECK (length(trim(identifier)) > 0), 
	UNIQUE (identifier)
);

CREATE TABLE year (
	id SERIAL NOT NULL, 
	degree_id INTEGER NOT NULL, 
	number INTEGER NOT NULL, 
	PRIMARY KEY (id), 
	CONSTRAINT uq_year_degree_number UNIQUE (degree_id, number), 
	CONSTRAINT ck_year_number_positive CHECK (number > 0), 
	FOREIGN KEY(degree_id) REFERENCES degree (id) ON DELETE CASCADE
);

CREATE TABLE semester (
	id SERIAL NOT NULL, 
	year_id INTEGER NOT NULL, 
	number INTEGER NOT NULL, 
	PRIMARY KEY (id), 
	CONSTRAINT uq_semester_year_number UNIQUE (year_id, number), 
	CONSTRAINT ck_semester_number_positive CHECK (number > 0), 
	FOREIGN KEY(year_id) REFERENCES year (id) ON DELETE CASCADE
);

CREATE TABLE course (
	id SERIAL NOT NULL, 
	name VARCHAR(255) NOT NULL, 
	degree_id INTEGER NOT NULL, 
	year_id INTEGER NOT NULL, 
	semester_id INTEGER NOT NULL, 
	weekly_hours INTEGER NOT NULL, 
       session_duration_minutes INTEGER DEFAULT 60 NOT NULL,
	enrolled_students INTEGER NOT NULL, 
	requires_lab BOOLEAN DEFAULT '0' NOT NULL, 
	requires_projector BOOLEAN DEFAULT '0' NOT NULL, 
	PRIMARY KEY (id), 
	CONSTRAINT uq_course_semester_name UNIQUE (semester_id, name), 
	CONSTRAINT ck_course_weekly_hours_positive CHECK (weekly_hours > 0), 
       CONSTRAINT ck_course_session_duration_positive CHECK (session_duration_minutes > 0),
       CONSTRAINT ck_course_session_duration_divides_week CHECK ((weekly_hours * 60) % session_duration_minutes = 0),
	CONSTRAINT ck_course_enrolled_students_positive CHECK (enrolled_students > 0), 
	CONSTRAINT ck_course_name_not_empty CHECK (length(trim(name)) > 0), 
	FOREIGN KEY(degree_id) REFERENCES degree (id) ON DELETE RESTRICT, 
	FOREIGN KEY(year_id) REFERENCES year (id) ON DELETE RESTRICT, 
	FOREIGN KEY(semester_id) REFERENCES semester (id) ON DELETE CASCADE
);

CREATE TABLE course_teacher (
	course_id INTEGER NOT NULL, 
	teacher_id INTEGER NOT NULL, 
	PRIMARY KEY (course_id, teacher_id), 
	FOREIGN KEY(course_id) REFERENCES course (id) ON DELETE CASCADE, 
	FOREIGN KEY(teacher_id) REFERENCES teacher (id) ON DELETE CASCADE
);

CREATE TABLE schedule_session (
	id SERIAL NOT NULL, 
	course_id INTEGER NOT NULL, 
	room_id INTEGER, 
	weekday INTEGER NOT NULL, 
	start_time TIME WITHOUT TIME ZONE NOT NULL, 
	end_time TIME WITHOUT TIME ZONE NOT NULL, 
	PRIMARY KEY (id), 
	CONSTRAINT ck_schedule_weekday CHECK (weekday BETWEEN 0 AND 6), 
	CONSTRAINT ck_schedule_time_order CHECK (start_time < end_time), 
	FOREIGN KEY(course_id) REFERENCES course (id) ON DELETE CASCADE, 
	FOREIGN KEY(room_id) REFERENCES room (id) ON DELETE SET NULL
);

-- KAN-57: time ranges a teacher marks as unavailable or preferred.
CREATE TABLE teacher_availability (
	id SERIAL NOT NULL, 
	teacher_id INTEGER NOT NULL, 
	weekday INTEGER NOT NULL, 
	start_time TIME WITHOUT TIME ZONE NOT NULL, 
	end_time TIME WITHOUT TIME ZONE NOT NULL, 
	availability_type VARCHAR(16) NOT NULL, 
	PRIMARY KEY (id), 
	CONSTRAINT ck_availability_weekday CHECK (weekday BETWEEN 0 AND 6), 
	CONSTRAINT ck_availability_time_order CHECK (start_time < end_time), 
	CONSTRAINT ck_availability_type CHECK (availability_type IN ('unavailable', 'preferred')), 
	FOREIGN KEY(teacher_id) REFERENCES teacher (id) ON DELETE CASCADE
);

-- Platform role of each Supabase Auth user (KAN-44). `id` is auth.users.id.
-- The FK to auth.users and the RLS policy exist only here: the `auth` schema
-- is not available in the SQLite test database used by the backend tests.
CREATE TABLE app_user (
	id UUID NOT NULL, 
	role VARCHAR(16) NOT NULL, 
	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	PRIMARY KEY (id), 
	CONSTRAINT ck_app_user_role CHECK (role IN ('director', 'teacher', 'student')), 
	FOREIGN KEY(id) REFERENCES auth.users (id) ON DELETE CASCADE
);

CREATE TABLE director_degree (
    user_id UUID NOT NULL,
    degree_id INTEGER NOT NULL,
    PRIMARY KEY (user_id, degree_id),
    FOREIGN KEY(user_id) REFERENCES app_user (id) ON DELETE CASCADE,
    FOREIGN KEY(degree_id) REFERENCES degree (id) ON DELETE CASCADE
);

-- Through the Supabase Data API a logged-in user can only read their own row.
-- No insert/update/delete policies: roles are assigned by the backend, which
-- connects as the table owner and is therefore not limited by these policies.
ALTER TABLE app_user ENABLE ROW LEVEL SECURITY;

CREATE POLICY app_user_select_own ON app_user
	FOR SELECT TO authenticated
	USING ((SELECT auth.uid()) = id);
