from django.contrib import admin

from .models import PhysicsClass, Problem, RepositoryFile, SyncState, Unit


@admin.register(SyncState)
class SyncStateAdmin(admin.ModelAdmin):
	list_display = ("repo_owner", "repo_name", "default_branch", "last_status", "last_synced_at")


@admin.register(RepositoryFile)
class RepositoryFileAdmin(admin.ModelAdmin):
	list_display = ("path", "sha", "size", "is_text", "synced_at")
	search_fields = ("path", "sha")


@admin.register(PhysicsClass)
class PhysicsClassAdmin(admin.ModelAdmin):
	list_display = ("name", "repo_path", "sort_order")
	prepopulated_fields = {"slug": ("name",)}


@admin.register(Unit)
class UnitAdmin(admin.ModelAdmin):
	list_display = ("name", "physics_class", "sort_order", "repo_path")
	search_fields = ("name", "repo_path")
	list_filter = ("physics_class",)


@admin.register(Problem)
class ProblemAdmin(admin.ModelAdmin):
	list_display = ("code", "title", "unit", "question_count", "yaml_path")
	search_fields = ("code", "title", "yaml_path")
	list_filter = ("unit__physics_class",)
