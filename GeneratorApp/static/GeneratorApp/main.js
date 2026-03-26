/* Global JavaScript */
function getFileName() {
    let path = window.location.pathname;
    let fileName = path.substring(path.lastIndexOf('/') + 1);
    return fileName;
}

function showClass(cls) {
  const c = document.getElementById('class' + String(cls));
  const main = document.getElementById('classes');
  const file = getFileName();
  const pcp = document.getElementById('problem-class-pages');

  if (!c || !main) {
    return;
  }

  if (c.style.display === "none" || c.style.display === "") {
      c.style.display = "block";
      main.style.display = "none";
      if (file === "problems.html") {
          pcp.style.display = "block";
      } else if (file === "generator.html") {
        selectFirstUnit(cls);
        updateShoppingCart(cls);
      }
  } else {
      c.style.display = "none";
      if (file === "generator.html") {
          main.style.display = "flex";
      } else if (file === "problems.html") {
          main.style.display = "block";
          pcp.style.display = "none";
      }
  }
}

function selectFirstUnit(cls) {
  const firstTab = document.getElementById('defaulttab-' + String(cls));
  if (firstTab) {
    firstTab.click();
  }
}

let cachedCatalog = null;
let cachedProblemQuestionData = new Map();
let buttonLockState = null;
const CATALOG_SESSION_CACHE_KEY = 'catalogData:v2';

function lockAllButtons() {
  if (buttonLockState) {
    return;
  }

  buttonLockState = new Map();
  const buttons = document.querySelectorAll('button');
  buttons.forEach(function (btn) {
    buttonLockState.set(btn, btn.disabled);
    btn.disabled = true;
  });
}

function unlockAllButtons() {
  if (!buttonLockState) {
    return;
  }

  buttonLockState.forEach(function (wasDisabled, btn) {
    btn.disabled = wasDisabled;
  });
  buttonLockState = null;
}

async function getCatalogData() {
  if (cachedCatalog) {
    return cachedCatalog;
  }

  try {
    const cachedRaw = sessionStorage.getItem(CATALOG_SESSION_CACHE_KEY);
    if (cachedRaw) {
      const cachedParsed = JSON.parse(cachedRaw);
      if (Array.isArray(cachedParsed)) {
        cachedCatalog = cachedParsed;
        return cachedCatalog;
      }
    }
  } catch (error) {
    console.warn('Catalog session cache read failed:', error);
  }

  try {
    const response = await fetch('/api/catalog/', { headers: { 'Accept': 'application/json' } });
    
    if (!response.ok) {
      throw new Error(`API returned ${response.status}: ${response.statusText}`);
    }

    const payload = await response.json();
    cachedCatalog = payload.classes || [];

    try {
      sessionStorage.setItem(CATALOG_SESSION_CACHE_KEY, JSON.stringify(cachedCatalog));
    } catch (error) {
      console.warn('Catalog session cache write failed:', error);
    }

    return cachedCatalog;
  } catch (error) {
    console.error('getCatalogData error:', error.message);
    throw error;
  }
}

function renderCatalogError(hostEl, message) {
  if (!hostEl) {
    return;
  }
  hostEl.innerHTML = '';
  const error = document.createElement('p');
  error.textContent = message;
  hostEl.appendChild(error);
}

function getCookie(name) {
  const value = `; ${document.cookie}`;
  const parts = value.split(`; ${name}=`);
  if (parts.length === 2) {
    return parts.pop().split(';').shift();
  }
  return '';
}

function getCurrentClassContainer() {
  const genbody2 = document.getElementById('genbody2');
  if (!genbody2) {
    return null;
  }

  return Array.from(genbody2.querySelectorAll('[id^="class"]'))
    .find(function (el) { return el.id !== 'classes' && el.style.display !== 'none'; }) || null;
}

function collectExamSelections() {
  const classContainer = getCurrentClassContainer();
  if (!classContainer) {
    return [];
  }

  const selections = [];
  const selectedInputs = classContainer.querySelectorAll('input[type="number"][data-yaml-path]');
  selectedInputs.forEach(function (input) {
    const count = parseInt(input.value, 10);
    if (Number.isNaN(count) || count <= 0) {
      return;
    }

    selections.push({
      yaml_path: input.dataset.yamlPath,
      count: count,
      unit_name: input.dataset.unitName || '',
      problem_title: input.dataset.problem || '',
    });
  });

  return selections;
}

async function handleGenerateExamClick() {
  const button = document.getElementById('cart-button');
  const examInput = document.getElementById('exam-count-input');
  if (!button || !examInput) {
    return;
  }

  const selections = collectExamSelections();
  if (!selections.length) {
    alert('Select at least one problem before generating exams.');
    return;
  }

  const examCount = parseInt(examInput.value, 10);
  if (Number.isNaN(examCount) || examCount < 1) {
    alert('Enter a valid number of exams.');
    return;
  }

  const previousLabel = button.textContent;
  lockAllButtons();
  button.classList.add('is-busy');
  button.textContent = 'Generating...';

  try {
    const response = await fetch('/api/exams/generate/', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRFToken': getCookie('csrftoken'),
      },
      body: JSON.stringify({
        exam_count: examCount,
        selections: selections,
      }),
    });

    if (!response.ok) {
      let message = `Generation failed (${response.status}).`;
      try {
        const payload = await response.json();
        if (payload && payload.message) {
          message = payload.message;
        }
      } catch (error) {
        // Ignore parse failures and use generic message.
      }
      throw new Error(message);
    }

    const blob = await response.blob();
    const disposition = response.headers.get('Content-Disposition') || '';
    const match = disposition.match(/filename="?([^\"]+)"?/i);
    const filename = match ? match[1] : 'generated_exams.zip';

    const url = window.URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.URL.revokeObjectURL(url);
  } catch (error) {
    console.error('Exam generation error:', error);
    alert(error.message || 'Unable to generate exams right now.');
  } finally {
    button.classList.remove('is-busy');
    button.textContent = previousLabel;
    unlockAllButtons();
  }
}

