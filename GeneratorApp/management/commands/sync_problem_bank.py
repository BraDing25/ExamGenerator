from django.core.management.base import BaseCommand

from GeneratorApp.services.github_sync import GitHubProblemBankSyncService


class Command(BaseCommand):
    help = "Sync ESTELA physics problem bank from GitHub into local database"

    def handle(self, *args, **options):
        result = GitHubProblemBankSyncService().sync()
        self.stdout.write(self.style.SUCCESS(result.message))
