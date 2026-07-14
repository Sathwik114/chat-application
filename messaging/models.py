from django.db import models
from django.conf import settings
from django.core.validators import FileExtensionValidator
from django.utils import timezone
import os


def upload_to(instance, filename):
    """Generate upload path for media files."""
    return os.path.join('chat_media', str(instance.conversation.id), filename)


class Conversation(models.Model):
    """Base model for conversations (both individual and group)."""
    
    CONVERSATION_TYPES = [
        ('individual', 'Individual'),
        ('group', 'Group'),
    ]
    
    conversation_type = models.CharField(max_length=20, choices=CONVERSATION_TYPES, default='individual')
    participants = models.ManyToManyField(
        settings.AUTH_USER_MODEL,
        related_name='conversations',
        through='ConversationParticipant'
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    
    class Meta:
        ordering = ['-updated_at']
    
    def __str__(self):
        if self.conversation_type == 'group':
            try:
                return f"Group: {self.group.name}"
            except:
                return f"Group: Unnamed"
        else:
            participants = self.participants.all()
            return f"Chat: {' - '.join([p.username for p in participants])}"
    
    def get_other_participant(self, user):
        """Get the other participant in an individual conversation."""
        if self.conversation_type == 'individual':
            return self.participants.exclude(id=user.id).first()
        return None


class Group(models.Model):
    """Group conversation model."""
    
    conversation = models.OneToOneField(Conversation, on_delete=models.CASCADE, related_name='group')
    name = models.CharField(max_length=100)
    description = models.TextField(blank=True)
    group_picture = models.ImageField(upload_to='group_pics/', blank=True, null=True)
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='created_groups')
    admins = models.ManyToManyField(settings.AUTH_USER_MODEL, related_name='admin_groups')
    
    class Meta:
        verbose_name = 'Group'
        verbose_name_plural = 'Groups'
    
    def __str__(self):
        return self.name


class ConversationParticipant(models.Model):
    """Through model for conversation participants with additional fields."""
    
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    conversation = models.ForeignKey(Conversation, on_delete=models.CASCADE)
    joined_at = models.DateTimeField(auto_now_add=True)
    last_read_message = models.ForeignKey('Message', on_delete=models.SET_NULL, null=True, blank=True, related_name='read_by')
    is_muted = models.BooleanField(default=False)
    
    class Meta:
        unique_together = ['user', 'conversation']
        verbose_name = 'Conversation Participant'
        verbose_name_plural = 'Conversation Participants'
    
    def __str__(self):
        return f"{self.user.username} - {self.conversation}"


class Message(models.Model):
    """Message model for all types of messages."""
    
    MESSAGE_TYPES = [
        ('text', 'Text'),
        ('image', 'Image'),
        ('video', 'Video'),
        ('file', 'File'),
        ('audio', 'Audio'),
        ('system', 'System'),
    ]
    
    STATUS_CHOICES = [
        ('sent', 'Sent'),
        ('delivered', 'Delivered'),
        ('seen', 'Seen'),
    ]
    
    conversation = models.ForeignKey(Conversation, on_delete=models.CASCADE, related_name='messages')
    sender = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='sent_messages')
    message_type = models.CharField(max_length=20, choices=MESSAGE_TYPES, default='text')
    content = models.TextField(blank=True)
    media_file = models.FileField(
        upload_to=upload_to,
        blank=True,
        null=True,
        validators=[FileExtensionValidator(allowed_extensions=['jpg', 'jpeg', 'png', 'gif', 'mp4', 'mov', 'avi', 'pdf', 'doc', 'docx', 'xls', 'xlsx', 'txt', 'zip'])]
    )
    file_name = models.CharField(max_length=255, blank=True)
    file_size = models.BigIntegerField(blank=True, null=True)
    file_sha256 = models.CharField(max_length=64, blank=True)
    original_file_size = models.BigIntegerField(blank=True, null=True)
    compressed_file_size = models.BigIntegerField(blank=True, null=True)
    was_compressed = models.BooleanField(default=False)
    reply_to = models.ForeignKey('self', on_delete=models.SET_NULL, null=True, blank=True, related_name='replies')
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='sent')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    is_deleted_for_me = models.ManyToManyField(
        settings.AUTH_USER_MODEL,
        blank=True,
        related_name='deleted_messages'
    )
    is_deleted_for_everyone = models.BooleanField(default=False)
    edited = models.BooleanField(default=False)
    edited_at = models.DateTimeField(null=True, blank=True)
    
    class Meta:
        ordering = ['created_at']
        verbose_name = 'Message'
        verbose_name_plural = 'Messages'
    
    def __str__(self):
        if self.message_type == 'text':
            return f"{self.sender.username}: {self.content[:50]}"
        else:
            return f"{self.sender.username}: [{self.message_type}]"
    
    def save(self, *args, **kwargs):
        if self.media_file:
            self.file_name = os.path.basename(self.media_file.name)
            self.file_size = self.media_file.size
            if not self.compressed_file_size:
                self.compressed_file_size = self.media_file.size
        super().save(*args, **kwargs)


class TypingIndicator(models.Model):
    """Model to track typing status in conversations."""
    
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    conversation = models.ForeignKey(Conversation, on_delete=models.CASCADE)
    is_typing = models.BooleanField(default=False)
    last_updated = models.DateTimeField(auto_now=True)
    
    class Meta:
        unique_together = ['user', 'conversation']
        verbose_name = 'Typing Indicator'
        verbose_name_plural = 'Typing Indicators'
    
    def __str__(self):
        return f"{self.user.username} typing in {self.conversation}"


