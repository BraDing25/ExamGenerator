import hashlib
import json
import posixpath
import re
import subprocess
from dataclasses import dataclass
from pathlib import Path

import yaml
from django.conf import settings
from django.db import transaction
from django.utils import timezone
from django.utils.text import slugify

from BankApp.models import PhysicsClass, Problem, RepositoryFile, SyncState, Unit
from BankApp.utils.exam_generation import string_to_latex

UNIT_DIR_PATTERN = re.compile(r"^(\d+)_")
YAML_EXTENSIONS = (".yml", ".yaml")
TEXT_EXTENSIONS = (
    ".csv", ".md", ".txt", ".yaml", ".yml", ".json", ".py", ".js", ".css", ".html", ".xml", ".tex",
)
EXCLUDED_PATH_TOKEN_PATTERN = re.compile(r"(^|[-_\s])(old|archive|draft|prompt|prompts|oldfiles|old_files)($|[-_\s])", re.IGNORECASE)
QUESTION_ENTRY_PATTERN = re.compile(r"^\s*-\s*[A-Za-z_][\w-]*\s*:\s*$", re.MULTILINE)


@dataclass
class SyncResult:
    status: str
    message: str
    files_total: int = 0
    files_updated: int = 0


class GitHubProblemBankSyncService:
    def __init__(self, owner=None, repo=None):
        state = SyncState.objects.first()
        self.owner = owner or (state.repo_owner if state else "Zhongzhou")
        self.repo = repo or (state.repo_name if state else "ESTELA-physics-problem-bank")
        self.repo_url = f"https://github.com/{self.owner}/{self.repo}.git"
        self.cache_root = Path(settings.BASE_DIR) / ".cache" / "problem-bank"
        self.local_repo = self.cache_root / f"{self.owner}_{self.repo}"
        self.modal_cache_file = self.cache_root / f"{self.owner}_{self.repo}_modal_cache.json"

    def _get_state(self):
        state = SyncState.objects.first()
        if state:
            return state
        return SyncState.objects.create(repo_owner=self.owner, repo_name=self.repo)

    def _run_git(self, args, cwd=None):
        result = subprocess.run(
            ["git", *args],
            cwd=cwd,
            text=True,
            capture_output=True,
            check=False,
        )
        if result.returncode != 0:
            raise RuntimeError(result.stderr.strip() or "git command failed")
        return result.stdout.strip()

    def _get_default_branch(self):
        output = self._run_git(["ls-remote", "--symref", self.repo_url, "HEAD"])
        for line in output.splitlines():
            if line.startswith("ref:") and "HEAD" in line:
                ref = line.split()[1]
                if ref.startswith("refs/heads/"):
                    return ref.replace("refs/heads/", "", 1)
        return "main"

    def _ensure_local_repo(self, branch):
        self.cache_root.mkdir(parents=True, exist_ok=True)
        if not self.local_repo.exists():
            self._run_git(["clone", "--depth", "1", "--branch", branch, self.repo_url, str(self.local_repo)])
            return

        self._run_git(["fetch", "--depth", "1", "origin", branch], cwd=self.local_repo)
        self._run_git(["checkout", branch], cwd=self.local_repo)
        self._run_git(["reset", "--hard", f"origin/{branch}"], cwd=self.local_repo)

    def _current_head(self):
        return self._run_git(["rev-parse", "HEAD"], cwd=self.local_repo)

    def _is_text_file(self, path):
        lowered = path.lower()
        return lowered.endswith(TEXT_EXTENSIONS)

    def _is_yaml_file(self, path):
        lowered = path.lower()
        return lowered.endswith(YAML_EXTENSIONS)

    def _load_yaml_dict(self, content):
        if not content:
            return None
        try:
            parsed = yaml.safe_load(content) or {}
        except yaml.YAMLError:
            return self._fallback_yaml_metadata(content)
        if not isinstance(parsed, dict):
            return self._fallback_yaml_metadata(content)
        return parsed

    def _fallback_yaml_metadata(self, content):
        if not content:
            return None

        title_match = re.search(r"^\s*title\s*:\s*(.+?)\s*$", content, flags=re.MULTILINE)
        bank_id_match = re.search(r"^\s*bank_id\s*:\s*(.+?)\s*$", content, flags=re.MULTILINE)
        if not title_match or not bank_id_match:
            return None

        title = title_match.group(1).split("#", 1)[0].strip(" '\"\t")
        bank_id = bank_id_match.group(1).split("#", 1)[0].strip(" '\"\t")
        if not title or not bank_id:
            return None

        questions_anchor = re.search(r"^\s*questions\s*:\s*$", content, flags=re.MULTILINE)
        if not questions_anchor:
            return None

        questions_tail = content[questions_anchor.end():]
        question_count = len(QUESTION_ENTRY_PATTERN.findall(questions_tail))
        if question_count <= 0:
            return None

        return {
            "bank_info": {
                "title": title,
                "bank_id": bank_id,
            },
            "questions": [{} for _ in range(question_count)],
        }

    def _is_excluded_path(self, path):
        parts = path.split("/")
        for part in parts:
            if EXCLUDED_PATH_TOKEN_PATTERN.search(part):
                return True
        return False

    def _is_completed_problem_yaml(self, path, parsed_yaml):
        if self._is_excluded_path(path):
            return False
        if not isinstance(parsed_yaml, dict):
            return False

        bank_info = parsed_yaml.get("bank_info")
        questions = parsed_yaml.get("questions")
        if not isinstance(bank_info, dict) or not isinstance(questions, list) or not questions:
            return False

        title = bank_info.get("title")
        bank_id = bank_info.get("bank_id")
        if not isinstance(title, str) or not title.strip():
            return False
        if not isinstance(bank_id, str) or not bank_id.strip():
            return False

        path_parts = path.split("/")
        # Only accept the canonical depth: <class>/<unit>/<problem_folder>/<problem_file>.yaml
        # This prevents syncing backup/history YAMLs inside nested subfolders.
        if len(path_parts) != 4:
            return False

        return True

    def _iter_question_payloads(self, parsed_yaml):
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

    def _resolve_figure_path(self, yaml_path, figure_ref):
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
        deduped = []
        for candidate in candidates:
            if candidate in seen:
                continue
            seen.add(candidate)
            deduped.append(candidate)

        for candidate in deduped:
            candidate_file = self.local_repo.joinpath(*candidate.split("/"))
            if candidate_file.is_file():
                return candidate

        return deduped[0] if deduped else ""

    def _build_modal_payload(self, parsed_yaml, yaml_path):
        payload = {"description": "", "example": "", "figure_path": ""}
        if not isinstance(parsed_yaml, dict):
            return payload

        bank_info = parsed_yaml.get("bank_info", {})
        if isinstance(bank_info, dict):
            description_value = bank_info.get("description", "")
            payload["description"] = str(description_value).strip() if description_value is not None else ""

        question_payloads = self._iter_question_payloads(parsed_yaml)
        for question_payload in question_payloads:
            if payload["example"] == "":
                example_source = str(question_payload.get("text") or question_payload.get("title") or "").strip()
                if example_source:
                    payload["example"] = string_to_latex(example_source)

            if payload["figure_path"] == "":
                figure_ref = question_payload.get("figure")
                if isinstance(figure_ref, str) and figure_ref.strip():
                    payload["figure_path"] = self._resolve_figure_path(yaml_path, figure_ref)

            if payload["example"] and payload["figure_path"]:
                break

        return payload

    def _save_modal_cache(self, modal_by_sha):
        self.cache_root.mkdir(parents=True, exist_ok=True)
        self.modal_cache_file.write_text(json.dumps(modal_by_sha), encoding="utf-8")

    def _build_modal_cache_from_db(self):
        modal_by_sha = {}
        for path, content, sha in RepositoryFile.objects.values_list("path", "content", "sha"):
            lower = str(path).lower()
            if not lower.endswith(YAML_EXTENSIONS):
                continue

            parsed_yaml = self._load_yaml_dict(content)
            if not self._is_completed_problem_yaml(path, parsed_yaml):
                continue

            modal_by_sha[sha] = self._build_modal_payload(parsed_yaml, path)

        return modal_by_sha

    def _ensure_modal_cache_file(self):
        if self.modal_cache_file.is_file():
            return
        modal_by_sha = self._build_modal_cache_from_db()
        self._save_modal_cache(modal_by_sha)

    def _extract_catalog(self, file_entries):
        classes = {}
        modal_by_sha = {}
        seen_bank_ids = set()
        seen_yaml_paths = set()
        for file_entry in file_entries:
            path = file_entry["path"]
            lower = path.lower()
            if not lower.endswith(YAML_EXTENSIONS):
                continue

            parsed_yaml = self._load_yaml_dict(file_entry.get("content", ""))
            if not self._is_completed_problem_yaml(path, parsed_yaml):
                continue

            parts = path.split("/")
            if len(parts) < 3:
                continue

            class_name = parts[0]
            unit_idx = None
            for idx, segment in enumerate(parts):
                if UNIT_DIR_PATTERN.match(segment):
                    unit_idx = idx
                    break
            if unit_idx is None or unit_idx + 1 >= len(parts):
                continue

            unit_segment = parts[unit_idx]
            bank_info = parsed_yaml.get("bank_info", {})
            bank_id = str(bank_info.get("bank_id", "")).strip()
            if bank_id and bank_id in seen_bank_ids:
                continue
            if path in seen_yaml_paths:
                continue

            seen_yaml_paths.add(path)
            if bank_id:
                seen_bank_ids.add(bank_id)

            modal_by_sha[file_entry["sha"]] = self._build_modal_payload(parsed_yaml, path)

            if class_name not in classes:
                classes[class_name] = {"units": {}, "name": class_name}

            unit_bucket = classes[class_name]["units"].setdefault(unit_segment, [])
            unit_bucket.append(
                {
                    "path": path,
                    "sha": file_entry["sha"],
                    "problem_title": str(bank_info.get("title", "")).strip(),
                    "question_count": len(parsed_yaml.get("questions", [])),
                }
            )

        return classes, modal_by_sha

    def _count_questions(self, content):
        if not content:
            return 1
        try:
            parsed = yaml.safe_load(content) or {}
        except yaml.YAMLError:
            return 1
        if isinstance(parsed, list):
            return len(parsed) if parsed else 1
        if not isinstance(parsed, dict):
            return 1
        questions = parsed.get("questions", [])
        if isinstance(questions, list) and questions:
            return len(questions)
        return 1

    def _extract_problem_title(self, content, fallback_title):
        if not content:
            return fallback_title
        try:
            parsed = yaml.safe_load(content) or {}
        except yaml.YAMLError:
            return fallback_title
        if not isinstance(parsed, dict):
            return fallback_title
        bank_info = parsed.get("bank_info", {})
        if not isinstance(bank_info, dict):
            return fallback_title
        title = bank_info.get("title")
        if isinstance(title, str) and title.strip():
            return title.strip()
        return fallback_title

    @transaction.atomic
    def _persist_catalog(self, classes):
        Problem.objects.all().delete()
        Unit.objects.all().delete()
        PhysicsClass.objects.all().delete()

        class_order = 0
        for class_name in sorted(classes.keys()):
            class_obj = PhysicsClass.objects.create(
                name=class_name,
                slug=slugify(class_name)[:255],
                repo_path=class_name,
                sort_order=class_order,
            )
            class_order += 1

            unit_items = classes[class_name]["units"]
            for unit_segment in sorted(unit_items.keys(), key=self._unit_sort_key):
                number_match = UNIT_DIR_PATTERN.match(unit_segment)
                unit_sort = int(number_match.group(1)) if number_match else 9999
                unit_name = unit_segment.split("_", 1)[1] if "_" in unit_segment else unit_segment
                unit_obj = Unit.objects.create(
                    physics_class=class_obj,
                    name=unit_name,
                    slug=slugify(unit_segment)[:255],
                    repo_path=f"{class_name}/{unit_segment}",
                    sort_order=unit_sort,
                )

                for blob in sorted(unit_items[unit_segment], key=lambda x: x["path"]):
                    yaml_path = blob["path"]
                    path_parts = yaml_path.split("/")
                    problem_folder = path_parts[path_parts.index(unit_segment) + 1]
                    fallback_title = problem_folder.replace("_", " ").replace("-", " ")
                    problem_title = blob.get("problem_title") or fallback_title
                    question_count = blob.get("question_count") or 1
                    Problem.objects.create(
                        unit=unit_obj,
                        code=problem_folder,
                        title=problem_title,
                        folder_path="/".join(path_parts[:-1]),
                        yaml_path=yaml_path,
                        sha=blob["sha"],
                        question_count=max(int(question_count), 1),
                    )

    def _unit_sort_key(self, unit_name):
        match = UNIT_DIR_PATTERN.match(unit_name)
        if not match:
            return 9999, unit_name
        return int(match.group(1)), unit_name

    def _scan_repo_files(self):
        entries = []
        for file_path in self.local_repo.rglob("*"):
            if file_path.is_dir():
                continue
            if ".git" in file_path.parts:
                continue

            rel_path = file_path.relative_to(self.local_repo).as_posix()
            payload = file_path.read_bytes()
            entries.append(
                {
                    "path": rel_path,
                    "sha": hashlib.sha1(payload).hexdigest(),
                    "size": file_path.stat().st_size,
                    "is_text": self._is_text_file(rel_path),
                    "content": payload.decode("utf-8", errors="ignore") if rel_path.lower().endswith(YAML_EXTENSIONS) else "",
                }
            )
        return entries

    def sync(self, force_rebuild=False):
        state = self._get_state()
        state.repo_owner = self.owner
        state.repo_name = self.repo
        state.last_checked_at = timezone.now()
        state.save(update_fields=["repo_owner", "repo_name", "last_checked_at"])

        branch = state.default_branch or self._get_default_branch()
        self._ensure_local_repo(branch)
        latest_head = self._current_head()

        if (not force_rebuild) and state.tree_etag and state.tree_etag == latest_head and RepositoryFile.objects.exists():
            self._ensure_modal_cache_file()
            state.last_status = "unchanged"
            state.last_message = "Repository unchanged; using database cache."
            state.default_branch = branch
            state.save(update_fields=["last_status", "last_message", "default_branch"])
            return SyncResult(status="unchanged", message=state.last_message)

        scanned_files = self._scan_repo_files()

        existing_by_path = {rf.path: rf for rf in RepositoryFile.objects.all()}
        seen_paths = set()
        updated_count = 0

        for file_data in scanned_files:
            path = file_data["path"]
            sha = file_data["sha"]
            size = file_data["size"]
            seen_paths.add(path)

            existing = existing_by_path.get(path)
            if existing and existing.sha == sha:
                continue

            RepositoryFile.objects.update_or_create(
                path=path,
                defaults={
                    "sha": sha,
                    "size": size,
                    "is_text": file_data["is_text"],
                    "content": file_data["content"],
                },
            )
            updated_count += 1

        RepositoryFile.objects.exclude(path__in=seen_paths).delete()

        parsed_catalog, modal_by_sha = self._extract_catalog(scanned_files)
        self._persist_catalog(parsed_catalog)
        self._save_modal_cache(modal_by_sha)

        state.default_branch = branch
        state.tree_etag = latest_head
        state.last_synced_at = timezone.now()
        state.last_status = "synced"
        state.last_message = f"Synced {len(scanned_files)} files. Updated {updated_count} file(s)."
        state.save(
            update_fields=[
                "default_branch",
                "tree_etag",
                "last_synced_at",
                "last_status",
                "last_message",
            ]
        )

        return SyncResult(
            status="synced",
            message=state.last_message,
            files_total=len(scanned_files),
            files_updated=updated_count,
        )
