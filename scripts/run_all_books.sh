#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  scripts/run_all_books.sh [options]

Options:
  --books FILE            TSV file with: <book-id><TAB><pdf-path>
                          Default: books.tsv
  --root DIR              Versioned output root.
                          Default: data/v5
  --db PATH               SQLite database path.
                          Default: storage/knowledge.sqlite
  --refresh-outline       Rebuild outlines even if data/outlines/<book-id>.outline.json exists.
  --force-manifest-init   Reinitialize pipeline manifests with --force.
  --sync-from-snapshot    Bootstrap SQLite from the existing output-root snapshot before processing.
  --export-snapshot       Export the final SQLite dataset into the output root after all books finish.
  --continue-on-error     Continue processing later books after one book fails.
  --help                  Show this help message.

TSV format:
  chem-grade8-all-in-one<TAB>/absolute/path/to/book1.pdf
  chem-grade9-all-in-one<TAB>/absolute/path/to/book2.pdf

Notes:
  - Books are processed sequentially, not in parallel.
  - Blank lines and lines beginning with # are ignored.
  - The default pipeline prompt uses complete knowledge mode for full-book extraction.
EOF
}

log() {
  printf '[run_all_books] %s\n' "$*"
}

BOOKS_FILE="books.tsv"
ROOT="data/v5"
DB="storage/knowledge.sqlite"
REFRESH_OUTLINE=0
FORCE_MANIFEST_INIT=0
SYNC_FROM_SNAPSHOT=0
EXPORT_SNAPSHOT=0
CONTINUE_ON_ERROR=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --books)
      BOOKS_FILE="$2"
      shift 2
      ;;
    --root)
      ROOT="$2"
      shift 2
      ;;
    --db)
      DB="$2"
      shift 2
      ;;
    --refresh-outline)
      REFRESH_OUTLINE=1
      shift
      ;;
    --force-manifest-init)
      FORCE_MANIFEST_INIT=1
      shift
      ;;
    --sync-from-snapshot)
      SYNC_FROM_SNAPSHOT=1
      shift
      ;;
    --export-snapshot)
      EXPORT_SNAPSHOT=1
      shift
      ;;
    --continue-on-error)
      CONTINUE_ON_ERROR=1
      shift
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      printf 'Unknown option: %s\n\n' "$1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "$REPO_ROOT"

if ! command -v python3 >/dev/null 2>&1; then
  printf 'python3 is required but was not found in PATH.\n' >&2
  exit 1
fi

if ! command -v opencode >/dev/null 2>&1; then
  printf 'opencode is required but was not found in PATH.\n' >&2
  exit 1
fi

if [[ ! -f "$BOOKS_FILE" ]]; then
  printf 'Books file not found: %s\n' "$BOOKS_FILE" >&2
  exit 1
fi

mkdir -p "$ROOT"

if [[ "$SYNC_FROM_SNAPSHOT" -eq 1 ]]; then
  log "Bootstrapping SQLite from snapshot root ${ROOT}"
  python3 scripts/sync_output_root_to_sqlite.py "$ROOT" \
    --db "$DB" \
    --replace --activate --preserve-runtime
fi

failures=()
processed=0

run_book() {
  local book_id="$1"
  local pdf_path="$2"
  local outline_path="data/outlines/${book_id}.outline.json"
  local manifest_path="${ROOT}/runs/${book_id}.pipeline.json"
  local prompt
  local manifest_args=(
    scripts/pipeline_manifest.py
    init
    --root "$ROOT"
    --book-id "$book_id"
  )

  if [[ ! -f "$pdf_path" ]]; then
    printf 'PDF not found for %s: %s\n' "$book_id" "$pdf_path" >&2
    return 1
  fi

  if [[ "$REFRESH_OUTLINE" -eq 1 || ! -f "$outline_path" ]]; then
    log "Extracting outline for ${book_id}"
    python3 .opencode/skills/textbook-outline/scripts/extract_outline.py \
      --pdf "$pdf_path" \
      --book-id "$book_id" \
      --out "$outline_path"
  else
    log "Reusing existing outline for ${book_id}: ${outline_path}"
  fi

  if [[ "$FORCE_MANIFEST_INIT" -eq 1 || ! -f "$manifest_path" ]]; then
    log "Initializing manifest for ${book_id}"
    if [[ "$FORCE_MANIFEST_INIT" -eq 1 ]]; then
      manifest_args+=(--force)
    fi
    python3 "${manifest_args[@]}"
  else
    log "Reusing existing manifest for ${book_id}: ${manifest_path}"
  fi

  if [[ "$DB" == "storage/knowledge.sqlite" ]]; then
    prompt="@kg-pipeline 以完整知识模式处理 ${book_id} 全书，按 lesson 分批抽取，输出到 ${ROOT}"
  else
    prompt="@kg-pipeline 使用 SQLite 数据库 ${DB} 以完整知识模式处理 ${book_id} 全书，按 lesson 分批抽取，输出到 ${ROOT}"
  fi

  log "Running kg-pipeline for ${book_id}"
  opencode run --agent build "$prompt" </dev/null
}

while IFS= read -r raw_line <&3 || [[ -n "${raw_line:-}" ]]; do
  raw_line="${raw_line%$'\r'}"
  if [[ -z "${raw_line//[[:space:]]/}" ]]; then
    continue
  fi
  if [[ "$raw_line" == \#* ]]; then
    continue
  fi

  IFS=$'\t' read -r book_id pdf_path extra <<<"$raw_line"
  book_id="${book_id%$'\r'}"
  pdf_path="${pdf_path%$'\r'}"

  if [[ -z "$book_id" || -z "$pdf_path" ]]; then
    printf 'Invalid line in %s: %s\n' "$BOOKS_FILE" "$raw_line" >&2
    if [[ "$CONTINUE_ON_ERROR" -eq 1 ]]; then
      failures+=("invalid-line:${raw_line}")
      continue
    fi
    exit 1
  fi

  if [[ -n "${extra:-}" ]]; then
    log "Ignoring extra TSV columns for ${book_id}"
  fi

  processed=$((processed + 1))
  if ! run_book "$book_id" "$pdf_path"; then
    if [[ "$CONTINUE_ON_ERROR" -eq 1 ]]; then
      log "Book failed, continuing: ${book_id}"
      failures+=("$book_id")
      continue
    fi
    printf 'Stopping on failure: %s\n' "$book_id" >&2
    exit 1
  fi
done 3< "$BOOKS_FILE"

if [[ "$processed" -eq 0 ]]; then
  printf 'No books were found in %s\n' "$BOOKS_FILE" >&2
  exit 1
fi

if [[ "$EXPORT_SNAPSHOT" -eq 1 ]]; then
  log "Exporting final snapshot to ${ROOT}"
  python3 scripts/export_snapshot.py "$ROOT" \
    --db "$DB" \
    --dataset-id "$(basename "$ROOT")"
fi

log "Processed books: ${processed}"
if [[ "${#failures[@]}" -gt 0 ]]; then
  printf 'Completed with failures:\n' >&2
  for item in "${failures[@]}"; do
    printf '  - %s\n' "$item" >&2
  done
  exit 1
fi

log "All books completed successfully."
