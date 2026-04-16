"""Compatibility shim: provide execute_values for psycopg3 where it's missing."""

from __future__ import annotations

from typing import Any, Iterable, Optional, Sequence

import psycopg
from psycopg import sql as pg_sql


def execute_values(
    cur: psycopg.Cursor,
    query: str,
    argslist: Iterable[Sequence[Any]],
    template: Optional[str] = None,
    page_size: int = 100,
    fetch: bool = False,
) -> Optional[list[tuple]]:
    """Insert multiple rows using VALUES clause, similar to psycopg2.extras.execute_values.

    This is a simplified version that builds a single INSERT ... VALUES statement
    with multiple value tuples, which is the efficient approach for bulk inserts.
    """
    # Convert argslist to list so we can chunk it
    all_args = list(argslist)
    if not all_args:
        return []

    if template is None:
        # Auto-detect template from first row
        cols = len(all_args[0])
        template_str = "(" + ", ".join(["%s"] * cols) + ")"
    else:
        template_str = template

    # Process in pages
    results: list[tuple] = []
    for i in range(0, len(all_args), page_size):
        page = all_args[i : i + page_size]
        # Build the VALUES part
        values_parts = []
        flat_params: list[Any] = []
        for row in page:
            values_parts.append(template_str)
            flat_params.extend(row)

        # Replace the %s in the query with our values
        # The query should end with "VALUES %s" pattern
        # We replace the VALUES %s with our constructed VALUES clause
        if "%s" in query:
            # Find the VALUES %s pattern
            full_query = query % (", ".join(values_parts),)
        else:
            full_query = query

        cur.execute(full_query, flat_params)

        if fetch:
            results.extend(cur.fetchall())

    return results if fetch else None


# Make it importable as psycopg.extras
try:
    import psycopg
    if not hasattr(psycopg, 'extras'):
        import sys
        import types
        extras_module = types.ModuleType('psycopg.extras')
        extras_module.execute_values = execute_values
        sys.modules['psycopg.extras'] = extras_module
        psycopg.extras = extras_module  # type: ignore
except Exception:
    pass
