import posixpath
import random
import re
import shutil
import subprocess
import zipfile
from pathlib import Path

import yaml

from .exam_generation import string_to_latex


class ExamBuildError(Exception):
    pass


def _load_yaml_questions(yaml_file_path):
    try:
        with open(yaml_file_path, "r", encoding="utf-8") as handle:
            payload = yaml.safe_load(handle) or {}
    except FileNotFoundError as exc:
        raise ExamBuildError(f"Missing YAML file: {yaml_file_path}") from exc
    except yaml.YAMLError as exc:
        raise ExamBuildError(f"Invalid YAML file: {yaml_file_path}") from exc

    questions = payload.get("questions", []) if isinstance(payload, dict) else []
    if not isinstance(questions, list):
        return []
    return questions


def _unwrap_question(question):
    if not isinstance(question, dict):
        return "unknown", {}

    for kind in ("numerical", "multiple_choice", "multiple_answers"):
        block = question.get(kind)
        if isinstance(block, dict):
            return kind, block

    # Fall back to a single wrapped question block of unknown type.
    if len(question) == 1:
        only_key, only_value = next(iter(question.items()))
        if isinstance(only_value, dict):
            return str(only_key), only_value

    # Fall back to first dict-like block that looks like a question payload.
    for key, value in question.items():
        if not isinstance(value, dict):
            continue
        if any(field in value for field in ("text", "title", "question", "prompt", "answers", "figure")):
            return str(key), value

    return "unknown", question


def _find_first_text_value(value):
    if isinstance(value, dict):
        for key in ("text", "title", "question", "prompt", "statement"):
            candidate = value.get(key)
            if candidate is not None:
                text = str(candidate).strip()
                if text:
                    return text
        for nested in value.values():
            found = _find_first_text_value(nested)
            if found:
                return found
        return ""

    if isinstance(value, list):
        for item in value:
            found = _find_first_text_value(item)
            if found:
                return found

    return ""


def _find_first_figure_ref(value):
    if isinstance(value, dict):
        figure = value.get("figure")
        if isinstance(figure, str) and figure.strip():
            return figure.strip()
        for nested in value.values():
            found = _find_first_figure_ref(nested)
            if found:
                return found
        return None

    if isinstance(value, list):
        for item in value:
            found = _find_first_figure_ref(item)
            if found:
                return found

    return None


def _extract_choices(question_type, question_block):
    if question_type not in ("multiple_choice", "multiple_answers"):
        return []

    answers = question_block.get("answers", [])
    if not isinstance(answers, list):
        return []

    choices = []
    for answer in answers:
        if not isinstance(answer, dict):
            continue
        answer_block = answer.get("answer", answer)
        if not isinstance(answer_block, dict):
            continue
        text = str(answer_block.get("text", "")).strip()
        if text:
            choices.append(text)
    return choices


def _extract_answer_key(question_type, question_block):
    if question_type == "multiple_answers":
        answers = question_block.get("answers", [])
        if not isinstance(answers, list):
            return ""

        correct_parts = []
        for idx, answer in enumerate(answers):
            if not isinstance(answer, dict):
                continue
            answer_block = answer.get("answer", answer)
            if not isinstance(answer_block, dict):
                continue
            if bool(answer_block.get("correct", False)):
                label = chr(ord("A") + idx)
                text = str(answer_block.get("text", "")).strip()
                correct_parts.append(f"{label}. {text}" if text else label)

        if not correct_parts:
            return ""
        return "; ".join(correct_parts)

    if question_type == "multiple_choice":
        answers = question_block.get("answers", [])
        if not isinstance(answers, list):
            return ""

        for idx, answer in enumerate(answers):
            if not isinstance(answer, dict):
                continue
            answer_block = answer.get("answer", answer)
            if not isinstance(answer_block, dict):
                continue
            if bool(answer_block.get("correct", False)):
                label = chr(ord("A") + idx)
                text = str(answer_block.get("text", "")).strip()
                return f"{label}. {text}" if text else label
        return ""

    if question_type == "numerical":
        answer = question_block.get("answer", {})
        if not isinstance(answer, dict):
            return ""
        value = answer.get("value", "")
        tolerance = answer.get("tolerance")
        margin_type = str(answer.get("margin_type", "")).strip()

        if value == "":
            return ""

        base = f"{value}"
        if tolerance is not None and margin_type:
            return f"{base} (tolerance: {tolerance} {margin_type})"
        if tolerance is not None:
            return f"{base} (tolerance: {tolerance})"
        return base

    return ""


