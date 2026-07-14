from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand

from messaging.models import ConversationParticipant, Group


User = get_user_model()


class Command(BaseCommand):
    help = 'Remove superusers from chat participants and group admins'

    def handle(self, *args, **options):
        superusers = list(User.objects.filter(is_superuser=True))
        if not superusers:
            self.stdout.write('No superusers found.')
            return

        removed_memberships = ConversationParticipant.objects.filter(user__in=superusers).delete()[0]
        removed_admin_links = 0

        for group in Group.objects.filter(admins__in=superusers).distinct():
            before = group.admins.count()
            group.admins.remove(*superusers)
            removed_admin_links += before - group.admins.count()

        self.stdout.write(
            self.style.SUCCESS(
                f'Removed {removed_memberships} chat memberships and '
                f'{removed_admin_links} group admin links for superusers.'
            )
        )
