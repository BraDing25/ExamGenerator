from django.db import models


class SyncState(models.Model):
	repo_owner = models.CharField(max_length=200, default="Zhongzhou")
	repo_name = models.CharField(max_length=200, default="ESTELA-physics-problem-bank")
	default_branch = models.CharField(max_length=120, blank=True)
	tree_etag = models.CharField(max_length=255, blank=True)
	last_checked_at = models.DateTimeField(null=True, blank=True)
	last_synced_at = models.DateTimeField(null=True, blank=True)
	last_status = models.CharField(max_length=30, default="never")
	last_message = models.TextField(blank=True)

	class Meta:
		verbose_name = "Sync State"
		verbose_name_plural = "Sync State"


class RepositoryFile(models.Model):
	path = models.CharField(max_length=1000, unique=True)
	sha = models.CharField(max_length=64)
	size = models.PositiveIntegerField(default=0)
	is_text = models.BooleanField(default=True)
	content = models.TextField(blank=True)
	synced_at = models.DateTimeField(auto_now=True)

	class Meta:
		ordering = ["path"]


class PhysicsClass(models.Model):
		name = models.CharField(max_length=255)
		slug = models.SlugField(max_length=255, unique=True)
		repo_path = models.CharField(max_length=600, unique=True)
		sort_order = models.IntegerField(default=0)

		class Meta:
			ordering = ["sort_order", "name"]


class Unit(models.Model):
	physics_class = models.ForeignKey(PhysicsClass, on_delete=models.CASCADE, related_name="units")
	name = models.CharField(max_length=255)
	slug = models.SlugField(max_length=255)
	repo_path = models.CharField(max_length=700, unique=True)
	sort_order = models.IntegerField(default=0)

	class Meta:
		ordering = ["physics_class", "sort_order", "name"]
		constraints = [
			models.UniqueConstraint(fields=["physics_class", "slug"], name="uniq_unit_slug_per_class"),
		]


class Problem(models.Model):
	unit = models.ForeignKey(Unit, on_delete=models.CASCADE, related_name="problems")
	code = models.CharField(max_length=255)
	title = models.CharField(max_length=255)
	folder_path = models.CharField(max_length=900)
	yaml_path = models.CharField(max_length=900, unique=True)
	sha = models.CharField(max_length=64)
	question_count = models.PositiveIntegerField(default=1)

	class Meta:
		ordering = ["unit", "code", "title"]
