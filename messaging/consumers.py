import json
from channels.generic.websocket import AsyncWebsocketConsumer
from channels.db import database_sync_to_async
from django.contrib.auth import get_user_model
from django.db.utils import OperationalError, ProgrammingError
from .models import Message, Conversation, TypingIndicator, MessageReadReceipt, HelpDeskContainer, TaskChatMessage, TaskChatReadState
from .utils import IT_MEMBER_USERNAMES, get_it_member_usernames, is_it_member_user, strip_invisible_marks
from notifications.models import Notification
from asgiref.sync import async_to_sync
import asyncio

User = get_user_model()
class ChatConsumer(AsyncWebsocketConsumer):
    """WebSocket consumer for real-time chat communication."""
    
    async def connect(self):
        self.conversation_id = self.scope['url_route']['kwargs']['conversation_id']
        self.conversation_group_name = f'chat_{self.conversation_id}'
        self.user = self.scope['user']
        
        # Check if user is authenticated
        if not self.user.is_authenticated:
            await self.close()
            return
        
        # Check if user is participant in conversation
        is_participant = await self.is_conversation_participant()
        if not is_participant:
            await self.close()
            return
        
        # Join conversation group
        await self.channel_layer.group_add(
            self.conversation_group_name,
            self.channel_name
        )
        
        # Update user status to online
        await self.update_user_status('online')
        
        await self.accept()
    
    async def disconnect(self, close_code):
        # Leave conversation group
        await self.channel_layer.group_discard(
            self.conversation_group_name,
            self.channel_name
        )
        
        # Update user status to offline
        await self.update_user_status('offline')
    
    async def receive(self, text_data):
        """Receive message from WebSocket."""
        try:
            data = json.loads(text_data)
            message_type = data.get('type')
            
            if message_type == 'chat_message':
                await self.handle_chat_message(data)
            elif message_type == 'typing':
                await self.handle_typing(data)
            elif message_type == 'message_read':
                await self.handle_message_read(data)
            elif message_type == 'delete_message':
                await self.handle_delete_message(data)
            elif message_type == 'edit_message':
                await self.handle_edit_message(data)
                
        except Exception as e:
            print(f"Error processing message: {e}")
    
    async def handle_chat_message(self, data):
        """Handle sending a new message."""
        content = data.get('content', '')
        message_type = data.get('message_type', 'text')
        reply_to_id = data.get('reply_to')

        can_send = await self.can_send_message()
        if not can_send:
            await self.send(text_data=json.dumps({
                'type': 'error',
                'error': 'Only IT members can send messages to GTI members group',
            }))
            return
        
        # Create message in database
        message = await self.create_message(content, message_type, reply_to_id)
        
        # Send message to conversation group
        await self.channel_layer.group_send(
            self.conversation_group_name,
            {
                'type': 'chat_message',
                'message': await self.message_to_dict(message),
            }
        )
        
        # Update conversation timestamp
        await self.update_conversation_timestamp()
        
        # Create notifications for other participants
        await self.create_notifications(message)
    
    async def handle_typing(self, data):
        """Handle typing indicator."""
        is_typing = data.get('is_typing', False)
        
        await self.update_typing_indicator(is_typing)
        
        # Broadcast typing status to group
        await self.channel_layer.group_send(
            self.conversation_group_name,
            {
                'type': 'typing_indicator',
                'user_id': self.user.id,
                'username': self.user.username,
                'is_typing': is_typing,
            }
        )
    
    async def handle_message_read(self, data):
        """Handle message read receipt."""
        message_id = data.get('message_id')
        
        await self.create_read_receipt(message_id)
        
        # Update message status to seen
        await self.update_message_status(message_id, 'seen')
        
        # Broadcast read receipt to group
        await self.channel_layer.group_send(
            self.conversation_group_name,
            {
                'type': 'message_read',
                'message_id': message_id,
                'user_id': self.user.id,
                'username': self.user.username,
            }
        )
    
    async def handle_delete_message(self, data):
        """Handle message deletion."""
        message_id = data.get('message_id')
        delete_for_everyone = data.get('delete_for_everyone', False)
        
        if delete_for_everyone:
            await self.delete_message_for_everyone(message_id)
        else:
            await self.delete_message_for_me(message_id)
        
        # Broadcast deletion to group
        await self.channel_layer.group_send(
            self.conversation_group_name,
            {
                'type': 'message_deleted',
                'message_id': message_id,
                'delete_for_everyone': delete_for_everyone,
                'user_id': self.user.id,
            }
        )
    
    async def handle_edit_message(self, data):
        """Handle message editing."""
        message_id = data.get('message_id')
        new_content = data.get('content')
        
        message = await self.edit_message(message_id, new_content)
        
        # Broadcast edit to group
        await self.channel_layer.group_send(
            self.conversation_group_name,
            {
                'type': 'message_edited',
                'message': await self.message_to_dict(message),
            }
        )
    
    async def chat_message(self, event):
        """Send chat message to WebSocket."""
        await self.send(text_data=json.dumps({
            'type': 'chat_message',
            'message': event['message'],
        }))
    
    async def typing_indicator(self, event):
        """Send typing indicator to WebSocket."""
        await self.send(text_data=json.dumps({
            'type': 'typing_indicator',
            'user_id': event['user_id'],
            'username': event['username'],
            'is_typing': event['is_typing'],
        }))
    
    async def message_read(self, event):
        """Send message read receipt to WebSocket."""
        await self.send(text_data=json.dumps({
            'type': 'message_read',
            'message_id': event['message_id'],
            'user_id': event['user_id'],
            'username': event['username'],
        }))
    
    async def message_deleted(self, event):
        """Send message deletion to WebSocket."""
        await self.send(text_data=json.dumps({
            'type': 'message_deleted',
            'message_id': event['message_id'],
            'delete_for_everyone': event['delete_for_everyone'],
            'user_id': event['user_id'],
        }))
    
    async def message_edited(self, event):
        """Send message edit to WebSocket."""
        await self.send(text_data=json.dumps({
            'type': 'message_edited',
            'message': event['message'],
        }))
    
    @database_sync_to_async
    def is_conversation_participant(self):
        """Check if user is a participant in the conversation."""
        try:
            conversation = Conversation.objects.get(id=self.conversation_id)
            return conversation.participants.filter(id=self.user.id).exists()
        except Conversation.DoesNotExist:
            return False

    @database_sync_to_async
    def can_send_message(self):
        """Check group-specific send permissions."""
        try:
            conversation = Conversation.objects.select_related('group').get(id=self.conversation_id)
        except Conversation.DoesNotExist:
            return False

        if conversation.conversation_type == 'group' and conversation.group.name == 'GTI members':
            return is_it_member_user(self.user)

        return True
    
    @database_sync_to_async
    def create_message(self, content, message_type, reply_to_id):
        """Create a new message in the database."""
        conversation = Conversation.objects.get(id=self.conversation_id)
        reply_to = None
        if reply_to_id:
            try:
                reply_to = Message.objects.get(id=reply_to_id)
            except Message.DoesNotExist:
                pass
        
        message = Message.objects.create(
            conversation=conversation,
            sender=self.user,
            message_type=message_type,
            content=content,
            reply_to=reply_to,
            status='sent'
        )
        return message
    
    @database_sync_to_async
    def update_typing_indicator(self, is_typing):
        """Update typing indicator in database."""
        conversation = Conversation.objects.get(id=self.conversation_id)
        indicator, created = TypingIndicator.objects.get_or_create(
            user=self.user,
            conversation=conversation,
            defaults={'is_typing': is_typing}
        )
        if not created:
            indicator.is_typing = is_typing
            indicator.save()
    
    @database_sync_to_async
    def create_read_receipt(self, message_id):
        """Create a read receipt for a message."""
        try:
            message = Message.objects.get(id=message_id)
            MessageReadReceipt.objects.get_or_create(
                message=message,
                user=self.user
            )
        except Message.DoesNotExist:
            pass
    
    @database_sync_to_async
    def update_message_status(self, message_id, status):
        """Update message status."""
        try:
            message = Message.objects.get(id=message_id)
            message.status = status
            message.save()
        except Message.DoesNotExist:
            pass
    
    @database_sync_to_async
    def delete_message_for_me(self, message_id):
        """Delete message for current user only."""
        try:
            message = Message.objects.get(id=message_id)
            message.is_deleted_for_me.add(self.user)
        except Message.DoesNotExist:
            pass
    
    @database_sync_to_async
    def delete_message_for_everyone(self, message_id):
        """Delete message for everyone."""
        try:
            message = Message.objects.get(id=message_id)
            if message.sender == self.user:
                message.is_deleted_for_everyone = True
                message.save()
        except Message.DoesNotExist:
            pass
    
    @database_sync_to_async
    def edit_message(self, message_id, new_content):
        """Edit a message."""
        try:
            message = Message.objects.get(id=message_id)
            if message.sender == self.user:
                message.content = new_content
                message.edited = True
                message.save()
            return message
        except Message.DoesNotExist:
            return None
    
    @database_sync_to_async
    def update_user_status(self, status):
        """Update user online status."""
        self.user.status = status
        self.user.save()
    
    @database_sync_to_async
    def update_conversation_timestamp(self):
        """Update conversation timestamp."""
        try:
            conversation = Conversation.objects.get(id=self.conversation_id)
            conversation.save()
        except Conversation.DoesNotExist:
            pass
    
    @database_sync_to_async
    def create_notifications(self, message):
        """Create notifications for other participants."""
        conversation = Conversation.objects.get(id=self.conversation_id)
        participants = conversation.participants.exclude(id=self.user.id)
        
        for participant in participants:
            notification = Notification.objects.create(
                recipient=participant,
                message=message,
                conversation=conversation,
                notification_type='new_message'
            )
            async_to_sync(self.channel_layer.group_send)(
                f'notifications_{participant.id}',
                {
                    'type': 'notification',
                    'notification': {
                        'id': notification.id,
                        'notification_type': notification.notification_type,
                        'title': notification.title,
                        'body': notification.body,
                        'conversation_id': conversation.id,
                        'message_id': message.id,
                        'created_at': notification.created_at.isoformat(),
                    }
                }
            )
    
    @database_sync_to_async
    def message_to_dict(self, message):
        """Convert message to dictionary for JSON serialization."""
        return {
            'id': message.id,
            'conversation_id': message.conversation.id,
            'sender_id': message.sender.id,
            'sender_username': message.sender.username,
            'sender_full_name': message.sender.get_full_name(),
            'message_type': message.message_type,
            'content': message.content,
            'media_file': message.media_file.url if message.media_file else None,
            'file_name': message.file_name,
            'file_size': message.file_size,
            'reply_to_id': message.reply_to.id if message.reply_to else None,
            'reply_to_content': message.reply_to.content if message.reply_to else None,
            'reply_to_sender': message.reply_to.sender.username if message.reply_to else None,
            'reply_to_sender_id': message.reply_to.sender.id if message.reply_to else None,
            'status': message.status,
            'created_at': message.created_at.isoformat(),
            'edited': message.edited,
            'is_deleted_for_everyone': message.is_deleted_for_everyone,
        }


