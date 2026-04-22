---
name: python-backend
description: Python backend patterns for FastAPI, SQLAlchemy 2.0, async, and testing. Use when writing, reviewing, or refactoring Python backend code. Triggers on tasks involving API endpoints, Pydantic models, SQLAlchemy ORM models, async patterns, or Python testing.
---

# Python Backend Patterns

Expert-level Python patterns for FastAPI, SQLAlchemy 2.0, and async programming.

This project uses a hybrid DB strategy:
- **SQLAlchemy ORM** (`db/orm/`) for simple CRUD domains (users, sessions, settings, tidal, genres, health, releases)
- **SQLAlchemy Core / `text()`** (`db/queries/`, `db/jobs/`) for complex queries (analytics, browse, bliss, task claiming)
- **Alembic** for schema migrations (`db/migrations/`)
- **Pydantic v2** for API schemas (`api/schemas/`) and data models (`db/models/`)

## When to Apply

- Writing or reviewing FastAPI endpoints
- Creating Pydantic models for request/response validation
- Adding or modifying SQLAlchemy ORM models
- Working with async patterns or concurrency
- Writing tests
- Designing error handling

---

## 1. FastAPI Patterns

### Pydantic Models

```python
from pydantic import BaseModel, EmailStr, Field, field_validator

class UserCreate(BaseModel):
    email: EmailStr
    name: str = Field(..., min_length=2, max_length=100)
    password: str = Field(..., min_length=8)

    @field_validator('name')
    @classmethod
    def name_must_not_be_empty(cls, v: str) -> str:
        if not v.strip():
            raise ValueError('Name cannot be empty')
        return v.strip()

    model_config = {'str_strip_whitespace': True}
```

### Dependency Injection

```python
from typing import Annotated
from fastapi import Depends, HTTPException

async def get_current_user(
    token: str = Depends(oauth2_scheme),
    db: AsyncSession = Depends(get_db)
) -> User:
    user = await verify_token(token, db)
    if user is None:
        raise HTTPException(status_code=401, detail="Invalid token")
    return user

CurrentUser = Annotated[User, Depends(get_current_user)]

@app.get("/me")
async def get_me(user: CurrentUser):
    return user
```

### Background Tasks

```python
from fastapi import BackgroundTasks

@app.post("/users/")
async def create_user(
    user: UserCreate,
    background_tasks: BackgroundTasks,
):
    db_user = await crud.create_user(user)
    background_tasks.add_task(send_welcome_email, user.email)
    return db_user
```

### Exception Handling

```python
from fastapi import HTTPException
from fastapi.responses import JSONResponse

class AppException(Exception):
    def __init__(self, code: str, message: str, status_code: int = 400):
        self.code = code
        self.message = message
        self.status_code = status_code

@app.exception_handler(AppException)
async def app_exception_handler(request, exc: AppException):
    return JSONResponse(
        status_code=exc.status_code,
        content={"code": exc.code, "message": exc.message}
    )
```

### Lifespan Events

```python
from contextlib import asynccontextmanager

@asynccontextmanager
async def lifespan(app: FastAPI):
    await database.connect()
    yield
    await database.disconnect()

app = FastAPI(lifespan=lifespan)
```

---

## 2. SQLAlchemy 2.0 ORM Patterns

### Declarative Models (Mapped style)

```python
from sqlalchemy import DateTime, ForeignKey, Integer, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from crate.db.engine import Base

class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    email: Mapped[str] = mapped_column(Text, unique=True, nullable=False)
    name: Mapped[str | None] = mapped_column(Text)
    role: Mapped[str] = mapped_column(Text, nullable=False, server_default="user")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)

    sessions: Mapped[list["Session"]] = relationship(back_populates="user")
```

### Eager Loading (prevent N+1)

```python
from sqlalchemy.orm import selectinload, joinedload
from sqlalchemy import select

stmt = select(User).options(
    selectinload(User.sessions),  # Separate IN query
    joinedload(User.profile)      # JOIN
)
```

