from logging.config import fileConfig
import os
import sys

# Make sure app package is importable from migrations/
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from sqlalchemy import engine_from_config
from sqlalchemy import pool

from alembic import context

from app.core.config import get_settings
from app.db.session import Base

# Import all models so Alembic can detect them for autogenerate
from app.models.models import (  # noqa: F401
    User, Organizer, OrganizerMember, Event, EventTier, Ticket, Payment,
    Barcode, PriceCap, Transfer, GateScanner, Attendance, AuditLog, Notification,
)

config = context.config

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# Override sqlalchemy.url from our app settings (reads from .env)
settings = get_settings()
config.set_main_option("sqlalchemy.url", settings.DATABASE_URL)

target_metadata = Base.metadata

# other values from the config, defined by the needs of env.py,
# can be acquired:
# my_important_option = config.get_main_option("my_important_option")
# ... etc.


def run_migrations_offline() -> None:
    """Run migrations in 'offline' mode.

    This configures the context with just a URL
    and not an Engine, though an Engine is acceptable
    here as well.  By skipping the Engine creation
    we don't even need a DBAPI to be available.

    Calls to context.execute() here emit the given string to the
    script output.

    """
    url = config.get_main_option("sqlalchemy.url")
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        # SQLite (local dev fallback) can't ALTER TABLE to add constraints or drop
        # columns directly — batch mode rebuilds the table instead. Harmless on
        # Postgres (the docker-compose target), which supports these natively.
        render_as_batch=True,
    )

    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    """Run migrations in 'online' mode.

    In this scenario we need to create an Engine
    and associate a connection with the context.

    """
    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )

    with connectable.connect() as connection:
        context.configure(
            connection=connection, target_metadata=target_metadata,
            render_as_batch=True,
        )

        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
