/* Shared JavaScript */
function getFileName() {
  var path = window.location.pathname;
  return path.substring(path.lastIndexOf('/') + 1);
}

function showClass(cls) {
  var c = document.getElementById('class' + String(cls));
  var main = document.getElementById('classes');
  var file = getFileName();
  var pcp = document.getElementById('problem-class-pages');
  var isProblemsPage = file === 'problems.html' || file === '' || file === 'index.html';

  if (!c || !main) {
    return;
  }

  if (c.style.display === 'none' || c.style.display === '') {
    c.style.display = 'block';
    main.style.display = 'none';

    if (isProblemsPage) {
      if (pcp) {
        pcp.style.display = 'block';
      }
      if (typeof window.syncProblemsPageMobileState === 'function') {
        window.syncProblemsPageMobileState(cls, 'units');
      }
    } else if (file === 'generator.html') {
      if (typeof selectFirstUnit === 'function') {
        selectFirstUnit(cls);
      }
      if (typeof updateShoppingCart === 'function') {
        updateShoppingCart(cls);
      }
    }
  } else {
    c.style.display = 'none';

    if (file === 'generator.html') {
      main.style.display = 'flex';
    } else if (isProblemsPage) {
      if (typeof window.resetProblemsPageSelection === 'function') {
        window.resetProblemsPageSelection(cls);
      }
      main.style.display = 'block';
      if (pcp) {
        pcp.style.display = 'none';
      }
    }
  }
}

function selectFirstUnit(cls) {
  var firstTab = document.getElementById('defaulttab-' + String(cls));
  if (firstTab) {
    firstTab.click();
  }
}

var cachedCatalog = null;
var CATALOG_SESSION_CACHE_KEY = 'catalogData:v2';

async function getCatalogData() {
  if (cachedCatalog) {
    return cachedCatalog;
  }

  try {
    var cachedRaw = sessionStorage.getItem(CATALOG_SESSION_CACHE_KEY);
    if (cachedRaw) {
      var cachedParsed = JSON.parse(cachedRaw);
      if (Array.isArray(cachedParsed)) {
        cachedCatalog = cachedParsed;
        return cachedCatalog;
      }
    }
  } catch (error) {
    console.warn('Catalog session cache read failed:', error);
  }

  var response = await fetch('/api/catalog/', { headers: { Accept: 'application/json' } });
  if (!response.ok) {
    throw new Error('API returned ' + response.status + ': ' + response.statusText);
  }

  var payload = await response.json();
  cachedCatalog = payload.classes || [];

  try {
    sessionStorage.setItem(CATALOG_SESSION_CACHE_KEY, JSON.stringify(cachedCatalog));
  } catch (error) {
    console.warn('Catalog session cache write failed:', error);
  }

  return cachedCatalog;
}

function renderCatalogError(hostEl, message) {
  if (!hostEl) {
    return;
  }
  hostEl.innerHTML = '';
  var error = document.createElement('p');
  error.textContent = message;
  hostEl.appendChild(error);
}

function getCookie(name) {
  var value = '; ' + document.cookie;
  var parts = value.split('; ' + name + '=');
  if (parts.length === 2) {
    return parts.pop().split(';').shift();
  }
  return '';
}

function formatLastSyncDate(dateString) {
  if (!dateString) {
    return 'Never';
  }

  var parsed = new Date(dateString);
  if (Number.isNaN(parsed.getTime())) {
    return 'Unknown';
  }

  return parsed.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

async function setupFooterLastSync() {
  var footerEl = document.getElementById('last-sync-footer');
  if (!footerEl) {
    return;
  }

  try {
    var response = await fetch('/api/sync/status/', { headers: { Accept: 'application/json' } });
    if (!response.ok) {
      footerEl.textContent = 'Last Sync: Unavailable';
      return;
    }

    var payload = await response.json();
    footerEl.textContent = 'Last Sync: ' + formatLastSyncDate(payload.last_synced_at);
  } catch (error) {
    console.error('Footer sync status error:', error);
    footerEl.textContent = 'Last Sync: Unavailable';
  }
}

document.addEventListener('DOMContentLoaded', function () {
  setupFooterLastSync();
});