class TypingConsumer(AsyncWebsocketConsumer):
    """WebSocket consumer for typing indicators across conversations."""
    
    async def connect(self):
        self.user = self.scope['user']
        
        if not self.user.is_authenticated:
            await self.close()
            return
        
        self.user_group_name = f'user_{self.user.id}'
        
        await self.channel_layer.group_add(
            self.user_group_name,
            self.channel_name
        )
        
        await self.accept()
    
    async def disconnect(self, close_code):
        await self.channel_layer.group_discard(
            self.user_group_name,
            self.channel_name
        )
    
    async def receive(self, text_data):
        data = json.loads(text_data)
        # Handle typing updates if needed
        pass


class NotificationConsumer(AsyncWebsocketConsumer):
    """WebSocket consumer for real-time notifications."""
    
    async def connect(self):
        self.user = self.scope['user']
        
        if not self.user.is_authenticated:
            await self.close()
            return
        
        self.notification_group_name = f'notifications_{self.user.id}'
        
        await self.channel_layer.group_add(
            self.notification_group_name,
            self.channel_name
        )
        
        await self.accept()
    
    async def disconnect(self, close_code):
        await self.channel_layer.group_discard(
            self.notification_group_name,
            self.channel_name
        )
    
    async def notification(self, event):
        """Send notification to WebSocket."""
        await self.send(text_data=json.dumps({
            'type': 'notification',
            'notification': event['notification'],
        }))

    async def task_chat_unread(self, event):
        await self.send(text_data=json.dumps({
            'type': 'task_chat_unread',
            'task_id': event.get('task_id'),
            'unread_count': event.get('unread_count', 0),
        }))

    async def helpdesk_work_status(self, event):
        await self.send(text_data=json.dumps({
            'type': 'helpdesk_work_status',
            'status': event.get('status') or {},
        }))

    async def it_membership_list_changed(self, event):
        await self.send(text_data=json.dumps({
            'type': 'it_membership_list_changed',
        }))


