/* Problems Page JavaScript */
var cachedProblemQuestionData = new Map();
var cachedProblemMetadata = new Map();
var problemsPageMobileQuery = window.matchMedia('(max-width: 980px)');

function isProblemsPageMobileLayout() {
  return !!problemsPageMobileQuery && problemsPageMobileQuery.matches;
}

function syncProblemsPageMobileState(cls, forcedStep) {
  var classContainer = document.getElementById('class' + String(cls));
  if (!classContainer) {
    return;
  }

  var browserLayout = classContainer.querySelector('.course-browser-layout');
  var browserPanel = classContainer.querySelector('.problem-browser-panel');
  var step = forcedStep || classContainer.dataset.problemMobileStep || 'units';
  var isMobile = isProblemsPageMobileLayout();

  classContainer.classList.toggle('is-mobile-flow', isMobile);
  classContainer.classList.toggle('problem-mobile-units', isMobile && step === 'units');
  classContainer.classList.toggle('problem-mobile-problems', isMobile && step === 'problems');
  classContainer.dataset.problemMobileStep = step;

  if (!browserLayout || !browserPanel) {
    return;
  }

  if (!isMobile) {
    browserLayout.style.display = '';
    browserPanel.style.display = '';
    return;
  }

  browserLayout.style.display = step === 'units' ? '' : 'none';
  browserPanel.style.display = step === 'problems' ? '' : 'none';
}

window.syncProblemsPageMobileState = syncProblemsPageMobileState;

function resetProblemsPageSelection(cls) {
  var classContainer = document.getElementById('class' + String(cls));
  if (!classContainer) {
    return;
  }

  var unitList = classContainer.querySelector('.course-unit-list');
  var bankButtons = classContainer.querySelectorAll('.course-problem-button');

  bankButtons.forEach(function (button) {
    button.classList.remove('active');
  });

  if (unitList) {
    unitList.querySelectorAll('.course-unit-accordion.open').forEach(function (item) {
      item.classList.remove('open');
      var headerButton = item.querySelector('.course-unit-button');
      var panel = item.querySelector('.course-unit-panel');
      if (headerButton) {
        headerButton.classList.remove('active');
        headerButton.setAttribute('aria-expanded', 'false');
      }
      if (panel) {
        panel.style.maxHeight = '0px';
      }
    });
  }

  classContainer.dataset.problemMobileStep = 'units';
  classContainer._problemQuestions = [];
  classContainer._problemMetadata = {};
  classContainer._problemQuestionIndex = 0;

  if (typeof syncProblemsPageMobileState === 'function') {
    syncProblemsPageMobileState(cls, 'units');
  }

  var panel = classContainer.querySelector('.problem-browser-panel');
  if (panel) {
    renderProblemQuestionList(classContainer, [], {});
  }
}

window.resetProblemsPageSelection = resetProblemsPageSelection;

function updateMobileProblemNav(classContainer) {
  if (!classContainer) {
    return;
  }

  var nav = classContainer.querySelector('.problem-mobile-question-nav');
  if (!nav) {
    return;
  }

  var questions = Array.isArray(classContainer._problemQuestions) ? classContainer._problemQuestions : [];
  var index = Number(classContainer._problemQuestionIndex || 0);
  var prevButton = nav.querySelector('.problem-mobile-question-prev');
  var nextButton = nav.querySelector('.problem-mobile-question-next');
  var statusEl = nav.querySelector('.problem-mobile-question-status');

  if (statusEl) {
    statusEl.textContent = questions.length ? (String(index + 1) + ' / ' + String(questions.length)) : '0 / 0';
  }

  if (prevButton) {
    prevButton.disabled = !questions.length || index <= 0;
  }
  if (nextButton) {
    nextButton.disabled = !questions.length || index >= questions.length - 1;
  }
}

