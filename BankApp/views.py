import posixpath
import json
import hashlib
import re
import tempfile
import mimetypes
from io import BytesIO
from pathlib import Path
from urllib.parse import quote
import zipfile

import yaml
from django.conf import settings
from django.http import FileResponse, Http404, HttpResponse, JsonResponse
from django.shortcuts import render
from django.urls import reverse
from django.views.decorators.csrf import ensure_csrf_cookie
from django.views.decorators.http import require_http_methods
from django.views.decorators.http import require_GET

from .models import PhysicsClass, Problem, RepositoryFile, SyncState
from .services.github_sync import GitHubProblemBankSyncService
from .utils.exam_builder import ExamBuildError, build_exam_preview_pdf, build_exam_zip
from .utils.exam_generation import string_to_latex, string_to_latex_html


_MODAL_DATA_BY_SHA = {}
_MODAL_CACHE_KEY = None
_CATALOG_CACHE_KEY = None
_CATALOG_CACHE_DATA = None


def _safe_load_problem_yaml(yaml_content):
	if not yaml_content:
		return {}

	try:
		parsed = yaml.safe_load(yaml_content) or {}
		if isinstance(parsed, dict):
			return parsed
	except yaml.YAMLError:
		pass

	# Fallback for malformed bank headers: load only the questions section.
	match = re.search(r"(?m)^questions:\s*$", yaml_content)
	if not match:
		return {}

	questions_block = yaml_content[match.start():]
	try:
		parsed = yaml.safe_load(questions_block) or {}
		if isinstance(parsed, dict):
			return parsed
	except yaml.YAMLError:
		return {}

	return {}


def _build_local_figure_url(figure_path):
	if not figure_path:
		return ""
	encoded = quote(str(figure_path).strip(), safe="/")
	return f"{reverse('problem_figure_api')}?path={encoded}"


def _resolve_figure_path(yaml_path, figure_ref, repo_root):
	raw_ref = str(figure_ref or "").strip()
	if not raw_ref:
		return ""

	markdown_match = re.search(r"!\[[^\]]*\]\(([^)]+)\)", raw_ref)
	if markdown_match:
		raw_ref = markdown_match.group(1).strip()

	img_src_match = re.search(r"src\s*=\s*[\"']([^\"']+)[\"']", raw_ref, flags=re.IGNORECASE)
	if img_src_match:
		raw_ref = img_src_match.group(1).strip()

	if raw_ref.startswith(("http://", "https://")):
		return ""

	normalized = raw_ref.strip("\"'").replace("\\", "/")
	normalized = normalized.lstrip("/")
	if normalized.startswith("./"):
		normalized = normalized[2:]

	base_dir = posixpath.dirname(yaml_path)
	candidates = []
	direct = posixpath.normpath(posixpath.join(base_dir, normalized))
	candidates.append(direct)

	if "/" not in normalized:
		for folder in ("Figures", "Figure", "figure_folder", "figures", "figure", "images", "Images"):
			candidates.append(posixpath.normpath(posixpath.join(base_dir, folder, normalized)))

	for source, replacement in (
		("/figure_folder/", "/Figures/"),
		("/figure_folder/", "/Figure/"),
		("/Figure/", "/Figures/"),
		("/figures/", "/Figures/"),
		("/figure/", "/Figure/"),
	):
		if source in direct:
			candidates.append(direct.replace(source, replacement))

	seen = set()
	for candidate in candidates:
		if candidate in seen:
			continue
		seen.add(candidate)
		if repo_root.joinpath(*candidate.split("/")).is_file():
			return candidate

	return direct


