# PythonAnywhere Deployment Guide (Beginner Friendly)

This guide walks you through deploying this Django project to PythonAnywhere from scratch.

It is designed for people who are new to hosting and command-line tools.

## Before You Start

You will need:
- A zipped copy of this project (for example: ProblemBank.zip)
- Your local project dependencies already listed in requirements.txt
- 20 to 45 minutes for first deployment

Important:
- PythonAnywhere runs Linux commands in a Bash console.
- Do not use Windows PowerShell commands on PythonAnywhere.

---

## 1) Create a PythonAnywhere Account

1. Go to https://www.pythonanywhere.com/
2. Click Pricing and choose a plan (free or paid).
3. Click Sign up and create an account.
4. Verify your email if prompted.
5. Log in to the PythonAnywhere Dashboard.

After account creation, note these values:

- PythonAnywhere username: <PA_USERNAME>
- Your web domain will be: <PA_USERNAME>.pythonanywhere.com

---

## 2) Upload Your Project ZIP

1. In PythonAnywhere, open the Files tab.
2. Navigate to your home directory: /home/<PA_USERNAME>/
3. Use Upload a file and upload your ZIP (example: ProblemBank.zip).
4. Open a Bash console from the Consoles tab.
5. Run:

```bash
cd /home/<PA_USERNAME>
unzip ProblemBank.zip
```

If the unzip creates an extra nested folder, make sure manage.py ends up at:

```text
/home/<PA_USERNAME>/ProblemBank/manage.py
```

If needed, rename/move folders so this path is correct.

---

## 3) Set Project Variables (Recommended)

Run this once in Bash so later commands are easy to copy/paste:

```bash
export PA_USERNAME="<PA_USERNAME>"
export PROJECT_NAME="ProblemBank"
export PROJECT_PATH="/home/$PA_USERNAME/$PROJECT_NAME"
export VENV_PATH="/home/$PA_USERNAME/.virtualenvs/problembank-env"
export DOMAIN="$PA_USERNAME.pythonanywhere.com"
```

Check that the project path is correct:

```bash
ls "$PROJECT_PATH/manage.py"
```

---

## 4) Create a Virtual Environment and Install Dependencies

In Bash:

```bash
mkvirtualenv --python=python3.13 problembank-env
workon problembank-env
cd "$PROJECT_PATH"
pip install --upgrade pip
pip install -r requirements.txt
```

If python3.13 is not available on your account, use the latest available Python version from PythonAnywhere.

---

## 5) Create the Web App in PythonAnywhere

1. Go to the Web tab.
2. Click Add a new web app.
3. Choose your domain: <PA_USERNAME>.pythonanywhere.com
4. Select Manual configuration.
5. Choose the same Python version used for your virtualenv.

Now configure:

- Source code: /home/<PA_USERNAME>/ProblemBank
- Working directory: /home/<PA_USERNAME>/ProblemBank
- Virtualenv: /home/<PA_USERNAME>/.virtualenvs/problembank-env

---

## 6) Configure the WSGI File

In the Web tab, open the WSGI configuration file and replace its content with:

```python
import os
import sys

path = '/home/<PA_USERNAME>/ProblemBank'
if path not in sys.path:
    sys.path.append(path)

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'ProblemBank.settings')

from django.core.wsgi import get_wsgi_application
application = get_wsgi_application()
```

Save the WSGI file.

---

## 7) Add Environment Variables (Security + Settings)

In Web tab -> Environment variables, add these keys and values:

```text
DJANGO_DEBUG=false
DJANGO_SECRET_KEY=<GENERATE_A_NEW_SECRET_KEY>
DJANGO_ALLOWED_HOSTS=<PA_USERNAME>.pythonanywhere.com
DJANGO_CSRF_TRUSTED_ORIGINS=https://<PA_USERNAME>.pythonanywhere.com
DJANGO_SECURE_SSL_REDIRECT=true
DJANGO_SECURE_HSTS_SECONDS=31536000
DJANGO_SECURE_HSTS_INCLUDE_SUBDOMAINS=true
DJANGO_SECURE_HSTS_PRELOAD=false
```

Generate a secure secret key in Bash:

```bash
workon problembank-env
python -c "from django.core.management.utils import get_random_secret_key; print(get_random_secret_key())"
```

Copy the printed value into DJANGO_SECRET_KEY.

---

## 8) Configure Static Files Mapping

In Web tab -> Static files:

- URL: /static/
- Directory: /home/<PA_USERNAME>/ProblemBank/staticfiles

Save changes.

---

## 9) First Deployment Commands

Run this full block in Bash:

```bash
workon problembank-env
cd /home/<PA_USERNAME>/ProblemBank

# Ensure writable project, cache, and SQLite files
chmod -R u+rwX .
chmod u+rw db.sqlite3 2>/dev/null || true
rm -f db.sqlite3-wal db.sqlite3-shm 2>/dev/null || true

# Rebuild staticfiles directory cleanly
find . -maxdepth 1 -type d -name 'staticfiles_old_*' -exec rm -rf {} + 2>/dev/null || true
mv staticfiles staticfiles_old_$(date +%Y%m%d_%H%M%S) 2>/dev/null || true
mkdir -p staticfiles
chmod -R u+rwX staticfiles

# Django setup
python manage.py migrate
python manage.py collectstatic --noinput
python manage.py check --deploy
```