def _normalize_question(yaml_path, yaml_dir, index, raw_question):
    question_type, question_block = _unwrap_question(raw_question)
    text = _find_first_text_value(question_block)
    if not text:
        return None

    figure_ref = _find_first_figure_ref(question_block)
    figure_path = None
    if isinstance(figure_ref, str) and figure_ref.strip():
        figure_path = posixpath.normpath(posixpath.join(yaml_dir, figure_ref.strip().replace("\\", "/")))

    return {
        "question_key": f"{yaml_path}#{index}",
        "question_type": question_type,
        "text": text,
        "choices": _extract_choices(question_type, question_block),
        "answer_key": _extract_answer_key(question_type, question_block),
        "figure_path": figure_path,
    }


def _load_question_pool(repo_root, yaml_path):
    yaml_file_path = repo_root.joinpath(*yaml_path.split("/"))
    questions = _load_yaml_questions(yaml_file_path)

    normalized = []
    yaml_dir = posixpath.dirname(yaml_path)
    for index, raw_question in enumerate(questions):
        parsed = _normalize_question(yaml_path, yaml_dir, index, raw_question)
        if parsed:
            normalized.append(parsed)
    return normalized


def _latex_strip_html(value):
    text = string_to_latex(value)
    text = re.sub(r"</?(div|span|h1|h2|h3|h4|h5|h6|table|thead|tbody|tr|th|td|br)\\b[^>]*>", "", text)
    return text.strip()


def _safe_latex_text(value):
    text = _latex_strip_html(value)
    text = text.replace("<", r"\textless{}")
    text = text.replace(">", r"\textgreater{}")
    text = text.replace("≤", r"$\leq$")
    text = text.replace("≥", r"$\geq$")
    text = text.replace("≠", r"$\neq$")
    text = text.replace("±", r"$\pm$")
    # Keep percent signs from breaking LaTeX text mode.
    text = text.replace("%", r"\%")
    text = _escape_latex_underscores_outside_math(text)
    return text


def _escape_latex_underscores_outside_math(text):
    out = []
    in_math = False
    escaped = False

    for ch in text:
        if escaped:
            out.append(ch)
            escaped = False
            continue

        if ch == "\\":
            out.append(ch)
            escaped = True
            continue

        if ch == "$":
            in_math = not in_math
            out.append(ch)
            continue

        if ch == "_" and not in_math:
            out.append(r"\_")
            continue

        out.append(ch)

    return "".join(out)


def _copy_figure_if_available(question, repo_root, assets_dir, exam_number, question_number):
    figure_path = question.get("figure_path")
    if not figure_path:
        return None

    source_file = repo_root.joinpath(*figure_path.split("/"))
    if not source_file.is_file():
        return None

    suffix = source_file.suffix or ".png"
    target_name = f"exam_{exam_number:02d}_q_{question_number:03d}{suffix}"
    target_file = assets_dir / target_name
    shutil.copy2(source_file, target_file)

    return f"assets/{target_name}"