def _figure_exists(repo_root, figure_path):
	if not figure_path:
		return False
	figure_str = str(figure_path).replace("\\", "/").strip("/")
	if not figure_str:
		return False

	direct_path = repo_root.joinpath(*figure_str.split("/"))
	if direct_path.is_file():
		return True

	parent = posixpath.dirname(figure_str)
	file_name = posixpath.basename(figure_str)
	if not parent or not file_name:
		return False

	zip_path = repo_root.joinpath(*parent.split("/")).with_suffix(".zip")
	if not zip_path.is_file():
		return False

	try:
		with zipfile.ZipFile(zip_path, "r") as archive:
			members = set(archive.namelist())
			return file_name in members or posixpath.join(posixpath.basename(parent), file_name) in members
	except (OSError, zipfile.BadZipFile):
		return False


def _read_figure_bytes_from_cache(repo_root, figure_path):
	"""Read a figure either as a direct file or from a sibling zip archive."""
	figure_str = str(figure_path or "").replace("\\", "/").strip("/")
	if not figure_str:
		return None, None

	direct_path = repo_root.joinpath(*figure_str.split("/"))
	if direct_path.is_file():
		return direct_path.read_bytes(), direct_path.name

	parent = posixpath.dirname(figure_str)
	file_name = posixpath.basename(figure_str)
	if not parent or not file_name:
		return None, None

	zip_path = repo_root.joinpath(*parent.split("/")).with_suffix(".zip")
	if not zip_path.is_file():
		return None, None

	try:
		with zipfile.ZipFile(zip_path, "r") as archive:
			member_candidates = [
				file_name,
				posixpath.join(posixpath.basename(parent), file_name),
			]
			for member in member_candidates:
				try:
					return archive.read(member), file_name
				except KeyError:
					continue
	except (OSError, zipfile.BadZipFile):
		return None, None

	return None, None


def _iter_question_payloads(parsed_yaml):
	questions = parsed_yaml.get("questions", []) if isinstance(parsed_yaml, dict) else []
	if not isinstance(questions, list) or not questions:
		return []

	payloads = []
	for question in questions:
		if not isinstance(question, dict):
			continue
		if len(question) == 1:
			first_value = next(iter(question.values()))
			if isinstance(first_value, dict):
				payloads.append(first_value)
				continue
		payloads.append(question)
	return payloads


def _extract_question_metadata(question_payload):
	"""Extract metadata for a single question: answer type and categories."""
	metadata = {
		"answer_type": "",
		"category_count": 0,
	}
	
	if not isinstance(question_payload, dict):
		return metadata
	
	# Extract answer type
	if "numerical" in question_payload or "value" in question_payload or "numerical_answer" in question_payload:
		metadata["answer_type"] = "numerical"
	elif "choices" in question_payload or "answers" in question_payload or "options" in question_payload:
		metadata["answer_type"] = "multiple_choice"
	elif "categories" in question_payload:
		metadata["answer_type"] = "category"
		# Count categories
		categories = question_payload.get("categories")
		if isinstance(categories, (list, dict)):
			metadata["category_count"] = len(categories)
	elif "text" in question_payload:
		metadata["answer_type"] = "free_response"
	
	return metadata


def _extract_problem_metadata(yaml_content):
	"""Extract file-level metadata: total questions and all answer types."""
	metadata = {
		"answer_types": set(),
		"num_questions": 0,
	}
	
	if not yaml_content:
		return {"answer_types": [], "num_questions": 0}
	
	parsed = _safe_load_problem_yaml(yaml_content)
	if not isinstance(parsed, dict):
		return {"answer_types": [], "num_questions": 0}
	
	for question_payload in _iter_question_payloads(parsed):
		if not isinstance(question_payload, dict):
			continue
		
		metadata["num_questions"] += 1
		
		# Extract answer type and add to set
		question_meta = _extract_question_metadata(question_payload)
		if question_meta["answer_type"]:
			metadata["answer_types"].add(question_meta["answer_type"])
	
	return {
		"answer_types": sorted(list(metadata["answer_types"])),
		"num_questions": metadata["num_questions"],
	}


