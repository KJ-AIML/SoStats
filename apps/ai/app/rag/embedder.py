import base64
import io
import re
from html.parser import HTMLParser
from zipfile import BadZipFile, ZipFile

from docx import Document
from pypdf import PdfReader


MAX_SOURCE_BYTES = 15 * 1024 * 1024
MAX_TEXT_CHARS = 500_000
MAX_CHUNKS = 100


class _TextExtractor(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.parts: list[str] = []
        self._ignored_depth = 0

    def handle_starttag(self, tag: str, attrs) -> None:
        if tag.lower() in {"script", "style", "noscript", "svg"}:
            self._ignored_depth += 1
        elif tag.lower() in {"p", "br", "li", "div", "section", "article", "h1", "h2", "h3"}:
            self.parts.append("\n")

    def handle_endtag(self, tag: str) -> None:
        if tag.lower() in {"script", "style", "noscript", "svg"}:
            self._ignored_depth = max(0, self._ignored_depth - 1)
        elif tag.lower() in {"p", "li", "div", "section", "article"}:
            self.parts.append("\n")

    def handle_data(self, data: str) -> None:
        if self._ignored_depth == 0:
            self.parts.append(data)


def normalize_text(value: str) -> str:
    value = value.replace("\x00", " ")
    value = re.sub(r"\r\n?", "\n", value)
    value = re.sub(r"[ \t]+", " ", value)
    value = re.sub(r"\n{3,}", "\n\n", value)
    return value.strip()[:MAX_TEXT_CHARS]


def extract_text(
    *,
    media_type: str,
    content: str | None = None,
    content_base64: str | None = None,
) -> str:
    normalized_type = media_type.split(";", 1)[0].strip().lower()

    if normalized_type == "text/plain":
        return normalize_text(content or "")

    if content_base64:
        try:
            raw = base64.b64decode(content_base64, validate=True)
        except Exception as exc:
            raise ValueError("Source payload is not valid base64") from exc
        if len(raw) > MAX_SOURCE_BYTES:
            raise ValueError("Knowledge source exceeds the 8 MiB processing limit")
    else:
        raw = (content or "").encode("utf-8")
        if len(raw) > MAX_SOURCE_BYTES:
            raise ValueError("Knowledge source exceeds the 8 MiB processing limit")

    if normalized_type in {"text/html", "application/xhtml+xml"}:
        parser = _TextExtractor()
        parser.feed(raw.decode("utf-8", errors="replace"))
        return normalize_text("".join(parser.parts))

    if normalized_type == "application/pdf":
        reader = PdfReader(io.BytesIO(raw))
        if len(reader.pages) > 250:
            raise ValueError("PDF exceeds the 250 page processing limit")
        pages = []
        for page in reader.pages:
            pages.append(page.extract_text() or "")
        return normalize_text("\n\n".join(pages))

    if (
        normalized_type
        == "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    ):
        try:
            with ZipFile(io.BytesIO(raw)) as archive:
                entries = archive.infolist()
                if len(entries) > 2000:
                    raise ValueError("DOCX archive contains too many entries")
                total_uncompressed = sum(entry.file_size for entry in entries)
                if total_uncompressed > 50 * 1024 * 1024:
                    raise ValueError(
                        "DOCX archive exceeds the 50 MiB expanded-size limit"
                    )
                if any(entry.file_size > 25 * 1024 * 1024 for entry in entries):
                    raise ValueError("DOCX archive contains an oversized entry")
                names = {entry.filename for entry in entries}
                if (
                    "[Content_Types].xml" not in names
                    or "word/document.xml" not in names
                ):
                    raise ValueError("DOCX archive is missing required document parts")
        except BadZipFile as exc:
            raise ValueError("DOCX source is not a valid ZIP container") from exc

        document = Document(io.BytesIO(raw))
        parts: list[str] = []
        for paragraph in document.paragraphs:
            if paragraph.text.strip():
                parts.append(paragraph.text)
        for table in document.tables:
            for row in table.rows:
                cells = [cell.text.strip() for cell in row.cells if cell.text.strip()]
                if cells:
                    parts.append(" | ".join(cells))
        return normalize_text("\n".join(parts))

    if normalized_type.startswith("text/"):
        return normalize_text(raw.decode("utf-8", errors="replace"))

    raise ValueError(f"Unsupported knowledge media type: {normalized_type}")


def chunk_text(
    text: str,
    *,
    target_words: int = 650,
    overlap_words: int = 100,
) -> list[str]:
    words = text.split()
    if not words:
        return []
    if target_words < 100 or overlap_words < 0 or overlap_words >= target_words:
        raise ValueError("Invalid chunking configuration")

    chunks: list[str] = []
    start = 0
    while start < len(words) and len(chunks) < MAX_CHUNKS:
        end = min(len(words), start + target_words)
        chunk = " ".join(words[start:end]).strip()
        if chunk:
            chunks.append(chunk)
        if end >= len(words):
            break
        start = end - overlap_words

    return chunks