async function handlePreviewExamClick() {
  const button = document.getElementById('preview-button');
  if (!button) {
    return;
  }

  const selections = collectExamSelections();
  if (!selections.length) {
    alert('Select at least one problem before previewing.');
    return;
  }

  const previousLabel = button.textContent;
  button.disabled = true;
  button.textContent = 'Building Preview...';

  try {
    const response = await fetch('/api/exams/preview/', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRFToken': getCookie('csrftoken'),
      },
      body: JSON.stringify({ selections: selections }),
    });

    if (!response.ok) {
      let message = `Preview failed (${response.status}).`;
      try {
        const payload = await response.json();
        if (payload && payload.message) {
          message = payload.message;
        }
      } catch (error) {
        // Ignore parse failures and use generic message.
      }
      throw new Error(message);
    }

    const blob = await response.blob();
    const url = window.URL.createObjectURL(blob);
    window.open(url, '_blank', 'noopener,noreferrer');
    setTimeout(function () {
      window.URL.revokeObjectURL(url);
    }, 30000);
  } catch (error) {
    console.error('Preview generation error:', error);
    alert(error.message || 'Unable to generate preview right now.');
  } finally {
    button.disabled = false;
    button.textContent = previousLabel;
  }
}

function setupGenerateExamButton() {
  const button = document.getElementById('cart-button');
  if (!button) {
    return;
  }
  button.addEventListener('click', handleGenerateExamClick);
}

function setupPreviewExamButton() {
  const button = document.getElementById('preview-button');
  if (!button) {
    return;
  }
  button.addEventListener('click', handlePreviewExamClick);
}

function formatLastSyncDate(dateString) {
  if (!dateString) {
    return 'Never';
  }

  const parsed = new Date(dateString);
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
  const footerEl = document.getElementById('last-sync-footer');
  if (!footerEl) {
    return;
  }

  try {
    const response = await fetch('/api/sync/status/', { headers: { Accept: 'application/json' } });
    if (!response.ok) {
      footerEl.textContent = 'Last Sync: Unavailable';
      return;
    }

    const payload = await response.json();
    footerEl.textContent = `Last Sync: ${formatLastSyncDate(payload.last_synced_at)}`;
  } catch (error) {
    console.error('Footer sync status error:', error);
    footerEl.textContent = 'Last Sync: Unavailable';
  }
}




/* Problems Page JavaScript */
function setPanelHeight(panel) {
  panel.style.maxHeight = panel.scrollHeight + "px";
}

function syncProblemListPaneHeight(panel) {
  if (!panel) {
    return;
  }

  const listPane = panel.querySelector('.problem-list-pane');
  const listEl = panel.querySelector('.problem-question-list');
  const detailPane = panel.querySelector('.problem-detail-pane');
  const previewContentEl = panel.querySelector('.problem-detail-content[data-tab="preview"]');
  const yamlContentEl = panel.querySelector('.problem-detail-content[data-tab="yaml"]');
  const yamlEl = panel.querySelector('.problem-detail-yaml');

  if (!listPane || !listEl || !detailPane) {
    return;
  }

  if (previewContentEl) {
    const measuredPreviewHeight = previewContentEl.offsetHeight;
    if (measuredPreviewHeight > 0) {
      panel.dataset.previewHeight = String(measuredPreviewHeight);
    }
  }

  const savedPreviewHeight = Number(panel.dataset.previewHeight || 0);
  const previewHeight = Math.max(260, savedPreviewHeight || detailPane.offsetHeight);

  if (yamlContentEl) {
    yamlContentEl.style.height = previewHeight + 'px';
    yamlContentEl.style.minHeight = previewHeight + 'px';
    yamlContentEl.style.maxHeight = previewHeight + 'px';
  }
  if (yamlEl) {
    yamlEl.style.height = '100%';
    yamlEl.style.maxHeight = '100%';
  }

  const targetHeight = Math.max(260, detailPane.offsetHeight);

  listPane.style.height = targetHeight + 'px';
  listPane.style.maxHeight = targetHeight + 'px';

  const paneRect = listPane.getBoundingClientRect();
  const listRect = listEl.getBoundingClientRect();
  const listOffsetTop = Math.max(0, Math.ceil(listRect.top - paneRect.top));
  const listHeight = Math.max(120, targetHeight - listOffsetTop - 8);
  listEl.style.maxHeight = listHeight + 'px';
}

