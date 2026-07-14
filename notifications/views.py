from django.contrib.auth.decorators import login_required
from django.http import JsonResponse
from django.views.decorators.http import require_http_methods
from .models import Notification
import json


@login_required
def notifications_list(request):
    """Get all notifications for the current user."""
    notifications = Notification.objects.filter(recipient=request.user)
    since_id = request.GET.get('since_id')

    if since_id:
        try:
            notifications = notifications.filter(id__gt=int(since_id))
        except (TypeError, ValueError):
            pass

    if request.GET.get('unread_only') == '1':
        notifications = notifications.filter(is_read=False)

    if since_id:
        notifications = notifications.order_by('id')[:50]
    else:
        notifications = notifications.order_by('-created_at')[:50]
    
    notifications_data = [
        {
            'id': notif.id,
            'notification_type': notif.notification_type,
            'title': notif.title,
            'body': notif.body,
            'is_read': notif.is_read,
            'created_at': notif.created_at.isoformat(),
            'conversation_id': notif.conversation.id if notif.conversation else None,
            'message_id': notif.message.id if notif.message else None,
        }
        for notif in notifications
    ]
    
    return JsonResponse({'notifications': notifications_data})


@login_required
def unread_count(request):
    """Get count of unread notifications."""
    count = Notification.objects.filter(
        recipient=request.user,
        is_read=False
    ).count()
    
    return JsonResponse({'unread_count': count})


@login_required
@require_http_methods(["POST"])
def mark_read(request, notification_id):
    """Mark a notification as read."""
    try:
        notification = Notification.objects.get(id=notification_id, recipient=request.user)
        notification.is_read = True
        notification.save()
        return JsonResponse({'success': True})
    except Notification.DoesNotExist:
        return JsonResponse({'error': 'Notification not found'}, status=404)


@login_required
@require_http_methods(["POST"])
def mark_all_read(request):
    """Mark all notifications as read."""
    Notification.objects.filter(
        recipient=request.user,
        is_read=False
    ).update(is_read=True)
    
    return JsonResponse({'success': True})


@login_required
@require_http_methods(["DELETE"])
def delete_notification(request, notification_id):
    """Delete a notification."""
    try:
        notification = Notification.objects.get(id=notification_id, recipient=request.user)
        notification.delete()
        return JsonResponse({'success': True})
    except Notification.DoesNotExist:
        return JsonResponse({'error': 'Notification not found'}, status=404)