def _parse_problem_modal_data(yaml_content, yaml_path, repo_root):
	default_payload = {"description": "", "example": "", "figure_path": ""}
	if not yaml_content:
		return default_payload

	parsed = _safe_load_problem_yaml(yaml_content)

	if not isinstance(parsed, dict):
		return default_payload

	bank_info = parsed.get("bank_info", {})
	description = ""
	if isinstance(bank_info, dict):
		description_value = bank_info.get("description", "")
		description = str(description_value).strip() if description_value is not None else ""

	example = ""
	figure_path = ""
	for question_payload in _iter_question_payloads(parsed):
		if example == "":
			example_source = str(question_payload.get("text") or question_payload.get("title") or "").strip()
			if example_source:
				example = string_to_latex(example_source)

		if figure_path == "":
			figure_ref = question_payload.get("figure")
			if isinstance(figure_ref, str) and figure_ref.strip():
				figure_path = _resolve_figure_path(yaml_path, figure_ref, repo_root)

		if example and figure_path:
			break

	return {"description": description, "example": example, "figure_path": figure_path}


def _parse_problem_question_data(yaml_content, yaml_path, repo_root, owner, repo, branch):
	def _is_true(value):
		if isinstance(value, bool):
			return value
		if isinstance(value, str):
			return value.strip().lower() in ("true", "yes", "1")
		return False

	def _clean_text(value):
		if value is None:
			return ""
		text = str(value).replace("\r\n", " ").replace("\r", " ").replace("\n", " ")
		text = re.sub(r"[ \t]+", " ", text).strip()
		return text

	def _clean_multiline_text(value):
		"""Normalize multiline YAML text while preserving intended paragraph breaks."""
		if value is None:
			return ""

		text = str(value).replace("\r\n", "\n").replace("\r", "\n")
		# Some YAML entries include literal escaped newlines in quoted strings.
		text = text.replace("\\n", "\n")
		# Drop markdown line-continuation backslashes at end-of-line.
		text = re.sub(r"\\[ \t]*\n", "\n", text)
		# Normalize horizontal spacing per line while preserving line structure.
		lines = [re.sub(r"[ \t]+", " ", line).strip() for line in text.split("\n")]
		text = "\n".join(lines)
		# Avoid excessive vertical whitespace while keeping readable paragraphs.
		text = re.sub(r"\n{3,}", "\n\n", text)
		return text.strip()

	def _normalize_letter(raw_letter, fallback_index):
		candidate = _clean_text(raw_letter).upper()
		# Only keep explicit single-letter labels; otherwise use positional A/B/C fallback.
		if re.fullmatch(r"[A-Z]", candidate):
			return candidate
		return chr(65 + fallback_index)

	def _extract_choice_records(question_payload):
		if not isinstance(question_payload, dict):
			return []

		raw_choices = question_payload.get("choices")
		if raw_choices is None:
			raw_choices = question_payload.get("answers")
		if raw_choices is None:
			raw_choices = question_payload.get("options")

		records = []

		def append_record(letter, text_value, is_correct):
			text = _clean_text(text_value)
			if not text:
				return
			clean_letter = _normalize_letter(letter, len(records))
			records.append({
				"letter": clean_letter,
				"text": text,
				"is_correct": _is_true(is_correct),
			})

		if isinstance(raw_choices, dict):
			for key, value in raw_choices.items():
				if isinstance(value, dict):
					append_record(key, value.get("text"), value.get("is_correct") or value.get("correct"))
				else:
					append_record(key, value, False)
			return records

		if not isinstance(raw_choices, list):
			return records

		for idx, choice in enumerate(raw_choices):
			default_letter = chr(65 + idx)
			if isinstance(choice, dict):
				if len(choice) == 1:
					entry_key = next(iter(choice.keys()))
					entry_value = choice[entry_key]
					if isinstance(entry_value, dict):
						append_record(entry_key, entry_value.get("text"), entry_value.get("is_correct") or entry_value.get("correct"))
						continue
					if not isinstance(entry_value, (list, dict)):
						append_record(entry_key, entry_value, False)
						continue

				append_record(
					choice.get("label") or choice.get("id") or default_letter,
					choice.get("text"),
					choice.get("is_correct") or choice.get("correct"),
				)
			else:
				append_record(default_letter, choice, False)

		return records

	def _format_to_sig_figs(value_str, sig_figs):
		"""Convert a number to specified significant figures."""
		try:
			value = float(value_str)
			if value == 0:
				return value_str
			
			from math import log10, floor
			
			# Calculate the number of decimal places needed
			magnitude = floor(log10(abs(value)))
			decimal_places = sig_figs - magnitude - 1
			
			if decimal_places < 0:
				# Round to nearest 10, 100, etc.
				rounded = round(value, decimal_places)
				return str(int(rounded))
			else:
				rounded = round(value, decimal_places)
				return f"{rounded:.{decimal_places}f}"
		except (ValueError, TypeError):
			return value_str

	def _extract_answer_text(question_payload):
		if not isinstance(question_payload, dict):
			return ""

		choice_records = _extract_choice_records(question_payload)
		correct_letters = [record["letter"] for record in choice_records if record["is_correct"]]
		if correct_letters:
			return ", ".join(correct_letters)

		# Check for value-based answers with tolerance
		value_key = None
		for key in ("value", "numerical_answer", "numeric_answer"):
			if key in question_payload:
				value_key = key
				break

		if value_key:
			value_data = question_payload.get(value_key)
			
			# Handle case where value is a dict with nested structure
			if isinstance(value_data, dict):
				actual_value = _clean_text(value_data.get("value"))
				tolerance = _clean_text(value_data.get("tolerance"))
				margin_type = _clean_text(value_data.get("margin_type"))
				precision = value_data.get("precision")
				precision_type = _clean_text(value_data.get("precision_type"))
				
				if actual_value:
					result_parts = [actual_value]
					
					if tolerance:
						# Add % to tolerance if margin_type is "percent"
						if margin_type and "percent" in margin_type.lower():
							result_parts.append(f"Tolerance: {tolerance}%")
						else:
							result_parts.append(f"Tolerance: {tolerance}")
					
					# Check for significant figures / precision
					if precision and precision_type and "significant" in precision_type.lower():
						try:
							precision_num = int(_clean_text(str(precision)))
							sig_figs_value = _format_to_sig_figs(actual_value, precision_num)
							result_parts.append(f"Significant Figures: {sig_figs_value}")
						except (ValueError, TypeError):
							pass
					
					return "    ".join(result_parts)
					
			else:
				# Handle simple value
				value = _clean_text(value_data)
				tolerance = None
				margin_type = None
				for tol_key in ("tolerance", "tol"):
					if tol_key in question_payload:
						tolerance = _clean_text(question_payload.get(tol_key))
						break
				
				for mt_key in ("margin_type",):
					if mt_key in question_payload:
						margin_type = _clean_text(question_payload.get(mt_key))
						break

				if value:
					result_parts = [value]
					if tolerance:
						if margin_type and "percent" in margin_type.lower():
							result_parts.append(f"Tolerance: {tolerance}%")
						else:
							result_parts.append(f"Tolerance: {tolerance}")
					return "    ".join(result_parts)

		answers = []

		def add_answer(answer_val):
			if answer_val is None:
				return
			
			# Check if answer_val is a dict with value/tolerance structure
			if isinstance(answer_val, dict):
				if "value" in answer_val:
					actual_value = _clean_text(answer_val.get("value"))
					tolerance = _clean_text(answer_val.get("tolerance"))
					margin_type = _clean_text(answer_val.get("margin_type"))
					precision = answer_val.get("precision")
					precision_type = _clean_text(answer_val.get("precision_type"))
					
					if actual_value:
						result_parts = [actual_value]
						
						if tolerance:
							if margin_type and "percent" in margin_type.lower():
								result_parts.append(f"Tolerance: {tolerance}%")
							else:
								result_parts.append(f"Tolerance: {tolerance}")
						
						# Check for significant figures / precision
						if precision and precision_type and "significant" in precision_type.lower():
							try:
								precision_num = int(_clean_text(str(precision)))
								sig_figs_value = _format_to_sig_figs(actual_value, precision_num)
								result_parts.append(f"Significant Figures: {sig_figs_value}")
							except (ValueError, TypeError):
								pass
						
						formatted = "    ".join(result_parts)
						if formatted not in answers:
							answers.append(formatted)
						return
			
			if isinstance(answer_val, list):
				for entry in answer_val:
					add_answer(entry)
				return
			
			text = _clean_text(answer_val)
			if text and text not in answers:
				answers.append(text)

		for key in ("answer", "correct_answer", "correct", "solution", "final_answer", "ans"):
			answer_val = question_payload.get(key)
			add_answer(answer_val)

		if not answers:
			# Check if this is a "categories" item (no answer provided)
			if "categories" in question_payload and not answers:
				return "Not provided in this item. Refer to source code for further details."
			return ""

		if len(answers) == 1:
			return answers[0]

		return "\n".join([f"- {item}" for item in answers])

	def _extract_general_feedback_text(question_payload):
		if not isinstance(question_payload, dict):
			return ""

		feedback = question_payload.get("feedback")
		if isinstance(feedback, dict):
			general_feedback = _clean_multiline_text(feedback.get("general"))
			if general_feedback:
				return general_feedback
		elif isinstance(feedback, str):
			feedback_text = _clean_multiline_text(feedback)
			if feedback_text:
				return feedback_text

		# Compatibility fallback for non-standard key naming.
		return _clean_multiline_text(question_payload.get("general_feedback") or "")

	def _build_output_text(question_payload):
		if not isinstance(question_payload, dict):
			return _clean_multiline_text(question_payload)

		stem = _clean_multiline_text(question_payload.get("text") or question_payload.get("title") or question_payload.get("question") or "")
		if not stem:
			stem = _clean_multiline_text(question_payload)

		choice_records = _extract_choice_records(question_payload)
		if not choice_records:
			return stem

		choice_lines = [f"{record['letter']}) {record['text']}" for record in choice_records]

		if not choice_lines:
			return stem

		return stem + "\n\nChoices:\n" + "\n".join(choice_lines)

	if not yaml_content:
		return []

	parsed = _safe_load_problem_yaml(yaml_content)

	payloads = _iter_question_payloads(parsed)
	entries = []

	for index, payload in enumerate(payloads, start=1):
		label = f"Problem {index}"
		answer_text = ""
		figure_url = ""
		if isinstance(payload, dict):
			label_value = payload.get("title") or payload.get("name") or payload.get("id") or ""
			if label_value:
				label = str(label_value).strip()

			output_source = _build_output_text(payload)

			answer_text = _extract_answer_text(payload)
			general_feedback_text = _extract_general_feedback_text(payload)

			figure_ref = payload.get("figure")
			if isinstance(figure_ref, str) and figure_ref.strip():
				figure_path = _resolve_figure_path(yaml_path, figure_ref, repo_root)
				if figure_path and _figure_exists(repo_root, figure_path):
					figure_url = _build_local_figure_url(figure_path)

			yaml_source = yaml.safe_dump(payload, sort_keys=False, default_flow_style=False, allow_unicode=False).strip()
		else:
			output_source = _build_output_text(payload)
			general_feedback_text = ""
			yaml_source = str(payload)

		latex_source = string_to_latex(output_source) if output_source else ""
		answer_latex = string_to_latex(answer_text) if answer_text else ""
		general_feedback_latex = string_to_latex(general_feedback_text) if general_feedback_text else ""

		# Extract per-question metadata
		question_metadata = _extract_question_metadata(payload)

		entries.append(
			{
				"index": index,
				"label": label,
				"output": latex_source,
				"answer": answer_latex,
				"general_feedback": general_feedback_latex,
				"figure_url": figure_url,
				"latex_source": latex_source,
				"yaml_source": yaml_source,
				"answer_type": question_metadata["answer_type"],
				"category_count": question_metadata["category_count"],
			}
		)

	return entries