async function getProblemQuestions(yamlPath) {
  if (!yamlPath) {
    return [];
  }

  if (cachedProblemQuestionData.has(yamlPath)) {
    return cachedProblemQuestionData.get(yamlPath);
  }

  const response = await fetch('/api/problems/questions/?yaml_path=' + encodeURIComponent(yamlPath), {
    headers: { Accept: 'application/json' },
  });

  if (!response.ok) {
    throw new Error('Unable to load questions for this problem.');
  }

  const payload = await response.json();
  const questions = Array.isArray(payload.questions) ? payload.questions : [];
  cachedProblemQuestionData.set(yamlPath, questions);
  return questions;
}

function activateProblemDetailTab(panel, tabName) {
  if (!panel) {
    return;
  }

  const tabs = panel.querySelectorAll('.problem-detail-tab');
  tabs.forEach(function (tab) {
    tab.classList.toggle('active', tab.dataset.tab === tabName);
  });

  const panes = panel.querySelectorAll('.problem-detail-content');
  panes.forEach(function (pane) {
    pane.style.display = pane.dataset.tab === tabName ? 'block' : 'none';
  });

  window.requestAnimationFrame(function () {
    syncProblemListPaneHeight(panel);
  });
}

function renderProblemDetail(panel, question) {
  if (!panel || !question) {
    return;
  }

  const titleEl = panel.querySelector('.problem-detail-title');
  const outputEl = panel.querySelector('.problem-detail-question');
  const answerEl = panel.querySelector('.problem-detail-answer');
  const figureEl = panel.querySelector('.problem-detail-figure');
  const latexEl = panel.querySelector('.problem-detail-latex');
  const yamlEl = panel.querySelector('.problem-detail-yaml');

  if (titleEl) {
    titleEl.textContent = question.label || ('Problem ' + String(question.index || ''));
  }

  if (outputEl) {
    outputEl.textContent = question.output || '';

    if (answerEl) {
      const answerText = question.answer || 'Not provided in this item.';
      answerEl.innerHTML = '<strong>Correct Answer:</strong>\n' + answerText;
    }

    if (figureEl) {
      figureEl.onload = function () {
        syncProblemListPaneHeight(panel);
      };
      figureEl.onerror = function () {
        syncProblemListPaneHeight(panel);
      };

      if (question.figure_url) {
        figureEl.src = question.figure_url;
        figureEl.style.display = 'block';

        if (figureEl.complete) {
          syncProblemListPaneHeight(panel);
        }
      } else {
        figureEl.removeAttribute('src');
        figureEl.style.display = 'none';
        syncProblemListPaneHeight(panel);
      }
    }

    if (window.MathJax && typeof window.MathJax.typesetPromise === 'function') {
      if (typeof window.MathJax.typesetClear === 'function') {
        window.MathJax.typesetClear([outputEl, answerEl]);
      }
      window.MathJax.typesetPromise([outputEl, answerEl])
        .then(function () {
          syncProblemListPaneHeight(panel);
        })
        .catch(function (err) {
          console.error('MathJax typeset error:', err);
          syncProblemListPaneHeight(panel);
        });
    } else {
      syncProblemListPaneHeight(panel);
    }
  }

  if (latexEl) {
    latexEl.textContent = question.latex_source || '';
  }

  if (yamlEl) {
    yamlEl.textContent = question.yaml_source || '';
  }
}

function renderProblemQuestionList(classContainer, questions) {
  const listEl = classContainer.querySelector('.problem-question-list');
  const panel = classContainer.querySelector('.problem-browser-panel');
  if (!listEl || !panel) {
    return;
  }

  listEl.innerHTML = '';
  if (!questions.length) {
    const emptyState = document.createElement('p');
    emptyState.className = 'problem-browser-empty';
    emptyState.textContent = 'No question entries were found in this YAML file.';
    listEl.appendChild(emptyState);

    renderProblemDetail(panel, {
      label: 'No question selected',
      output: '',
      answer: '',
      figure_url: '',
      latex_source: '',
      yaml_source: '',
    });
    return;
  }

  questions.forEach(function (question, index) {
    const itemButton = document.createElement('button');
    itemButton.type = 'button';
    itemButton.className = 'problem-question-item';
    itemButton.textContent = question.label || ('Problem ' + String(index + 1));

    itemButton.addEventListener('click', function () {
      listEl.querySelectorAll('.problem-question-item').forEach(function (node) {
        node.classList.remove('active');
      });
      itemButton.classList.add('active');
      activateProblemDetailTab(panel, 'preview');
      renderProblemDetail(panel, question);
    });

    listEl.appendChild(itemButton);
  });

  const firstButton = listEl.querySelector('.problem-question-item');
  if (firstButton) {
    firstButton.click();
  }
}

document.addEventListener('click', function (evt) {
  const tab = evt.target.closest('.problem-detail-tab');
  if (tab) {
    const panel = tab.closest('.problem-browser-panel');
    activateProblemDetailTab(panel, tab.dataset.tab || 'preview');
    return;
  }

  if (!evt.target.classList.contains('accordion')) {
    return;
  }

  evt.target.classList.toggle('active');
  var panel = evt.target.nextElementSibling;
  if (!panel) {
    return;
  }

  if (panel.style.maxHeight) {
    panel.style.maxHeight = null;
  } else {
    setPanelHeight(panel);

    var imgs = panel.querySelectorAll('img');
    imgs.forEach(function (img) {
      if (!img.complete) {
        img.addEventListener('load', function () {
          if (panel.style.maxHeight) {
            setPanelHeight(panel);
          }
        }, { once: true });
      }
    });
  }
});

