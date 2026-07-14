"""
Django settings for chat_system project.
"""

import os
from pathlib import Path
from datetime import timedelta

# Build paths inside the project like this: BASE_DIR / 'subdir'.
BASE_DIR = Path(__file__).resolve().parent.parent


# SECURITY WARNING: keep the secret key used in production secret!
SECRET_KEY = os.environ.get('DJANGO_SECRET_KEY', 'django-insecure-change-this-in-production')

# SECURITY WARNING: don't run with debug turned on in production!
DEBUG = os.environ.get('DEBUG', 'True') == 'True'

ALLOWED_HOSTS = os.environ.get('ALLOWED_HOSTS', '*').split(',')

# Application definition
INSTALLED_APPS = [
    'daphne',
    'django.contrib.admin',
    'django.contrib.auth',
    'django.contrib.contenttypes',
    'django.contrib.sessions',
    'django.contrib.messages',
    'django.contrib.staticfiles',
    'channels',
    'corsheaders',
    'authentication',
    'messaging',
    'notifications',
]

MIDDLEWARE = [
    'corsheaders.middleware.CorsMiddleware',
    'django.middleware.security.SecurityMiddleware',
    'whitenoise.middleware.WhiteNoiseMiddleware',
    'django.contrib.sessions.middleware.SessionMiddleware',
    'django.middleware.common.CommonMiddleware',
    'django.middleware.csrf.CsrfViewMiddleware',
    'django.contrib.auth.middleware.AuthenticationMiddleware',
    'django.contrib.messages.middleware.MessageMiddleware',
    'django.middleware.clickjacking.XFrameOptionsMiddleware',
]

# The desktop chat shell embeds internal pages such as IT Reports in the main
# workspace. Keep clickjacking protection for other origins while allowing the
# same app origin to frame its own pages.
X_FRAME_OPTIONS = 'SAMEORIGIN'

ROOT_URLCONF = 'chat_system.urls'

TEMPLATES = [
    {
        'BACKEND': 'django.template.backends.django.DjangoTemplates',
        'DIRS': [BASE_DIR / 'templates'],
        'APP_DIRS': True,
        'OPTIONS': {
            'context_processors': [
                'django.template.context_processors.debug',
                'django.template.context_processors.request',
                'django.contrib.auth.context_processors.auth',
                'django.contrib.messages.context_processors.messages',
            ],
        },
    },
]

WSGI_APPLICATION = 'chat_system.wsgi.application'
ASGI_APPLICATION = 'chat_system.asgi.application'

# Database
DATABASES = {
    'default': {
        'ENGINE': 'mssql',
        'NAME': os.environ.get('DB_NAME', 'ITSupport'),
        'USER': os.environ.get('DB_USER', 'sa'),
        'PASSWORD': os.environ.get('DB_PASSWORD', 'ccise054879+m'),
        'HOST': os.environ.get('DB_HOST', '10.40.10.125'),
        'PORT': os.environ.get('DB_PORT', '1433'),
        'OPTIONS': {
            'driver': os.environ.get('DB_DRIVER', 'SQL Server Native Client 11.0'),
        },
    },

    'odbc17': {
        'ENGINE': 'django.db.backends.sqlite3',
        'NAME': BASE_DIR / 'db.sqlite3',
        'OPTIONS': {
            'driver': 'ODBC Driver 17 for SQL Server',
            'server': '10.40.10.105',
            'database': 'Payroll',
            'user': 'paydev',
            'password': 'dev.gtipay@123',
            'port': '1433',
        },
    }
}

# Password validation
AUTH_PASSWORD_VALIDATORS = [
    {
        'NAME': 'django.contrib.auth.password_validation.UserAttributeSimilarityValidator',
    },
    {
        'NAME': 'django.contrib.auth.password_validation.MinimumLengthValidator',
    },
    {
        'NAME': 'django.contrib.auth.password_validation.CommonPasswordValidator',
    },
    {
        'NAME': 'django.contrib.auth.password_validation.NumericPasswordValidator',
    },
]

# Internationalization
LANGUAGE_CODE = 'en-us'
TIME_ZONE = 'Asia/Kolkata'
USE_I18N = True
USE_TZ = True

# Static files (CSS, JavaScript, Images)
STATIC_URL = '/static/'
STATIC_ROOT = BASE_DIR / 'staticfiles'
STATICFILES_DIRS = [BASE_DIR / 'static']
STATICFILES_STORAGE = 'whitenoise.storage.CompressedManifestStaticFilesStorage'

