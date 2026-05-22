"""Parse .eml email files into paragraph-level chunks with metadata."""

from __future__ import annotations
import email as email_lib
from app.models.schemas import Chunk


def parse_email(file_path: str) -> list[Chunk]:
    chunks: list[Chunk] = []
    filename = file_path.split("/")[-1]

    with open(file_path, "r", encoding="utf-8", errors="replace") as f:
        raw = f.read()

    # Handle raw email text (not MIME-encoded) or full MIME
    subject = ""
    body = ""

    if raw.startswith("From:") or raw.startswith("Subject:"):
        # Parse as raw RFC 2822 headers
        lines = raw.splitlines()
        header_done = False
        body_lines = []
        for line in lines:
            if not header_done:
                if line.startswith("Subject:"):
                    subject = line.replace("Subject:", "").strip()
                elif line.strip() == "":
                    header_done = True
            else:
                body_lines.append(line)
        body = "\n".join(body_lines)
    else:
        msg = email_lib.message_from_string(raw)
        subject = msg.get("subject", "")
        if msg.is_multipart():
            for part in msg.walk():
                if part.get_content_type() == "text/plain":
                    body += part.get_payload(decode=True).decode("utf-8", errors="replace")
        else:
            payload = msg.get_payload(decode=True)
            if payload:
                body = payload.decode("utf-8", errors="replace")

    if not subject:
        subject = filename

    # Split body into paragraph chunks
    paragraphs = [p.strip() for p in body.split("\n\n") if p.strip()]
    for idx, para in enumerate(paragraphs):
        if len(para) < 20:
            continue
        chunks.append(
            Chunk(
                text=f"[Email Subject: {subject}]\n{para}",
                source_file=filename,
                source_type="email",
                section=subject,
                chunk_index=idx,
                doc_precedence=1,
            )
        )

    return chunks