window.addEventListener("resize", function() {
  var activeAccordions = document.querySelectorAll('.accordion.active');
  activeAccordions.forEach(function (accordion) {
    var panel = accordion.nextElementSibling;
    if (panel && panel.style.maxHeight) {
      setPanelHeight(panel);
    }
  });
});

function generateProblemsPage(classes) {
  const classesHost = document.getElementById('problem-classes') || document.getElementById('classes');
  const classPagesHost = document.getElementById('problem-class-pages');
  const classGrid = classesHost && classesHost.id === 'classes' ? classesHost.querySelector('div') : classesHost;

  if (!classGrid || !classPagesHost) {
    return;
  }

  classGrid.innerHTML = '';
  classPagesHost.innerHTML = '';

  if (!classes.length) {
    renderCatalogError(classGrid, 'No classes found in the local database yet.');
    return;
  }

  classes.forEach(function (cls, classIndex) {
    const i = classIndex + 1;

    const classCardWrap = document.createElement('div');
    classCardWrap.style.display = 'flex';
    classCardWrap.style.flexDirection = 'row';

    const classCard = document.createElement('div');
    classCard.className = 'class-select';

    const heading = document.createElement('h1');
    heading.textContent = cls.name;

    const thumbnailWrap = document.createElement('div');
    thumbnailWrap.className = 'thumbnail';

    const thumbnail = document.createElement('img');
    thumbnail.src = cls.class_thumbnail_url || 'https://placehold.co/500x300/cccccc/888888?text=No+Image';
    thumbnail.alt = cls.name + ' Thumbnail';
    thumbnail.loading = 'lazy';

    const selectButton = document.createElement('button');
    selectButton.className = 'select-button';
    selectButton.textContent = 'Select';
    selectButton.onclick = function () { showClass(i); };

    thumbnailWrap.appendChild(thumbnail);
    classCard.appendChild(heading);
    classCard.appendChild(thumbnailWrap);
    classCard.appendChild(selectButton);
    classCardWrap.appendChild(classCard);
    classGrid.appendChild(classCardWrap);

    const classContainer = document.createElement('div');
    classContainer.className = 'container problem-class-page';
    classContainer.id = 'class' + String(i);
    classContainer.style.display = 'none';

    const backButton = document.createElement('button');
    backButton.className = 'back';
    backButton.textContent = 'Back to Classes';
    backButton.onclick = function () { showClass(i); };
    classContainer.appendChild(backButton);

    const classHeading = document.createElement('h2');
    classHeading.className = 'problem-class-heading';
    classHeading.textContent = cls.name + ' Problem Browser';

    const selectionPage = document.createElement('div');
    selectionPage.className = 'problem-selection-page';
    selectionPage.appendChild(classHeading);

    const unitGrid = document.createElement('div');
    unitGrid.className = 'problem-unit-grid';
    const problemPickers = [];

    cls.units.forEach(function (unit) {
      const unitCard = document.createElement('div');
      unitCard.className = 'probselect problem-unit-card';

      const unitTitle = document.createElement('h3');
      unitTitle.textContent = 'Unit ' + String(unit.sort_order + 1);

      const unitName = document.createElement('p');
      unitName.className = 'problem-unit-name';
      unitName.textContent = unit.name || '';

      const pickerLabel = document.createElement('p');
      pickerLabel.className = 'problem-picker-label';
      pickerLabel.textContent = 'Choose a problem';

      const pickerWrap = document.createElement('div');
      pickerWrap.className = 'problem-hover-picker';

      const pickerTrigger = document.createElement('button');
      pickerTrigger.type = 'button';
      pickerTrigger.className = 'problem-picker-trigger';
      pickerTrigger.textContent = 'Select a problem...';

      const pickerMenu = document.createElement('div');
      pickerMenu.className = 'problem-hover-menu';

      unit.problems.forEach(function (problem) {
        const selectedPath = problem.yaml_path || '';
        const selectedTitle = problem.title || problem.code || 'Problem';

        const optionButton = document.createElement('button');
        optionButton.type = 'button';
        optionButton.className = 'problem-hover-option';
        optionButton.textContent = selectedTitle;

        optionButton.addEventListener('click', async function () {
          pickerTrigger.textContent = selectedTitle;

          const selectedProblemEl = classContainer.querySelector('.problem-selected-problem');
          const selectedPathEl = classContainer.querySelector('.problem-selected-path');
          if (selectedProblemEl) {
            selectedProblemEl.textContent = selectedPath ? selectedTitle : 'No problem selected';
          }
          if (selectedPathEl) {
            selectedPathEl.textContent = selectedPath || '';
          }

          if (!selectedPath) {
            renderProblemQuestionList(classContainer, []);
            return;
          }

          backButton.style.display = 'none';
          selectionPage.style.display = 'none';
          detailPage.style.display = 'block';

          try {
            const listEl = classContainer.querySelector('.problem-question-list');
            if (listEl) {
              listEl.innerHTML = '<p class="problem-browser-empty">Loading questions...</p>';
            }
            const questions = await getProblemQuestions(selectedPath);
            renderProblemQuestionList(classContainer, questions);
          } catch (error) {
            const listEl = classContainer.querySelector('.problem-question-list');
            if (listEl) {
              listEl.innerHTML = '<p class="problem-browser-empty">Unable to load questions for this file.</p>';
            }
          }
        });

        pickerMenu.appendChild(optionButton);
      });

      pickerWrap.appendChild(pickerTrigger);
      pickerWrap.appendChild(pickerMenu);

      problemPickers.push({
        trigger: pickerTrigger,
        defaultLabel: 'Select a problem...'
      });

      unitCard.appendChild(unitTitle);
      unitCard.appendChild(unitName);
      unitCard.appendChild(pickerLabel);
      unitCard.appendChild(pickerWrap);
      unitGrid.appendChild(unitCard);
    });

    selectionPage.appendChild(unitGrid);
    classContainer.appendChild(selectionPage);

    const detailPage = document.createElement('div');
    detailPage.className = 'problem-detail-page';
    detailPage.style.display = 'none';

    const detailBackButton = document.createElement('button');
    detailBackButton.className = 'back';
    detailBackButton.textContent = 'Back to Problem Selection';
    detailBackButton.onclick = function () {
      detailPage.style.display = 'none';
      selectionPage.style.display = 'block';
      backButton.style.display = 'inline-block';

      problemPickers.forEach(function (pickerInfo) {
        pickerInfo.trigger.textContent = pickerInfo.defaultLabel;
      });

      const selectedProblemEl = classContainer.querySelector('.problem-selected-problem');
      const selectedPathEl = classContainer.querySelector('.problem-selected-path');
      if (selectedProblemEl) {
        selectedProblemEl.textContent = 'No problem selected';
      }
      if (selectedPathEl) {
        selectedPathEl.textContent = '';
      }

      renderProblemQuestionList(classContainer, []);
    };
    detailPage.appendChild(detailBackButton);

    const browserPanel = document.createElement('div');
    browserPanel.className = 'problem-browser-panel';

    const selectedSummary = document.createElement('div');
    selectedSummary.className = 'problem-selected-summary';
    selectedSummary.innerHTML = '<p><strong>Selected Problem:</strong> <span class="problem-selected-problem">No problem selected</span></p><p class="problem-selected-path"></p>';
    browserPanel.appendChild(selectedSummary);

    const split = document.createElement('div');
    split.className = 'problem-browser-split';

    const listPane = document.createElement('div');
    listPane.className = 'problem-list-pane';
    listPane.innerHTML = '<h3>YAML Problems</h3><div class="problem-question-list"><p class="problem-browser-empty">Select a problem from a unit to view its questions.</p></div>';

    const detailPane = document.createElement('div');
    detailPane.className = 'problem-detail-pane';
    detailPane.innerHTML = '<div class="problem-detail-title">No question selected</div><div class="problem-detail-tabs"><button type="button" class="problem-detail-tab active" data-tab="preview">Preview</button><button type="button" class="problem-detail-tab" data-tab="latex">LaTeX Source Code</button><button type="button" class="problem-detail-tab" data-tab="yaml">YAML Source Code</button></div><div class="problem-detail-content" data-tab="preview"><div class="problem-detail-question"></div><img class="problem-detail-figure" alt="Problem figure" style="display: none;" /><div class="problem-detail-answer"></div></div><div class="problem-detail-content" data-tab="latex" style="display: none;"><pre class="problem-detail-latex"></pre></div><div class="problem-detail-content" data-tab="yaml" style="display: none;"><pre class="problem-detail-yaml"></pre></div>';

    split.appendChild(listPane);
    split.appendChild(detailPane);
    browserPanel.appendChild(split);
    detailPage.appendChild(browserPanel);
    classContainer.appendChild(detailPage);

    classPagesHost.appendChild(classContainer);
  });
}

