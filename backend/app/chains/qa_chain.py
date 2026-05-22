"""
Contract Q&A chain — NVIDIA RAG architecture with LCEL.

Replaces the deprecated RetrievalQA.from_chain_type with the modern:
  create_retrieval_chain + create_stuff_documents_chain (LCEL pipeline)

Retrieval is hybrid (dense + BM25 + reranker) via build_hybrid_retriever.
"""

from __future__ import annotations
from typing import Optional

from langchain_openai import ChatOpenAI
from langchain_chroma import Chroma
from langchain_community.retrievers import BM25Retriever
from langchain_core.prompts import ChatPromptTemplate
from langchain.chains import create_retrieval_chain
from langchain.chains.combine_documents import create_stuff_documents_chain

from app.models.schemas import QAResponse, QASource
from app.config import resolve_qa_model, supports_temperature
from app.rag.retriever import build_hybrid_retriever, get_retrieval_info


QA_SYSTEM = """You are an expert contract analyst.
Use ONLY the provided contract document excerpts to answer the question.
Be precise and cite which document, page, or section you are drawing from.
If the answer is not in the provided context, say "This information is not found in the provided contract documents."
Do not invent or infer values not present in the excerpts."""

QA_PROMPT = ChatPromptTemplate.from_messages([
    ("system", QA_SYSTEM),
    ("human", "{input}\n\nContract document excerpts:\n{context}"),
])


def run_qa(
    question: str,
    vectorstore: Chroma,
    openai_api_key: str,
    bm25_retriever: Optional[BM25Retriever] = None,
    top_n: int = 6,
) -> QAResponse:
    """
    LCEL retrieval chain:
      hybrid_retriever | create_stuff_documents_chain(llm, prompt) → answer + context
    """
    model = resolve_qa_model(openai_api_key)
    llm_kwargs: dict = {"model": model, "openai_api_key": openai_api_key}
    if supports_temperature(model):
        llm_kwargs["temperature"] = 0
    llm = ChatOpenAI(**llm_kwargs)

    # Stage 1+2: hybrid retriever (dense + BM25 → EnsembleRetriever → reranker)
    hybrid_retriever = build_hybrid_retriever(
        vectorstore=vectorstore,
        bm25_retriever=bm25_retriever,
        top_n=top_n,
    )

    # LCEL chain: replaces deprecated RetrievalQA.from_chain_type
    combine_docs_chain = create_stuff_documents_chain(llm, QA_PROMPT)
    retrieval_chain = create_retrieval_chain(hybrid_retriever, combine_docs_chain)

    result = retrieval_chain.invoke({"input": question})

    answer: str = result.get("answer", "")
    source_docs = result.get("context", [])

    # Build deduplicated source citations (same format as before)
    sources: list[QASource] = []
    seen: set = set()
    for doc in source_docs:
        m = doc.metadata
        key = (
            m.get("source_file"),
            m.get("page_number"),
            m.get("sheet_name"),
            m.get("row_range"),
        )
        if key in seen:
            continue
        seen.add(key)
        sources.append(
            QASource(
                source_file=m.get("source_file", ""),
                page_number=m.get("page_number"),
                sheet_name=m.get("sheet_name"),
                row_range=m.get("row_range"),
                section=m.get("section"),
                excerpt=doc.page_content[:300],
            )
        )

    return QAResponse(question=question, answer=answer, sources=sources)
