from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text

from app.auth import router as auth_router
from app.availability import router as availability_router
from app.database import Base, engine
from app.degrees import router as degrees_router
from app.rooms import router as rooms_router
from app.teachers import router as teachers_router
from app.student_me import router as student_me_router
from app.students import router as students_router
from app.timetable import router as timetable_router
from app.timetable_publication import router as publication_router
from app.seed_api import router as seed_router
from app.slot_config import router as slot_config_router
from app.courses import router as courses_router
from app.timetable_generate import router as timetable_generate_router
from app.users import router as users_router


@asynccontextmanager
async def lifespan(app: FastAPI):
    if engine.dialect.name == "sqlite":
        Base.metadata.create_all(engine)

    with engine.connect() as connection:
        connection.execute(text("SELECT 1"))

    yield


app = FastAPI(
    title="University of Calabria Timetable Generator API",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_methods=["*"],
    allow_headers=["*"],
    # Browsers hide custom headers from other origins unless they are listed here.
    expose_headers=["X-Total-Count"],
)

app.include_router(auth_router)
app.include_router(degrees_router)
app.include_router(rooms_router)
app.include_router(teachers_router)
app.include_router(student_me_router)
app.include_router(students_router)
app.include_router(availability_router)
app.include_router(timetable_router)
app.include_router(publication_router)
app.include_router(seed_router)
app.include_router(courses_router)
app.include_router(slot_config_router)
app.include_router(timetable_generate_router)
app.include_router(users_router)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