def _load_modal_cache(owner, repo):
	global _MODAL_CACHE_KEY
	cache_key = f"{owner}/{repo}"
	if _MODAL_CACHE_KEY == cache_key and _MODAL_DATA_BY_SHA:
		return

	_MODAL_DATA_BY_SHA.clear()
	cache_file = Path(settings.BASE_DIR) / ".cache" / "problem-bank" / f"{owner}_{repo}_modal_cache.json"
	if cache_file.is_file():
		try:
			loaded = json.loads(cache_file.read_text(encoding="utf-8"))
			if isinstance(loaded, dict):
				for sha, payload in loaded.items():
					if isinstance(payload, dict):
						_MODAL_DATA_BY_SHA[sha] = {
							"description": str(payload.get("description", "")),
							"example": str(payload.get("example", "")),
							"figure_path": str(payload.get("figure_path", "")),
						}
		except Exception:
			pass

	_MODAL_CACHE_KEY = cache_key


def home_view(request):
	return render(request, "BankApp/index.html")


def problems_view(request):
	return render(request, "BankApp/problems.html")


@ensure_csrf_cookie
def generator_view(request):
	return render(request, "BankApp/generator.html")


@require_GET
def latex_preview_api(request):
	text = request.GET.get("text", "")
	return JsonResponse({"latex": string_to_latex(text)})