function showMobileProblemQuestion(classContainer, nextIndex) {
  if (!classContainer) {
    return;
  }

  var questions = Array.isArray(classContainer._problemQuestions) ? classContainer._problemQuestions : [];
  var panel = classContainer.querySelector('.problem-browser-panel');
  var index = Math.max(0, Math.min(Number(nextIndex || 0), Math.max(questions.length - 1, 0)));

  classContainer._problemQuestionIndex = index;

  if (questions.length && panel) {
    renderProblemDetail(panel, questions[index], classContainer._problemMetadata || {});
  }

  updateMobileProblemNav(classContainer);
}

function syncProblemListPaneHeight(panel) {
  if (!panel) {
    return;
  }

  var listPane = panel.querySelector('.problem-list-pane');
  var listEl = panel.querySelector('.problem-question-list');
  var detailPane = panel.querySelector('.problem-detail-pane');
  var splitPane = panel.querySelector('.problem-browser-split');
  var previewContentEl = panel.querySelector('.problem-detail-content[data-tab="preview"]');
  var yamlContentEl = panel.querySelector('.problem-detail-content[data-tab="yaml"]');
  var yamlEl = panel.querySelector('.problem-detail-yaml');
  var classContainer = panel.closest('.problem-class-page');
  var mobileProblemsMode = !!(classContainer && classContainer.classList.contains('problem-mobile-problems'));

  if (!listPane || !listEl || !detailPane) {
    return;
  }

  // Mobile problems view uses a single flexible detail pane;
  // fixed pixel heights create unused gaps, so clear any locks.
  if (mobileProblemsMode) {
    listPane.style.height = '0px';
    listPane.style.maxHeight = '0px';
    listEl.style.maxHeight = '';
    detailPane.style.height = '';
    detailPane.style.maxHeight = '';
    if (yamlContentEl) {
      yamlContentEl.style.height = '';
      yamlContentEl.style.minHeight = '';
      yamlContentEl.style.maxHeight = '';
    }
    if (yamlEl) {
      yamlEl.style.height = '';
      yamlEl.style.maxHeight = '';
    }
    return;
  }

  var lockedHeight = Number(panel.dataset.problemPanelHeightLock || 0);

  if (!lockedHeight) {
    if (previewContentEl) {
      var measuredPreviewHeight = previewContentEl.offsetHeight;
      if (measuredPreviewHeight > 0) {
        panel.dataset.previewHeight = String(measuredPreviewHeight);
      }
    }

    var savedPreviewHeight = Number(panel.dataset.previewHeight || 0);
    lockedHeight = Math.max(260, savedPreviewHeight || detailPane.offsetHeight);
    panel.dataset.problemPanelHeightLock = String(lockedHeight);
  }

  var previewHeight = Math.max(260, lockedHeight);
  var availableHeight = splitPane ? Math.max(260, splitPane.clientHeight) : previewHeight;
  var targetHeight = Math.max(previewHeight, availableHeight);

  if (yamlContentEl) {
    yamlContentEl.style.height = targetHeight + 'px';
    yamlContentEl.style.minHeight = targetHeight + 'px';
    yamlContentEl.style.maxHeight = targetHeight + 'px';
  }
  if (yamlEl) {
    yamlEl.style.height = '100%';
    yamlEl.style.maxHeight = '100%';
  }

  listPane.style.height = targetHeight + 'px';
  listPane.style.maxHeight = targetHeight + 'px';
  detailPane.style.height = targetHeight + 'px';
  detailPane.style.maxHeight = targetHeight + 'px';

  var paneRect = listPane.getBoundingClientRect();
  var listRect = listEl.getBoundingClientRect();
  var listOffsetTop = Math.max(0, Math.ceil(listRect.top - paneRect.top));
  var listHeight = Math.max(120, targetHeight - listOffsetTop - 8);
  listEl.style.maxHeight = listHeight + 'px';
}

