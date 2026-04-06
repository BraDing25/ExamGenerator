import re
from pathlib import Path
from importlib import import_module

import yaml


def _normalize_list_linebreaks(text):
    if not text:
        return ""

    normalized = str(text).replace("\r\n", "\n").replace("\r", "\n")

    # Put inline numbered/lettered list markers on their own lines.
    normalized = re.sub(r"(?<!\n)\s+(?=(?:\d{1,2}[\.)],?\s+))", "\n", normalized)
    normalized = re.sub(r"(?<!\n)\s+(?=(?:[A-Za-z][\.)]\s+))", "\n", normalized)

    # If bullets are written inline after punctuation, start them on a new line.
    normalized = re.sub(r"([:;])\s+(?=[\-\*•]\s+)", r"\1\n", normalized)

    # Preserve spacing but avoid excessive blank lines.
    normalized = re.sub(r"\n{3,}", "\n\n", normalized)
    return normalized


def _compact_list_spacing(text):
    if not text:
        return ""

    compact = str(text).replace("\r\n", "\n").replace("\r", "\n")

    def is_list_item(line):
        stripped = (line or "").strip()
        if not stripped:
            return False
        return bool(re.match(r"^(?:•\s|\d{1,2}[\.)]\s|[A-Za-z][\.)]\s)", stripped))

    source_lines = [line.rstrip() for line in compact.split("\n")]
    cleaned = []

    for idx, raw_line in enumerate(source_lines):
        line = raw_line.strip()
        if line:
            cleaned.append(raw_line.rstrip())
            continue

        # Find previous and next non-empty lines to decide whether blank line is useful.
        prev_non_empty = ""
        for prev_line in reversed(cleaned):
            if prev_line.strip():
                prev_non_empty = prev_line
                break

        next_non_empty = ""
        for next_idx in range(idx + 1, len(source_lines)):
            candidate = source_lines[next_idx].strip()
            if candidate:
                next_non_empty = source_lines[next_idx]
                break

        # Remove blank gaps inside list blocks.
        if is_list_item(prev_non_empty) and is_list_item(next_non_empty):
            continue

        # Keep at most one blank line between non-list paragraphs.
        if cleaned and cleaned[-1] == "":
            continue

        cleaned.append("")

    return "\n".join(cleaned).strip()

def extract_problem(path, index):
    with open(path, "r", encoding="utf-8") as file:
        data = yaml.safe_load(file)

    question = data["questions"][index]
    question_type = ""
    figure = None

    if "numerical" in question:
        problem = question["numerical"]["text"]
        question_type = "numerical"
        if "figure" in question["numerical"]:
            figure = question["numerical"]["figure"]

    if "multiple_choice" in question:
        problem = question["multiple_choice"]["text"]
        question_type = "multiple_choice"
        if "figure" in question["multiple_choice"]:
            figure = question["multiple_choice"]["figure"]

    return problem, question_type, figure


def string_to_latex(string):
    if string is None:
        return ""
    text = _normalize_list_linebreaks(string)
    text = text.replace("&lt;", "<").replace("&gt;", ">")
    text = text.replace("&le;", "≤").replace("&ge;", "≥")
    text = text.replace("&ne;", "≠").replace("&plusmn;", "±")
    text = re.sub(r"<\s*\\\s*latex\s*>", "</latex>", text, flags=re.IGNORECASE)
    text = re.sub(r"<\s*/\s*\\\s*latex\s*>", "</latex>", text, flags=re.IGNORECASE)
    text = re.sub(r"<\s*\\/\s*latex\s*>", "</latex>", text, flags=re.IGNORECASE)
    text = text.replace("<latex>", "$").replace("</latex>", "$")
    text = text.replace("<ul>", "").replace("</ul>", "")
    text = text.replace("<li>", "• ").replace("</li>", "\n")
    text = text.replace("<p>", "").replace("</p>", "")
    text = text.replace("<b>", "$\\textbf{").replace("</b>", "}$")
    text = text.replace("<strong>", "$\\textbf{").replace("</strong>", "}$")
    text = re.sub(r"\*\*(.*?)\*\*", r"$\\textbf{\1}$", text)
    text = re.sub(r"\*(.*?)\*", r"$\\textbf{\1}$", text)
    return _compact_list_spacing(text)


def string_to_latex_html(string):
    return string_to_latex(string)