class MessageReadReceipt(models.Model):
    """Track which users have read which messages."""
    
    message = models.ForeignKey(Message, on_delete=models.CASCADE, related_name='read_receipts')
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    read_at = models.DateTimeField(auto_now_add=True)
    
    class Meta:
        unique_together = ['message', 'user']
        verbose_name = 'Message Read Receipt'
        verbose_name_plural = 'Message Read Receipts'
    
    def __str__(self):
        return f"{self.user.username} read {self.message}"


class HelpDeskRequest(models.Model):
    """Model to track help desk requests and IT member takeovers."""
    
    STATUS_CHOICES = [
        ('pending', 'Pending'),
        ('taken', 'Taken'),
        ('resolved', 'Resolved'),
    ]
    
    conversation = models.ForeignKey(Conversation, on_delete=models.CASCADE, related_name='helpdesk_requests')
    requester = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='helpdesk_requests')
    taken_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, 
        on_delete=models.SET_NULL, 
        null=True, 
        blank=True, 
        related_name='taken_requests'
    )
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='pending')
    request_message = models.TextField()
    taken_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    
    class Meta:
        verbose_name = 'Help Desk Request'
        verbose_name_plural = 'Help Desk Requests'
        ordering = ['-created_at']
    
    def __str__(self):
        return f"Request by {self.requester.username} - {self.status}"
    
    def take_request(self, it_member):
        """Mark request as taken by an IT member."""
        self.taken_by = it_member
        self.status = 'taken'
        self.taken_at = timezone.now()
        self.save()


class HelpDeskContainer(models.Model):
    """Individual help desk request container with unique ID."""
    
    STATUS_CHOICES = [
        ('pending', 'Pending'),
        ('took_over', 'Took Over'),
        ('completed', 'Completed'),
        ('resolved', 'Resolved'),
    ]
    
    container_id = models.AutoField(primary_key=True)
    conversation = models.ForeignKey(Conversation, on_delete=models.CASCADE, related_name='helpdesk_containers')
    requester = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='helpdesk_containers')
    taken_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, 
        on_delete=models.SET_NULL, 
        null=True, 
        blank=True, 
        related_name='taken_containers'
    )
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='pending')
    problem_description = models.TextField()
    fixed_problem = models.TextField(blank=True)
    attached_files = models.FileField(upload_to='helpdesk_files/', blank=True, null=True)
    file_name = models.CharField(max_length=255, blank=True)
    file_sha256 = models.CharField(max_length=64, blank=True)
    original_file_size = models.BigIntegerField(blank=True, null=True)
    compressed_file_size = models.BigIntegerField(blank=True, null=True)
    was_compressed = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)
    taken_at = models.DateTimeField(null=True, blank=True)
    completed_at = models.DateTimeField(null=True, blank=True)
    completed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='completed_containers'
    )
    updated_at = models.DateTimeField(auto_now=True)
    
    class Meta:
        verbose_name = 'Help Desk Container'
        verbose_name_plural = 'Help Desk Containers'
        ordering = ['-created_at']
    
    def __str__(self):
        return f"Task #{self.container_id} - {self.requester.username} - {self.status}"
    
    def take_over(self, it_member):
        """Mark container as taken over by an IT member."""
        if self.status == 'pending':
            self.taken_by = it_member
            self.status = 'took_over'
            self.taken_at = timezone.now()
            self.save()
            return True
        return False


class TaskChatMessage(models.Model):
    """Task-specific chat message for a help desk container."""

    task = models.ForeignKey(HelpDeskContainer, on_delete=models.CASCADE, related_name='chat_messages')
    sender = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='task_chat_messages')
    message = models.TextField()
    timestamp = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['timestamp']
        verbose_name = 'Task Chat Message'
        verbose_name_plural = 'Task Chat Messages'

    def __str__(self):
        return f'Task #{self.task_id} - {self.sender.username}: {self.message[:40]}'


class TaskChatReadState(models.Model):
    """Per-user read state for task container chat (unseen badge support)."""

    task = models.ForeignKey(HelpDeskContainer, on_delete=models.CASCADE, related_name='task_chat_read_states')
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='task_chat_read_states')
    last_read_at = models.DateTimeField(null=True, blank=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        unique_together = ['task', 'user']
        ordering = ['-updated_at']
        verbose_name = 'Task Chat Read State'
        verbose_name_plural = 'Task Chat Read States'

    def __str__(self):
        return f'Task #{self.task_id} - {self.user.username} read_at={self.last_read_at}'


class ITMembershipChangeLog(models.Model):
    """Audit trail for IT maintain users role changes."""

    ACTION_CHOICES = [
        ('normal_to_it', 'Normal user to IT member'),
        ('it_to_normal', 'IT member to normal user'),
    ]

    changed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='it_membership_changes_made'
    )
    target_user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='it_membership_changes_received'
    )
    changed_by_user_pk = models.IntegerField(null=True, blank=True)
    changed_by_username = models.CharField(max_length=150)
    changed_by_full_name = models.CharField(max_length=255, blank=True)
    target_user_pk = models.IntegerField(null=True, blank=True)
    target_username = models.CharField(max_length=150)
    target_full_name = models.CharField(max_length=255, blank=True)
    from_role = models.CharField(max_length=50)
    to_role = models.CharField(max_length=50)
    action = models.CharField(max_length=30, choices=ACTION_CHOICES)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']
        verbose_name = 'IT Membership Change Log'
        verbose_name_plural = 'IT Membership Change Logs'

    def __str__(self):
        return f'{self.target_username}: {self.from_role} -> {self.to_role}'