function openProblemModal(problemData) {
  const modalOverlay = document.getElementById('problem-modal-overlay');
  const modalTitle = document.getElementById('problem-modal-title');
  const modalDescription = document.getElementById('problem-modal-description');
  const modalExample = document.getElementById('problem-modal-example');
  const modalFigure = document.getElementById('problem-modal-figure');

  if (modalTitle) {
    modalTitle.textContent = problemData.title || 'Problem';
  }
  if (modalDescription) {
    modalDescription.textContent = problemData.description || '';
  }
  if (modalExample) {
    modalExample.textContent = problemData.example || '';

    if (window.MathJax && typeof window.MathJax.typesetPromise === 'function') {
      if (typeof window.MathJax.typesetClear === 'function') {
        window.MathJax.typesetClear([modalExample]);
      }
      window.MathJax.typesetPromise([modalExample]).catch(function (err) {
        console.error('MathJax typeset error:', err);
      });
    }
  }
  if (modalFigure) {
    const figureUrl = problemData.figureUrl || '';
    if (figureUrl) {
      modalFigure.src = figureUrl;
      modalFigure.style.display = 'block';
    } else {
      modalFigure.removeAttribute('src');
      modalFigure.style.display = 'none';
    }
  }
  if (modalOverlay) {
    modalOverlay.classList.add('open');
    modalOverlay.setAttribute('aria-hidden', 'false');
  }
}

