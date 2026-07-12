# OKM-EduKU-Bench v0.2

This directory contains the paper-grade experiment scaffold for comparing OKM as an evidence-constrained Knowledge Unit system.

It is intentionally separate from `experiments/physics-okm-benchmark-2026-07-01`. The earlier physics experiment remains a pilot and development set. This benchmark defines the held-out test design for two MinerU textbooks:

- physics: `data/mineru/physics-hukj-compulsory-3/full.md`
- chemistry: `data/mineru/chem-hukj-xb2-structure/full.md`

## Research Claim

The experiment should not claim that OKM is better than every retrieval system on every metric. The narrower claim is:

- OKM should be stronger on object identity, evidence binding, relation governance, teaching profiles, and service-ready Knowledge Units.
- Chunk retrieval systems may still have higher keyword coverage or lower setup cost.
- GraphRAG, LightRAG, HippoRAG, and NodeRAG should be compared as retrieval and grounded-generation systems, not as full Knowledge Unit construction systems.

## Main Experiments

Experiment 1 evaluates Knowledge Unit construction.

- Main methods: OKM full pipeline, LLM-only schema extraction, OneKE, DeepKE, OpenNRE, Stanford OpenIE.
- Main metrics: node F1, relation F1, evidence precision and recall, definition accuracy, semantic-core completeness, pedagogical-profile completeness, wrong merge rate, schema violations, isolated node rate, and manual review cost.
- Required gold data: two annotators plus adjudication for the 16 held-out sections.

Experiment 2 evaluates object-level retrieval and grounded generation.

- Main methods: OKM ApiUnit-RAG, BM25 chunk RAG, dense chunk RAG, hybrid chunk RAG, GraphRAG, LightRAG, HippoRAG.
- Secondary table: NodeRAG, if installation and runtime are stable.
- Question set: 60 questions, 30 physics and 30 chemistry.
- Main metrics: retrieval hit@k, evidence recall@k, object hit@k, relation path hit, answer correctness, citation precision and recall, unsupported claim count, prerequisite coverage, misconception handling, latency, build cost, and incremental update cost.

Experiment 3 evaluates educational utility.

- Main methods: OKM ApiUnit-RAG, chunk RAG, GraphRAG, LightRAG, and plain LLM tutor.
- Reviewers: two or three teachers or subject experts.
- Scoring: 1-5 Likert scores plus paired preference.
- Statistics: mean, confidence interval, paired Wilcoxon signed-rank test, preference win rate, and qualitative note categories.

## Files

- `fixtures/benchmark-design.json`: benchmark definition, held-out sections, baseline groups, metrics, and reproducibility settings.
- `fixtures/runtime-cases.v0.2.jsonl`: 60 retrieval and generation questions.
- `fixtures/annotation-guidelines.md`: annotation rules for Knowledge Objects, relations, evidence spans, semantic core, and pedagogical profile.
- `fixtures/expert-review-rubric.md`: blind-review rubric for educational utility.
- `schemas/construction-output.schema.json`: unified construction output format.
- `schemas/runtime-output.schema.json`: unified retrieval and generation output format.
- `schemas/expert-score-row.schema.json`: expected expert score row format.
- `templates/expert-review-sheet.csv`: manual scoring template.

## Commands

Build the dataset manifest, environment status, annotation packet, runtime case copy, and run manifest:

```bash
node experiments/okm-eduku-bench-v0.2-2026-07-01/scripts/build-benchmark-packets.mjs
```

Score any available unified outputs:

```bash
node experiments/okm-eduku-bench-v0.2-2026-07-01/scripts/score-unified-results.mjs
```

Build a blinded expert review sheet after runtime systems have produced outputs:

```bash
node experiments/okm-eduku-bench-v0.2-2026-07-01/scripts/build-expert-review-sheet.mjs
```

## Output Contracts

Construction systems must write JSON files under `outputs/construction/*.json` with this shape:

```json
{
  "method": "okm-full",
  "status": "ok",
  "nodes": [],
  "edges": [],
  "evidence_links": [],
  "semantic_core": [],
  "pedagogical_profile": [],
  "cost": {}
}
```

Runtime systems must write JSON files under `outputs/runtime/*.json` with this shape:

```json
{
  "method": "okm-apiunit-rag",
  "status": "ok",
  "results": [
    {
      "case_id": "phy-rq-001",
      "retrieved_units": [],
      "retrieved_evidence": [],
      "relation_paths": [],
      "answer": "",
      "citations": [],
      "unsupported_claims": [],
      "cost": {}
    }
  ]
}
```

## Quality Gates

- OKM construction outputs must pass strict QA and graph integrity checks before they are included in the main table.
- Baseline outputs must pass the unified JSON shape checks before scoring.
- Citation metrics must distinguish internal system citations from citations mapped to textbook evidence IDs.
- Annotation packets are not gold labels. Gold labels require two independent annotations and an adjudicated version.

## Current Status

This directory implements the benchmark design, held-out section manifest generation, runtime question set, annotation instructions, expert review rubric, unified result schemas, and scoring scaffolding.

The main experimental results still require:

- adjudicated gold annotations for 16 held-out sections;
- official baseline adapters for OneKE, DeepKE, OpenNRE, Stanford OpenIE, GraphRAG, LightRAG, HippoRAG, and optional NodeRAG;
- OKM ApiUnit-RAG runtime output exported in the unified format;
- expert blind review scores.
