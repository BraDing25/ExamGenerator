# Deploying ExamGenerator to PythonAnywhere (Smooth Version)

This guide is optimized for the exact issues encountered during deployment.

Important:
- Run Linux commands in a PythonAnywhere Bash console, not Windows PowerShell.
- PythonAnywhere username used below: `BradyDin25`.

## 0) One-time paths
- Project path: `/home/BradyDin25/ExamGenerator`
- Virtualenv: `/home/BradyDin25/.virtualenvs/examgen-env`
- Domain: `BradyDin25.pythonanywhere.com`

## 1) Upload project
- Upload or clone so `manage.py` is at `/home/BradyDin25/ExamGenerator/manage.py`.

## 2) Create virtualenv and install dependencies
In PythonAnywhere Bash:

```bash
mkvirtualenv --python=python3.13 examgen-env
workon examgen-env
cd ~/ExamGenerator
pip install -r requirements.txt
```

## 3) Configure web app (Web tab)

### 3.1 Source and WSGI
- Source code: `/home/BradyDin25/ExamGenerator`
- Working directory: `/home/BradyDin25/ExamGenerator`

Edit WSGI file to include:

```python
import os
import sys

path = '/home/BradyDin25/ExamGenerator'
if path not in sys.path:
    sys.path.append(path)

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'ExamGenerator.settings')

from django.core.wsgi import get_wsgi_application
application = get_wsgi_application()
```

### 3.2 Environment variables
In PythonAnywhere Web tab -> Environment variables, set these exact names and values:

```text
DJANGO_DEBUG=false
DJANGO_SECRET_KEY=<paste-your-generated-secret-key-here>
DJANGO_ALLOWED_HOSTS=BradyDin25.pythonanywhere.com
DJANGO_CSRF_TRUSTED_ORIGINS=https://BradyDin25.pythonanywhere.com
DJANGO_SECURE_SSL_REDIRECT=true
DJANGO_SECURE_HSTS_SECONDS=31536000
DJANGO_SECURE_HSTS_INCLUDE_SUBDOMAINS=true
DJANGO_SECURE_HSTS_PRELOAD=false
```

Generate a strong secret key in PythonAnywhere Bash:

```bash
python -c "from django.core.management.utils import get_random_secret_key; print(get_random_secret_key())"
```

### 3.3 Static files mapping
- URL: `/static/`
- Directory: `/home/BradyDin25/ExamGenerator/staticfiles`

## 4) First deployment commands (safe copy/paste block)
Run in PythonAnywhere Bash:

```bash
workon examgen-env
cd ~/ExamGenerator

# Ensure writable project, cache, and DB
chmod -R u+rwX ~/ExamGenerator
chmod u+rw ~/ExamGenerator/db.sqlite3 2>/dev/null || true
rm -f ~/ExamGenerator/db.sqlite3-wal ~/ExamGenerator/db.sqlite3-shm 2>/dev/null || true

# Fresh staticfiles directory (avoids PermissionError during collectstatic)
mv ~/ExamGenerator/staticfiles ~/ExamGenerator/staticfiles_old_$(date +%Y%m%d_%H%M%S) 2>/dev/null || true
mkdir -p ~/ExamGenerator/staticfiles
chmod -R u+rwX ~/ExamGenerator/staticfiles

# Django setup
python manage.py migrate
python manage.py collectstatic --noinput
python manage.py check --deploy
```

## 4.1) Permission reset command (run any time you get Permission denied)
Run in PythonAnywhere Bash:

```bash
cd ~/ExamGenerator

# Give yourself rwx on all directories and rw on all files
find . -type d -exec chmod u+rwx {} \;
find . -type f -exec chmod u+rw {} \;

# Common writable paths for Django runtime
chmod u+rw db.sqlite3 2>/dev/null || true
chmod -R u+rwX .cache 2>/dev/null || true
chmod -R u+rwX staticfiles 2>/dev/null || true

# Optional hardening: remove group/other access
chmod -R go-rwx .
find . -type d -exec chmod u+rwx {} \;
find . -type f -exec chmod u+rw {} \;
```

If permissions still fail, check for wrong ownership:

