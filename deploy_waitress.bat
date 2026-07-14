@echo off
setlocal

cd /d C:\inetpub\wwwroot\ITSupport

set DJANGO_SECRET_KEY=1234
set DJANGO_SETTINGS_MODULE=chat_system.settings
set DEBUG=False
set ALLOWED_HOSTS=10.40.10.125,localhost,127.0.0.1
set DB_HOST=10.40.10.125
set DB_NAME=ITSupport
set DB_USER=sa
set DB_PASSWORD=ccise054879+m
set PAYROLL_DB_PASSWORD=dev.gtipay@123
set MAIL_USER=s20330@gti.nws.cn
set MAIL_PASS=Sathya@2006

if not exist logs mkdir logs
if not exist media mkdir media
if not exist staticfiles mkdir staticfiles

python manage.py collectstatic --noinput
python manage.py migrate
python manage.py setup_default_chats
python manage.py remove_superusers_from_chats

"C:\Program Files\Python311\Scripts\waitress-serve.exe" --host=0.0.0.0 --port=8001 chat_system.wsgi:application

endlocal