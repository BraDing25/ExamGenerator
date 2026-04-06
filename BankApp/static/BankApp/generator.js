/* Generator Page JavaScript */
var buttonLockState = null;

function lockAllButtons() {
  if (buttonLockState) {
    return;
  }

  buttonLockState = new Map();
  var buttons = document.querySelectorAll('button');
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

function getCurrentClassContainer() {
  var genbody2 = document.getElementById('genbody2');
  if (!genbody2) {
    return null;
  }

  return Array.from(genbody2.querySelectorAll('[id^="class"]'))
    .find(function (el) { return el.id !== 'classes' && el.style.display !== 'none'; }) || null;
}

function collectExamSelections() {
  var classContainer = getCurrentClassContainer();
  if (!classContainer) {
    return [];
  }

  var selections = [];
  var selectedInputs = classContainer.querySelectorAll('input[type="number"][data-yaml-path]');
  selectedInputs.forEach(function (input) {
    var count = parseInt(input.value, 10);
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
  var button = document.getElementById('cart-button');
  var examInput = document.getElementById('exam-count-input');
  if (!button || !examInput) {
    return;
  }

  var selections = collectExamSelections();
  if (!selections.length) {
    alert('Select at least one problem before generating exams.');
    return;
  }

  var examCount = parseInt(examInput.value, 10);
  if (Number.isNaN(examCount) || examCount < 1) {
    alert('Enter a valid number of exams.');
    return;
  }

  var previousLabel = button.textContent;
  lockAllButtons();
  button.classList.add('is-busy');
  button.textContent = 'Generating...';

  try {
    var generateApi = (window.appUrls && window.appUrls.generate_exams_api) || '/api/exams/generate/';
    var response = await fetch(generateApi, {
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
      var message = 'Generation failed (' + response.status + ').';
      try {
        var payload = await response.json();
        if (payload && payload.message) {
          message = payload.message;
        }
      } catch (error) {
        // Ignore parse failures and use generic message.
      }
      throw new Error(message);
    }

    var blob = await response.blob();
    var disposition = response.headers.get('Content-Disposition') || '';
    var match = disposition.match(/filename="?([^\"]+)"?/i);
    var filename = match ? match[1] : 'generated_exams.zip';

    var url = window.URL.createObjectURL(blob);
    var anchor = document.createElement('a');
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
  var button = document.getElementById('preview-button');
  if (!button) {
    return;
  }

  var selections = collectExamSelections();
  if (!selections.length) {
    alert('Select at least one problem before previewing.');
    return;
  }

  var previousLabel = button.textContent;
  button.disabled = true;
  button.textContent = 'Building Preview...';

  try {
    var previewApi = (window.appUrls && window.appUrls.preview_exam_api) || '/api/exams/preview/';
    var response = await fetch(previewApi, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRFToken': getCookie('csrftoken'),
      },
      body: JSON.stringify({ selections: selections }),
    });

    if (!response.ok) {
      var message = 'Preview failed (' + response.status + ').';
      try {
        var payload = await response.json();
        if (payload && payload.message) {
          message = payload.message;
        }
      } catch (error) {
        // Ignore parse failures and use generic message.
      }
      throw new Error(message);
    }

    var blob = await response.blob();
    var url = window.URL.createObjectURL(blob);
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
  var button = document.getElementById('cart-button');
  if (!button) {
    return;
  }
  button.addEventListener('click', handleGenerateExamClick);
}

function setupPreviewExamButton() {
  var button = document.getElementById('preview-button');
  if (!button) {
    return;
  }
  button.addEventListener('click', handlePreviewExamClick);
}

function openProblemModal(problemData) {
  var modalOverlay = document.getElementById('problem-modal-overlay');
  var modalTitle = document.getElementById('problem-modal-title');
  var modalDescription = document.getElementById('problem-modal-description');
  var modalExample = document.getElementById('problem-modal-example');
  var modalFigure = document.getElementById('problem-modal-figure');

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
    var figureUrl = problemData.figureUrl || '';
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
  var modalOverlay = document.getElementById('problem-modal-overlay');
  if (modalOverlay) {
    modalOverlay.classList.remove('open');
    modalOverlay.setAttribute('aria-hidden', 'true');
  }
}

function setupProblemModal() {
  var modalOverlay = document.getElementById('problem-modal-overlay');
  var modalClose = document.getElementById('problem-modal-close');

  document.addEventListener('click', function (event) {
    var infoButton = event.target.closest('button.problem-info-button');
    if (infoButton) {
      openProblemModal({
        title: infoButton.dataset.problemTitle || 'Problem',
        description: infoButton.dataset.problemDescription || '',
        example: infoButton.dataset.problemExample || '',
        figureUrl: infoButton.dataset.problemFigureUrl || '',
      });
      return;
    }

    var viewButton = event.target.closest('button.select-button');
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

    var problemCard = viewButton.closest('.problem-select');
    var problemText = problemCard && problemCard.querySelector('h3')
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

function switchUnit(evt, unit) {
  var i;
  var tabcontent = document.getElementsByClassName('tabcontent');
  for (i = 0; i < tabcontent.length; i++) {
    tabcontent[i].style.display = 'none';
  }
  var tablinks = document.getElementsByClassName('tablinks');
  for (i = 0; i < tablinks.length; i++) {
    tablinks[i].className = tablinks[i].className.replace(' active', '');
  }
  document.getElementById(unit).style.display = 'block';
  evt.currentTarget.className += ' active';
}

function setProblemAccordionState(accordionItem, shouldOpen) {
  if (!accordionItem) {
    return;
  }

  var toggleButton = accordionItem.querySelector('.problem-accordion-toggle');
  var contentPanel = accordionItem.querySelector('.problem-accordion-content');

  accordionItem.classList.toggle('open', shouldOpen);
  if (toggleButton) {
    toggleButton.setAttribute('aria-expanded', shouldOpen ? 'true' : 'false');
  }
  if (contentPanel) {
    contentPanel.hidden = !shouldOpen;
  }
}

function toggleProblemAccordion(toggleButton) {
  var accordionItem = toggleButton.closest('.problem-accordion');
  if (!accordionItem) {
    return;
  }

  var tabContent = toggleButton.closest('.tabcontent');
  var shouldOpen = !accordionItem.classList.contains('open');

  if (tabContent) {
    tabContent.querySelectorAll('.problem-accordion.open').forEach(function (openItem) {
      if (openItem !== accordionItem) {
        setProblemAccordionState(openItem, false);
      }
    });
  }

  setProblemAccordionState(accordionItem, shouldOpen);
}

function resetClassSelections(classContainer) {
  var inputs = classContainer.querySelectorAll('input[type="number"]');
  inputs.forEach(function (input) {
    input.value = input.min || 0;
  });
}

function clearCart() {
  var genbody2 = document.getElementById('genbody2');
  if (!genbody2) {
    return;
  }
  var visibleClass = Array.from(genbody2.querySelectorAll('[id^="class"]'))
    .find(function (el) { return el.style.display !== 'none'; });
  if (!visibleClass) {
    return;
  }
  resetClassSelections(visibleClass);
  var match = visibleClass.id.match(/^class(\d+)$/);
  if (match) {
    updateShoppingCart(parseInt(match[1], 10));
  }
}

function getClassNumberFromInput(inputEl) {
  var tabContent = inputEl.closest('.tabcontent');
  if (!tabContent || !tabContent.id) {
    return null;
  }
  var match = tabContent.id.match(/^class(\d+)-unit\d+$/);
  return match ? parseInt(match[1], 10) : null;
}

function summarizeCartLabel(label) {
  var clean = String(label || '').replace(/\s+/g, ' ').trim();
  if (!clean) {
    return 'Problem';
  }
  var maxLen = 36;
  if (clean.length <= maxLen) {
    return clean;
  }
  return clean.slice(0, maxLen - 1).trimEnd() + '...';
}

function updateShoppingCart(classNumber) {
  if (!classNumber) {
    return;
  }

  var classContainer = document.getElementById('class' + String(classNumber));
  var cart = document.getElementById('cart');
  if (!classContainer || !cart) {
    return;
  }

  var inputs = classContainer.querySelectorAll('input[type="number"]');
  var unitData = new Map();
  var totalQuestions = 0;

  inputs.forEach(function (input) {
    var value = parseInt(input.value, 10);
    var count = Number.isNaN(value) ? 0 : value;
    if (count <= 0) {
      return;
    }

    var unit = parseInt(input.dataset.unit, 10);
    var problemLabel = input.dataset.problem || 'Problem';
    if (!unitData.has(unit)) {
      unitData.set(unit, []);
    }
    unitData.get(unit).push({ problemLabel: problemLabel, count: count });
    totalQuestions += count;
  });

  cart.innerHTML = '';

  var sortedUnits = Array.from(unitData.keys()).sort(function (a, b) { return a - b; });
  sortedUnits.forEach(function (unitNumber) {
    var unitHeading = document.createElement('p');
    unitHeading.textContent = 'Unit ' + String(unitNumber);
    cart.appendChild(unitHeading);

    var list = document.createElement('ul');
    var problems = unitData.get(unitNumber).sort(function (a, b) { return a.problemLabel.localeCompare(b.problemLabel); });
    problems.forEach(function (item) {
      var li = document.createElement('li');
      li.textContent = summarizeCartLabel(item.problemLabel) + ':';
      var countSpan = document.createElement('span');
      countSpan.textContent = String(item.count);
      li.appendChild(countSpan);
      list.appendChild(li);
    });
    cart.appendChild(list);
  });

  var totalWrapper = document.createElement('span');
  var totalLabel = document.createElement('b');
  totalLabel.textContent = 'Total Questions:';
  var totalValue = document.createElement('p');
  totalValue.textContent = String(totalQuestions);
  totalWrapper.appendChild(totalLabel);
  totalWrapper.appendChild(totalValue);
  cart.appendChild(totalWrapper);
}

function generateGenPage(classes) {
  var classesRoot = document.getElementById('classes');
  var genbody2 = document.getElementById('genbody2');

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
    var i = classIndex + 1;

    var layer1 = document.createElement('div');
    layer1.style.display = 'flex';
    layer1.style.flexDirection = 'row';

    var layer2 = document.createElement('div');
    layer2.className = 'class-select';

    var heading = document.createElement('h1');
    heading.textContent = cls.name;

    var button = document.createElement('button');
    button.className = 'select-button';
    button.onclick = function () { showClass(i); };
    button.textContent = 'Select';

    layer2.appendChild(heading);
    layer2.appendChild(button);
    layer1.appendChild(layer2);

    classesRoot.appendChild(layer1);

    var mainLayer = document.createElement('div');
    mainLayer.id = 'class' + String(i);
    mainLayer.style.display = 'none';

    var backButton = document.createElement('button');
    backButton.className = 'back';
    backButton.onclick = function () {
      resetClassSelections(mainLayer);
      selectFirstUnit(i);
      updateShoppingCart(i);
      showClass(i);
    };
    backButton.textContent = 'Start Over';
    mainLayer.appendChild(backButton);

    var tabsLayer = document.createElement('div');
    tabsLayer.className = 'tabs';

    cls.units.forEach(function (unit, unitIndex) {
      var j = unitIndex + 1;
      var tabButton = document.createElement('button');
      tabButton.className = 'tablinks';
      tabButton.id = j === 1 ? 'defaulttab-' + String(i) : '';
      tabButton.onclick = function (evt) { switchUnit(evt, 'class' + String(i) + '-unit' + String(j)); };
      tabButton.textContent = 'Unit ' + String(unit.sort_order + 1);
      tabsLayer.appendChild(tabButton);
    });
    mainLayer.appendChild(tabsLayer);

    var unitsLayer = document.createElement('div');
    unitsLayer.className = 'units';

    cls.units.forEach(function (unit, unitIndex) {
      var j = unitIndex + 1;
      var unitContent = document.createElement('div');
      unitContent.id = 'class' + String(i) + '-unit' + String(j);
      unitContent.className = 'tabcontent';

      var accordionList = document.createElement('div');
      accordionList.className = 'problem-accordion-list';

      unit.problems.forEach(function (problem, problemIndex) {
        var k = problemIndex + 1;
        var problemLayer = document.createElement('div');
        problemLayer.className = 'probselect problem-accordion';

        var accordionHeader = document.createElement('button');
        accordionHeader.className = 'problem-accordion-toggle';
        accordionHeader.type = 'button';
        accordionHeader.setAttribute('aria-expanded', 'false');

        var infoButton = document.createElement('button');
        infoButton.className = 'problem-info-button';
        infoButton.type = 'button';
        infoButton.textContent = 'i';
        infoButton.setAttribute('aria-label', 'View problem details');
        infoButton.dataset.problemTitle = problem.title || ('Problem ' + String(k));
        infoButton.dataset.problemDescription = problem.description || '';
        infoButton.dataset.problemExample = problem.example || '';
        infoButton.dataset.problemFigureUrl = problem.figure_url || '';

        var headerLabel = document.createElement('span');
        headerLabel.className = 'problem-accordion-heading';
        headerLabel.textContent = problem.title || ('Problem Bank ' + String(k));

        var accordionChevron = document.createElement('span');
        accordionChevron.className = 'problem-accordion-chevron';
        accordionChevron.setAttribute('aria-hidden', 'true');
        accordionChevron.textContent = '\u25be';

        accordionHeader.appendChild(headerLabel);
        accordionHeader.appendChild(accordionChevron);

        var accordionContent = document.createElement('div');
        accordionContent.className = 'problem-accordion-content';
        accordionContent.hidden = true;

        var problemHeading = document.createElement('h3');
        problemHeading.textContent = 'Problem Bank ' + String(k);

        var problemTitle = document.createElement('p');
        problemTitle.textContent = problem.title;
        problemTitle.style.fontWeight = 'bold';

        var problemSubtitle = document.createElement('p');
        problemSubtitle.textContent = 'Select # of Questions';

        var problemSelect = document.createElement('span');
        problemSelect.className = 'quantselect';

        var decrementBtn = document.createElement('button');
        decrementBtn.className = 'decrement-btn';
        decrementBtn.textContent = '-';

        var numberInput = document.createElement('input');
        numberInput.type = 'number';
        numberInput.value = '0';
        numberInput.min = '0';
        numberInput.max = String(problem.question_count || 10);
        numberInput.dataset.unit = String(j);
        numberInput.dataset.problem = problem.title || ('Problem ' + String(k));
        numberInput.dataset.yamlPath = problem.yaml_path || '';
        numberInput.dataset.unitName = unit.name || '';

        var incrementBtn = document.createElement('button');
        incrementBtn.className = 'increment-btn';
        incrementBtn.textContent = '+';

        problemSelect.appendChild(decrementBtn);
        problemSelect.appendChild(numberInput);
        problemSelect.appendChild(incrementBtn);

        accordionContent.appendChild(problemHeading);
        accordionContent.appendChild(problemTitle);
        accordionContent.appendChild(problemSubtitle);
        accordionContent.appendChild(problemSelect);

        problemLayer.appendChild(accordionHeader);
        problemLayer.appendChild(infoButton);
        problemLayer.appendChild(accordionContent);

        if (problemIndex === 0) {
          setProblemAccordionState(problemLayer, true);
        }

        accordionList.appendChild(problemLayer);
      });

      unitContent.appendChild(accordionList);

      unitsLayer.appendChild(unitContent);
    });

    mainLayer.appendChild(unitsLayer);
    genbody2.appendChild(mainLayer);
  });

  selectFirstUnit(1);
  updateShoppingCart(1);
}

document.addEventListener('click', function (evt) {
  if (evt.target.closest('.problem-accordion-toggle')) {
    toggleProblemAccordion(evt.target.closest('.problem-accordion-toggle'));
    return;
  }

  if (evt.target.id === 'clear-cart-btn') {
    clearCart();
  }

  if (evt.target.classList.contains('exam-count-increment') || evt.target.classList.contains('exam-count-decrement')) {
    var examInput = document.getElementById('exam-count-input');
    if (!examInput) {
      return;
    }
    var minValue = parseInt(examInput.min, 10) || 1;
    var maxValue = parseInt(examInput.max, 10) || 10;
    var currentValue = parseInt(examInput.value, 10);
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
    var incInput = evt.target.previousElementSibling;
    var incMax = parseInt(incInput.max, 10);
    var incCurrent = parseInt(incInput.value, 10);
    if (Number.isNaN(incCurrent)) {
      incCurrent = 0;
    }
    if (incCurrent < incMax) {
      incInput.value = incCurrent + 1;
    }
    updateShoppingCart(getClassNumberFromInput(incInput));
  }

  if (evt.target.classList.contains('decrement-btn')) {
    var decInput = evt.target.nextElementSibling;
    var decMin = parseInt(decInput.min, 10);
    var decCurrent = parseInt(decInput.value, 10);
    if (Number.isNaN(decCurrent)) {
      decCurrent = 0;
    }
    if (decCurrent > decMin) {
      decInput.value = decCurrent - 1;
    }
    updateShoppingCart(getClassNumberFromInput(decInput));
  }
});

document.addEventListener('change', function (evt) {
  if (evt.target.id === 'exam-count-input') {
    var examInput = evt.target;
    var minValue = parseInt(examInput.min, 10) || 1;
    var maxValue = parseInt(examInput.max, 10) || 10;
    var currentValue = parseInt(examInput.value, 10);
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
    var numberInput = evt.target;
    var maxValue = parseInt(numberInput.max, 10);
    var minValue = parseInt(numberInput.min, 10);
    var currentValue = parseInt(numberInput.value, 10);

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

document.addEventListener('DOMContentLoaded', async function () {
  var hasGeneratorPage = !!document.getElementById('genbody2') && !!document.getElementById('cart');
  if (!hasGeneratorPage) {
    return;
  }

  setupProblemModal();

  try {
    var classes = await getCatalogData();
    generateGenPage(classes);
    setupGenerateExamButton();
    setupPreviewExamButton();
  } catch (error) {
    console.error('Generator page error:', error);
    renderCatalogError(document.getElementById('classes'), 'Unable to load problem bank data.');
  }
});