```bash
find ~/ExamGenerator ! -user "$USER" -printf '%u:%g %p\n' | head -100
```

If any files are shown, contact PythonAnywhere support to reset ownership for:
- `/home/BradyDin25/ExamGenerator`

## 5) Problem bank sync (with correct cache path)
The app uses this cache path:
- `~/ExamGenerator/.cache/problem-bank`

Run:

```bash
workon examgen-env
cd ~/ExamGenerator

# Clear sync cache safely (correct path)
chmod -R u+rwX .cache/problem-bank 2>/dev/null || true
rm -rf .cache/problem-bank

# Sync
python manage.py sync_problem_bank

# Force rebuild catalog after sync logic/code changes (recommended after deploy updates)
python manage.py sync_problem_bank --force
```

If output is:
- `Repository unchanged; using database cache`

That is success, not an error.

## 6) Reload web app
In PythonAnywhere Web tab, click Reload.

## 7) Verify quickly
In Bash:

```bash
workon examgen-env
cd ~/ExamGenerator
python manage.py shell -c "from GeneratorApp.models import PhysicsClass,Unit,Problem,RepositoryFile; print('Classes:', PhysicsClass.objects.count()); print('Units:', Unit.objects.count()); print('Problems:', Problem.objects.count()); print('Files:', RepositoryFile.objects.count())"
```

Then test website:
- Open Generator page
- Try Preview Exam
- Try Generate Exam

## 8) Redeploy updates (routine, direct edits on PythonAnywhere)
If you edit files directly on PythonAnywhere (Files tab), you usually do not need to re-upload the project.

Run this in PythonAnywhere Bash after your edits:

```bash
workon examgen-env
cd ~/ExamGenerator

# Only needed if dependencies changed
pip install -r requirements.txt

# Only needed if models changed
python manage.py migrate

# Rebuild static files if CSS/JS/templates/static assets changed
mv staticfiles staticfiles_old_$(date +%Y%m%d_%H%M%S) 2>/dev/null || true
mkdir -p staticfiles
chmod -R u+rwX staticfiles
python manage.py collectstatic --noinput

# Good final checks
python manage.py check --deploy
python manage.py sync_problem_bank

# If sync/parsing logic changed in code, force rebuild from current repo contents
python manage.py sync_problem_bank --force
```

Then click Reload in the Web tab.

## 9) Error quick fixes

### A) `PermissionError ... staticfiles/...` during collectstatic
Run:

```bash
cd ~/ExamGenerator
mv staticfiles staticfiles_old_$(date +%Y%m%d_%H%M%S) 2>/dev/null || true
mkdir -p staticfiles
chmod -R u+rwX staticfiles
workon examgen-env
python manage.py collectstatic --noinput
```

### B) `sqlite3.OperationalError: attempt to write a readonly database`
Run:

```bash
cd ~/ExamGenerator
rm -f db.sqlite3-wal db.sqlite3-shm
chmod u+rw db.sqlite3
chmod u+rwx .
workon examgen-env
python manage.py migrate
python manage.py sync_problem_bank
```

### C) Git sync `unable to unlink old ... Permission denied`
Run:

```bash
cd ~/ExamGenerator
chmod -R u+rwX .cache/problem-bank 2>/dev/null || true
rm -rf .cache/problem-bank
workon examgen-env
python manage.py sync_problem_bank
```

### D) 403 on `/api/exams/preview/` or `/api/exams/generate/`
Checklist:
1. Confirm latest code is deployed (includes CSRF cookie fix in `generator_view`).
2. Confirm `DJANGO_CSRF_TRUSTED_ORIGINS=https://BradyDin25.pythonanywhere.com` is set.
3. Reload web app.
4. Hard refresh browser (Ctrl+Shift+R).

## 10) Scheduled sync task
PythonAnywhere Tasks tab command:

```bash
/home/BradyDin25/.virtualenvs/examgen-env/bin/python /home/BradyDin25/ExamGenerator/manage.py sync_problem_bank
```

## Notes
- PDF generation requires `pdflatex`. If unavailable on your PythonAnywhere plan, PDF preview/generation may fail while `.tex` output can still work.
- If files are not owned by your user and cannot be changed/deleted, contact PythonAnywhere support with the exact path.