async function getProblemQuestions(yamlPath) {
  if (!yamlPath) {
    return { questions: [], metadata: {} };
  }

  if (cachedProblemQuestionData.has(yamlPath)) {
    return {
      questions: cachedProblemQuestionData.get(yamlPath),
      metadata: cachedProblemMetadata.get(yamlPath) || {}
    };
  }

  var response = await fetch('/api/problems/questions/?yaml_path=' + encodeURIComponent(yamlPath), {
    headers: { Accept: 'application/json' },
  });

  if (!response.ok) {
    throw new Error('Unable to load questions for this problem.');
  }

  var payload = await response.json();
  var questions = Array.isArray(payload.questions) ? payload.questions : [];
  var metadata = payload.metadata || {};
  
  cachedProblemQuestionData.set(yamlPath, questions);
  cachedProblemMetadata.set(yamlPath, metadata);
  
  return { questions: questions, metadata: metadata };
}

function activateProblemDetailTab(panel, tabName) {
  if (!panel) {
    return;
  }

  var tabs = panel.querySelectorAll('.problem-detail-tab');
  tabs.forEach(function (tab) {
    tab.classList.toggle('active', tab.dataset.tab === tabName);
  });

  var panes = panel.querySelectorAll('.problem-detail-content');
  panes.forEach(function (pane) {
    pane.style.display = pane.dataset.tab === tabName ? 'block' : 'none';
  });

  window.requestAnimationFrame(function () {
    syncProblemListPaneHeight(panel);
  });
}

function typesetProblemMath(panel, elements, attempt) {
  var maxAttempts = 25;
  var retryDelayMs = 120;
  var nodes = (elements || []).filter(function (el) {
    return !!el;
  });

  if (!nodes.length) {
    syncProblemListPaneHeight(panel);
    return;
  }

  if (window.MathJax && typeof window.MathJax.typesetPromise === 'function') {
    if (typeof window.MathJax.typesetClear === 'function') {
      window.MathJax.typesetClear(nodes);
    }
    window.MathJax.typesetPromise(nodes)
      .then(function () {
        syncProblemListPaneHeight(panel);
      })
      .catch(function (err) {
        console.error('MathJax typeset error:', err);
        syncProblemListPaneHeight(panel);
      });
    return;
  }

  if ((attempt || 0) < maxAttempts) {
    window.setTimeout(function () {
      typesetProblemMath(panel, nodes, (attempt || 0) + 1);
    }, retryDelayMs);
    return;
  }

  syncProblemListPaneHeight(panel);
}