class TaskChatConsumer(AsyncWebsocketConsumer):
    """WebSocket consumer for help desk task container chats."""

    async def connect(self):
        self.task_id = self.scope['url_route']['kwargs']['task_id']
        self.task_group_name = f'task_chat_{self.task_id}'
        self.user = self.scope['user']

        if not self.user.is_authenticated:
            await self.close()
            return

        if not await self.can_view_task():
            await self.close()
            return

        await self.channel_layer.group_add(self.task_group_name, self.channel_name)
        await self.accept()

    async def disconnect(self, close_code):
        await self.channel_layer.group_discard(self.task_group_name, self.channel_name)

    async def receive(self, text_data):
        try:
            data = json.loads(text_data)
            if data.get('type') != 'task_chat_message':
                return

            message_text = (data.get('message') or '').strip()
            if not message_text:
                return

            if not await self.can_send_task_message():
                await self.send(text_data=json.dumps({
                    'type': 'error',
                    'error': 'Only the requester and assigned IT member can send messages for this task.',
                }))
                return

            message = await self.create_task_message(message_text)
            await self.channel_layer.group_send(
                self.task_group_name,
                {
                    'type': 'task_chat_message',
                    'message': await self.task_message_to_dict(message),
                }
            )

            # Update unread badges and notifications for requester, assigned IT, and IT help desk members.
            recipient_counts = await self.get_unread_counts_for_recipients(sender_id=self.user.id)
            for user_id, unread_count in recipient_counts.items():
                await self.channel_layer.group_send(
                    f'notifications_{user_id}',
                    {
                        'type': 'task_chat_unread',
                        'task_id': int(self.task_id),
                        'unread_count': unread_count,
                    }
                )
                await self.channel_layer.group_send(
                    f'notifications_{user_id}',
                    {
                        'type': 'notification',
                        'notification': {
                            'id': f'taskchat-{self.task_id}-{message.id}',
                            'notification_type': 'task_chat_message',
                            'title': f'New task chat message',
                            'body': f'Task #{self.task_id} has a new message.',
                            'conversation_id': message.task.conversation_id,
                            'task_id': int(self.task_id),
                            'message_id': message.id,
                            'created_at': message.timestamp.isoformat(),
                        }
                    }
                )
        except Exception as e:
            await self.send(text_data=json.dumps({
                'type': 'error',
                'error': str(e),
            }))

    async def task_chat_message(self, event):
        await self.send(text_data=json.dumps({
            'type': 'task_chat_message',
            'message': event['message'],
        }))

    @database_sync_to_async
    def can_view_task(self):
        try:
            task = HelpDeskContainer.objects.get(container_id=self.task_id)
            return task.conversation.participants.filter(id=self.user.id).exists()
        except HelpDeskContainer.DoesNotExist:
            return False

    @database_sync_to_async
    def can_send_task_message(self):
        try:
            task = HelpDeskContainer.objects.get(container_id=self.task_id)
            return task.requester_id == self.user.id or task.taken_by_id == self.user.id
        except HelpDeskContainer.DoesNotExist:
            return False

    @database_sync_to_async
    def create_task_message(self, message_text):
        task = HelpDeskContainer.objects.get(container_id=self.task_id)
        return TaskChatMessage.objects.create(
            task=task,
            sender=self.user,
            message=message_text,
        )

    @database_sync_to_async
    def get_unread_counts_for_recipients(self, sender_id: int):
        """
        Compute unread counts for task-chat notification recipients.

        Recipients are the requester, assigned IT member, and IT help desk
        members who can see the task. The sender is excluded.
        """
        try:
            task = HelpDeskContainer.objects.get(container_id=self.task_id)
        except HelpDeskContainer.DoesNotExist:
            return {}

        recipient_ids = set()
        if task.requester_id:
            recipient_ids.add(task.requester_id)
        if task.taken_by_id:
            recipient_ids.add(task.taken_by_id)

        it_member_ids = task.conversation.participants.filter(
            username__in=get_it_member_usernames(),
            is_active=True,
        ).values_list('id', flat=True)
        recipient_ids.update(it_member_ids)
        recipient_ids.discard(sender_id)

        result = {}
        for uid in recipient_ids:
            try:
                state = TaskChatReadState.objects.filter(task=task, user_id=uid).only('last_read_at').first()
            except (OperationalError, ProgrammingError):
                state = None

            qs = TaskChatMessage.objects.filter(task=task).exclude(sender_id=uid)
            if state and getattr(state, 'last_read_at', None):
                qs = qs.filter(timestamp__gt=state.last_read_at)
            result[uid] = qs.count()
        return result

    @database_sync_to_async
    def task_message_to_dict(self, message):
        return {
            'id': message.id,
            'task_id': message.task_id,
            'sender_id': message.sender_id,
            'sender_username': message.sender.username,
            'sender_full_name': strip_invisible_marks(message.sender.get_full_name() or message.sender.username),
            'message': message.message,
            'timestamp': message.timestamp.isoformat(),
        }
