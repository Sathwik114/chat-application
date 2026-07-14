from django.shortcuts import render, get_object_or_404
from django.contrib.auth.decorators import login_required
from django.http import JsonResponse, FileResponse, Http404
from django.views.decorators.http import require_http_methods
from django.views.decorators.csrf import csrf_exempt
from django.core.paginator import Paginator
from django.db.models import Q, Count, Max
from django.conf import settings
from django.utils import timezone
from django.db.utils import OperationalError, ProgrammingError
from .models import Message, Conversation, Group, ConversationParticipant, TypingIndicator, MessageReadReceipt, HelpDeskRequest, HelpDeskContainer, TaskChatMessage, TaskChatReadState, ITMembershipChangeLog
from .utils import (
    IT_MEMBER_USERNAMES,
    get_it_member_usernames,
    get_it_maintain_group,
    is_it_member_user as user_has_it_role,
    is_protected_it_member,
    process_uploaded_file,
    strip_invisible_marks,
)
import json
import mimetypes
import logging
from urllib.parse import unquote
from authentication.models import User
from authentication.views import get_employee_data_from_mssql
import json
import os
from channels.layers import get_channel_layer
from asgiref.sync import async_to_sync
from notifications.models import Notification

def is_it_member_user(user):
    return user_has_it_role(user)


def serve_media_file(request, file_path):
    """Serve uploaded media files inline so PDFs and documents open in the browser."""
    if not file_path:
        raise Http404

    logger = logging.getLogger(__name__)

    # URL paths may be percent-encoded when passed from the frontend (e.g. spaces -> %20).
    # Decode and normalize before joining with MEDIA_ROOT.
    try:
        decoded = unquote(file_path)
    except Exception:
        decoded = file_path

    # Remove any leading slashes to avoid absolute path joins
    decoded = decoded.lstrip('/\\')

    media_root = os.path.realpath(settings.MEDIA_ROOT)
    candidate_path = os.path.realpath(os.path.join(media_root, decoded))

    logger.info('Serving media file request: raw=%s decoded=%s candidate=%s', file_path, decoded, candidate_path)

    if (not candidate_path.startswith(media_root + os.sep) and candidate_path != media_root) or not os.path.isfile(candidate_path):
        logger.warning('Media file not found or outside media root: %s', candidate_path)
        raise Http404

    content_type, _ = mimetypes.guess_type(candidate_path)
    if not content_type:
        content_type = 'application/octet-stream'

    response = FileResponse(open(candidate_path, 'rb'), content_type=content_type)
    response['Content-Disposition'] = f'inline; filename="{os.path.basename(candidate_path)}"'
    response['X-Content-Type-Options'] = 'nosniff'
    response['Cache-Control'] = 'public, max-age=86400'
    return response


def get_helpdesk_report_user_data(user, employee_cache):
    """Build user details for help desk reports."""
    employee_data = employee_cache.get(user.username)
    if employee_data is None:
        employee_data = get_employee_data_from_mssql(user.username) or {}
        employee_cache[user.username] = employee_data

    full_name = strip_invisible_marks(employee_data.get('full_name') or user.get_full_name())
    return {
        'id': user.id,
        'username': user.username,
        'full_name': full_name,
        'display_name': f"{user.username} | {full_name}" if full_name else user.username,
        'department': employee_data.get('department') or user.department or '',
        'section': employee_data.get('section') or getattr(user, 'section', '') or '',
    }


def can_send_task_chat(user, task):
    return task.requester_id == user.id or task.taken_by_id == user.id


def get_task_chat_unread_count(user, task):
    """Unread messages for user in a task chat (excluding user's own messages)."""
    can_receive_task_chat_notifications = (
        can_send_task_chat(user, task) or
        (is_it_member_user(user) and task.conversation.participants.filter(id=user.id).exists())
    )
    if not can_receive_task_chat_notifications:
        return 0
    try:
        state = TaskChatReadState.objects.filter(task=task, user=user).only('last_read_at').first()
        qs = TaskChatMessage.objects.filter(task=task).exclude(sender=user)
        if state and state.last_read_at:
            qs = qs.filter(timestamp__gt=state.last_read_at)
        return qs.count()
    except (OperationalError, ProgrammingError):
        # Migration/table not applied yet - fall back gracefully.
        return 0


def build_helpdesk_work_status():
    """
    Return a compact structure for IT members showing active tasks.
    Active tasks: taken_by set AND status == 'took_over' (not completed/resolved).
    """
    dynamic_usernames = list(
        User.objects.filter(groups__name='IT maintain users').values_list('username', flat=True)
    )
    it_usernames = list(dict.fromkeys(IT_MEMBER_USERNAMES + sorted(dynamic_usernames)))
    members = User.objects.filter(username__in=it_usernames)
    members_by_username = {u.username: u for u in members}

    active = (
        HelpDeskContainer.objects
        .filter(taken_by__username__in=it_usernames, status='took_over')
        .select_related('taken_by')
    )

    tasks_by_username = {u: [] for u in it_usernames}
    for c in active:
        if c.taken_by and c.taken_by.username in tasks_by_username:
            tasks_by_username[c.taken_by.username].append(c.container_id)

    result_members = []
    for username in it_usernames:
        user = members_by_username.get(username)
        full_name = strip_invisible_marks(user.get_full_name()) if user else username
        task_ids = sorted(tasks_by_username.get(username) or [])
        result_members.append({
            'username': username,
            'full_name': full_name,
            'active_tasks': task_ids,
        })

    return {'members': result_members}


def broadcast_helpdesk_work_status(extra_user_ids=None):
    """Push work status to NotificationConsumer for IT members + optional extra user ids."""
    channel_layer = get_channel_layer()
    if not channel_layer:
        return
    status = build_helpdesk_work_status()

    user_ids = set(
        User.objects.filter(username__in=IT_MEMBER_USERNAMES).values_list('id', flat=True)
    )
    user_ids.update(User.objects.filter(groups__name='IT maintain users').values_list('id', flat=True))
    if extra_user_ids:
        for uid in extra_user_ids:
            if uid:
                user_ids.add(uid)

    for uid in user_ids:
        async_to_sync(channel_layer.group_send)(
            f'notifications_{uid}',
            {
                'type': 'helpdesk_work_status',
                'status': status,
            }
        )


def task_chat_message_to_dict(message, user):
    return {
        'id': message.id,
        'task_id': message.task_id,
        'sender_id': message.sender_id,
        'sender_username': message.sender.username,
        'sender_full_name': strip_invisible_marks(message.sender.get_full_name() or message.sender.username),
        'message': message.message,
        'timestamp': message.timestamp.isoformat(),
        'is_self': message.sender_id == user.id,
    }


