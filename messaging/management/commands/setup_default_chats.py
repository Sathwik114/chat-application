from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand

from messaging.models import Conversation, Group, ConversationParticipant


User = get_user_model()

IT_MEMBERS = {
    's20330': {
        'display_name': 'Sathya Sathwik Pushpagiri',
        'first_name': 'Sathya',
        'last_name': 'Sathwik',
        'password': 'gtiit@s20330',
    },
    '250479': {
        'display_name': 'Rajesh',
        'first_name': 'Rajesh',
        'last_name': '',
        'password': 'gtiit@250479',
    },
    '230022': {
        'display_name': 'Shakeer',
        'first_name': 'Shakeer',
        'last_name': '',
        'password': 'gtiit@230022',
    },
    '140287': {
        'display_name': 'Narasimha',
        'first_name': 'Narasimha',
        'last_name': '',
        'password': 'gtiit@140287',
    },
    '111075': {
        'display_name': 'Masthan',
        'first_name': 'Masthan',
        'last_name': '',
        'password': 'gtiit@111075',
    },
}


class Command(BaseCommand):
    help = 'Create the default chat groups and IT member conversations for a fresh database'

    def handle(self, *args, **options):
        self.ensure_it_users()

        it_users = list(User.objects.filter(username__in=IT_MEMBERS.keys()).order_by('username'))
        all_users = list(
            User.objects.filter(is_active=True, is_superuser=False).order_by('username')
        )
        normal_users = [user for user in all_users if user.username not in IT_MEMBERS]

        if not it_users:
            self.stdout.write(self.style.WARNING('No IT users found. Create/login IT users first, then rerun this command.'))
            return

        created_by = it_users[0]

        gti_group = self.ensure_group(
            name='GTI members',
            description='All GTI members',
            created_by=created_by,
            participants=all_users,
            admins=it_users,
        )
        self.stdout.write(f'GTI members participants: {gti_group.conversation.participants.count()}')

        helpdesk_group = self.ensure_group(
            name='IT help desk',
            description='IT Help Desk requests',
            created_by=created_by,
            participants=all_users,
            admins=it_users,
        )
        self.stdout.write(f'IT help desk participants: {helpdesk_group.conversation.participants.count()}')

        it_personal_group = self.ensure_group(
            name='IT personal',
            description='IT members personal chat',
            created_by=created_by,
            participants=it_users,
            admins=it_users,
        )
        self.stdout.write(f'IT personal participants: {it_personal_group.conversation.participants.count()}')

        for it_user in it_users:
            display_name = IT_MEMBERS.get(it_user.username, {}).get('display_name') or it_user.get_full_name() or it_user.username
            participants = all_users
            personal_group = self.ensure_group(
                name=display_name,
                description=f'Personal chat for {display_name}',
                created_by=it_user,
                participants=participants,
                admins=[it_user],
            )
            self.stdout.write(f'{display_name} group participants: {personal_group.conversation.participants.count()}')

        individual_count = 0
        for normal_user in normal_users:
            for it_user in it_users:
                if self.ensure_individual_chat(normal_user, it_user):
                    individual_count += 1

        it_individual_count = 0
        for index, first_it_user in enumerate(it_users):
            for second_it_user in it_users[index + 1:]:
                if self.ensure_individual_chat(first_it_user, second_it_user):
                    it_individual_count += 1

        self.stdout.write(f'Created {individual_count} new individual chats')
        self.stdout.write(f'Created {it_individual_count} new IT member individual chats')
        self.remove_superusers_from_chats()
        self.stdout.write(self.style.SUCCESS('Default chat setup completed.'))

    def ensure_it_users(self):
        for username, data in IT_MEMBERS.items():
            user, created = User.objects.get_or_create(
                username=username,
                defaults={
                    'first_name': data['first_name'],
                    'last_name': data['last_name'],
                    'email': f'{username}@gti.nws.cn',
                    'is_staff': False,
                    'is_active': True,
                },
            )

            if created:
                user.set_password(data['password'])
                user.save()
                self.stdout.write(f'Created IT user: {username}')

    def ensure_group(self, name, description, created_by, participants, admins):
        group = Group.objects.filter(name__iexact=name).first()

        if group is None:
            conversation = Conversation.objects.create(conversation_type='group')
            group = Group.objects.create(
                conversation=conversation,
                name=name,
                description=description,
                created_by=created_by,
            )
            self.stdout.write(f'Created group: {name}')
        else:
            conversation = group.conversation

        for user in participants:
            ConversationParticipant.objects.get_or_create(
                conversation=conversation,
                user=user,
            )

        for admin in admins:
            group.admins.add(admin)

        return group

    def remove_superusers_from_chats(self):
        superusers = User.objects.filter(is_superuser=True)
        removed_count = ConversationParticipant.objects.filter(user__in=superusers).delete()[0]
        for group in Group.objects.filter(admins__in=superusers).distinct():
            group.admins.remove(*superusers)
        self.stdout.write(f'Removed {removed_count} superuser chat memberships')

    def ensure_individual_chat(self, first_user, second_user):
        existing_chat = Conversation.objects.filter(
            conversation_type='individual',
            participants=first_user,
        ).filter(
            participants=second_user,
        ).first()

        if existing_chat:
            return False

        chat = Conversation.objects.create(conversation_type='individual')
        ConversationParticipant.objects.get_or_create(conversation=chat, user=first_user)
        ConversationParticipant.objects.get_or_create(conversation=chat, user=second_user)
        return True
