import posixpath
import json
import tempfile
from pathlib import Path
from urllib.parse import quote

import yaml
from django.conf import settings
from django.http import HttpResponse, JsonResponse
from django.shortcuts import render
from django.views.decorators.csrf import ensure_csrf_cookie
from django.views.decorators.http import require_http_methods
from django.views.decorators.http import require_GET

from .models import PhysicsClass, Problem, RepositoryFile, SyncState
from .services.github_sync import GitHubProblemBankSyncService
from .utils.exam_builder import ExamBuildError, build_exam_preview_pdf, build_exam_zip
from .utils.exam_generation import string_to_latex


_MODAL_DATA_BY_SHA = {}
_MODAL_CACHE_KEY = None


def _extract_first_question_payload(parsed_yaml):
	questions = parsed_yaml.get("questions", []) if isinstance(parsed_yaml, dict) else []
	if not isinstance(questions, list) or not questions:
		return {}
	first_question = questions[0]
	if not isinstance(first_question, dict):
		return {}
	if len(first_question) == 1:
		first_value = next(iter(first_question.values()))
		if isinstance(first_value, dict):
			return first_value
	return first_question


def _parse_problem_modal_data(yaml_content, yaml_path):
	default_payload = {"description": "", "example": "", "figure_path": ""}
	if not yaml_content:
		return default_payload

	try:
		parsed = yaml.safe_load(yaml_content) or {}
	except yaml.YAMLError:
		return default_payload

	if not isinstance(parsed, dict):
		return default_payload

	bank_info = parsed.get("bank_info", {})
	description = ""
	if isinstance(bank_info, dict):
		description_value = bank_info.get("description", "")
		description = str(description_value).strip() if description_value is not None else ""

	first_payload = _extract_first_question_payload(parsed)
	example = ""
	if isinstance(first_payload, dict):
		example_source = str(first_payload.get("text") or first_payload.get("title") or "").strip()
		example = string_to_latex(example_source)

	figure_path = ""
	if isinstance(first_payload, dict):
		figure_ref = first_payload.get("figure")
		if isinstance(figure_ref, str) and figure_ref.strip():
			normalized = figure_ref.strip().replace("\\", "/")
			base_dir = posixpath.dirname(yaml_path)
			figure_path = posixpath.normpath(posixpath.join(base_dir, normalized))

	return {"description": description, "example": example, "figure_path": figure_path}


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
	return render(request, "GeneratorApp/index.html")


def problems_view(request):
	return render(request, "GeneratorApp/problems.html")


@ensure_csrf_cookie
def generator_view(request):
	return render(request, "GeneratorApp/generator.html")


@require_GET
def latex_preview_api(request):
	text = request.GET.get("text", "")
	return JsonResponse({"latex": string_to_latex(text)})


@require_GET
def catalog_api(request):
	state = SyncState.objects.first()
	owner = state.repo_owner if state else "Zhongzhou"
	repo = state.repo_name if state else "ESTELA-physics-problem-bank"
	branch = state.default_branch if state and state.default_branch else "main"
	_load_modal_cache(owner, repo)

	classes_qs = PhysicsClass.objects.prefetch_related("units__problems").all()
	yaml_paths = list(Problem.objects.values_list("yaml_path", flat=True))
	repo_rows = RepositoryFile.objects.filter(path__in=yaml_paths).values_list("path", "content", "sha")
	modal_cache = {}
	for yaml_path, content, sha in repo_rows:
		cached = _MODAL_DATA_BY_SHA.get(sha)
		if cached is None:
			cached = _parse_problem_modal_data(content, yaml_path)
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
				if figure_path:
					encoded = quote(figure_path, safe="/")
					figure_url = f"https://raw.githubusercontent.com/{owner}/{repo}/{branch}/{encoded}"
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

	return JsonResponse({"classes": classes})


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
