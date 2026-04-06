from pathlib import Path

from django import template
from django.conf import settings
from django.templatetags.static import static

register = template.Library()


@register.simple_tag
def versioned_static(asset_path):
    asset_url = static(asset_path)
    source_path = Path(settings.BASE_DIR) / "BankApp" / "static" / Path(asset_path)

    try:
        version = str(int(source_path.stat().st_mtime))
    except OSError:
        return asset_url

    separator = "&" if "?" in asset_url else "?"
    return f"{asset_url}{separator}v={version}"