### Async Queries

```python
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

async def get_user(db: AsyncSession, user_id: int) -> User | None:
    stmt = select(User).where(User.id == user_id)
    result = await db.execute(stmt)
    return result.scalar_one_or_none()
```

### Pagination

```python
from sqlalchemy import func, select

async def get_users_paginated(
    db: AsyncSession, page: int = 1, per_page: int = 20
) -> tuple[list[User], int]:
    total = await db.scalar(select(func.count()).select_from(User))
    stmt = select(User).offset((page - 1) * per_page).limit(per_page)
    result = await db.execute(stmt)
    return result.scalars().all(), total
```

---

## 3. Async Patterns

### Parallel Operations

```python
import asyncio

async def get_dashboard_data(user_id: int) -> dict:
    user, posts, notifications = await asyncio.gather(
        get_user(user_id),
        get_user_posts(user_id),
        get_notifications(user_id)
    )
    return {"user": user, "posts": posts, "notifications": notifications}
```

### Timeout Handling

```python
async def fetch_with_timeout(url: str, timeout: float = 5.0):
    async with asyncio.timeout(timeout):
        async with httpx.AsyncClient() as client:
            return await client.get(url)
```

### Rate Limiting

```python
semaphore = asyncio.Semaphore(10)

async def fetch_limited(url: str):
    async with semaphore:
        return await fetch(url)
```

### Task Groups (Python 3.11+)

```python
async def process_all(items: list[Item]):
    async with asyncio.TaskGroup() as tg:
        for item in items:
            tg.create_task(process_item(item))
```

---

## 4. Type Hints (Python 3.12+)

```python
# Modern union syntax
def get_users(active: bool | None = None) -> list[User]:
    ...

# TypeVar for generics
from typing import TypeVar
T = TypeVar('T', bound=BaseModel)

async def get_or_404(model: type[T], id: int) -> T:
    obj = await db.get(model, id)
    if obj is None:
        raise HTTPException(status_code=404)
    return obj

# Protocol for structural typing
from typing import Protocol

class Repository(Protocol):
    async def get(self, id: int) -> Model | None: ...
    async def create(self, data: dict) -> Model: ...
    async def delete(self, id: int) -> bool: ...
```

---

## 5. Testing Patterns

### Pytest Fixtures

```python
import pytest
from httpx import AsyncClient

@pytest.fixture
async def client(app):
    async with AsyncClient(app=app, base_url="http://test") as client:
        yield client
```

### Parametrized Tests

```python
@pytest.mark.parametrize("email,valid", [
    ("test@example.com", True),
    ("invalid", False),
    ("", False),
])
def test_validate_email(email: str, valid: bool):
    assert validate_email(email) == valid
```

### Mocking

```python
from unittest.mock import AsyncMock, patch

@pytest.mark.asyncio
async def test_create_user_sends_email():
    with patch('app.services.send_email', new_callable=AsyncMock) as mock:
        await create_user(UserCreate(email="test@example.com"))
        mock.assert_called_once()
```

---

## 6. Error Handling

### Custom Exception Hierarchy

```python
class AppError(Exception):
    def __init__(self, message: str, code: str = "UNKNOWN"):
        self.message = message
        self.code = code
        super().__init__(message)

class NotFoundError(AppError):
    def __init__(self, resource: str, id: int):
        super().__init__(f"{resource} with id {id} not found", "NOT_FOUND")
```

### Result Pattern

```python
from dataclasses import dataclass
from typing import Generic, TypeVar

T = TypeVar('T')
E = TypeVar('E')

@dataclass
class Ok(Generic[T]):
    value: T

@dataclass
class Err(Generic[E]):
    error: E

Result = Ok[T] | Err[E]

match await get_user(123):
    case Ok(user):
        print(f"Found: {user.name}")
    case Err(error):
        print(f"Error: {error}")
```
