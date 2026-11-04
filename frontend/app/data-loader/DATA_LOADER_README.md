# Data Loader — KAN-11

The **Data Loader** allows timetable administrators to import, validate, and view academic datasets through a dedicated page.

**User Story:** As a timetable administrator, I want to manually load sample data so that I can test the system end to end.

## Features

- **JSON Import:** Load degree programmes, years, semesters, courses, teachers, and rooms.
- **Data Validation:** Validate required fields, relationships, and data integrity before importing.
- **Conflict Handling:** Detect shared-room conflicts and allow confirmed reuse without overwriting existing records.
- **Import Preview:** Review dataset details and confirm before importing.
- **Academic Records:** View persisted courses, teachers, rooms, years, and semesters.
- **Search & Pagination:** Filter by degree, search records, and navigate tables with 5, 10, 20, or 50 rows per page.
- **Refresh:** Retrieve the latest database records without reloading the page.

## How to Use

1. Open **Data Loader** from the navigation menu (`/data-loader`).
2. Click **Import Data** and select a JSON dataset.
3. Click **Validate** to review the dataset summary and any conflicts.
4. Approve reuse of existing room properties if needed.
5. Confirm the import.
6. View the persisted records using the available tabs.

## Data Integrity

- Prevents duplicate records when importing the same dataset repeatedly.
- Rejects invalid or conflicting data.
- Rolls back failed imports.
- Preserves existing database room values.

## Acceptance Criteria

The Data Loader supports loading realistic sample datasets, validating their contents, preventing duplicates, and displaying persisted academic records through searchable and paginated lists.