function closeProblemModal() {
  const modalOverlay = document.getElementById('problem-modal-overlay');
  if (modalOverlay) {
    modalOverlay.classList.remove('open');
    modalOverlay.setAttribute('aria-hidden', 'true');
  }
}

function setupProblemModal() {
  const modalOverlay = document.getElementById('problem-modal-overlay');
  const modalClose = document.getElementById('problem-modal-close');

  document.addEventListener('click', function (event) {
    const infoButton = event.target.closest('button.problem-info-button');
    if (infoButton) {
      openProblemModal({
        title: infoButton.dataset.problemTitle || 'Problem',
        description: infoButton.dataset.problemDescription || '',
        example: infoButton.dataset.problemExample || '',
        figureUrl: infoButton.dataset.problemFigureUrl || '',
      });
      return;
    }

    const viewButton = event.target.closest('button.select-button');
    if (!viewButton || viewButton.textContent.trim() !== 'View Problem') {
      return;
    }

    if (viewButton.dataset.problemTitle || viewButton.dataset.problemDescription || viewButton.dataset.problemExample || viewButton.dataset.problemFigureUrl) {
      openProblemModal({
        title: viewButton.dataset.problemTitle || 'Problem',
        description: viewButton.dataset.problemDescription || '',
        example: viewButton.dataset.problemExample || '',
        figureUrl: viewButton.dataset.problemFigureUrl || '',
      });
      return;
    }

    const problemCard = viewButton.closest('.problem-select');
    const problemText = problemCard && problemCard.querySelector('h3')
      ? problemCard.querySelector('h3').textContent.trim()
      : 'Problem';

    openProblemModal({ title: problemText, description: '', example: '', figureUrl: '' });
  });

  if (modalClose) {
    modalClose.addEventListener('click', closeProblemModal);
  }

  if (modalOverlay) {
    modalOverlay.addEventListener('click', function (event) {
      if (event.target === modalOverlay) {
        closeProblemModal();
      }
    });
  }

  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape') {
      closeProblemModal();
    }
  });
}




/* Generator Page JavaScript */
function switchUnit(evt, unit) {
  var i, tabcontent, tablinks;
  tabcontent = document.getElementsByClassName("tabcontent");
  for (i = 0; i < tabcontent.length; i++) {
    tabcontent[i].style.display = "none";
  }
  tablinks = document.getElementsByClassName("tablinks");
  for (i = 0; i < tablinks.length; i++) {
    tablinks[i].className = tablinks[i].className.replace(" active", "");
  }
  document.getElementById(unit).style.display = "flex";
  evt.currentTarget.className += " active";
}

function resetClassSelections(classContainer) {
  const inputs = classContainer.querySelectorAll('input[type="number"]');
  inputs.forEach(function (input) {
    input.value = input.min || 0;
  });
}

function clearCart() {
  const genbody2 = document.getElementById('genbody2');
  if (!genbody2) {
    return;
  }
  const visibleClass = Array.from(genbody2.querySelectorAll('[id^="class"]'))
    .find(function (el) { return el.style.display !== 'none'; });
  if (!visibleClass) {
    return;
  }
  resetClassSelections(visibleClass);
  const match = visibleClass.id.match(/^class(\d+)$/);
  if (match) {
    updateShoppingCart(parseInt(match[1], 10));
  }
}

// Use event delegation so controls created after page load still work.
document.addEventListener('click', function (evt) {
  if (evt.target.id === 'clear-cart-btn') {
    clearCart();
  }

  if (evt.target.classList.contains('exam-count-increment') || evt.target.classList.contains('exam-count-decrement')) {
    const examInput = document.getElementById('exam-count-input');
    if (!examInput) {
      return;
    }
    const minValue = parseInt(examInput.min, 10) || 1;
    const maxValue = parseInt(examInput.max, 10) || 10;
    let currentValue = parseInt(examInput.value, 10);
    if (Number.isNaN(currentValue)) {
      currentValue = minValue;
    }
    if (evt.target.classList.contains('exam-count-increment')) {
      examInput.value = Math.min(currentValue + 1, maxValue);
    } else {
      examInput.value = Math.max(currentValue - 1, minValue);
    }
  }

  if (evt.target.classList.contains('increment-btn')) {
    const numberInput = evt.target.previousElementSibling;
    const maxValue = parseInt(numberInput.max, 10);
    let currentValue = parseInt(numberInput.value, 10);
    if (Number.isNaN(currentValue)) {
      currentValue = 0;
    }
    if (currentValue < maxValue) {
      numberInput.value = currentValue + 1;
    }
    updateShoppingCart(getClassNumberFromInput(numberInput));
  }

  if (evt.target.classList.contains('decrement-btn')) {
    const numberInput = evt.target.nextElementSibling;
    const minValue = parseInt(numberInput.min, 10);
    let currentValue = parseInt(numberInput.value, 10);
    if (Number.isNaN(currentValue)) {
      currentValue = 0;
    }
    if (currentValue > minValue) {
      numberInput.value = currentValue - 1;
    }
    updateShoppingCart(getClassNumberFromInput(numberInput));
  }
});