def push_message_notifications(message):
    """Create and send realtime notifications for REST-created chat messages."""
    channel_layer = get_channel_layer()
    conversation = message.conversation
    recipients = conversation.participants.exclude(id=message.sender_id)

    for recipient in recipients:
        notification = Notification.objects.create(
            recipient=recipient,
            message=message,
            conversation=conversation,
            notification_type='new_message'
        )

        if not channel_layer:
            continue

        async_to_sync(channel_layer.group_send)(
            f'notifications_{recipient.id}',
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


@login_required
def conversations_list(request):
    """Get all conversations for the current user."""
    # IT member usernames
    it_usernames = get_it_member_usernames()
    it_group_names = ['GTI members', 'IT help desk', 'IT personal']
    normal_user_group_names = ['GTI members', 'IT help desk']
    
    # Check if current user is an IT member
    is_it_member = is_it_member_user(request.user)
    
    if is_it_member:
        # IT members see shared IT groups plus their individual chats.
        conversations = Conversation.objects.filter(
            Q(conversation_type='individual') |
            Q(conversation_type='group', group__name__in=it_group_names),
            participants=request.user,
            participants__isnull=False
        ).annotate(
            last_message_time=Max(
                'messages__created_at',
                filter=Q(messages__is_deleted_for_everyone=False) &
                       ~Q(messages__is_deleted_for_me=request.user)
            ),
            unread_count=Count(
                'messages',
                filter=Q(messages__status__in=['sent', 'delivered']) &
                       Q(messages__is_deleted_for_everyone=False) &
                       ~Q(messages__sender=request.user) &
                       ~Q(messages__read_receipts__user=request.user) &
                       ~Q(messages__is_deleted_for_me=request.user)
            )
        ).order_by('-last_message_time')
    else:
        ensure_normal_user_it_chats(request.user)

        # Normal users see the two shared groups plus their individual chats.
        conversations = Conversation.objects.filter(
            participants=request.user,
            participants__isnull=False
        ).filter(
            Q(conversation_type='individual', participants__username__in=it_usernames) |
            Q(conversation_type='group', group__name__in=normal_user_group_names)
        ).distinct().annotate(
            last_message_time=Max(
                'messages__created_at',
                filter=Q(messages__is_deleted_for_everyone=False) &
                       ~Q(messages__is_deleted_for_me=request.user)
            ),
            unread_count=Count(
                'messages',
                filter=Q(messages__status__in=['sent', 'delivered']) &
                       Q(messages__is_deleted_for_everyone=False) &
                       ~Q(messages__sender=request.user) &
                       ~Q(messages__read_receipts__user=request.user) &
                       ~Q(messages__is_deleted_for_me=request.user)
            )
        ).order_by('-last_message_time')
    
    conversations_data = []
    for conv in conversations:
        conv_data = {
            'id': conv.id,
            'conversation_type': conv.conversation_type,
            'updated_at': conv.updated_at.isoformat(),
            'unread_count': conv.unread_count,
        }
        
        if conv.conversation_type == 'group':
            group = conv.group
            conv_data['name'] = group.name
            conv_data['group_picture'] = group.group_picture.url if group.group_picture else None
            conv_data['description'] = group.description
            
            # Check if user can send messages in this group
            it_usernames = IT_MEMBER_USERNAMES
            is_it_member = is_it_member_user(request.user)
            
            # GTI members group - only IT members can send messages
            if group.name == 'GTI members':
                conv_data['can_send_messages'] = is_it_member
            else:
                conv_data['can_send_messages'] = True
        else:
            other_user = conv.get_other_participant(request.user)
            if other_user:
                conv_data['name'] = other_user.get_full_name() or other_user.username
                conv_data['username'] = other_user.username
                conv_data['profile_picture'] = other_user.profile_picture.url if other_user.profile_picture else None
                conv_data['status'] = other_user.status
        
        # Get last message
        last_message = conv.messages.filter(
            is_deleted_for_everyone=False
        ).exclude(
            is_deleted_for_me=request.user
        ).last()
        if last_message:
            conv_data['last_message'] = {
                'content': last_message.content[:50] if last_message.message_type == 'text' else f'[{last_message.message_type}]',
                'sender': last_message.sender.username,
                'sender_id': last_message.sender.id,
                'created_at': last_message.created_at.isoformat(),
                'message_type': last_message.message_type,
            }
        
        conversations_data.append(conv_data)
    
    return JsonResponse({'conversations': conversations_data})


@login_required
def conversation_detail(request, conversation_id):
    """Get conversation details and messages."""
    conversation = get_object_or_404(Conversation, id=conversation_id)
    
    # Check if user is participant
    if not conversation.participants.filter(id=request.user.id).exists():
        return JsonResponse({'error': 'Not authorized'}, status=403)
    
    # Get conversation info
    conv_data = {
        'id': conversation.id,
        'conversation_type': conversation.conversation_type,
        'updated_at': conversation.updated_at.isoformat(),
    }
    
    if conversation.conversation_type == 'group':
        group = conversation.group
        conv_data['name'] = group.name
        conv_data['group_picture'] = group.group_picture.url if group.group_picture else None
        conv_data['description'] = group.description
        conv_data['created_by'] = group.created_by.username
        conv_data['admins'] = [admin.username for admin in group.admins.all()]
        conv_data['can_manage_members'] = (
            group.created_by_id == request.user.id
            or group.admins.filter(id=request.user.id).exists()
        )
        conv_data['participants'] = [
            {
                'id': p.id,
                'username': p.username,
                'full_name': p.get_full_name(),
                'profile_picture': p.profile_picture.url if p.profile_picture else None,
                'status': p.status,
            }
            for p in conversation.participants.all()
        ]
        
        # Add help desk specific information
        if group.name == 'IT help desk':
            it_usernames = IT_MEMBER_USERNAMES
            is_it_member = is_it_member_user(request.user)
            conv_data['is_help_desk'] = True
            conv_data['can_send_messages'] = False  # No one can send regular messages in IT help desk
            conv_data['can_create_request'] = not is_it_member  # Only normal users can create requests
            
            # Get help desk containers
            if is_it_member:
                # IT members see all containers
                containers = HelpDeskContainer.objects.filter(conversation=conversation)
            else:
                # Normal users see only their containers
                containers = HelpDeskContainer.objects.filter(conversation=conversation, requester=request.user)
            
            conv_data['helpdesk_containers'] = [
                {
                    'container_id': container.container_id,
                    'requester': container.requester.username,
                    'problem_description': container.problem_description,
                    'attached_files': container.attached_files.url if container.attached_files else None,
                    'file_name': container.file_name,
                    'status': container.status,
                    'taken_by': container.taken_by.username if container.taken_by else None,
                    'created_at': container.created_at.isoformat(),
                    'taken_at': container.taken_at.isoformat() if container.taken_at else None,
                    'completed_at': container.completed_at.isoformat() if container.completed_at else None,
                    'completed_by': container.completed_by.username if container.completed_by else None,
                }
                for container in containers
            ]
    else:
        other_user = conversation.get_other_participant(request.user)
        if other_user:
            conv_data['name'] = other_user.get_full_name() or other_user.username
            conv_data['username'] = other_user.username
            conv_data['profile_picture'] = other_user.profile_picture.url if other_user.profile_picture else None
            conv_data['status'] = other_user.status
            conv_data['last_seen'] = other_user.last_seen.isoformat()
    
    # Get messages with pagination
    page = int(request.GET.get('page', 1))
    per_page = int(request.GET.get('per_page', 50))
    
    messages = conversation.messages.filter(
        is_deleted_for_everyone=False
    ).exclude(
        is_deleted_for_me=request.user
    ).order_by('created_at')
    
    paginator = Paginator(messages, per_page)
    messages_page = paginator.get_page(page)
    
    messages_data = []
    for msg in messages_page:
        msg_data = {
            'id': msg.id,
            'sender_id': msg.sender.id,
            'sender_username': msg.sender.username,
            'sender_full_name': msg.sender.get_full_name(),
            'message_type': msg.message_type,
            'content': msg.content,
            'media_file': msg.media_file.url if msg.media_file else None,
            'file_name': msg.file_name,
            'file_size': msg.file_size,
            'reply_to_id': msg.reply_to.id if msg.reply_to else None,
            'reply_to_content': msg.reply_to.content if msg.reply_to else None,
            'reply_to_sender': msg.reply_to.sender.username if msg.reply_to else None,
            'reply_to_sender_id': msg.reply_to.sender.id if msg.reply_to else None,
            'status': msg.status,
            'created_at': msg.created_at.isoformat(),
            'edited': msg.edited,
            'edited_at': msg.edited_at.isoformat() if msg.edited_at else None,
            'is_self': msg.sender == request.user,
        }
        messages_data.append(msg_data)
    
    conv_data['messages'] = messages_data
    conv_data['pagination'] = {
        'page': messages_page.number,
        'total_pages': paginator.num_pages,
        'total_count': paginator.count,
    }
    
    return JsonResponse({'conversation': conv_data})


@login_required
def complete_container(request, container_id):
    """Complete a help desk container"""
    try:
        print(f"DEBUG: Completing container {container_id}")
        if not is_it_member_user(request.user):
            return JsonResponse({
                'success': False,
                'error': 'Only IT members can complete tasks'
            }, status=403)

        fixed_problem = ''
        if request.body:
            try:
                data = json.loads(request.body)
                fixed_problem = data.get('fixed_problem', '').strip()
            except json.JSONDecodeError:
                fixed_problem = request.POST.get('fixed_problem', '').strip()
        else:
            fixed_problem = request.POST.get('fixed_problem', '').strip()

        if not fixed_problem:
            return JsonResponse({
                'success': False,
                'error': 'Please enter what was fixed before completing this task'
            }, status=400)

        container = get_object_or_404(HelpDeskContainer, container_id=container_id)
        if container.status == 'pending':
            return JsonResponse({
                'success': False,
                'error': 'Please take over this request before completing it'
            }, status=400)

        if container.taken_by_id != request.user.id:
            return JsonResponse({
                'success': False,
                'error': 'Only the IT member who took over this request can complete it'
            }, status=403)

        if container.status == 'completed':
            return JsonResponse({
                'success': False,
                'error': 'This request is already completed'
            }, status=400)
        
        # Mark as completed
        container.status = 'completed'
        container.fixed_problem = fixed_problem
        container.completed_at = timezone.now()
        container.completed_by = request.user
        container.save()
        
        print(f"DEBUG: Container {container_id} completed by {request.user.username}")

        # Realtime work status update (active tasks list changes)
        try:
            broadcast_helpdesk_work_status(extra_user_ids=[container.requester_id])
        except Exception:
            pass
        
        return JsonResponse({
            'success': True,
            'message': f'Task {container_id} completed successfully'
        })
        
    except Exception as e:
        print(f"DEBUG: Error completing container: {str(e)}")
        return JsonResponse({
            'success': False,
            'error': str(e)
        })


@login_required
def get_conversation_messages(request, conversation_id):
    """Get messages for a specific conversation."""
    try:
        print(f"DEBUG: Getting messages for conversation {conversation_id} by user {request.user.username}")
        conversation = get_object_or_404(Conversation, id=conversation_id)
        
        # Check if user is participant
        if not conversation.participants.filter(id=request.user.id).exists():
            print(f"DEBUG: User {request.user.username} not authorized for conversation {conversation_id}")
            return JsonResponse({'error': 'Not authorized'}, status=403)
        
        print(f"DEBUG: User authorized, getting messages...")
        
        messages = conversation.messages.filter(
            ~Q(is_deleted_for_everyone=True),
            ~Q(is_deleted_for_me=request.user)
        ).order_by('created_at')
        
        print(f"DEBUG: Found {messages.count()} messages")
    
        messages_data = []
        for msg in messages:
            msg_data = {
                'id': msg.id,
                'sender_id': msg.sender.id,
                'sender_username': msg.sender.username,
                'sender_full_name': msg.sender.get_full_name(),
                'message_type': msg.message_type,
                'content': msg.content,
                'media_file': msg.media_file.url if msg.media_file else None,
                'file_name': msg.file_name,
                'file_size': msg.file_size,
                'reply_to_id': msg.reply_to.id if msg.reply_to else None,
                'reply_to_content': msg.reply_to.content if msg.reply_to else None,
                'reply_to_sender': msg.reply_to.sender.username if msg.reply_to else None,
                'reply_to_sender_id': msg.reply_to.sender.id if msg.reply_to else None,
                'status': msg.status,
                'created_at': msg.created_at.isoformat(),
                'edited': msg.edited,
                'edited_at': msg.edited_at.isoformat() if msg.edited_at else None,
                'is_self': msg.sender == request.user,
            }
            messages_data.append(msg_data)
        
        print(f"DEBUG: Returning {len(messages_data)} messages")
        return JsonResponse({'messages': messages_data})
        
    except Exception as e:
        return JsonResponse({'error': str(e)}, status=500)


@login_required
def conversation_messages(request, conversation_id):
    """Get messages for a conversation."""
    conversation = get_object_or_404(Conversation, id=conversation_id)
    
    # Check if user is participant
    if not conversation.participants.filter(id=request.user.id).exists():
        return JsonResponse({'error': 'Not authorized'}, status=403)
    
    messages = conversation.messages.filter(
        ~Q(is_deleted_for_everyone=True),
        ~Q(is_deleted_for_me=request.user)
    ).order_by('created_at')
    
    messages_data = []
    for msg in messages:
        msg_data = {
            'id': msg.id,
            'sender_id': msg.sender.id,
            'sender_username': msg.sender.username,
            'sender_full_name': msg.sender.get_full_name(),
            'message_type': msg.message_type,
            'content': msg.content,
            'media_file': msg.media_file.url if msg.media_file else None,
            'file_name': msg.file_name,
            'file_size': msg.file_size,
            'reply_to_id': msg.reply_to.id if msg.reply_to else None,
            'reply_to_content': msg.reply_to.content if msg.reply_to else None,
            'reply_to_sender': msg.reply_to.sender.username if msg.reply_to else None,
            'reply_to_sender_id': msg.reply_to.sender.id if msg.reply_to else None,
            'status': msg.status,
            'created_at': msg.created_at.isoformat(),
            'edited': msg.edited,
            'edited_at': msg.edited_at.isoformat() if msg.edited_at else None,
        }
        messages_data.append(msg_data)
    
    return JsonResponse({'messages': messages_data})


@login_required
@csrf_exempt
@require_http_methods(["POST"])
def send_message(request):
    """Send a new message."""
    try:
        data = json.loads(request.body)
        conversation_id = data.get('conversation_id')
        content = data.get('content', '')
        message_type = data.get('message_type', 'text')
        reply_to_id = data.get('reply_to')
        
        conversation = get_object_or_404(Conversation, id=conversation_id)
        
        # Check if user is participant
        if not conversation.participants.filter(id=request.user.id).exists():
            return JsonResponse({'error': 'Not authorized'}, status=403)
        
        # IT member usernames
        it_usernames = IT_MEMBER_USERNAMES
        is_it_member = is_it_member_user(request.user)
        
        # Check GTI members group permissions - only IT members can send messages
        try:
            if conversation.group and conversation.group.name == 'GTI members':
                if not is_it_member:
                    return JsonResponse({'error': 'Only IT members can send messages to GTI members group'}, status=403)
        except:
            # Individual conversations don't have groups, so skip permission check
            pass
        
                
        # Create message
        reply_to = None
        if reply_to_id:
            reply_to = Message.objects.get(id=reply_to_id)
            
        message = Message.objects.create(
            conversation=conversation,
            sender=request.user,
            content=content,
            message_type=message_type,
            reply_to=reply_to
        )
        
        # Update conversation timestamp
        conversation.save()
        push_message_notifications(message)
        
        return JsonResponse({
            'success': True,
            'message': {
                'id': message.id,
                'sender_id': message.sender.id,
                'sender_username': message.sender.username,
                'content': message.content,
                'message_type': message.message_type,
                'reply_to_id': message.reply_to.id if message.reply_to else None,
                'reply_to_content': message.reply_to.content if message.reply_to else None,
                'reply_to_sender': message.reply_to.sender.username if message.reply_to else None,
                'reply_to_sender_id': message.reply_to.sender.id if message.reply_to else None,
                'status': message.status,
                'created_at': message.created_at.isoformat(),
                'conversation_id': conversation.id
            }
        })
        
    except Exception as e:
        return JsonResponse({'error': str(e)}, status=500)


@login_required
@csrf_exempt
@require_http_methods(["POST"])
def create_conversation(request):
    """Create a new conversation (group or individual for IT members)."""
    try:
        data = json.loads(request.body)
        conversation_type = data.get('conversation_type', 'group')
        participant_ids = data.get('participant_ids') or data.get('user_ids') or []
        group_name = data.get('group_name', '')
        group_description = data.get('group_description', '')
        
        # IT member usernames
        it_usernames = IT_MEMBER_USERNAMES
        is_it_member = is_it_member_user(request.user)
        
        # Only IT members can create individual chats
        if conversation_type == 'individual':
            if not is_it_member:
                return JsonResponse({'error': 'Only IT members can create individual chats'}, status=403)
            if len(participant_ids) != 1:
                return JsonResponse({'error': 'Individual chat requires exactly one participant'}, status=400)
            
            # Check if conversation already exists
            existing_conv = Conversation.objects.filter(
                conversation_type='individual',
                participants=request.user
            ).filter(participants__in=participant_ids).first()
            
            if existing_conv:
                return JsonResponse({
                    'success': True,
                    'conversation_id': existing_conv.id,
                    'message': 'Conversation already exists'
                })
            
            # Create individual conversation
            conversation = Conversation.objects.create(conversation_type='individual')
            conversation.participants.add(request.user, *participant_ids)
            
            return JsonResponse({
                'success': True,
                'conversation_id': conversation.id,
                'message': 'Individual chat created'
            })
        
        # Group conversation
        if conversation_type != 'group':
            return JsonResponse({'error': 'Invalid conversation type'}, status=400)
        
        if not group_name:
            return JsonResponse({'error': 'Group name is required'}, status=400)
        
        if request.user.id not in participant_ids:
            participant_ids.append(request.user.id)
        
        # Create group conversation
        conversation = Conversation.objects.create(conversation_type='group')
        conversation.participants.add(*participant_ids)
        
        # Create group details
        group = Group.objects.create(
            conversation=conversation,
            name=group_name,
            description=group_description,
            created_by=request.user
        )
        group.admins.add(request.user)
        
        return JsonResponse({'conversation_id': conversation.id, 'exists': False})
        
    except Exception as e:
        return JsonResponse({'error': str(e)}, status=500)


@login_required
@csrf_exempt
@require_http_methods(["POST"])
def add_group_participants(request, conversation_id):
    """Add participants to a group."""
    try:
        conversation = get_object_or_404(Conversation, id=conversation_id)
        
        if conversation.conversation_type != 'group':
            return JsonResponse({'error': 'Not a group conversation'}, status=400)
        
        # Check if user is admin
        if not conversation.group.admins.filter(id=request.user.id).exists():
            return JsonResponse({'error': 'Not authorized'}, status=403)
        
        data = json.loads(request.body)
        participant_ids = data.get('participant_ids', [])
        
        conversation.participants.add(*participant_ids)
        
        return JsonResponse({'success': True})
        
    except Exception as e:
        return JsonResponse({'error': str(e)}, status=500)


@login_required
@csrf_exempt
@require_http_methods(["POST"])
def remove_group_participant(request, conversation_id):
    """Remove a participant from a group."""
    try:
        conversation = get_object_or_404(Conversation, id=conversation_id)
        
        if conversation.conversation_type != 'group':
            return JsonResponse({'error': 'Not a group conversation'}, status=400)
        
        # Check if user is admin
        if not conversation.group.admins.filter(id=request.user.id).exists():
            return JsonResponse({'error': 'Not authorized'}, status=403)
        
        data = json.loads(request.body)
        participant_id = data.get('participant_id')
        
        # Cannot remove the creator
        if participant_id == conversation.group.created_by.id:
            return JsonResponse({'error': 'Cannot remove group creator'}, status=400)
        
        conversation.participants.remove(participant_id)
        
        return JsonResponse({'success': True})
        
    except Exception as e:
        return JsonResponse({'error': str(e)}, status=500)


@login_required
@csrf_exempt
@require_http_methods(["POST"])
def upload_media(request):
    """Upload media file for a message."""
    try:
        conversation_id = request.POST.get('conversation_id')
        message_type = request.POST.get('message_type', 'file')
        content = request.POST.get('content', '')
        file = request.FILES.get('file')
        
        if not file:
            return JsonResponse({'error': 'No file provided'}, status=400)
        
        processed_upload = process_uploaded_file(file)

        # Check file size after image compression.
        if processed_upload['compressed_size'] > settings.MAX_UPLOAD_SIZE:
            return JsonResponse({'error': f'File size must be less than or equal to 3MB after compression. Current size: {processed_upload["compressed_size"] / (1024*1024):.2f}MB'}, status=400)
        
        conversation = get_object_or_404(Conversation, id=conversation_id)
        
        # Check if user is participant
        if not conversation.participants.filter(id=request.user.id).exists():
            return JsonResponse({'error': 'Not authorized'}, status=403)

        try:
            if conversation.group and conversation.group.name == 'GTI members':
                if not is_it_member_user(request.user):
                    return JsonResponse({'error': 'Only IT members can send messages to GTI members group'}, status=403)
        except Group.DoesNotExist:
            pass
        
        # Create message with media
        message = Message.objects.create(
            conversation=conversation,
            sender=request.user,
            message_type=message_type,
            content=content,
            media_file=processed_upload['file'],
            file_sha256=processed_upload['sha256'],
            original_file_size=processed_upload['original_size'],
            compressed_file_size=processed_upload['compressed_size'],
            was_compressed=processed_upload['was_compressed'],
            status='sent'
        )
        conversation.save()
        push_message_notifications(message)
        
        return JsonResponse({
            'success': True,
            'message_id': message.id,
            'media_url': message.media_file.url,
            'file_name': message.file_name,
            'file_size': message.file_size,
            'file_sha256': message.file_sha256,
            'original_file_size': message.original_file_size,
            'compressed_file_size': message.compressed_file_size,
            'was_compressed': message.was_compressed,
        })
        
    except Exception as e:
        return JsonResponse({'error': str(e)}, status=500)


@login_required
def search(request):
    """Search for users, conversations, and messages."""
    query = request.GET.get('q', '')
    search_type = request.GET.get('type', 'all')
    
    results = {}
    
    if search_type in ['all', 'users']:
        users = User.objects.filter(
            Q(username__icontains=query) |
            Q(first_name__icontains=query) |
            Q(last_name__icontains=query)
        ).exclude(id=request.user.id)[:20]
        
        results['users'] = [
            {
                'id': user.id,
                'username': user.username,
                'full_name': user.get_full_name(),
                'profile_picture': user.profile_picture.url if user.profile_picture else None,
                'status': user.status,
            }
            for user in users
        ]
    
    if search_type in ['all', 'conversations']:
        conversations = Conversation.objects.filter(
            participants=request.user
        ).filter(
            Q(group__name__icontains=query) |
            Q(participants__username__icontains=query)
        ).distinct()[:20]
        
        results['conversations'] = [
            {
                'id': conv.id,
                'conversation_type': conv.conversation_type,
                'name': conv.group.name if conv.conversation_type == 'group' else conv.get_other_participant(request.user).get_full_name(),
            }
            for conv in conversations
        ]
    
    if search_type in ['all', 'messages']:
        messages = Message.objects.filter(
            conversation__participants=request.user,
            content__icontains=query,
            message_type='text'
        ).exclude(
            is_deleted_for_everyone=True
        ).exclude(
            is_deleted_for_me=request.user
        )[:50]
        
        results['messages'] = [
            {
                'id': msg.id,
                'conversation_id': msg.conversation.id,
                'content': msg.content,
                'sender': msg.sender.username,
                'created_at': msg.created_at.isoformat(),
            }
            for msg in messages
        ]
    
    return JsonResponse({'results': results})


@login_required
@csrf_exempt
@require_http_methods(["POST"])
def mark_messages_read(request):
    """Mark all messages in a conversation as read with per-user tracking."""
    try:
        data = json.loads(request.body)
        conversation_id = data.get('conversation_id')
        
        conversation = get_object_or_404(Conversation, id=conversation_id)
        
        # Check if user is participant
        if not conversation.participants.filter(id=request.user.id).exists():
            return JsonResponse({'error': 'Not authorized'}, status=403)
        
        # Get all messages in conversation that user hasn't read yet
        all_messages = conversation.messages.all()
        message_count = 0
        receipts_created = 0
        
        # Create read receipts for each message with current timestamp
        from django.utils import timezone
        read_time = timezone.now()
        
        for msg in all_messages:
            # Don't create read receipt for own messages
            if msg.sender == request.user:
                continue
                
            message_count += 1
            receipt, created = MessageReadReceipt.objects.get_or_create(
                message=msg,
                user=request.user,
                defaults={'read_at': read_time}
            )
            if created:
                receipts_created += 1
        
        # Update message status to 'seen' only when ALL participants have read it
        for msg in all_messages:
            # Get all participants except sender
            all_participants = msg.conversation.participants.exclude(id=msg.sender.id)
            # Check if all participants have read receipts
            read_receipts_count = MessageReadReceipt.objects.filter(
                message=msg,
                user__in=all_participants
            ).count()
            
            if read_receipts_count == all_participants.count():
                msg.status = 'seen'
                msg.save()
            elif msg.status == 'sent':
                msg.status = 'delivered'
                msg.save()
        
        # Update sender's messages to 'delivered' if they are 'sent'
        conversation.messages.filter(
            sender=request.user,
            status='sent'
        ).update(status='delivered')
        
        return JsonResponse({
            'success': True, 
            'read_count': message_count,
            'receipts_created': receipts_created
        })
        
    except json.JSONDecodeError:
        return JsonResponse({'error': 'Invalid JSON data'}, status=400)
    except Exception as e:
        import traceback
        print(f"Error in mark_messages_read: {str(e)}")
        print(traceback.format_exc())
        return JsonResponse({'error': str(e)}, status=500)


@login_required
@csrf_exempt
@require_http_methods(["POST"])
def broadcast_message(request):
    """Send a broadcast message to all conversations."""
    try:
        # Check if user is IT member
        if not is_it_member_user(request.user):
            return JsonResponse({'error': 'Only IT members can broadcast messages'}, status=403)
        
        message_type = request.POST.get('message_type', 'text')
        content = request.POST.get('content', '')
        media_file = request.FILES.get('media')
        
        if not content and not media_file:
            return JsonResponse({'error': 'Message content or media is required'}, status=400)
        
        # Get all conversations for the user
        conversations = Conversation.objects.filter(participants=request.user)
        
        sent_count = 0
        for conversation in conversations:
            try:
                message = Message.objects.create(
                    conversation=conversation,
                    sender=request.user,
                    content=content if message_type == 'text' else '',
                    message_type=message_type,
                    media_file=media_file if message_type == 'media' else None,
                    status='sent'
                )
                sent_count += 1
            except Exception as e:
                # Continue with other conversations if one fails
                continue
        
        return JsonResponse({
            'success': True,
            'sent_count': sent_count,
            'message': f'Message sent to {sent_count} conversations'
        })
        
    except Exception as e:
        return JsonResponse({'error': str(e)}, status=500)


@login_required
@csrf_exempt
@require_http_methods(["POST"])
def delete_message(request):
    """Delete a message for the user or for everyone."""
    try:
        data = json.loads(request.body)
        message_id = data.get('message_id')
        delete_for_everyone = data.get('delete_for_everyone', False)
        
        message = get_object_or_404(Message, id=message_id)
        
        # Check if user is the sender
        if message.sender != request.user:
            return JsonResponse({'error': 'Not authorized'}, status=403)
        
        if delete_for_everyone:
            # Delete for everyone
            message.is_deleted_for_everyone = True
            message.save()
        else:
            # Delete for current user only
            message.is_deleted_for_me.add(request.user)
        
        return JsonResponse({'success': True})
        
    except Exception as e:
        return JsonResponse({'error': str(e)}, status=500)


@login_required
def get_online_users(request):
    """Get list of online users."""
    online_users = User.objects.filter(status='online').exclude(id=request.user.id)
    
    return JsonResponse({'users': online_users})


@login_required
@csrf_exempt
@require_http_methods(["POST", "DELETE"])
def delete_conversation(request):
    """Clear a conversation's visible messages for the current user."""
    try:
        data = json.loads(request.body)
        conversation_id = data.get('conversation_id')
        
        if not conversation_id:
            return JsonResponse({'error': 'Conversation ID is required'}, status=400)
        
        conversation = get_object_or_404(Conversation, id=conversation_id)
        
        # Check if user is a participant
        if not conversation.participants.filter(id=request.user.id).exists():
            return JsonResponse({'error': 'You are not a participant in this conversation'}, status=403)
        
        messages = conversation.messages.exclude(is_deleted_for_everyone=True)
        cleared_count = messages.count()
        for message in messages:
            message.is_deleted_for_me.add(request.user)
        
        return JsonResponse({
            'success': True,
            'cleared_count': cleared_count,
            'message': 'Chat cleared successfully'
        })
        
    except json.JSONDecodeError:
        return JsonResponse({'error': 'Invalid JSON data'}, status=400)
    except Exception as e:
        return JsonResponse({'error': str(e)}, status=500)


@login_required
def get_message_read_receipts(request, message_id):
    """Get read receipts for a specific message - tracks who actually opened."""
    try:
        message = get_object_or_404(Message, id=message_id)
        conversation = message.conversation
        
        # Check if user is sender or participant
        if message.sender != request.user and not conversation.participants.filter(id=request.user.id).exists():
            return JsonResponse({'error': 'Not authorized'}, status=403)
        
        # Get all participants except sender
        all_participants = conversation.participants.exclude(id=message.sender.id)
        
        # Get users who have actually read this message (via read receipts)
        read_receipts = MessageReadReceipt.objects.filter(
            message=message,
            user__in=all_participants
        ).select_related('user')
        
        print(f"DEBUG: Message {message_id}, Read receipts count: {read_receipts.count()}")
        print(f"DEBUG: All participants (except sender): {list(all_participants.values_list('username', flat=True))}")
        
        # Build read list with actual timestamps
        read_user_ids = set()
        read_by = []
        for receipt in read_receipts:
            read_user_ids.add(receipt.user.id)
            read_by.append({
                'id': receipt.user.id,
                'username': receipt.user.username,
                'full_name': receipt.user.get_full_name(),
                'read_at': receipt.read_at.isoformat()
            })
            print(f"DEBUG: User {receipt.user.username} read at {receipt.read_at}")
        
        # Build not-read list (participants who haven't opened yet)
        not_read_by = []
        for participant in all_participants:
            if participant.id not in read_user_ids:
                not_read_by.append({
                    'id': participant.id,
                    'username': participant.username,
                    'full_name': participant.get_full_name()
                })
                print(f"DEBUG: User {participant.username} has NOT read")
        
        result = {
            'message_id': message_id,
            'read_by': read_by,
            'not_read_by': not_read_by,
            'total_participants': all_participants.count(),
            'read_count': len(read_by),
            'unread_count': len(not_read_by)
        }
        
        print(f"DEBUG: Returning read receipts result: {result}")
        return JsonResponse(result)
        
    except Exception as e:
        import traceback
        print(f"Error in get_message_read_receipts: {str(e)}")
        print(traceback.format_exc())
        return JsonResponse({'error': str(e)}, status=500)


@login_required
@csrf_exempt
@require_http_methods(["POST"])
def edit_message(request, message_id):
    """Edit a message (only within 5 minutes of sending)."""
    try:
        message = get_object_or_404(Message, id=message_id)
        
        # Check if user is the sender
        if message.sender != request.user:
            return JsonResponse({'error': 'You can only edit your own messages'}, status=403)
        
        # Check if within 5 minutes
        from django.utils import timezone
        time_diff = timezone.now() - message.created_at
        if time_diff.total_seconds() > 300:  # 5 minutes = 300 seconds
            return JsonResponse({'error': 'Messages can only be edited within 5 minutes'}, status=400)
        
        data = json.loads(request.body)
        new_content = data.get('content', '').strip()
        
        if not new_content:
            return JsonResponse({'error': 'Message content cannot be empty'}, status=400)
        
        # Update message
        message.content = new_content
        message.edited = True
        message.edited_at = timezone.now()
        message.save()
        
        return JsonResponse({
            'success': True,
            'message': 'Message edited successfully',
            'content': message.content,
            'edited_at': message.edited_at.isoformat()
        })
        
    except json.JSONDecodeError:
        return JsonResponse({'error': 'Invalid JSON data'}, status=400)
    except Exception as e:
        return JsonResponse({'error': str(e)}, status=500)


@login_required
@csrf_exempt
@require_http_methods(["POST"])
def delete_message_api(request, message_id):
    """Delete a message for me or for everyone."""
    try:
        message = get_object_or_404(Message, id=message_id)
        conversation = message.conversation
        
        data = json.loads(request.body)
        delete_for = data.get('delete_for', 'me')  # 'me' or 'everyone'
        
        # Check if user is participant
        if not conversation.participants.filter(id=request.user.id).exists():
            return JsonResponse({'error': 'Not authorized'}, status=403)
        
        if delete_for == 'everyone':
            # Only sender can delete for everyone
            if message.sender != request.user:
                return JsonResponse({'error': 'Only the sender can delete for everyone'}, status=403)
            
            # Soft delete - mark as deleted for everyone
            message.content = ''
            message.media_file = None
            message.save()
            
            return JsonResponse({
                'success': True,
                'message': 'Message deleted for everyone',
                'deleted_by': request.user.get_full_name() or request.user.username
            })
            
        else:  # delete_for == 'me'
            # Mark message as deleted for this user
            message.is_deleted_for_me.add(request.user)
            
            return JsonResponse({
                'success': True,
                'message': 'Message deleted for you'
            })
        
    except json.JSONDecodeError:
        return JsonResponse({'error': 'Invalid JSON data'}, status=400)
    except Exception as e:
        return JsonResponse({'error': str(e)}, status=500)


@login_required
@csrf_exempt
@require_http_methods(["POST"])
def create_helpdesk_request(request):
    """Create a new help desk request."""
    try:
        data = json.loads(request.body)
        request_message = data.get('request_message', '').strip()
        
        if not request_message:
            return JsonResponse({'error': 'Request message is required'}, status=400)
        
        # Check if user is IT member (IT members cannot create requests)
        if is_it_member_user(request.user):
            return JsonResponse({'error': 'IT members cannot create help desk requests'}, status=403)
        
        # Get IT help desk conversation
        helpdesk_conv = Conversation.objects.filter(
            conversation_type='group',
            group__name='IT help desk',
            participants=request.user
        ).first()
        
        if not helpdesk_conv:
            return JsonResponse({'error': 'IT help desk conversation not found'}, status=404)
        
        # Create help desk request
        helpdesk_request = HelpDeskRequest.objects.create(
            conversation=helpdesk_conv,
            requester=request.user,
            request_message=request_message,
            status='pending'
        )
        
        # Create a system message in the conversation
        system_message = Message.objects.create(
            conversation=helpdesk_conv,
            sender=request.user,
            content=f"🎫 **NEW REQUEST** from {request.user.get_full_name() or request.user.username}:\n\n{request_message}\n\n*Status: Pending*",
            message_type='text',
            status='sent'
        )
        
        return JsonResponse({
            'success': True,
            'request_id': helpdesk_request.id,
            'message': 'Help desk request created successfully'
        })
        
    except json.JSONDecodeError:
        return JsonResponse({'error': 'Invalid JSON data'}, status=400)
    except Exception as e:
        return JsonResponse({'error': str(e)}, status=500)


@login_required
@csrf_exempt
@require_http_methods(["POST"])
def take_helpdesk_request(request, request_id):
    """Take over a help desk request (IT members only)."""
    try:
        # Check if user is IT member
        if not is_it_member_user(request.user):
            return JsonResponse({'error': 'Only IT members can take over requests'}, status=403)
        
        helpdesk_request = get_object_or_404(HelpDeskRequest, id=request_id)
        
        if helpdesk_request.status != 'pending':
            return JsonResponse({'error': 'This request has already been taken'}, status=400)
        
        # Take's request
        helpdesk_request.take_request(request.user)
        
        # Create a system message announcing the takeover
        system_message = Message.objects.create(
            conversation=helpdesk_request.conversation,
            sender=request.user,
            content=f"✅ **REQUEST TAKEN** by {request.user.get_full_name() or request.user.username}\n\nOriginal request from {helpdesk_request.requester.get_full_name() or helpdesk_request.requester.username}:\n{helpdesk_request.request_message}\n\n*Status: In Progress*",
            message_type='text',
            status='sent'
        )
        
        return JsonResponse({
            'success': True,
            'message': f'Request taken by {request.user.get_full_name() or request.user.username}',
            'taken_by': {
                'id': request.user.id,
                'username': request.user.username,
                'full_name': request.user.get_full_name()
            }
        })
        
    except Exception as e:
        return JsonResponse({'error': str(e)}, status=500)


@login_required
def get_helpdesk_requests(request):
    """Get all help desk requests."""
    try:
        # Get IT help desk conversation
        helpdesk_conv = Conversation.objects.filter(
            conversation_type='group',
            group__name='IT help desk',
            participants=request.user
        ).first()
        
        if not helpdesk_conv:
            return JsonResponse({'error': 'IT help desk conversation not found'}, status=404)
        
        # Get all requests for this conversation
        requests = HelpDeskRequest.objects.filter(
            conversation=helpdesk_conv
        ).order_by('-created_at')
        
        employee_cache = {}
        requests_data = []
        for req in requests:
            req_data = {
                'id': req.id,
                'requester': get_helpdesk_report_user_data(req.requester, employee_cache),
                'taken_by': get_helpdesk_report_user_data(req.taken_by, employee_cache) if req.taken_by else None,
                'status': req.status,
                'request_message': req.request_message,
                'created_at': req.created_at.isoformat(),
                'taken_at': req.taken_at.isoformat() if req.taken_at else None
            }
            requests_data.append(req_data)
        
        return JsonResponse({'requests': requests_data})
        
    except Exception as e:
        return JsonResponse({'error': str(e)}, status=500)


@login_required
@csrf_exempt
@require_http_methods(["POST"])
def create_helpdesk_container(request):
    """Create a new help desk container with file attachment."""
    try:
        # Check if user is IT member (IT members cannot create containers)
        if is_it_member_user(request.user):
            return JsonResponse({'error': 'IT members cannot create help desk containers'}, status=403)
        
        # Get IT help desk conversation
        helpdesk_conv = Conversation.objects.filter(
            conversation_type='group',
            group__name='IT help desk',
            participants=request.user
        ).first()
        
        if not helpdesk_conv:
            return JsonResponse({'error': 'IT help desk conversation not found'}, status=404)
        
        # Handle form data (for file uploads)
        problem_description = request.POST.get('problem_description', '').strip()
        attached_file = request.FILES.get('attached_file')
        processed_attachment = process_uploaded_file(attached_file) if attached_file else None
        
        if not problem_description:
            return JsonResponse({'error': 'Problem description is required'}, status=400)
        
        # Create help desk container
        container = HelpDeskContainer.objects.create(
            conversation=helpdesk_conv,
            requester=request.user,
            problem_description=problem_description,
            attached_files=processed_attachment['file'] if processed_attachment else None,
            file_name=processed_attachment['file'].name if processed_attachment else '',
            file_sha256=processed_attachment['sha256'] if processed_attachment else '',
            original_file_size=processed_attachment['original_size'] if processed_attachment else None,
            compressed_file_size=processed_attachment['compressed_size'] if processed_attachment else None,
            was_compressed=processed_attachment['was_compressed'] if processed_attachment else False,
            status='pending'
        )
        
        # Create a system message in the conversation
        message_content = f"🎫 **NEW TASK #{container.container_id}** from {request.user.get_full_name() or request.user.username}:\n\n{problem_description}"
        if attached_file:
            message_content += f"\n\n📎 File attached: {attached_file.name}"
        message_content += f"\n\n*Status: Pending - Click 'I will take over' to handle this request*"
        
        system_message = Message.objects.create(
            conversation=helpdesk_conv,
            sender=request.user,
            content=message_content,
            message_type='text',
            status='sent'
        )
        
        return JsonResponse({
            'success': True,
            'container_id': container.container_id,
            'message': 'Help desk task created successfully'
        })
        
    except Exception as e:
        return JsonResponse({'error': str(e)}, status=500)


@login_required
@csrf_exempt
@require_http_methods(["POST"])
def take_over_container(request, container_id):
    """Take over a help desk container (IT members only)."""
    try:
        # Check if user is IT member
        if not is_it_member_user(request.user):
            return JsonResponse({'error': 'Only IT members can take over tasks'}, status=403)
        
        container = get_object_or_404(HelpDeskContainer, container_id=container_id)
        
        # Try to take over the container
        if container.take_over(request.user):
            # Create a system message announcing the takeover
            message_content = f"✅ **TASK #{container.container_id} TOOK BY** {request.user.get_full_name() or request.user.username}\n\nOriginal request from {container.requester.get_full_name() or container.requester.username}:\n{container.problem_description}"
            
            if container.attached_files:
                message_content += f"\n\n📎 File: {container.file_name}"
            
            message_content += f"\n\n*Status: In Progress - Being handled by {request.user.get_full_name() or request.user.username}*"
            
            system_message = Message.objects.create(
                conversation=container.conversation,
                sender=request.user,
                content=message_content,
                message_type='text',
                status='sent'
            )

            # Realtime work status update (active assignments change)
            try:
                broadcast_helpdesk_work_status(extra_user_ids=[container.requester_id])
            except Exception:
                pass
            
            return JsonResponse({
                'success': True,
                'message': f'Task #{container.container_id} took by {request.user.get_full_name() or request.user.username}',
                'taken_by': {
                    'id': request.user.id,
                    'username': request.user.username,
                    'full_name': request.user.get_full_name()
                }
            })
        else:
            return JsonResponse({'error': 'This container has already been taken over'}, status=400)
        
    except Exception as e:
        return JsonResponse({'error': str(e)}, status=500)


@login_required
def get_helpdesk_containers(request):
    """Get help desk containers with proper visibility controls."""
    try:
        # Get IT help desk conversation
        helpdesk_conv = Conversation.objects.filter(
            conversation_type='group',
            group__name='IT help desk',
            participants=request.user
        ).first()
        
        if not helpdesk_conv:
            return JsonResponse({'error': 'IT help desk conversation not found'}, status=404)
        
        # Check if user is IT member
        it_usernames = IT_MEMBER_USERNAMES
        is_it_member = is_it_member_user(request.user)
        
        # Get containers based on user type
        if is_it_member:
            # IT members see all containers
            containers = HelpDeskContainer.objects.filter(conversation=helpdesk_conv)
        else:
            # Normal users see only their containers
            containers = HelpDeskContainer.objects.filter(conversation=helpdesk_conv, requester=request.user)
        
        employee_cache = {}
        containers_data = []
        for container in containers:
            container_data = {
                'container_id': container.container_id,
                'requester': get_helpdesk_report_user_data(container.requester, employee_cache),
                'taken_by': get_helpdesk_report_user_data(container.taken_by, employee_cache) if container.taken_by else None,
                'status': container.status,
                'problem_description': container.problem_description,
                'fixed_problem': container.fixed_problem,
                'attached_files': container.attached_files.url if container.attached_files else None,
                'file_name': container.file_name,
                'created_at': container.created_at.isoformat(),
                'taken_at': container.taken_at.isoformat() if container.taken_at else None,
                'completed_at': container.completed_at.isoformat() if container.completed_at else None,
                'completed_by': get_helpdesk_report_user_data(container.completed_by, employee_cache) if container.completed_by else None,
                'task_chat_unread_count': get_task_chat_unread_count(request.user, container),
            }
            containers_data.append(container_data)
        
        return JsonResponse({
            'containers': containers_data,
            'is_it_member': is_it_member
        })
        
    except Exception as e:
        return JsonResponse({'error': str(e)}, status=500)


@login_required
def get_task_chat_messages(request, container_id):
    """Return task-specific chat history and readonly state."""
    try:
        task = get_object_or_404(HelpDeskContainer, container_id=container_id)

        if not task.conversation.participants.filter(id=request.user.id).exists():
            return JsonResponse({'error': 'Not authorized'}, status=403)

        messages = TaskChatMessage.objects.filter(task=task).select_related('sender')
        return JsonResponse({
            'task_id': task.container_id,
            'can_send': can_send_task_chat(request.user, task),
            'unread_count': get_task_chat_unread_count(request.user, task),
            'messages': [task_chat_message_to_dict(message, request.user) for message in messages],
        })
    except Exception as e:
        return JsonResponse({'error': str(e)}, status=500)


@login_required
@require_http_methods(["POST"])
def mark_task_chat_read(request, container_id):
    """Mark all task chat messages as read for this user (used for per-container unread badge)."""
    task = get_object_or_404(HelpDeskContainer, container_id=container_id)
    if not task.conversation.participants.filter(id=request.user.id).exists():
        return JsonResponse({'error': 'Not authorized'}, status=403)

    # Mark read "now" (good enough for unseen badge). Excluding own messages is handled in unread calc.
    try:
        TaskChatReadState.objects.update_or_create(
            task=task,
            user=request.user,
            defaults={'last_read_at': timezone.now()},
        )
    except (OperationalError, ProgrammingError):
        # If migration isn't applied yet, treat as no-op.
        pass

    # Push badge reset to this user (realtime).
    try:
        channel_layer = get_channel_layer()
        if channel_layer:
            async_to_sync(channel_layer.group_send)(
                f'notifications_{request.user.id}',
                {'type': 'task_chat_unread', 'task_id': task.container_id, 'unread_count': 0}
            )
    except Exception:
        pass
    return JsonResponse({'success': True})


@login_required
def get_helpdesk_data_table(request):
    """Get help desk data in table format."""
    try:
        # Check if user is IT member
        if not is_it_member_user(request.user):
            return JsonResponse({'error': 'Only IT members can access data table'}, status=403)
        
        # Get all containers
        containers = HelpDeskContainer.objects.all().order_by('-created_at')
        
        table_data = []
        for container in containers:
            row = {
                'container_id': container.container_id,
                'date_time': container.created_at.strftime('%Y-%m-%d %H:%M:%S'),
                'it_member_username': container.taken_by.username if container.taken_by else 'Not taken',
                'problem': container.problem_description,
                'files': container.file_name if container.file_name else 'No files',
                'status': container.status,
                'completed_at': container.completed_at.strftime('%Y-%m-%d %H:%M:%S') if container.completed_at else '',
                'completed_by': container.completed_by.username if container.completed_by else ''
            }
            table_data.append(row)
        
        return JsonResponse({'data': table_data})
        
    except Exception as e:
        return JsonResponse({'error': str(e)}, status=500)


@login_required
def get_helpdesk_work_status(request):
    """Return current IT team work status (active tasks per IT member)."""
    # Must be participant in IT help desk to view
    helpdesk_conv = Conversation.objects.filter(
        conversation_type='group',
        group__name='IT help desk',
        participants=request.user
    ).first()
    if not helpdesk_conv:
        return JsonResponse({'error': 'IT help desk conversation not found'}, status=404)

    return JsonResponse({'status': build_helpdesk_work_status()})


def ensure_it_member_chat_access(user):
    it_group_names = ['GTI members', 'IT help desk', 'IT personal']
    for conversation in Conversation.objects.filter(conversation_type='group', group__name__in=it_group_names):
        ConversationParticipant.objects.get_or_create(user=user, conversation=conversation)


def ensure_it_member_individual_chats(user):
    normal_users = User.objects.filter(is_active=True).exclude(id=user.id)
    for other_user in normal_users:
        if is_it_member_user(other_user):
            continue

        existing_chat = Conversation.objects.filter(
            conversation_type='individual',
            participants=user,
        ).filter(
            participants=other_user,
        ).first()

        if existing_chat:
            continue

        chat = Conversation.objects.create(conversation_type='individual')
        ConversationParticipant.objects.get_or_create(conversation=chat, user=user)
        ConversationParticipant.objects.get_or_create(conversation=chat, user=other_user)


def ensure_normal_user_it_chats(user):
    it_members = User.objects.filter(username__in=get_it_member_usernames()).exclude(id=user.id)
    for it_member in it_members:
        existing_chat = Conversation.objects.filter(
            conversation_type='individual',
            participants=user,
        ).filter(
            participants=it_member,
        ).first()

        if existing_chat:
            continue

        chat = Conversation.objects.create(conversation_type='individual')
        ConversationParticipant.objects.get_or_create(conversation=chat, user=user)
        ConversationParticipant.objects.get_or_create(conversation=chat, user=it_member)


def notify_role_change(target_user, changed_by, make_it_member):
    channel_layer = get_channel_layer()
    if not channel_layer:
        return

    new_role = 'IT member' if make_it_member else 'normal user'
    changed_by_name = strip_invisible_marks(changed_by.get_full_name() or changed_by.username)
    async_to_sync(channel_layer.group_send)(
        f'notifications_{target_user.id}',
        {
            'type': 'notification',
            'notification': {
                'id': f'it-role-{target_user.id}-{timezone.now().timestamp()}',
                'notification_type': 'it_membership_changed',
                'title': 'Role Updated',
                'body': f'Your account was changed to {new_role} by {changed_by_name}.',
                'is_it_member': make_it_member,
                'created_at': timezone.now().isoformat(),
            }
        }
    )

    for user_id in User.objects.filter(is_active=True).values_list('id', flat=True):
        async_to_sync(channel_layer.group_send)(
            f'notifications_{user_id}',
            {
                'type': 'it_membership_list_changed',
            }
        )


@login_required
def it_membership_users(request):
    """List users for IT maintain users role management."""
    if not is_it_member_user(request.user):
        return JsonResponse({'error': 'Only IT members can maintain users'}, status=403)

    users = User.objects.filter(is_active=True).order_by('username')
    data = []
    for user in users:
        full_name = strip_invisible_marks(user.get_full_name() or user.username)
        data.append({
            'id': user.id,
            'username': user.username,
            'full_name': full_name,
            'display_name': f'{user.username} | {full_name}' if full_name and full_name != user.username else user.username,
            'is_it_member': is_it_member_user(user),
            'is_protected': is_protected_it_member(user) or user.is_superuser,
        })

    return JsonResponse({'users': data})


@login_required
@csrf_exempt
@require_http_methods(["POST"])
def update_it_membership(request):
    """Promote/demote users without deleting their messages or conversations."""
    if not is_it_member_user(request.user):
        return JsonResponse({'error': 'Only IT members can maintain users'}, status=403)

    try:
        data = json.loads(request.body)
        user_id = data.get('user_id')
        make_it_member = bool(data.get('is_it_member'))

        target_user = get_object_or_404(User, id=user_id, is_active=True)
        was_it_member = is_it_member_user(target_user)
        if target_user.id == request.user.id and not make_it_member:
            return JsonResponse({'error': 'You cannot remove your own IT access'}, status=400)

        if is_protected_it_member(target_user) and not make_it_member:
            return JsonResponse({'error': 'Built-in IT members cannot be changed here'}, status=400)

        if was_it_member == make_it_member:
            return JsonResponse({'error': 'This user already has the selected role'}, status=400)

        dynamic_group = get_it_maintain_group()
        if make_it_member:
            target_user.groups.add(dynamic_group)
            ensure_it_member_chat_access(target_user)
            ensure_it_member_individual_chats(target_user)
        else:
            target_user.groups.remove(dynamic_group)
            ensure_normal_user_it_chats(target_user)

        changed_by_full_name = strip_invisible_marks(request.user.get_full_name() or request.user.username)
        target_full_name = strip_invisible_marks(target_user.get_full_name() or target_user.username)
        ITMembershipChangeLog.objects.create(
            changed_by=request.user,
            target_user=target_user,
            changed_by_user_pk=request.user.id,
            changed_by_username=request.user.username,
            changed_by_full_name=changed_by_full_name,
            target_user_pk=target_user.id,
            target_username=target_user.username,
            target_full_name=target_full_name,
            from_role='IT member' if was_it_member else 'Normal user',
            to_role='IT member' if make_it_member else 'Normal user',
            action='normal_to_it' if make_it_member else 'it_to_normal',
        )
        notify_role_change(target_user, request.user, make_it_member)

        return JsonResponse({
            'success': True,
            'user': {
                'id': target_user.id,
                'username': target_user.username,
                'full_name': strip_invisible_marks(target_user.get_full_name() or target_user.username),
                'is_it_member': is_it_member_user(target_user),
                'is_protected': is_protected_it_member(target_user) or target_user.is_superuser,
            }
        })
    except Exception as e:
        return JsonResponse({'error': str(e)}, status=500)


@login_required
def it_membership_history(request):
    """Return IT membership change history."""
    if not is_it_member_user(request.user):
        return JsonResponse({'error': 'Only IT members can view role history'}, status=403)

    logs = ITMembershipChangeLog.objects.all()[:100]
    return JsonResponse({
        'history': [
            {
                'id': log.id,
                'changed_by_user_id': log.changed_by_user_pk,
                'changed_by_username': log.changed_by_username,
                'changed_by_full_name': log.changed_by_full_name,
                'target_user_id': log.target_user_pk,
                'target_username': log.target_username,
                'target_full_name': log.target_full_name,
                'from_role': log.from_role,
                'to_role': log.to_role,
                'action': log.action,
                'created_at': log.created_at.isoformat(),
            }
            for log in logs
        ]
    })


@login_required
def it_reports(request):
    """IT Reports page with help desk requests table"""
    if not is_it_member_user(request.user):
        return JsonResponse({'error': 'Access denied'}, status=403)
    
    # Get all help desk containers with related data
    containers = HelpDeskContainer.objects.select_related(
        'requester',
        'taken_by'
    ).all().order_by('-created_at')
    
    # HelpDeskRequest does not have container/user/assigned_to relations.
    # Keep this list for template compatibility.
    helpdesk_requests = HelpDeskRequest.objects.select_related(
        'requester',
        'taken_by'
    ).all().order_by('-created_at')
    
    context = {
        'containers': containers,
        'helpdesk_requests': helpdesk_requests,
        'current_user': request.user,
        'it_usernames': IT_MEMBER_USERNAMES
    }
    
    return render(request, 'messaging/it-reports.html', context)


@csrf_exempt
@require_http_methods(["POST"])
def update_container_status(request):
    """Update container status (take over, complete, etc.)"""
    if not is_it_member_user(request.user):
        return JsonResponse({'error': 'Access denied'}, status=403)
    
    try:
        data = json.loads(request.body)
        container_id = data.get('container_id')
        action = data.get('action')  # 'take_over', 'complete', 'in_progress'
        
        container = get_object_or_404(HelpDeskContainer, container_id=container_id)
        
        if action == 'take_over':
            if container.status == 'pending':
                container.taken_by = request.user
                container.status = 'took_over'
                container.taken_at = timezone.now()
                container.save()
                return JsonResponse({
                    'success': True,
                    'message': f'Task #{container.container_id} took by {request.user.get_full_name() or request.user.username}',
                    'taken_by': {
                        'id': request.user.id,
                        'username': request.user.username,
                        'full_name': request.user.get_full_name()
                    }
                })
            else:
                return JsonResponse({'error': 'Request already taken over'}, status=400)
                
        elif action == 'complete':
            if container.taken_by == request.user:
                container.status = 'completed'
                container.completed_at = timezone.now()
                container.save()
                return JsonResponse({
                    'success': True,
                    'message': f'Request #{container.container_id} marked as completed'
                })
            else:
                return JsonResponse({'error': 'You can only complete requests you have taken over'}, status=400)
                
        elif action == 'in_progress':
            if container.taken_by == request.user:
                container.status = 'in_progress'
                container.save()
                return JsonResponse({
                    'success': True,
                    'message': f'Request #{container.container_id} marked as in progress'
                })
            else:
                return JsonResponse({'error': 'You can only update requests you have taken over'}, status=400)
        
        return JsonResponse({'error': 'Invalid action'}, status=400)
        
    except Exception as e:
        return JsonResponse({'error': str(e)}, status=500)