def _estimate_question_block_lines(question):
    text = str(question.get("text", ""))
    choices = question.get("choices") or []
    has_figure = bool(question.get("figure_path"))

    # Rough page-fit estimate for Needspace; prioritize avoiding split blocks.
    lines = 9
    lines += max(3, len(text) // 55)
    lines += len(choices) * 2
    if has_figure:
        lines += 16
    return max(lines, 14)


def _render_exam_tex(exam_number, questions, repo_root, exam_dir):
    assets_dir = exam_dir / "assets"
    assets_dir.mkdir(parents=True, exist_ok=True)

    lines = [
        r"\documentclass[12pt]{article}",
        r"\usepackage[margin=1in]{geometry}",
        r"\usepackage{amsmath}",
        r"\usepackage{graphicx}",
        r"\usepackage{enumitem}",
        r"\setlength{\parskip}{0.5em}",
        r"\setlength{\parindent}{0pt}",
        r"\makeatletter",
        r"\newcommand{\questionneedspace}[1]{%",
        r"  \ifdim\pagegoal=\maxdimen\relax",
        r"  \else",
        r"    \dimen@=\dimexpr\pagegoal-\pagetotal\relax",
        r"    \ifdim\dimen@<#1\relax\newpage\fi",
        r"  \fi",
        r"}",
        r"\makeatother",
        r"\begin{document}",
        r"\title{PHY2047 Exam [\#]}",
        rf"\author{{Test {exam_number}}}",
        r"\maketitle",
        r"",
        r"\pagestyle{empty}",
        r"\section*{}",
        r"Name:\rule{7cm}{0.4pt} ID:\rule{4cm}{0.4pt}",
        r"",
        r"\subsection*{}",
        r"[Rules paragraph(s) placeholder]",
        r"",
        r"\vfill",
        r"\subsection*{}",
        r"Total: \rule{2cm}{0.4pt}",
        r"",
        r"\newpage",
        r"\section*{}",
    ]

    for index, question in enumerate(questions, start=1):
        needed_lines = _estimate_question_block_lines(question)
        lines.append(rf"\questionneedspace{{{needed_lines}\baselineskip}}")
        lines.append(r"\subsection*{}")
        lines.append(rf"{index}) {_safe_latex_text(question['text'])}")
        if not question["choices"]:
            lines.append(r"\par\noindent\textbf{Answer:} \rule{10cm}{0.4pt}")
            lines.append(r"\vspace{0.8cm}")

        figure_include = _copy_figure_if_available(question, repo_root, assets_dir, exam_number, index)
        if figure_include:
            lines.append(r"\begin{center}")
            lines.append(rf"\includegraphics[width=0.72\textwidth]{{{figure_include}}}")
            lines.append(r"\end{center}")

        if question["choices"]:
            lines.append(r"\begin{enumerate}[label=\Alph*.]")
            for choice in question["choices"]:
                lines.append(rf"\item {_safe_latex_text(choice)}")
            lines.append(r"\end{enumerate}")

    lines.append(r"\end{document}")

    tex_name = f"exam_{exam_number:02d}.tex"
    tex_path = exam_dir / tex_name
    tex_path.write_text("\n".join(lines), encoding="utf-8")
    return tex_path


def _render_answer_key_tex(exam_number, questions, exam_dir):
    lines = [
        r"\documentclass[12pt]{article}",
        r"\usepackage[margin=1in]{geometry}",
        r"\usepackage{amsmath}",
        r"\setlength{\parskip}{0.5em}",
        r"\setlength{\parindent}{0pt}",
        r"\begin{document}",
        rf"\section*{{Physics Exam {exam_number} Answer Key}}",
    ]

    for index, question in enumerate(questions, start=1):
        answer_text = question.get("answer_key", "")
        if not answer_text:
            answer_text = "Answer not available"
        lines.append(rf"\textbf{{Question {index}:}} {_safe_latex_text(answer_text)}")

    lines.append(r"\end{document}")

    tex_name = f"exam_{exam_number:02d}_answer_key.tex"
    tex_path = exam_dir / tex_name
    tex_path.write_text("\n".join(lines), encoding="utf-8")
    return tex_path


def _compile_tex_to_pdf(tex_path):
    cmd = [
        "pdflatex",
        "-interaction=nonstopmode",
        "-halt-on-error",
        tex_path.name,
    ]

    result = subprocess.run(
        cmd,
        cwd=tex_path.parent,
        capture_output=True,
        text=True,
        check=False,
    )

    if result.returncode != 0:
        stderr = (result.stderr or "").strip()
        stdout = (result.stdout or "").strip().splitlines()
        tail = "\n".join(stdout[-20:])
        msg = stderr or tail or "pdflatex failed"
        raise ExamBuildError(f"Failed to compile PDF for {tex_path.name}: {msg}")

    pdf_path = tex_path.with_suffix(".pdf")
    if not pdf_path.exists():
        raise ExamBuildError(f"Expected PDF was not generated for {tex_path.name}")
    return pdf_path


def _build_exam_payloads(repo_root, selections, exam_count):
    if exam_count < 1:
        raise ExamBuildError("Exam count must be at least 1.")

    valid_selections = []
    for selection in selections:
        try:
            count = int(selection.get("count", 0))
        except (TypeError, ValueError):
            continue
        if count > 0:
            valid_selections.append({**selection, "count": count})

    if not valid_selections:
        raise ExamBuildError("No problems were selected.")

    exam_payloads = [[] for _ in range(exam_count)]

    for selection in valid_selections:
        yaml_path = str(selection.get("yaml_path", "")).strip()
        count_per_exam = selection["count"]
        if not yaml_path:
            continue

        question_pool = _load_question_pool(repo_root, yaml_path)
        required_total = count_per_exam * exam_count
        if len(question_pool) < required_total:
            title = selection.get("problem_title") or yaml_path
            raise ExamBuildError(
                f"Not enough unique questions in {title}. Requested {required_total}, available {len(question_pool)}."
            )

        selected_questions = random.sample(question_pool, required_total)
        random.shuffle(selected_questions)

        for exam_index in range(exam_count):
            start = exam_index * count_per_exam
            end = start + count_per_exam
            exam_payloads[exam_index].extend(selected_questions[start:end])

    for questions in exam_payloads:
        random.shuffle(questions)

    return exam_payloads


def build_exam_preview_pdf(repo_root, selections, output_pdf_path):
    exam_payloads = _build_exam_payloads(repo_root, selections, exam_count=1)
    questions = exam_payloads[0]

    output_pdf_path.parent.mkdir(parents=True, exist_ok=True)
    working_root = output_pdf_path.parent / "_exam_preview"

    if working_root.exists():
        shutil.rmtree(working_root)
    working_root.mkdir(parents=True, exist_ok=True)

    try:
        exam_dir = working_root / "exam_01"
        exam_dir.mkdir(parents=True, exist_ok=True)
        tex_path = _render_exam_tex(1, questions, repo_root, exam_dir)
        pdf_path = _compile_tex_to_pdf(tex_path)
        shutil.copy2(pdf_path, output_pdf_path)
    finally:
        shutil.rmtree(working_root, ignore_errors=True)

    return output_pdf_path


def build_exam_zip(repo_root, selections, exam_count, output_zip_path):
    exam_payloads = _build_exam_payloads(repo_root, selections, exam_count)

    output_zip_path.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(output_zip_path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        working_root = output_zip_path.parent / "_exam_build"
        if working_root.exists():
            shutil.rmtree(working_root)
        working_root.mkdir(parents=True, exist_ok=True)

        for exam_number, questions in enumerate(exam_payloads, start=1):
            exam_dir = working_root / f"exam_{exam_number:02d}"
            exam_dir.mkdir(parents=True, exist_ok=True)
            archive_folder = exam_dir.name
            exam_prefix = f"exam{exam_number:02d}"

            tex_path = _render_exam_tex(exam_number, questions, repo_root, exam_dir)
            pdf_path = _compile_tex_to_pdf(tex_path)
            answer_key_tex_path = _render_answer_key_tex(exam_number, questions, exam_dir)
            answer_key_pdf_path = _compile_tex_to_pdf(answer_key_tex_path)

            archive.write(tex_path, arcname=f"{archive_folder}/{tex_path.name}")
            archive.write(pdf_path, arcname=f"{archive_folder}/{exam_prefix}_preview.pdf")
            archive.write(answer_key_tex_path, arcname=f"{archive_folder}/{answer_key_tex_path.name}")
            archive.write(answer_key_pdf_path, arcname=f"{archive_folder}/{exam_prefix}_answer_key_preview.pdf")

        shutil.rmtree(working_root, ignore_errors=True)

    return output_zip_path