@require_GET
def catalog_api(request):
	global _CATALOG_CACHE_KEY
	global _CATALOG_CACHE_DATA

	state = SyncState.objects.first()
	owner = state.repo_owner if state else "Zhongzhou"
	repo = state.repo_name if state else "ESTELA-physics-problem-bank"
	branch = state.default_branch if state and state.default_branch else "main"
	last_synced = state.last_synced_at.isoformat() if state and state.last_synced_at else "never"
	problem_count = Problem.objects.count()
	catalog_cache_key = f"{owner}/{repo}:{branch}:{last_synced}:{problem_count}"

	if _CATALOG_CACHE_KEY == catalog_cache_key and _CATALOG_CACHE_DATA is not None:
		return JsonResponse(_CATALOG_CACHE_DATA)

	local_repo_root = Path(settings.BASE_DIR) / ".cache" / "problem-bank" / f"{owner}_{repo}"
	_load_modal_cache(owner, repo)

	classes_qs = PhysicsClass.objects.prefetch_related("units__problems").all()
	yaml_paths = list(Problem.objects.values_list("yaml_path", flat=True))
	repo_rows = RepositoryFile.objects.filter(path__in=yaml_paths).values_list("path", "content", "sha")
	modal_cache = {}
	for yaml_path, content, sha in repo_rows:
		cached = _MODAL_DATA_BY_SHA.get(sha)
		refresh_cached = False
		if cached is None:
			refresh_cached = True
		else:
			cached_figure = str(cached.get("figure_path", "")).strip()
			if not cached_figure or not _figure_exists(local_repo_root, cached_figure):
				refresh_cached = True

		if refresh_cached:
			cached = _parse_problem_modal_data(content, yaml_path, local_repo_root)
			_MODAL_DATA_BY_SHA[sha] = cached
		modal_cache[yaml_path] = cached

	classes = []
	for cls in classes_qs:
		units = []
		for unit in cls.units.all():
			problems = []
			for problem in unit.problems.all():
				modal_data = modal_cache.get(problem.yaml_path, {"description": "", "example": "", "figure_path": ""})
				figure_path = str(modal_data.get("figure_path", "")).strip()
				figure_url = ""
				if figure_path and _figure_exists(local_repo_root, figure_path):
					figure_url = _build_local_figure_url(figure_path)
				problems.append(
					{
						"id": problem.id,
						"code": problem.code,
						"title": problem.title,
						"question_count": problem.question_count,
						"yaml_path": problem.yaml_path,
						"description": modal_data["description"],
						"example": modal_data["example"],
						"figure_url": figure_url,
					}
				)

			units.append(
				{
					"id": unit.id,
					"name": unit.name,
					"sort_order": unit.sort_order,
					"problems": problems,
				}
			)

		classes.append(
			{
				"id": cls.id,
				"name": cls.name,
				"sort_order": cls.sort_order,
				"units": units,
			}
		)

	payload = {"classes": classes}
	_CATALOG_CACHE_KEY = catalog_cache_key
	_CATALOG_CACHE_DATA = payload

	return JsonResponse(payload)


