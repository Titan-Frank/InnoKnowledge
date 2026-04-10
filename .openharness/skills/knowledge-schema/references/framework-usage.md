# Framework Usage

Use framework files as a soft scaffold for canonical knowledge and curriculum profiles, not as a rigid ontology.

## What The Framework Is For

- stabilizing top-level conceptual coverage
- helping choose canonical names when multiple textbook phrasings exist
- attaching curriculum profiles to broader learning expectations
- spotting missing coverage across multiple textbooks or grade bands

## What The Framework Is Not For

- forcing every sentence into a curriculum bullet
- preventing the creation of useful local textbook concepts
- replacing source evidence
- acting as the only source of truth for canonical node identity

## How To Use It

1. Look for an existing canonical node with the same meaning.
2. If found, reuse that canonical node.
3. Create or refine a curriculum profile for the current subject / stage / grade context.
4. Add `framework_refs` to the profile when the alignment is reasonably clear.
5. Keep chapter, lesson, and page information in mentions and evidence, not as the parent of the canonical node.

## Good Mapping Examples

- `entity/substance:oxygen` -> a curriculum profile tied to chemistry expectations about air, combustion, and common substances
- `activity/experiment:prepare-oxygen` -> a curriculum profile tied to experiment skills and common-substance expectations
- `skill:use-ph-paper` -> a curriculum profile tied to acids, bases, salts, or basic chemical experiment skills

## When To Leave `framework_refs` Empty

- the source introduces a very local sub-point that does not cleanly match the framework
- the alignment is ambiguous across multiple framework topics
- the node should wait for normalization before committing to a curriculum placement

## Practical Rule

If you must choose between:

- a precise canonical node with uncertain framework alignment
- an imprecise node forced into a framework bucket

prefer the precise canonical node and leave the framework mapping empty for now.