document.addEventListener('change', function (evt) {
  if (evt.target.id === 'exam-count-input') {
    const examInput = evt.target;
    const minValue = parseInt(examInput.min, 10) || 1;
    const maxValue = parseInt(examInput.max, 10) || 10;
    let currentValue = parseInt(examInput.value, 10);
    if (Number.isNaN(currentValue)) {
      currentValue = minValue;
    }
    if (currentValue > maxValue) {
      examInput.value = maxValue;
    } else if (currentValue < minValue) {
      examInput.value = minValue;
    }
    return;
  }

  if (evt.target.matches('input[type="number"]')) {
    const numberInput = evt.target;
    const maxValue = parseInt(numberInput.max, 10);
    const minValue = parseInt(numberInput.min, 10);
    let currentValue = parseInt(numberInput.value, 10);

    if (Number.isNaN(currentValue)) {
      currentValue = minValue;
    }
    if (currentValue > maxValue) {
      numberInput.value = maxValue;
    } else if (currentValue < minValue) {
      numberInput.value = minValue;
    }
    updateShoppingCart(getClassNumberFromInput(numberInput));
  }
});

function generateGenPage(classes) {
  const classesRoot = document.getElementById('classes');
  const genbody2 = document.getElementById('genbody2');

  if (!classesRoot || !genbody2) {
    return;
  }

  classesRoot.innerHTML = '';
  Array.from(genbody2.querySelectorAll('[id^="class"]:not([id="classes"])')).forEach(function (node) { node.remove(); });

  if (!classes || !classes.length) {
    renderCatalogError(classesRoot, 'No classes found in the local database yet.');
    return;
  }

  classes.forEach(function (cls, classIndex) {
    const i = classIndex + 1;

    const layer1 = document.createElement('div');
    layer1.style.display = 'flex';
    layer1.style.flexDirection = 'row';

    const layer2 = document.createElement('div');
    layer2.className = 'class-select';

    const heading = document.createElement('h1');
    heading.textContent = cls.name;

    const layer3 = document.createElement('div');
    layer3.className = 'thumbnail';

    const thumbnail = document.createElement('img');
    thumbnail.src = cls.class_thumbnail_url || 'https://placehold.co/500x300/cccccc/888888?text=No+Image';
    thumbnail.alt = cls.name + ' Thumbnail';
    thumbnail.loading = 'lazy';
    
    const button = document.createElement('button');
    button.className = 'select-button';
    button.onclick = function() { showClass(i); };
    button.textContent = 'Select';

    layer3.appendChild(thumbnail);
    layer2.appendChild(heading);
    layer2.appendChild(layer3);
    layer2.appendChild(button);
    layer1.appendChild(layer2);

    classesRoot.appendChild(layer1);

    const mainLayer = document.createElement('div');
    mainLayer.id = 'class' + String(i);
    mainLayer.style.display = 'none';

    const backButton = document.createElement('button');
    backButton.className = 'back';
    backButton.onclick = function() {
      resetClassSelections(mainLayer);
      selectFirstUnit(i);
      updateShoppingCart(i);
      showClass(i);
    };
    backButton.textContent = 'Start Over';
    mainLayer.appendChild(backButton);

    const tabsLayer = document.createElement('div');
    tabsLayer.className = 'tabs';

    cls.units.forEach(function (unit, unitIndex) {
      const j = unitIndex + 1;
      const tabButton = document.createElement('button');
      tabButton.className = 'tablinks';
      tabButton.id = (j === 1) ? 'defaulttab-' + String(i) : '';
      tabButton.onclick = function(evt) { switchUnit(evt, 'class' + String(i) + '-unit' + String(j)); };
      tabButton.textContent = 'Unit ' + String(unit.sort_order + 1);
      tabsLayer.appendChild(tabButton);
    });
    mainLayer.appendChild(tabsLayer);

    const unitsLayer = document.createElement('div');
    unitsLayer.className = 'units';

    cls.units.forEach(function (unit, unitIndex) {
      const j = unitIndex + 1;
      const unitContent = document.createElement('div');
      unitContent.id = 'class' + String(i) + '-unit' + String(j);
      unitContent.className = 'tabcontent';

      unit.problems.forEach(function (problem, problemIndex) {
        const k = problemIndex + 1;
        const problemLayer = document.createElement('div');
        problemLayer.className = 'probselect';

        const infoButton = document.createElement('button');
        infoButton.className = 'problem-info-button';
        infoButton.type = 'button';
        infoButton.textContent = 'i';
        infoButton.setAttribute('aria-label', 'View problem details');
        infoButton.dataset.problemTitle = problem.title || ('Problem ' + String(k));
        infoButton.dataset.problemDescription = problem.description || '';
        infoButton.dataset.problemExample = problem.example || '';
        infoButton.dataset.problemFigureUrl = problem.figure_url || '';

        const problemHeading = document.createElement('h3');
        problemHeading.textContent = 'Problem ' + String(k);

        const problemTitle = document.createElement('p');
        problemTitle.textContent = problem.title;
        problemTitle.style.fontWeight = 'bold';

        const problemSubtitle = document.createElement('p');
        problemSubtitle.textContent = 'Select # of Questions';

        const problemSelect = document.createElement('span');
        problemSelect.className = 'quantselect';

        const decrementBtn = document.createElement('button');
        decrementBtn.className = 'decrement-btn';
        decrementBtn.textContent = '-';

        const numberInput = document.createElement('input');
        numberInput.type = 'number';
        numberInput.value = '0';
        numberInput.min = '0';
        numberInput.max = String(problem.question_count || 10);
        numberInput.dataset.unit = String(j);
        numberInput.dataset.problem = problem.title || ('Problem ' + String(k));
        numberInput.dataset.yamlPath = problem.yaml_path || '';
        numberInput.dataset.unitName = unit.name || '';

        const incrementBtn = document.createElement('button');
        incrementBtn.className = 'increment-btn';
        incrementBtn.textContent = '+';

        problemSelect.appendChild(decrementBtn);
        problemSelect.appendChild(numberInput);
        problemSelect.appendChild(incrementBtn);

        problemLayer.appendChild(infoButton);
        problemLayer.appendChild(problemHeading);
        problemLayer.appendChild(problemTitle);
        problemLayer.appendChild(problemSubtitle);
        problemLayer.appendChild(problemSelect);

        unitContent.appendChild(problemLayer);
      });

      unitsLayer.appendChild(unitContent);
    });

    mainLayer.appendChild(unitsLayer);
    genbody2.appendChild(mainLayer);
  });

  selectFirstUnit(1);
  updateShoppingCart(1);
}