@require_GET
def problem_questions_api(request):
	yaml_path = str(request.GET.get("yaml_path", "")).strip()
	if not yaml_path:
		return JsonResponse({"message": "yaml_path is required."}, status=400)

	state = SyncState.objects.first()
	owner = state.repo_owner if state else "Zhongzhou"
	repo = state.repo_name if state else "ESTELA-physics-problem-bank"
	branch = state.default_branch if state and state.default_branch else "main"
	local_repo_root = Path(settings.BASE_DIR) / ".cache" / "problem-bank" / f"{owner}_{repo}"

	repo_file = RepositoryFile.objects.filter(path=yaml_path).values("content").first()
	if not repo_file:
		return JsonResponse({"message": "Problem file not found."}, status=404)

	questions = _parse_problem_question_data(repo_file["content"], yaml_path, local_repo_root, owner, repo, branch)
	metadata = _extract_problem_metadata(repo_file["content"])
	return JsonResponse({"yaml_path": yaml_path, "questions": questions, "metadata": metadata})


@require_GET
def problem_figure_api(request):
	figure_path = str(request.GET.get("path", "")).strip().replace("\\", "/")
	if not figure_path:
		raise Http404("Figure path is required.")

	sync_state = SyncState.objects.first()
	owner = sync_state.repo_owner if sync_state else "Zhongzhou"
	repo = sync_state.repo_name if sync_state else "ESTELA-physics-problem-bank"
	local_repo_root = Path(settings.BASE_DIR) / ".cache" / "problem-bank" / f"{owner}_{repo}"

	# Prevent path traversal: only allow files inside the cached repository root.
	target_path = (local_repo_root / Path(*figure_path.split("/"))).resolve()
	try:
		target_path.relative_to(local_repo_root.resolve())
	except ValueError as exc:
		raise Http404("Invalid figure path.") from exc

	if target_path.is_file():
		return FileResponse(open(target_path, "rb"))

	data, filename = _read_figure_bytes_from_cache(local_repo_root, figure_path)
	if data is None:
		raise Http404("Figure not found.")

	content_type = mimetypes.guess_type(filename or figure_path)[0] or "application/octet-stream"
	return FileResponse(BytesIO(data), content_type=content_type)


