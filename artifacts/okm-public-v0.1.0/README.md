# Open Knowledge Map public artifact v0.1.0

This directory is a self-contained, read-only candidate result layer for Open Knowledge Map. It contains a PostgreSQL-derived graph snapshot, one `ApiUnit` JSON file per active knowledge object, a JSON Schema, a data manifest, SHA-256 checksums, standard-library JavaScript and Python examples, and a static viewer.

The current snapshot is exported from the PostgreSQL `knowledge` database and its `main` dataset. It contains the complete `ApiUnit` view for every non-deprecated node. The source database includes textbook-derived evidence and does not yet contain complete redistribution metadata, so this directory is a rights-review candidate rather than a cleared public data release.

## Open the read-only viewer

From the repository root:

```bash
python3 -m http.server 8080 -d artifacts/okm-public-v0.1.0
```

Open <http://127.0.0.1:8080/viewer/>. The viewer reads only local JSON files. It has no PostgreSQL connection, model endpoint, upload path, editing action, or `POST` request.

## Read one ApiUnit

```bash
node artifacts/okm-public-v0.1.0/examples/javascript/read-unit.mjs
python3 artifacts/okm-public-v0.1.0/examples/python/read_unit.py
```

Pass a node identifier as the final argument to select a specific unit.

## Verify the snapshot

```bash
cd artifacts/okm-public-v0.1.0
shasum -a 256 -c SHA256SUMS
```

## Regenerate from PostgreSQL

The default export uses `postgresql://okm:okm@127.0.0.1:5432/knowledge`, `dataset_id=main`, and an explicit unreviewed-data override:

```bash
npm run artifact:export
```

An alternate dataset must be selected explicitly:

```bash
npm run artifact:export -- \
  --db postgresql://okm:okm@127.0.0.1:5432/database_name \
  --dataset-id dataset_name
```

The exporter itself refuses datasets without complete rights metadata unless `--allow-unreviewed` is supplied. The repository command includes that flag because this snapshot was explicitly requested from `main`; it does not make the exported data publicly redistributable.

## Directory contents

```text
manifest.json                  Snapshot identity, contracts, counts, filters, and rights state
SHA256SUMS                     SHA-256 for every file except the checksum list itself
schemas/api-unit.schema.json   Machine-readable ApiUnit contract
data/graph.json                Read-only graph snapshot
data/units/index.json          Stable node-id to unit-file mapping
data/units/unit-*.json         Complete ApiUnit records
examples/                      JavaScript and Python readers
viewer/                        Dependency-free static viewer
RIGHTS.md                      Source and reuse boundary
```

## 中文说明

这是一个与完整抽取流水线分离的只读成果候选层。它可以在没有 PostgreSQL、MinerU、模型密钥和教材 PDF 的情况下浏览图谱、点击知识对象并检查证据与完整度。当前数据来自 PostgreSQL 的 `knowledge/main`。由于其中含有教材衍生证据且尚未完成再分发授权审查，它目前只能作为本地候选快照，不能因为进入该目录就视为已经可以公开发布。详见 [RIGHTS.md](RIGHTS.md)。