function renderProblemDetail(panel, question, metadata) {
  if (!panel || !question) {
    return;
  }

  panel.dataset.problemPanelHeightLock = '';

  var titleEl = panel.querySelector('.problem-detail-title');
  var outputEl = panel.querySelector('.problem-detail-question');
  var answerEl = panel.querySelector('.problem-detail-answer');
  var feedbackEl = panel.querySelector('.problem-detail-feedback');
  var figureEl = panel.querySelector('.problem-detail-figure');
  var latexEl = panel.querySelector('.problem-detail-latex');
  var yamlEl = panel.querySelector('.problem-detail-yaml');

  if (titleEl) {
    titleEl.textContent = question.label || ('Problem ' + String(question.index || ''));
  }

  if (outputEl) {
    outputEl.textContent = question.output || '';

    if (answerEl) {
      var answerHTML = '<strong>Correct Answer:</strong> ' + (question.answer || 'Not provided in this item.');
      
      // Add per-question metadata if available
      if (question.answer_type || (question.category_count !== undefined && question.category_count > 0)) {
        answerHTML += '<div style="margin-top: 12px; padding-top: 12px; border-top: 1px solid #e0e0e0;">';
        
        if (question.answer_type) {
          var answerTypeDisplay = question.answer_type.replace(/_/g, ' ').charAt(0).toUpperCase() + question.answer_type.slice(1).replace(/_/g, ' ').toLowerCase();
          answerHTML += '<div style="margin-bottom: 6px;"><strong>Answer Type:</strong> ' + answerTypeDisplay + '</div>';
        }
        
        if (question.category_count !== undefined && question.category_count > 0) {
          answerHTML += '<div style="margin-bottom: 6px;"><strong>Categories:</strong> ' + question.category_count + '</div>';
        }
        
        answerHTML += '</div>';
      }
      
      answerEl.innerHTML = answerHTML;
    }

    if (feedbackEl) {
      if (question.general_feedback) {
        feedbackEl.innerHTML = question.general_feedback;
      } else {
        feedbackEl.innerHTML = 'No solution steps were provided in this item.';
      }
    }

    typesetProblemMath(panel, [outputEl, answerEl, feedbackEl], 0);
  }

  if (figureEl) {
    var figureUrl = (question.figure_url || '').trim();
    figureEl.onload = function () {
      syncProblemListPaneHeight(panel);
    };
    figureEl.onerror = function () {
      figureEl.style.display = 'none';
      syncProblemListPaneHeight(panel);
    };

    if (figureUrl) {
      if (figureEl.getAttribute('src') !== figureUrl) {
        figureEl.removeAttribute('src');
      }
      figureEl.src = figureUrl;
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

  if (latexEl) {
    latexEl.textContent = question.latex_source || '';
  }

  if (yamlEl) {
    yamlEl.textContent = question.yaml_source || '';
  }
}

function renderProblemQuestionList(classContainer, questions, metadata) {
  var listEl = classContainer.querySelector('.problem-question-list');
  var panel = classContainer.querySelector('.problem-browser-panel');
  if (!listEl || !panel) {
    return;
  }

  classContainer._problemQuestions = Array.isArray(questions) ? questions : [];
  classContainer._problemMetadata = metadata || {};
  classContainer._problemQuestionIndex = 0;

  // Store metadata in panel for renderProblemDetail to access
  if (metadata) {
    panel.dataset.problemMetadata = JSON.stringify(metadata);
  }
  
  // Update the YAML Problems heading to include question count
  var listPane = classContainer.querySelector('.problem-list-pane');
  if (listPane && listPane.querySelector('h3')) {
    var heading = 'YAML Problems';
    if (metadata && metadata.num_questions !== undefined && metadata.num_questions > 0) {
      heading += ' (' + metadata.num_questions + ')';
    }
    listPane.querySelector('h3').textContent = heading;
  }

  listEl.innerHTML = '';
  
  if (!questions.length) {
    var listPaneEmpty = classContainer.querySelector('.problem-list-pane');
    if (listPaneEmpty) {
      listPaneEmpty.style.display = '';
    }

    var emptyState = document.createElement('p');
    emptyState.className = 'problem-browser-empty';
    emptyState.textContent = 'No question entries were found in this YAML file.';
    listEl.appendChild(emptyState);

    renderProblemDetail(panel, {
      label: 'No question selected',
      output: '',
      answer: '',
      general_feedback: '',
      figure_url: '',
      latex_source: '',
      yaml_source: '',
    }, metadata);
    return;
  }

  var mobileProblemsMode = isProblemsPageMobileLayout() && classContainer.dataset.problemMobileStep === 'problems';

  if (mobileProblemsMode) {
    var listPaneMobile = classContainer.querySelector('.problem-list-pane');
    if (listPaneMobile) {
      listPaneMobile.style.display = 'none';
    }
    listEl.innerHTML = '';
    showMobileProblemQuestion(classContainer, 0);
    updateMobileProblemNav(classContainer);
    syncProblemListPaneHeight(panel);
    return;
  }

  var listPaneDesktop = classContainer.querySelector('.problem-list-pane');
  if (listPaneDesktop) {
    listPaneDesktop.style.display = '';
  }

  questions.forEach(function (question, index) {
    var itemButton = document.createElement('button');
    itemButton.type = 'button';
    itemButton.className = 'problem-question-item';
    itemButton.textContent = question.label || ('Problem ' + String(index + 1));

    itemButton.addEventListener('click', function () {
      listEl.querySelectorAll('.problem-question-item').forEach(function (node) {
        node.classList.remove('active');
      });
      itemButton.classList.add('active');
      activateProblemDetailTab(panel, 'preview');
      renderProblemDetail(panel, question, metadata);
    });

    listEl.appendChild(itemButton);
  });

  var firstButton = listEl.querySelector('.problem-question-item');
  if (firstButton) {
    firstButton.click();
  }

  updateMobileProblemNav(classContainer);
}

function generateProblemsPage(classes) {
  var classesHost = document.getElementById('problem-classes') || document.getElementById('classes');
  var classPagesHost = document.getElementById('problem-class-pages');
  var classGrid = classesHost && classesHost.id === 'classes' ? classesHost.querySelector('div') : classesHost;

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
    var i = classIndex + 1;

    var classCardWrap = document.createElement('div');
    classCardWrap.style.display = 'flex';
    classCardWrap.style.flexDirection = 'row';

    var classCard = document.createElement('div');
    classCard.className = 'class-select';

    var heading = document.createElement('h1');
    heading.textContent = cls.name;

    var selectButton = document.createElement('button');
    selectButton.className = 'select-button';
    selectButton.textContent = 'Select';
    selectButton.onclick = function () { showClass(i); };

    classCard.appendChild(heading);
    classCard.appendChild(selectButton);
    classCardWrap.appendChild(classCard);
    classGrid.appendChild(classCardWrap);

    var classContainer = document.createElement('div');
    classContainer.className = 'container problem-class-page';
    classContainer.id = 'class' + String(i);
    classContainer.style.display = 'none';

    var backButton = document.createElement('button');
    backButton.className = 'back';
    backButton.textContent = 'Back to Courses';
    backButton.onclick = function () { showClass(i); };
    classContainer.appendChild(backButton);

    var classHeading = document.createElement('h2');
    classHeading.className = 'problem-class-heading';
    classHeading.textContent = cls.name + ' Course';
    classContainer.appendChild(classHeading);

    var browserLayout = document.createElement('div');
    browserLayout.className = 'course-browser-layout';

    var unitBankPane = document.createElement('div');
    unitBankPane.className = 'course-unit-bank-pane';
    unitBankPane.innerHTML = '<h3>Units and Problem Banks</h3><p class="course-problem-help">Select a unit to expand and choose a problem bank.</p>';

    var unitList = document.createElement('div');
    unitList.className = 'course-unit-list course-unit-accordion-list';
    unitBankPane.appendChild(unitList);

    browserLayout.appendChild(unitBankPane);

    var workspaceLayout = document.createElement('div');
    workspaceLayout.className = 'course-workspace-layout';
    workspaceLayout.appendChild(browserLayout);

    var browserPanel = document.createElement('div');
    browserPanel.className = 'problem-browser-panel';

    var mobilePanelNav = document.createElement('div');
    mobilePanelNav.className = 'problem-mobile-nav';
    mobilePanelNav.innerHTML = '<button type="button" class="problem-mobile-back-to-units">Back to Units</button>';
    browserPanel.appendChild(mobilePanelNav);

    var mobileQuestionNav = document.createElement('div');
    mobileQuestionNav.className = 'problem-mobile-question-nav';
    mobileQuestionNav.innerHTML = '<button type="button" class="problem-mobile-question-prev" aria-label="Previous problem">◀</button><span class="problem-mobile-question-status">0 / 0</span><button type="button" class="problem-mobile-question-next" aria-label="Next problem">▶</button>';
    browserPanel.appendChild(mobileQuestionNav);

    var split = document.createElement('div');
    split.className = 'problem-browser-split';

    var listPane = document.createElement('div');
    listPane.className = 'problem-list-pane';
    listPane.innerHTML = '<h3>YAML Problems</h3><div class="problem-question-list"><p class="problem-browser-empty">Select a problem bank to view its questions.</p></div>';

    var detailPane = document.createElement('div');
    detailPane.className = 'problem-detail-pane';
    detailPane.innerHTML = '<div class="problem-detail-title">No question selected</div><div class="problem-detail-tabs"><button type="button" class="problem-detail-tab active" data-tab="preview">Preview</button><button type="button" class="problem-detail-tab" data-tab="how-to-solve">How to Solve</button><button type="button" class="problem-detail-tab" data-tab="latex">LaTeX Source Code</button><button type="button" class="problem-detail-tab" data-tab="yaml">YAML Source Code</button></div><div class="problem-detail-content" data-tab="preview"><div class="problem-detail-question"></div><img class="problem-detail-figure" alt="Problem figure" style="display: none;" /><div class="problem-detail-answer"></div></div><div class="problem-detail-content" data-tab="how-to-solve" style="display: none;"><div class="problem-detail-feedback"></div></div><div class="problem-detail-content" data-tab="latex" style="display: none;"><pre class="problem-detail-latex"></pre></div><div class="problem-detail-content" data-tab="yaml" style="display: none;"><pre class="problem-detail-yaml"></pre></div>';

    split.appendChild(listPane);
    split.appendChild(detailPane);
    browserPanel.appendChild(split);
    workspaceLayout.appendChild(browserPanel);
    classContainer.appendChild(workspaceLayout);
    classContainer.dataset.problemMobileStep = 'units';

    var mobileBackToUnitsButton = mobilePanelNav.querySelector('.problem-mobile-back-to-units');
    if (mobileBackToUnitsButton) {
      mobileBackToUnitsButton.addEventListener('click', function () {
        syncProblemsPageMobileState(i, 'units');
      });
    }

    var mobileQuestionPrevButton = mobileQuestionNav.querySelector('.problem-mobile-question-prev');
    var mobileQuestionNextButton = mobileQuestionNav.querySelector('.problem-mobile-question-next');
    if (mobileQuestionPrevButton) {
      mobileQuestionPrevButton.addEventListener('click', function () {
        showMobileProblemQuestion(classContainer, Number(classContainer._problemQuestionIndex || 0) - 1);
      });
    }
    if (mobileQuestionNextButton) {
      mobileQuestionNextButton.addEventListener('click', function () {
        showMobileProblemQuestion(classContainer, Number(classContainer._problemQuestionIndex || 0) + 1);
      });
    }

    var sortedUnits = (cls.units || []).slice().sort(function (a, b) {
      return (a.sort_order || 0) - (b.sort_order || 0);
    });

    function resetProblemDetail() {
      renderProblemQuestionList(classContainer, [], {});
    }

    function setUnitAccordionState(accordionItem, shouldOpen) {
      if (!accordionItem) {
        return;
      }

      var headerButton = accordionItem.querySelector('.course-unit-button');
      var panel = accordionItem.querySelector('.course-unit-panel');
      var panelInner = accordionItem.querySelector('.course-unit-panel-inner');

      accordionItem.classList.toggle('open', shouldOpen);
      if (headerButton) {
        headerButton.classList.toggle('active', shouldOpen);
        headerButton.setAttribute('aria-expanded', shouldOpen ? 'true' : 'false');
      }
      if (panel) {
        panel.hidden = false;
        if (shouldOpen) {
          panel.style.maxHeight = (panelInner ? panelInner.scrollHeight : panel.scrollHeight) + 'px';
        } else {
          panel.style.maxHeight = '0px';
        }
      }
    }

    function collapseOtherUnitAccordions(openItem) {
      unitList.querySelectorAll('.course-unit-accordion.open').forEach(function (item) {
        if (item !== openItem) {
          setUnitAccordionState(item, false);
        }
      });
    }

    async function handleProblemBankSelection(bankButton, selectedPath, selectedTitle) {
      var classId = String(classContainer.id || '').replace(/^class/, '');
      unitList.querySelectorAll('.course-problem-button').forEach(function (node) {
        node.classList.remove('active');
      });
      bankButton.classList.add('active');

      if (!selectedPath) {
        renderProblemQuestionList(classContainer, [], {});
        if (classId) {
          syncProblemsPageMobileState(classId, 'units');
        }
        return;
      }

      try {
        var listEl = classContainer.querySelector('.problem-question-list');
        if (listEl) {
          listEl.innerHTML = '<p class="problem-browser-empty">Loading questions...</p>';
        }
        var result = await getProblemQuestions(selectedPath);
        renderProblemQuestionList(classContainer, result.questions, result.metadata);
        if (classId) {
          syncProblemsPageMobileState(classId, 'problems');
        }
      } catch (error) {
        var listElError = classContainer.querySelector('.problem-question-list');
        if (listElError) {
          listElError.innerHTML = '<p class="problem-browser-empty">Unable to load questions for this file.</p>';
        }
      }
    }

    sortedUnits.forEach(function (unit, unitIndex) {
      var unitNumber = (unit.sort_order || unitIndex) + 1;
      var accordionItem = document.createElement('div');
      accordionItem.className = 'course-unit-accordion';

      var unitButton = document.createElement('button');
      unitButton.type = 'button';
      unitButton.className = 'course-unit-button';
      unitButton.setAttribute('aria-expanded', 'false');
      var unitLabel = (unit.name || '').trim() || 'Unit';
      unitButton.innerHTML = '<span class="course-unit-icon">' + String(unitNumber) + '</span><span class="course-unit-label">' + unitLabel + '</span><span class="course-unit-chevron" aria-hidden="true">\u25be</span>';

      var unitPanel = document.createElement('div');
      unitPanel.className = 'course-unit-panel';
      unitPanel.hidden = false;
      unitPanel.style.maxHeight = '0px';

      var panelInner = document.createElement('div');
      panelInner.className = 'course-unit-panel-inner';

      var problemList = document.createElement('div');
      problemList.className = 'course-problem-list';

      var problems = Array.isArray(unit.problems) ? unit.problems : [];
      if (!problems.length) {
        var emptyText = document.createElement('p');
        emptyText.className = 'course-problem-empty';
        emptyText.textContent = 'No problem banks are available for this unit.';
        problemList.appendChild(emptyText);
      }

      problems.forEach(function (problem) {
        var selectedPath = problem.yaml_path || '';
        var selectedTitle = problem.title || problem.code || 'Problem Bank';

        var bankButton = document.createElement('button');
        bankButton.type = 'button';
        bankButton.className = 'course-problem-button';
        bankButton.textContent = selectedTitle;

        bankButton.addEventListener('click', function () {
          handleProblemBankSelection(bankButton, selectedPath, selectedTitle);
        });

        problemList.appendChild(bankButton);
      });

      panelInner.appendChild(problemList);
      unitPanel.appendChild(panelInner);

      unitButton.addEventListener('click', function () {
        var shouldOpen = !accordionItem.classList.contains('open');
        collapseOtherUnitAccordions(accordionItem);
        setUnitAccordionState(accordionItem, shouldOpen);

        if (!shouldOpen) {
          resetProblemDetail();
        }
      });

      accordionItem.appendChild(unitButton);
      accordionItem.appendChild(unitPanel);
      unitList.appendChild(accordionItem);
    });

    var defaultUnitAccordion = unitList.querySelector('.course-unit-accordion');
    if (defaultUnitAccordion) {
      resetProblemDetail();
    } else {
      resetProblemDetail();
    }

    classPagesHost.appendChild(classContainer);
  });
}

document.addEventListener('click', function (evt) {
  var tab = evt.target.closest('.problem-detail-tab');
  if (tab) {
    var panel = tab.closest('.problem-browser-panel');
    activateProblemDetailTab(panel, tab.dataset.tab || 'preview');
  }
});

document.addEventListener('DOMContentLoaded', async function () {
  var hasProblemsPage = !!document.getElementById('problem-classes');
  if (!hasProblemsPage) {
    return;
  }

  try {
    var classes = await getCatalogData();
    generateProblemsPage(classes);
  } catch (error) {
    console.error('Problems page error:', error);
    renderCatalogError(document.getElementById('problem-classes'), 'Unable to load problem bank data.');
  }
});

window.addEventListener('resize', function () {
  window.requestAnimationFrame(function () {
    document.querySelectorAll('.problem-class-page').forEach(function (classContainer) {
      if (classContainer.style.display === 'block') {
        var classId = String(classContainer.id || '').replace(/^class/, '');
        if (classId) {
          syncProblemsPageMobileState(classId);
        }
      }
    });
  });
});