# Media files
MEDIA_URL = '/media/'
# Allow overriding media storage location in production via environment variable
# Example: set DJANGO_MEDIA_ROOT=C:\inetpub\wwwroot\ITSup\ITSupport\media
media_root_env = os.environ.get('DJANGO_MEDIA_ROOT', '').strip()
default_media_root = BASE_DIR / 'media'
deployed_media_root = Path(r'C:\inetpub\wwwroot\ITSup\ITSupport\media')

if media_root_env:
    MEDIA_ROOT = Path(media_root_env)
elif deployed_media_root.exists():
    MEDIA_ROOT = deployed_media_root
else:
    MEDIA_ROOT = default_media_root

# Default primary key field type
DEFAULT_AUTO_FIELD = 'django.db.models.BigAutoField'

# Custom User Model
AUTH_USER_MODEL = 'authentication.User'

AUTHENTICATION_BACKENDS = [
    "django.contrib.auth.backends.ModelBackend",
]

# Django Channels Configuration (using in-memory layer for testing)
CHANNEL_LAYERS = {
    'default': {
        'BACKEND': 'channels.layers.InMemoryChannelLayer',
    },
}

# CORS Configuration
CORS_ALLOWED_ORIGINS = os.environ.get('CORS_ALLOWED_ORIGINS', 'http://localhost:3000,http://127.0.0.1:3000').split(',')
CORS_ALLOW_CREDENTIALS = True

# Session Configuration
SESSION_COOKIE_AGE = timedelta(days=7).total_seconds()
SESSION_COOKIE_HTTPONLY = True
SESSION_COOKIE_SECURE = False  # Set to True in production with HTTPS
SESSION_COOKIE_SAMESITE = 'Lax'

# Login URLs
LOGIN_URL = '/login/'
LOGIN_REDIRECT_URL = '/'
LOGOUT_REDIRECT_URL = '/login/'

# File Upload Settings
DATA_UPLOAD_MAX_MEMORY_SIZE = 10485760  # 10MB
FILE_UPLOAD_MAX_MEMORY_SIZE = 10485760  # 10MB
MAX_UPLOAD_SIZE = 3145728  # 3MB

# Celery Configuration (for background tasks)
CELERY_BROKER_URL = os.environ.get('CELERY_BROKER_URL', 'redis://127.0.0.1:6379/0')
CELERY_RESULT_BACKEND = os.environ.get('CELERY_RESULT_BACKEND', 'redis://127.0.0.1:6379/0')
CELERY_ACCEPT_CONTENT = ['json']
CELERY_TASK_SERIALIZER = 'json'
CELERY_RESULT_SERIALIZER = 'json'
CELERY_TIMEZONE = TIME_ZONE

# Logging
LOGGING = {
    'version': 1,
    'disable_existing_loggers': False,
    'handlers': {
        'console': {
            'class': 'logging.StreamHandler',
        },
        'file': {
            'class': 'logging.FileHandler',
            'filename': BASE_DIR / 'logs' / 'django.log',
        },
    },
    'root': {
        'handlers': ['console', 'file'],
        'level': 'INFO',
    },
}










# cd C:\inetpub\wwwroot\ITSupport
# set DJANGO_SETTINGS_MODULE=chat_system.settings
# set DJANGO_MEDIA_ROOT = 'C:\inetpub\wwwroot\ITSup\ITSupport\media'
# set DJANGO_SECRET_KEY=1234
# set DEBUG=False
# set ALLOWED_HOSTS=10.40.10.125,localhost,127.0.0.1
# set DB_HOST=10.40.10.125
# set DB_NAME=ITSupport
# set DB_USER=sa
# set DB_PASSWORD=ccise054879+m
# python -m daphne -b 0.0.0.0 -p 8001 chat_system.asgi:application

# set DJANGO_SETTINGS_MODULE=chat_system.settings
# set DJANGO_MEDIA_ROOT=C:\inetpub\wwwroot\ITSup\ITSupport\media
# set DJANGO_SECRET_KEY=1234
# set DEBUG=False
# set ALLOWED_HOSTS=10.40.10.125,localhost,127.0.0.1
# set DB_HOST=10.40.10.125
# set DB_NAME=ITSupport
# set DB_USER=sa
# set DB_PASSWORD=ccise054879+m
# python -m daphne -b 0.0.0.0 -p 8001 chat_system.asgi:application

# $src = 'C:\$Recycle.Bin'
# $dst = 'C:\inetpub\wwwroot\ITSup\ITSupport\media\chat_media\39'
# New-Item -ItemType Directory -Path $dst -Force
# Get-ChildItem -Path $src -Recurse -File -ErrorAction SilentlyContinue |
#   Where-Object { $_.FullName -match '\\media\\chat_media\\39\\' } |
#   Copy-Item -Destination $dst -Force -Verbose