If any command fails, read the error and use the troubleshooting section below.

---

## 10) Sync the Problem Bank

This project uses cache at:

```text
/home/<PA_USERNAME>/ProblemBank/.cache/problem-bank
```

Run:

```bash
workon problembank-env
cd /home/<PA_USERNAME>/ProblemBank

chmod -R u+rwX .cache/problem-bank 2>/dev/null || true
rm -rf .cache/problem-bank

python manage.py sync_problem_bank
python manage.py sync_problem_bank --force
```

If you see "Repository unchanged; using database cache", that is a success message.

---

## 11) Reload the Website

1. Go to Web tab.
2. Click Reload.

Then open:

- https://<PA_USERNAME>.pythonanywhere.com

---

## 12) Quick Verification Checklist

In Bash:

```bash
workon problembank-env
cd /home/<PA_USERNAME>/ProblemBank
python manage.py shell -c "from BankApp.models import PhysicsClass,Unit,Problem,RepositoryFile; print('Classes:', PhysicsClass.objects.count()); print('Units:', Unit.objects.count()); print('Problems:', Problem.objects.count()); print('Files:', RepositoryFile.objects.count())"
```

In the browser:
- Open /problems.html
- Confirm classes and units load
- Confirm static styling is applied

---

## 13) Routine Redeploy After Updates

If you uploaded new code ZIP or edited files in PythonAnywhere, run:

```bash
workon problembank-env
cd /home/<PA_USERNAME>/ProblemBank

# Only if dependencies changed
pip install -r requirements.txt

# Only if model/schema changed
python manage.py migrate

# If static assets changed (CSS/JS/images)
find . -maxdepth 1 -type d -name 'staticfiles_old_*' -exec rm -rf {} + 2>/dev/null || true
mv staticfiles staticfiles_old_$(date +%Y%m%d_%H%M%S) 2>/dev/null || true
mkdir -p staticfiles
chmod -R u+rwX staticfiles
python manage.py collectstatic --noinput

# If parsing/sync logic changed
python manage.py sync_problem_bank --force

# Final checks
python manage.py check --deploy
python manage.py sync_problem_bank
```

Then click Reload in Web tab.

---

## 14) Troubleshooting (Copy/Paste Fixes)

### A) collectstatic permission error

Error includes PermissionError and staticfiles path.

```bash
cd /home/<PA_USERNAME>/ProblemBank
find . -maxdepth 1 -type d -name 'staticfiles_old_*' -exec rm -rf {} + 2>/dev/null || true
mv staticfiles staticfiles_old_$(date +%Y%m%d_%H%M%S) 2>/dev/null || true
mkdir -p staticfiles
chmod -R u+rwX staticfiles
workon problembank-env
python manage.py collectstatic --noinput
```

### B) SQLite readonly database error

Error includes sqlite3.OperationalError: attempt to write a readonly database.

```bash
cd /home/<PA_USERNAME>/ProblemBank
rm -f db.sqlite3-wal db.sqlite3-shm
chmod u+rw db.sqlite3
chmod u+rwx .
workon problembank-env
python manage.py migrate
python manage.py sync_problem_bank
```

### C) Cache/git unlink permission denied in sync

```bash
cd /home/<PA_USERNAME>/ProblemBank
chmod -R u+rwX .cache/problem-bank 2>/dev/null || true
rm -rf .cache/problem-bank
workon problembank-env
python manage.py sync_problem_bank
```

### D) 403 on API endpoints

Checklist:
1. Confirm latest code is deployed.
2. Confirm DJANGO_CSRF_TRUSTED_ORIGINS is exactly https://<PA_USERNAME>.pythonanywhere.com
3. Click Reload in Web tab.
4. Hard refresh browser (Ctrl+Shift+R).

### E) Changes not showing live

```bash
workon problembank-env
cd /home/<PA_USERNAME>/ProblemBank
python manage.py collectstatic --noinput
```

Then:
1. Reload in Web tab.
2. Hard refresh browser.
3. Confirm you edited files in /home/<PA_USERNAME>/ProblemBank (not another copy).

---

## 15) Scheduled Daily Sync (Optional)

In Tasks tab, add this command:

```bash
/home/<PA_USERNAME>/.virtualenvs/problembank-env/bin/python /home/<PA_USERNAME>/ProblemBank/manage.py sync_problem_bank
```

---

## 16) Ownership/Permissions Deep Fix

If permissions still fail:

```bash
cd /home/<PA_USERNAME>/ProblemBank
find . -type d -exec chmod u+rwx {} \;
find . -type f -exec chmod u+rw {} \;
chmod u+rw db.sqlite3 2>/dev/null || true
chmod -R u+rwX .cache 2>/dev/null || true
chmod -R u+rwX staticfiles 2>/dev/null || true
```

Check for wrong ownership:

```bash
find /home/<PA_USERNAME>/ProblemBank ! -user "$USER" -printf '%u:%g %p\n' | head -100
```

If files are not owned by your account, contact PythonAnywhere support and provide this path:

```text
/home/<PA_USERNAME>/ProblemBank
```

---

## Notes

- PDF features may require pdflatex, which may not be available on all plans.
- If pdflatex is unavailable, .tex workflows may still work while PDF generation fails.
- Keep DJANGO_SECRET_KEY private.
- Never commit secrets into the project files.

