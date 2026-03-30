/* Problems Page JavaScript */
var cachedProblemQuestionData = new Map();
var cachedProblemMetadata = new Map();

function syncProblemListPaneHeight(panel) {
  if (!panel) {
    return;
  }

  var listPane = panel.querySelector('.problem-list-pane');
  var listEl = panel.querySelector('.problem-question-list');
  var detailPane = panel.querySelector('.problem-detail-pane');
  var previewContentEl = panel.querySelector('.problem-detail-content[data-tab="preview"]');
  var yamlContentEl = panel.querySelector('.problem-detail-content[data-tab="yaml"]');
  var yamlEl = panel.querySelector('.problem-detail-yaml');

  if (!listPane || !listEl || !detailPane) {
    return;
  }

  if (previewContentEl) {
    var measuredPreviewHeight = previewContentEl.offsetHeight;
    if (measuredPreviewHeight > 0) {
      panel.dataset.previewHeight = String(measuredPreviewHeight);
    }
  }

  var savedPreviewHeight = Number(panel.dataset.previewHeight || 0);
  var previewHeight = Math.max(260, savedPreviewHeight || detailPane.offsetHeight);

  if (yamlContentEl) {
    yamlContentEl.style.height = previewHeight + 'px';
    yamlContentEl.style.minHeight = previewHeight + 'px';
    yamlContentEl.style.maxHeight = previewHeight + 'px';
  }
  if (yamlEl) {
    yamlEl.style.height = '100%';
    yamlEl.style.maxHeight = '100%';
  }

  var targetHeight = Math.max(260, detailPane.offsetHeight);
  listPane.style.height = targetHeight + 'px';
  listPane.style.maxHeight = targetHeight + 'px';

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

function renderProblemDetail(panel, question, metadata) {
  if (!panel || !question) {
    return;
  }

  var titleEl = panel.querySelector('.problem-detail-title');
  var outputEl = panel.querySelector('.problem-detail-question');
  var answerEl = panel.querySelector('.problem-detail-answer');
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
      if (question.answer_type || (question.points !== undefined && question.points > 0) || (question.category_count !== undefined && question.category_count > 0)) {
        answerHTML += '<div style="margin-top: 12px; padding-top: 12px; border-top: 1px solid #e0e0e0;">';
        
        if (question.answer_type) {
          var answerTypeDisplay = question.answer_type.replace(/_/g, ' ').charAt(0).toUpperCase() + question.answer_type.slice(1).replace(/_/g, ' ').toLowerCase();
          answerHTML += '<div style="margin-bottom: 6px;"><strong>Answer Type:</strong> ' + answerTypeDisplay + '</div>';
        }
        
        if (question.points !== undefined && question.points > 0) {
          answerHTML += '<div style="margin-bottom: 6px;"><strong>Points Worth:</strong> ' + question.points + '</div>';
        }
        
        if (question.category_count !== undefined && question.category_count > 0) {
          answerHTML += '<div style="margin-bottom: 6px;"><strong>Categories:</strong> ' + question.category_count + '</div>';
        }
        
        answerHTML += '</div>';
      }
      
      answerEl.innerHTML = answerHTML;
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

function renderProblemQuestionList(classContainer, questions, metadata) {
  var listEl = classContainer.querySelector('.problem-question-list');
  var panel = classContainer.querySelector('.problem-browser-panel');
  if (!listEl || !panel) {
    return;
  }

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
    var emptyState = document.createElement('p');
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
    }, metadata);
    return;
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

    var unitSidebar = document.createElement('div');
    unitSidebar.className = 'course-unit-sidebar';
    unitSidebar.innerHTML = '<h3>Units</h3>';

    var unitList = document.createElement('div');
    unitList.className = 'course-unit-list';
    unitSidebar.appendChild(unitList);

    var problemPane = document.createElement('div');
    problemPane.className = 'course-problem-pane';
    problemPane.innerHTML = '<h3>Select a problem bank</h3><p class="course-problem-help">Choose a unit on the left, then choose a problem bank here.</p>';

    var problemList = document.createElement('div');
    problemList.className = 'course-problem-list';
    problemPane.appendChild(problemList);

    browserLayout.appendChild(unitSidebar);
    browserLayout.appendChild(problemPane);

    var workspaceLayout = document.createElement('div');
    workspaceLayout.className = 'course-workspace-layout';
    workspaceLayout.appendChild(browserLayout);

    var browserPanel = document.createElement('div');
    browserPanel.className = 'problem-browser-panel';

    var selectedSummary = document.createElement('div');
    selectedSummary.className = 'problem-selected-summary';
    selectedSummary.innerHTML = '<p><strong>Selected Problem Bank:</strong> <span class="problem-selected-problem">No problem bank selected</span></p><p class="problem-selected-path"></p>';
    browserPanel.appendChild(selectedSummary);

    var split = document.createElement('div');
    split.className = 'problem-browser-split';

    var listPane = document.createElement('div');
    listPane.className = 'problem-list-pane';
    listPane.innerHTML = '<h3>YAML Problems</h3><div class="problem-question-list"><p class="problem-browser-empty">Select a problem bank to view its questions.</p></div>';

    var detailPane = document.createElement('div');
    detailPane.className = 'problem-detail-pane';
    detailPane.innerHTML = '<div class="problem-detail-title">No question selected</div><div class="problem-detail-tabs"><button type="button" class="problem-detail-tab active" data-tab="preview">Preview</button><button type="button" class="problem-detail-tab" data-tab="latex">LaTeX Source Code</button><button type="button" class="problem-detail-tab" data-tab="yaml">YAML Source Code</button></div><div class="problem-detail-content" data-tab="preview"><div class="problem-detail-question"></div><img class="problem-detail-figure" alt="Problem figure" style="display: none;" /><div class="problem-detail-answer"></div></div><div class="problem-detail-content" data-tab="latex" style="display: none;"><pre class="problem-detail-latex"></pre></div><div class="problem-detail-content" data-tab="yaml" style="display: none;"><pre class="problem-detail-yaml"></pre></div>';

    split.appendChild(listPane);
    split.appendChild(detailPane);
    browserPanel.appendChild(split);
    workspaceLayout.appendChild(browserPanel);
    classContainer.appendChild(workspaceLayout);

    var sortedUnits = (cls.units || []).slice().sort(function (a, b) {
      return (a.sort_order || 0) - (b.sort_order || 0);
    });

    function resetProblemDetail() {
      var selectedProblemEl = classContainer.querySelector('.problem-selected-problem');
      var selectedPathEl = classContainer.querySelector('.problem-selected-path');
      if (selectedProblemEl) {
        selectedProblemEl.textContent = 'No problem bank selected';
      }
      if (selectedPathEl) {
        selectedPathEl.textContent = '';
      }
      renderProblemQuestionList(classContainer, [], {});
    }

    function renderProblemBanksForUnit(unit) {
      problemList.innerHTML = '';

      var heading = problemPane.querySelector('h3');
      if (heading) {
        heading.textContent = 'Unit ' + String((unit.sort_order || 0) + 1) + ' Problem Banks';
      }

      var problems = Array.isArray(unit.problems) ? unit.problems : [];
      if (!problems.length) {
        var emptyText = document.createElement('p');
        emptyText.className = 'course-problem-empty';
        emptyText.textContent = 'No problem banks are available for this unit.';
        problemList.appendChild(emptyText);
        resetProblemDetail();
        return;
      }

      resetProblemDetail();

      problems.forEach(function (problem) {
        var selectedPath = problem.yaml_path || '';
        var selectedTitle = problem.title || problem.code || 'Problem Bank';

        var bankButton = document.createElement('button');
        bankButton.type = 'button';
        bankButton.className = 'course-problem-button';
        bankButton.textContent = selectedTitle;

        bankButton.addEventListener('click', async function () {
          problemList.querySelectorAll('.course-problem-button').forEach(function (node) {
            node.classList.remove('active');
          });
          bankButton.classList.add('active');

          var selectedProblemEl = classContainer.querySelector('.problem-selected-problem');
          var selectedPathEl = classContainer.querySelector('.problem-selected-path');
          if (selectedProblemEl) {
            selectedProblemEl.textContent = selectedPath ? selectedTitle : 'No problem bank selected';
          }
          if (selectedPathEl) {
            selectedPathEl.textContent = selectedPath || '';
          }

          if (!selectedPath) {
            renderProblemQuestionList(classContainer, [], {});
            return;
          }

          try {
            var listEl = classContainer.querySelector('.problem-question-list');
            if (listEl) {
              listEl.innerHTML = '<p class="problem-browser-empty">Loading questions...</p>';
            }
            var result = await getProblemQuestions(selectedPath);
            renderProblemQuestionList(classContainer, result.questions, result.metadata);
          } catch (error) {
            var listElError = classContainer.querySelector('.problem-question-list');
            if (listElError) {
              listElError.innerHTML = '<p class="problem-browser-empty">Unable to load questions for this file.</p>';
            }
          }
        });

        problemList.appendChild(bankButton);
      });
    }

    sortedUnits.forEach(function (unit, unitIndex) {
      var unitNumber = (unit.sort_order || unitIndex) + 1;
      var unitButton = document.createElement('button');
      unitButton.type = 'button';
      unitButton.className = 'course-unit-button';
      var unitLabel = (unit.name || '').trim() || 'Unit';
      unitButton.innerHTML = '<span class="course-unit-icon">' + String(unitNumber) + '</span><span class="course-unit-label">' + unitLabel + '</span>';

      unitButton.addEventListener('click', function () {
        unitList.querySelectorAll('.course-unit-button').forEach(function (btn) {
          btn.classList.remove('active');
        });
        unitButton.classList.add('active');
        renderProblemBanksForUnit(unit);
      });

      unitList.appendChild(unitButton);
    });

    var defaultUnitButton = unitList.querySelector('.course-unit-button');
    if (defaultUnitButton) {
      defaultUnitButton.click();
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
