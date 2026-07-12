#!/usr/bin/env python
import argparse
import asyncio
import json
import os
import re
from pathlib import Path

os.environ.setdefault("EMBEDDING_USE_BASE64", "false")

from lightrag import LightRAG, QueryParam
from lightrag.llm.openai import openai_complete_if_cache, openai_embed
from lightrag.utils import EmbeddingFunc


def main():
    parser = argparse.ArgumentParser(description="Run the official LightRAG baseline for the OKM benchmark.")
    parser.add_argument("--markdown", required=True)
    parser.add_argument("--cases", required=True)
    parser.add_argument("--work-dir", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    asyncio.run(run(args))


async def run(args):
    markdown = Path(args.markdown).read_text(encoding="utf-8")
    cases = read_jsonl(Path(args.cases))
    work_dir = Path(args.work_dir)
    work_dir.mkdir(parents=True, exist_ok=True)

    llm_model = required_env("OPENAI_MODEL")
    llm_base_url = required_env("OPENAI_BASE_URL")
    llm_api_key = required_env("OPENAI_API_KEY")
    embedding_model = required_env("EMBEDDING_MODEL")
    embedding_base_url = embedding_base_url_from_env()
    embedding_api_key = required_env("EMBEDDING_API_KEY")

    async def llm_model_func(prompt, system_prompt=None, history_messages=None, **kwargs):
      return await openai_complete_if_cache(
          llm_model,
          prompt,
          system_prompt=system_prompt,
          history_messages=history_messages or [],
          base_url=llm_base_url,
          api_key=llm_api_key,
          timeout=240,
          extra_body={"chat_template_kwargs": {"enable_thinking": False}},
          **kwargs,
      )

    async def embed_texts(texts, **kwargs):
      return await openai_embed.func(
          texts,
          model=embedding_model,
          base_url=embedding_base_url,
          api_key=embedding_api_key,
          max_token_size=kwargs.get("max_token_size", 8192),
          context=kwargs.get("context", "document"),
      )

    detected_embedding = await embed_texts(["OKM LightRAG embedding dimension probe"])
    embedding_dim = int(detected_embedding.shape[1])
    embedding_func = EmbeddingFunc(
        embedding_dim=embedding_dim,
        func=embed_texts,
        max_token_size=8192,
        model_name=embedding_model,
        supports_asymmetric=True,
    )

    rag = LightRAG(
        working_dir=str(work_dir),
        llm_model_func=llm_model_func,
        llm_model_name=llm_model,
        llm_model_max_async=2,
        llm_model_kwargs={},
        embedding_func=embedding_func,
        embedding_batch_num=4,
        embedding_func_max_async=2,
        chunk_token_size=1200,
        chunk_overlap_token_size=100,
        tiktoken_model_name="gpt-4o-mini",
        default_llm_timeout=240,
        default_embedding_timeout=120,
        auto_manage_storages_states=False,
    )

    results = []
    await rag.initialize_storages()
    try:
      await rag.ainsert(clean_markdown(markdown))
      for item in cases:
          question = item["question"]
          answer = await rag.aquery(
              question,
              param=QueryParam(
                  mode=os.getenv("LIGHTRAG_QUERY_MODE", "hybrid"),
                  response_type="Multiple Paragraphs",
                  top_k=12,
                  chunk_top_k=8,
                  include_references=True,
              ),
          )
          answer_text = stringify_answer(answer)
          results.append({
              "method": "lightrag-official",
              "id": item["id"],
              "question": question,
              "expected_terms": item.get("expected_terms", []),
              "context_ids": [],
              "context_char_count": 0,
              "answer": answer_text,
              "citations": extract_citations(answer_text),
              "unsupported_claims": [],
              "teaching_usability_score": None,
              "teaching_usability_rationale": "",
              "cost": {
                  "index_root": str(work_dir),
                  "query_mode": os.getenv("LIGHTRAG_QUERY_MODE", "hybrid"),
                  "embedding_dim": embedding_dim,
                  "model_calls_per_question": 1,
              },
          })
    finally:
      await rag.finalize_storages()

    output = {
        "method": "lightrag-official",
        "status": "completed",
        "results": results,
    }
    Path(args.output).write_text(json.dumps(output, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def clean_markdown(text):
    text = re.sub(r"!\[[^\]]*\]\([^)]+\)", "", text)
    text = re.sub(r"<img\b[^>]*>", "", text, flags=re.I)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def stringify_answer(answer):
    if isinstance(answer, str):
        return answer
    return json.dumps(answer, ensure_ascii=False)


def extract_citations(answer):
    citations = []
    for match in re.finditer(r"\[([^\]]{1,80})\]", answer):
        citations.append({"context_id": match.group(1), "note": "LightRAG inline reference"})
    return citations


def read_jsonl(path):
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


def required_env(key):
    value = os.getenv(key)
    if not value:
        raise RuntimeError(f"{key} is required")
    return value


def embedding_base_url_from_env():
    return re.sub(r"/embeddings/?$", "", required_env("EMBEDDING_URL"), flags=re.I)


if __name__ == "__main__":
    main()
