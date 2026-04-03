#!/usr/bin/env python3
"""Parse textbook markdown into structured chunks for extraction."""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any


@dataclass
class Section:
    """A section in the lesson."""

    heading: str
    level: int
    content: str
    section_type: str = "general"
    subsections: list[Section] = field(default_factory=list)


@dataclass
class Experiment:
    """An experiment/activity block."""

    title: str
    steps: list[str]
    materials: list[str]
    observations: list[str]
    safety_notes: list[str]
    images: list[str]


@dataclass
class Definition:
    """A definition paragraph."""

    term: str
    definition: str
    context: str


@dataclass
class Image:
    """An image with caption."""

    path: str
    caption: str
    figure_number: str | None = None


class MarkdownParser:
    """Parse textbook markdown into structured components."""

    def __init__(self, md_content: str):
        self.md_content = md_content
        self.lines = md_content.split("\n")

    def parse(self) -> dict[str, Any]:
        """Parse markdown into structured chunks."""
        sections = self._extract_sections()
        experiments = self._extract_experiments()
        definitions = self._extract_definitions()
        images = self._extract_images()

        return {
            "sections": sections,
            "experiments": experiments,
            "definitions": definitions,
            "images": images,
            "tables": self._extract_tables(),
            "formulas": self._extract_formulas(),
        }

    def _extract_sections(self) -> list[dict[str, Any]]:
        """Extract sections based on headings."""
        sections = []
        current_section = None
        current_content = []

        for line in self.lines:
            heading_match = re.match(r"^(#{1,6})\s+(.+)$", line)

            if heading_match:
                # Save previous section
                if current_section:
                    current_section["content"] = "\n".join(current_content).strip()
                    sections.append(current_section)

                # Start new section
                level = len(heading_match.group(1))
                heading = heading_match.group(2)

                current_section = {
                    "heading": heading,
                    "level": level,
                    "content": "",
                    "section_type": self._classify_section(heading),
                }
                current_content = []
            else:
                if current_section:
                    current_content.append(line)

        # Save last section
        if current_section:
            current_section["content"] = "\n".join(current_content).strip()
            sections.append(current_section)

        return sections

    def _classify_section(self, heading: str) -> str:
        """Classify section type by heading."""
        heading_lower = heading.lower()

        if any(
            kw in heading_lower for kw in ["实验", "探究", "activity", "experiment"]
        ):
            return "experiment"
        elif any(
            kw in heading_lower for kw in ["学习聚焦", "learning focus", "objectives"]
        ):
            return "objectives"
        elif any(
            kw in heading_lower for kw in ["定义", "definition", "概念", "concept"]
        ):
            return "definition"
        elif any(kw in heading_lower for kw in ["现象记录", "观察", "observation"]):
            return "observation"
        elif any(kw in heading_lower for kw in ["归纳小结", "总结", "summary"]):
            return "summary"
        elif any(
            kw in heading_lower for kw in ["练习", "习题", "exercise", "practice"]
        ):
            return "exercise"
        else:
            return "general"

    def _extract_experiments(self) -> list[dict[str, Any]]:
        """Extract experiment blocks."""
        experiments = []
        in_experiment = False
        current_exp = None

        for i, line in enumerate(self.lines):
            # Detect experiment start
            if re.search(r"#.*实验.*探究|#.*探究.*实验", line):
                in_experiment = True
                current_exp = {
                    "title": line.replace("#", "").strip(),
                    "steps": [],
                    "materials": [],
                    "observations": [],
                    "safety_notes": [],
                    "images": [],
                }
                continue

            # Detect experiment end
            if in_experiment and re.match(r"^#{1,3}\s+", line):
                # Check if this is still experiment content
                if not any(kw in line for kw in ["实验", "探究", "现象", "观察"]):
                    if current_exp:
                        experiments.append(current_exp)
                    in_experiment = False
                    current_exp = None
                    continue

            if in_experiment and current_exp:
                # Extract steps
                step_match = re.match(r"^\s*[（(](\d+)[)）]\s*(.+)", line)
                if step_match:
                    current_exp["steps"].append(step_match.group(2))

                # Extract safety notes
                if re.search(r"注意|小心|安全|不要", line):
                    current_exp["safety_notes"].append(line.strip())

                # Extract observations
                if re.search(r"现象记录|观察并记录", line):
                    current_exp["observations"].append(line.strip())

                # Extract images
                img_match = re.search(r"!\[\]\((images/[^)]+)\)", line)
                if img_match:
                    current_exp["images"].append(img_match.group(1))

        # Save last experiment
        if current_exp:
            experiments.append(current_exp)

        return experiments

    def _extract_definitions(self) -> list[dict[str, Any]]:
        """Extract definition paragraphs."""
        definitions = []

        # Pattern: "xxx叫做xxx" or "xxx是指xxx"
        patterns = [
            r"([^。]+)叫做([^。]+)",
            r"([^。]+)是指([^。]+)",
            r"([^。]+)称为([^。]+)",
        ]

        for line in self.lines:
            for pattern in patterns:
                matches = re.findall(pattern, line)
                for match in matches:
                    definitions.append(
                        {
                            "term": match[1].strip(),
                            "definition": match[0].strip(),
                            "context": line.strip(),
                        }
                    )

        return definitions

    def _extract_images(self) -> list[dict[str, Any]]:
        """Extract images with captions."""
        images = []

        for i, line in enumerate(self.lines):
            img_match = re.search(r"!\[\]\((images/[^)]+)\)", line)
            if img_match:
                image_path = img_match.group(1)

                # Look for caption (next line or same line)
                caption = ""
                figure_number = None

                # Check same line for figure number
                fig_match = re.search(r"图\s*(\d+\.\d+)", line)
                if fig_match:
                    figure_number = fig_match.group(1)
                    caption = line.replace(img_match.group(0), "").strip()
                else:
                    # Check next line
                    if i + 1 < len(self.lines):
                        next_line = self.lines[i + 1]
                        fig_match = re.search(r"图\s*(\d+\.\d+)\s*(.+)", next_line)
                        if fig_match:
                            figure_number = fig_match.group(1)
                            caption = fig_match.group(2).strip()

                images.append(
                    {
                        "path": image_path,
                        "caption": caption,
                        "figure_number": figure_number,
                    }
                )

        return images

    def _extract_tables(self) -> list[dict[str, Any]]:
        """Extract tables (basic implementation)."""
        tables = []
        in_table = False
        current_table = []

        for line in self.lines:
            if "|" in line:
                in_table = True
                cells = [cell.strip() for cell in line.split("|") if cell.strip()]
                current_table.append(cells)
            else:
                if in_table and current_table:
                    tables.append(
                        {
                            "rows": current_table,
                            "headers": current_table[0] if current_table else [],
                        }
                    )
                    current_table = []
                in_table = False

        return tables

    def _extract_formulas(self) -> list[str]:
        """Extract LaTeX formulas."""
        formulas = []

        # Inline math: $...$
        inline_formulas = re.findall(r"\$([^$]+)\$", self.md_content)
        formulas.extend(inline_formulas)

        # Block math: $$...$$
        block_formulas = re.findall(r"\$\$([^$]+)\$\$", self.md_content, re.DOTALL)
        formulas.extend(block_formulas)

        return list(set(formulas))  # Remove duplicates


def parse_markdown_file(md_path: str) -> dict[str, Any]:
    """Parse markdown file into structured components."""
    with open(md_path, "r", encoding="utf-8") as f:
        content = f.read()

    parser = MarkdownParser(content)
    return parser.parse()


if __name__ == "__main__":
    import sys
    import json

    if len(sys.argv) < 2:
        print("Usage: python markdown_parser.py <markdown_file>")
        sys.exit(1)

    result = parse_markdown_file(sys.argv[1])
    print(json.dumps(result, ensure_ascii=False, indent=2))
