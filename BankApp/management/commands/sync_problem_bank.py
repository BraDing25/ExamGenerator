from django.core.management.base import BaseCommand

from BankApp.services.github_sync import GitHubProblemBankSyncService


class Command(BaseCommand):
    help = "Sync ESTELA physics problem bank from GitHub into local database"

    def add_arguments(self, parser):
        parser.add_argument(
            "--force",
            action="store_true",
            help="Force a full catalog rebuild even if repository HEAD is unchanged.",
        )

    def handle(self, *args, **options):
        result = GitHubProblemBankSyncService().sync(force_rebuild=options.get("force", False))
        self.stdout.write(self.style.SUCCESS(result.message))
