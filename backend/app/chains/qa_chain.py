"""
Contract Q&A — LCEL retrieval chain over ChromaDB.

Replaces the deprecated RetrievalQA.from_chain_type with the modern:
  create_retrieval_chain + create_stuff_documents_chain
"""

from __future__ import annotations

from langchain_openai import ChatOpenAI
from langchain_chroma import Chroma
from langchain_core.prompts import ChatPromptTemplate
from langchain.chains import create_retrieval_chain
from langchain.chains.combine_documents import create_stuff_documents_chain

from app.models.schemas import QAResponse, QASource
from app.config import resolve_qa_model, supports_temperature


QA_SYSTEM = """You are an expert contract analyst.
Use ONLY the provided contract document excerpts to answer the question.
Cite which document, page, sheet, or section your answer is drawn from.
If the answer is not in the excerpts, say "This information is not found in the provided contract documents."
Do not invent or infer values that are not present in the excerpts."""

QA_PROMPT = ChatPromptTemplate.from_messages([
    ("system", QA_SYSTEM),
    ("human", "{input}\n\nContract document excerpts:\n{context}"),
])


def run_qa(
    question: str,
    vectorstore: Chroma,
    openai_api_key: str,
    k: int = 6,
) -> QAResponse:
    model = resolve_qa_model(openai_api_key)
    llm_kwargs: dict = {"model": model, "openai_api_key": openai_api_key}
    if supports_temperature(model):
        llm_kwargs["temperature"] = 0
    llm = ChatOpenAI(**llm_kwargs)

    retriever = vectorstore.as_retriever(search_kwargs={"k": k})
    combine_docs_chain = create_stuff_documents_chain(llm, QA_PROMPT)
    retrieval_chain = create_retrieval_chain(retriever, combine_docs_chain)

    result = retrieval_chain.invoke({"input": question})
    answer: str = result.get("answer", "")
    source_docs = result.get("context", [])

    sources: list[QASource] = []
    seen: set = set()
    for doc in source_docs:
        m = doc.metadata
        key = (m.get("source_file"), m.get("page_number"), m.get("sheet_name"), m.get("row_range"))
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
