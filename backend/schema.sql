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
	enrolled_students INTEGER NOT NULL, 
	requires_lab BOOLEAN DEFAULT '0' NOT NULL, 
	PRIMARY KEY (id), 
	CONSTRAINT uq_course_semester_name UNIQUE (semester_id, name), 
	CONSTRAINT ck_course_weekly_hours_positive CHECK (weekly_hours > 0), 
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
