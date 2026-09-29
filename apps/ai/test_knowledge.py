import base64
import io

from pypdf import PdfWriter

from app.rag.embedder import chunk_text, extract_text


def test_extracts_html_without_script_content():
    html = b"""
      <html><head><style>.x{color:red}</style></head>
      <body><h1>Brand story</h1><script>alert(1)</script>
      <p>Reliable automation for lean teams.</p></body></html>
    """
    text = extract_text(
        media_type="text/html",
        content_base64=base64.b64encode(html).decode(),
    )
    assert "Brand story" in text
    assert "Reliable automation" in text
    assert "alert" not in text


def test_chunks_with_overlap_and_bounds():
    source = " ".join(f"word-{index}" for index in range(1500))
    chunks = chunk_text(source, target_words=650, overlap_words=100)
    assert len(chunks) == 3
    assert chunks[0].split()[-100:] == chunks[1].split()[:100]


def test_extracts_pdf_text_path_without_network():
    writer = PdfWriter()
    writer.add_blank_page(width=200, height=200)
    buffer = io.BytesIO()
    writer.write(buffer)

    text = extract_text(
        media_type="application/pdf",
        content_base64=base64.b64encode(buffer.getvalue()).decode(),
    )
    assert text == ""
