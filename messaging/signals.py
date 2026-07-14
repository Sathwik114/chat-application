"""
Signals for automatic user addition to IT help desk group
"""

from django.db.models.signals import post_save
from django.dispatch import receiver
from django.contrib.auth import get_user_model

User = get_user_model()

IT_MEMBER_USERNAMES = ['s20330', '250479', '230022', '140287', '111075']
IT_MEMBER_GROUP_NAMES = [
    'Sathya Sathwik Pushpagiri',
    'Rajesh',
    'Shakeer',
    'Narasimha',
    'Masthan',
]


@receiver(post_save, sender=User)
def add_user_to_default_chats(sender, instance, created, **kwargs):
    """Automatically add new users to the default group and IT member chats."""
    if not created:
        return

    from .models import Conversation, ConversationParticipant

    is_it_member = instance.username in IT_MEMBER_USERNAMES
    default_group_names = ['GTI members', 'IT help desk']
    if is_it_member:
        default_group_names.append('IT personal')
    else:
        default_group_names.extend(IT_MEMBER_GROUP_NAMES)

    default_group_conversations = Conversation.objects.filter(
        conversation_type='group',
        group__name__in=default_group_names,
    )

    for conversation in default_group_conversations:
        ConversationParticipant.objects.get_or_create(
            user=instance,
            conversation=conversation,
        )

    if is_it_member:
        chat_partners = User.objects.filter(username__in=IT_MEMBER_USERNAMES).exclude(id=instance.id)
    else:
        chat_partners = User.objects.filter(username__in=IT_MEMBER_USERNAMES)

    for partner in chat_partners:
        if partner.id == instance.id:
            continue

        existing_chat = Conversation.objects.filter(
            conversation_type='individual',
            participants=instance,
        ).filter(
            participants=partner,
        ).first()

        if not existing_chat:
            chat = Conversation.objects.create(conversation_type='individual')
            ConversationParticipant.objects.get_or_create(conversation=chat, user=instance)
            ConversationParticipant.objects.get_or_create(conversation=chat, user=partner)
