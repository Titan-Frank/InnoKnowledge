# Open Knowledge Map inspection artifact v0.1.0

This directory is a self-contained, read-only candidate result layer for Open Knowledge Map. It contains a PostgreSQL-derived graph snapshot, one `ApiUnit` JSON file per active knowledge object, a JSON Schema, a data manifest, SHA-256 checksums, standard-library JavaScript and Python examples, and a read-only build of the repository's React viewer.

The current snapshot is exported from the PostgreSQL `knowledge` database and its `main` dataset. It contains the complete `ApiUnit` view for every non-deprecated node. The repository owner has authorized public inspection and previously described the source textbook as open source, but the local PDF copyright page reserves rights and no applicable open license or written permission is recorded. Public availability must not be interpreted as clearance for redistribution or reuse.

The hosted copy is available at <https://open-knowledge-map.pages.dev/>. This v0.1.0 inspection snapshot contains 182 knowledge objects, 144 typed relations, 537 exported evidence records, 182 cards, and 182 knowledge bodies. See [SOURCES.md](SOURCES.md) for the source fields that are known and still missing.

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
SOURCES.md                     Recorded source identity and missing license fields
```

## 中文说明

这是一个与完整抽取流水线分离的只读成果候选层。其界面与 `npm run dev` 使用同一套 React 前端，可以在没有 PostgreSQL、MinerU、模型密钥和教材 PDF 的情况下浏览图谱、点击知识对象并检查证据与完整度。需要服务器的抽取、标注、教材管理和回答生成功能会在公开模式隐藏。当前数据来自 PostgreSQL 的 `knowledge/main`，包含 182 个知识对象、144 条关系、537 条导出证据、182 张知识卡片和 182 篇知识正文。项目维护者此前说明源教材属于开源教材，但本地 PDF 版权页保留版权，当前也没有记录适用的开放许可证或书面授权。因此公开可访问不等于已经获得再分发许可。详见 [SOURCES.md](SOURCES.md) 与 [RIGHTS.md](RIGHTS.md)。