@require_GET
def sync_status_api(request):
	state = SyncState.objects.first()
	if not state:
		return JsonResponse({"status": "never", "message": "No sync has run yet."})

	return JsonResponse(
		{
			"status": state.last_status,
			"message": state.last_message,
			"last_synced_at": state.last_synced_at,
			"last_checked_at": state.last_checked_at,
			"repo_owner": state.repo_owner,
			"repo_name": state.repo_name,
			"branch": state.default_branch,
		}
	)


@require_http_methods(["POST"])
def trigger_sync_api(request):
	result = GitHubProblemBankSyncService().sync()
	return JsonResponse(
		{
			"queued": False,
			"mode": "sync-manual",
			"status": result.status,
			"message": result.message,
		}
	)


@require_http_methods(["POST"])
def generate_exams_api(request):
	try:
		payload = json.loads(request.body.decode("utf-8"))
	except Exception:
		return JsonResponse({"message": "Invalid JSON payload."}, status=400)

	selections = payload.get("selections", [])
	exam_count = payload.get("exam_count", 1)

	try:
		exam_count = int(exam_count)
	except (TypeError, ValueError):
		return JsonResponse({"message": "exam_count must be an integer."}, status=400)

	if not isinstance(selections, list) or not selections:
		return JsonResponse({"message": "No problem selections were provided."}, status=400)

	yaml_paths = []
	for selection in selections:
		yaml_path = str(selection.get("yaml_path", "")).strip()
		if yaml_path:
			yaml_paths.append(yaml_path)

	if not yaml_paths:
		return JsonResponse({"message": "Selections are missing yaml_path values."}, status=400)

	problem_rows = set(Problem.objects.filter(yaml_path__in=yaml_paths).values_list("yaml_path", flat=True))
	invalid_paths = [path for path in yaml_paths if path not in problem_rows]
	if invalid_paths:
		return JsonResponse({"message": f"Unknown problems selected: {invalid_paths[0]}"}, status=400)

	state = SyncState.objects.first()
	owner = state.repo_owner if state else "Zhongzhou"
	repo = state.repo_name if state else "ESTELA-physics-problem-bank"
	local_repo_root = Path(settings.BASE_DIR) / ".cache" / "problem-bank" / f"{owner}_{repo}"

	if not local_repo_root.exists():
		return JsonResponse({"message": "Problem bank cache is missing. Run a sync first."}, status=400)

	with tempfile.TemporaryDirectory(prefix="exam-gen-") as tmp_dir:
		zip_path = Path(tmp_dir) / "generated_exams.zip"
		try:
			build_exam_zip(local_repo_root, selections, exam_count, zip_path)
		except ExamBuildError as exc:
			return JsonResponse({"message": str(exc)}, status=400)
		except Exception as exc:
			return JsonResponse({"message": f"Failed to generate exams: {exc}"}, status=500)

		zip_bytes = zip_path.read_bytes()

	response = HttpResponse(zip_bytes, content_type="application/zip")
	response["Content-Disposition"] = 'attachment; filename="generated_exams.zip"'
	return response