function getClassNumberFromInput(inputEl) {
  const tabContent = inputEl.closest('.tabcontent');
  if (!tabContent || !tabContent.id) {
    return null;
  }
  const match = tabContent.id.match(/^class(\d+)-unit\d+$/);
  return match ? parseInt(match[1], 10) : null;
}

function summarizeCartLabel(label) {
  const clean = String(label || '').replace(/\s+/g, ' ').trim();
  if (!clean) {
    return 'Problem';
  }
  const maxLen = 36;
  if (clean.length <= maxLen) {
    return clean;
  }
  return clean.slice(0, maxLen - 1).trimEnd() + '...';
}

// Shopping cart sync: render selected counts grouped by unit and total.
function updateShoppingCart(classNumber) {
  if (!classNumber) {
    return;
  }

  const classContainer = document.getElementById('class' + String(classNumber));
  const cart = document.getElementById('cart');
  if (!classContainer || !cart) {
    return;
  }

  const inputs = classContainer.querySelectorAll('input[type="number"]');
  const unitData = new Map();
  let totalQuestions = 0;

  inputs.forEach(function (input) {
    const value = parseInt(input.value, 10);
    const count = Number.isNaN(value) ? 0 : value;
    if (count <= 0) {
      return;
    }

    const unit = parseInt(input.dataset.unit, 10);
    const problemLabel = input.dataset.problem || 'Problem';
    if (!unitData.has(unit)) {
      unitData.set(unit, []);
    }
    unitData.get(unit).push({ problemLabel: problemLabel, count: count });
    totalQuestions += count;
  });

  cart.innerHTML = '';

  const sortedUnits = Array.from(unitData.keys()).sort(function (a, b) { return a - b; });
  sortedUnits.forEach(function (unitNumber) {
    const unitHeading = document.createElement('p');
    unitHeading.textContent = 'Unit ' + String(unitNumber);
    cart.appendChild(unitHeading);

    const list = document.createElement('ul');
    const problems = unitData.get(unitNumber).sort(function (a, b) { return a.problemLabel.localeCompare(b.problemLabel); });
    problems.forEach(function (item) {
      const li = document.createElement('li');
      li.textContent = summarizeCartLabel(item.problemLabel) + ':';
      const countSpan = document.createElement('span');
      countSpan.textContent = String(item.count);
      li.appendChild(countSpan);
      list.appendChild(li);
    });
    cart.appendChild(list);
  });

  const totalWrapper = document.createElement('span');
  const totalLabel = document.createElement('b');
  totalLabel.textContent = 'Total Questions:';
  const totalValue = document.createElement('p');
  totalValue.textContent = String(totalQuestions);
  totalWrapper.appendChild(totalLabel);
  totalWrapper.appendChild(totalValue);
  cart.appendChild(totalWrapper);
}

document.addEventListener('DOMContentLoaded', async function () {
  setupFooterLastSync();

  const hasProblemsPage = !!document.getElementById('problem-classes');
  const hasGeneratorPage = !!document.getElementById('genbody2') && !!document.getElementById('cart');

  if (hasProblemsPage || hasGeneratorPage) {
    setupProblemModal();
  }

  if (hasProblemsPage) {
    try {
      const classes = await getCatalogData();
      generateProblemsPage(classes);
    } catch (error) {
      console.error('Problems page error:', error);
      renderCatalogError(document.getElementById('problem-classes'), 'Unable to load problem bank data.');
    }
  }

  if (hasGeneratorPage) {
    try {
      const classes = await getCatalogData();
      generateGenPage(classes);
      setupGenerateExamButton();
      setupPreviewExamButton();
    } catch (error) {
      console.error('Generator page error:', error);
      renderCatalogError(document.getElementById('classes'), 'Unable to load problem bank data.');
    }
  }
});