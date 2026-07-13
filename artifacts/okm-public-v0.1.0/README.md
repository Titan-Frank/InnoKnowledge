# Open Knowledge Map public artifact v0.1.0

This directory is a self-contained, read-only candidate result layer for Open Knowledge Map. It contains a PostgreSQL-derived graph snapshot, one `ApiUnit` JSON file per active knowledge object, a JSON Schema, a data manifest, SHA-256 checksums, standard-library JavaScript and Python examples, and a read-only build of the repository's React viewer.

The current snapshot is exported from the PostgreSQL `knowledge` database and its `main` dataset. It contains the complete `ApiUnit` view for every non-deprecated node. The repository owner has authorized public inspection of this snapshot and stated that the source textbooks are open source. Exact upstream source and license metadata is not yet recorded in the database, so public availability must not be interpreted as a separate redistribution or reuse license.

## Open the read-only viewer

From the repository root:

```bash
python3 -m http.server 8080 -d artifacts/okm-public-v0.1.0
```

Open <http://127.0.0.1:8080/viewer/>. The public viewer uses the same graph, filtering, object detail, evidence, responsive layout, and light/dark themes as `npm run dev`, while reading only local JSON files. Server-dependent extraction, annotation, textbook management, and answer generation controls are hidden. It has no PostgreSQL connection, model endpoint, upload path, editing action, or `POST` request.

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
viewer/                        React viewer build configured for local JSON
RIGHTS.md                      Source and reuse boundary
```

## 中文说明

这是一个与完整抽取流水线分离的只读成果候选层。其界面与 `npm run dev` 使用同一套 React 前端，可以在没有 PostgreSQL、MinerU、模型密钥和教材 PDF 的情况下浏览图谱、点击知识对象并检查证据与完整度。需要服务器的抽取、标注、教材管理和回答生成功能会在公开模式隐藏。当前数据来自 PostgreSQL 的 `knowledge/main`。项目维护者已授权公开浏览，并说明源教材属于开源教材；但数据库仍未记录准确的原始来源链接和许可证名称，因此公开可访问不等于另行授予再分发或再许可权限。详见 [RIGHTS.md](RIGHTS.md)。
