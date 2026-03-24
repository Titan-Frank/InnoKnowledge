# Framework Usage

Use `data/frameworks/junior-chemistry-framework.json` as a soft scaffold for canonical knowledge, not as a rigid template.

## What The Framework Is For

- stabilizing the top-level conceptual coverage
- helping choose canonical names when multiple textbook phrasings exist
- attaching extracted nodes to broader curriculum areas
- spotting missing coverage across multiple textbooks

## What The Framework Is Not For

- forcing every sentence into a curriculum bullet
- preventing the creation of useful local textbook concepts
- replacing textbook evidence

## How To Use It

1. Look for an existing canonical node with the same meaning.
2. If found, reuse that canonical node and add or refine `framework_refs`.
3. If not found, create a new canonical node with a stable ID and add `framework_refs` only when the alignment is reasonably clear.
4. Keep chapter and lesson information in mentions and evidence, not as the parent of the canonical node.

## Good Mapping Examples

- `concept:air-composition` -> a framework topic about air, oxygen, and carbon dioxide
- `experiment:prepare-oxygen` -> a framework topic about common substances plus an experiment or practice expectation
- `skill:use-ph-paper` -> a framework topic about acids, bases, salts, or basic chemical experiment skills

## When To Leave `framework_refs` Empty

- the textbook introduces a very local sub-point that does not cleanly match the framework
- the alignment is ambiguous across multiple framework topics
- the concept is temporary and should wait for normalization
