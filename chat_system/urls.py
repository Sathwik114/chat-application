"""
URL configuration for chat_system project.
"""
from django.contrib import admin
from django.urls import path, include, re_path
from django.conf import settings
from django.conf.urls.static import static
from django.views.generic import TemplateView
from messaging import views as messaging_views

urlpatterns = [
    path('admin/', admin.site.urls),
    path('api/auth/', include('authentication.urls')),
    path('api/messaging/', include('messaging.urls')),
    re_path(r'^media/(?P<file_path>.+)$', messaging_views.serve_media_file, name='serve_media_file_root'),
    path('it-reports/', messaging_views.it_reports, name='it_reports'),
    path('api/notifications/', include('notifications.urls')),
    path('', TemplateView.as_view(template_name='index.html'), name='home'),
    path('login/', TemplateView.as_view(template_name='login.html'), name='login'),
    path('signup/', TemplateView.as_view(template_name='signup.html'), name='signup'),
]

if settings.DEBUG:
    urlpatterns += static(settings.STATIC_URL, document_root=settings.STATIC_ROOT)

# Media files must be served in production too (chat attachments)
urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