@require_http_methods(["POST"])
def preview_exam_api(request):
	try:
		payload = json.loads(request.body.decode("utf-8"))
	except Exception:
		return JsonResponse({"message": "Invalid JSON payload."}, status=400)

	selections = payload.get("selections", [])
	if not isinstance(selections, list) or not selections:
		return JsonResponse({"message": "No problem selections were provided."}, status=400)

	yaml_paths = []
	for selection in selections:
		yaml_path = str(selection.get("yaml_path", "")).strip()
		if yaml_path:
			yaml_paths.append(yaml_path)

	if not yaml_paths:
		return JsonResponse({"message": "Selections are missing yaml_path values."}, status=400)

	problem_rows = set(Problem.objects.filter(yaml_path__in=yaml_paths).values_list("yaml_path", flat=True))
	invalid_paths = [path for path in yaml_paths if path not in problem_rows]
	if invalid_paths:
		return JsonResponse({"message": f"Unknown problems selected: {invalid_paths[0]}"}, status=400)

	state = SyncState.objects.first()
	owner = state.repo_owner if state else "Zhongzhou"
	repo = state.repo_name if state else "ESTELA-physics-problem-bank"
	local_repo_root = Path(settings.BASE_DIR) / ".cache" / "problem-bank" / f"{owner}_{repo}"

	if not local_repo_root.exists():
		return JsonResponse({"message": "Problem bank cache is missing. Run a sync first."}, status=400)

	with tempfile.TemporaryDirectory(prefix="exam-preview-") as tmp_dir:
		pdf_path = Path(tmp_dir) / "preview_exam.pdf"
		try:
			build_exam_preview_pdf(local_repo_root, selections, pdf_path)
		except ExamBuildError as exc:
			return JsonResponse({"message": str(exc)}, status=400)
		except Exception as exc:
			return JsonResponse({"message": f"Failed to generate preview: {exc}"}, status=500)

		pdf_bytes = pdf_path.read_bytes()

	response = HttpResponse(pdf_bytes, content_type="application/pdf")
	response["Content-Disposition"] = 'inline; filename="preview_exam.pdf"'
	return response
