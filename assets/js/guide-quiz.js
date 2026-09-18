/* ==========================================================================
   guide-quiz.js — subject-neutral "check your understanding" engine for
   guide-kit pages. Sits alongside guide-core.js/guide-math.js: the UI and
   scoring logic here are identical across every series, only the per-page
   QUIZ_QUESTIONS array (authored inline in each page's own {% raw %} block)
   differs. Two question kinds: 'choice' (one correct option, revealed
   instantly on click) and 'numeric' (a value within tolerance, checked on
   submit). Progress is a single versioned localStorage blob, read/written
   defensively since private-mode browsers can throw on access.
   ========================================================================== */
(function (global) {
  "use strict";

  var STORE_KEY = 'guide:quiz:v1';

  function loadStore() {
    try {
      var raw = localStorage.getItem(STORE_KEY);
      if (!raw) return { answers: {}, totals: {} };
      var parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return { answers: {}, totals: {} };
      return { answers: parsed.answers || {}, totals: parsed.totals || {} };
    } catch (e) {
      return { answers: {}, totals: {} };
    }
  }

  function saveStore(store) {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(store)); } catch (e) { /* private mode, quota, etc */ }
  }

  function registerTotal(pageId, total) {
    var store = loadStore();
    store.totals[pageId] = total;
    saveStore(store);
  }

  function setAnswered(pageId, questionId, record) {
    var store = loadStore();
    if (!store.answers[pageId]) store.answers[pageId] = {};
    store.answers[pageId][questionId] = record;
    saveStore(store);
  }

  function getProgress(pageId) {
    var store = loadStore();
    var answers = store.answers[pageId] || {};
    var total = store.totals[pageId] || 0;
    var answered = 0, correct = 0;
    Object.keys(answers).forEach(function (qid) {
      answered++;
      if (answers[qid] && answers[qid].correct) correct++;
    });
    return { answers: answers, answered: answered, total: total, correct: correct };
  }

  function updateBadge(badgeEl, pageId, total) {
    if (!badgeEl) return;
    var p = getProgress(pageId);
    var n = total != null ? total : p.total;
    if (!n) { badgeEl.style.display = 'none'; return; }
    badgeEl.style.display = '';
    badgeEl.textContent = p.answered + '/' + n + ' answered';
    if (p.answered >= n) badgeEl.classList.add('done'); else badgeEl.classList.remove('done');
  }

  function tolerance(q) {
    if (typeof q.tolerance === 'number') return q.tolerance;
    if (typeof q.relativeTolerance === 'number') return q.relativeTolerance * Math.abs(q.answer);
    return 1e-6;
  }

  function scoreChoice(question, selectedIndex) {
    var correctIndex = -1;
    question.options.forEach(function (o, i) { if (o.correct) correctIndex = i; });
    return { correct: selectedIndex === correctIndex, correctIndex: correctIndex };
  }

  function scoreNumeric(question, rawValue) {
    var parsed = parseFloat(rawValue);
    var tol = tolerance(question);
    var correct = isFinite(parsed) && Math.abs(parsed - question.answer) <= tol;
    return { correct: correct, answer: question.answer, unit: question.unit || '' };
  }

  function el(tag, cls, html) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  }

  function renderChoiceQuestion(q, idx, pageId, badgeEl, total, existing) {
    var wrap = el('div', 'g-quiz-q');
    wrap.appendChild(el('p', 'g-quiz-prompt', '<span class="g-quiz-qnum">' + (idx + 1) + '.</span> ' + q.prompt));
    var opts = el('div', 'g-quiz-choice-list');
    var feedback = el('div', 'g-quiz-feedback');
    var explain = el('div', 'g-quiz-explain', q.explanation || '');
    feedback.style.display = 'none';
    explain.style.display = 'none';

    var locked = !!existing;

    function reveal(selectedIndex, correct, correctIndex) {
      Array.prototype.forEach.call(opts.children, function (btn, i) {
        btn.disabled = true;
        if (i === correctIndex) btn.classList.add('correct');
        else if (i === selectedIndex) btn.classList.add('incorrect');
      });
      feedback.style.display = '';
      feedback.className = 'g-quiz-feedback ' + (correct ? 'hi' : 'bad');
      feedback.textContent = correct ? 'Correct.' : 'Not quite — the correct answer is highlighted above.';
      if (q.explanation) explain.style.display = '';
      wrap.classList.add('answered');
    }

    q.options.forEach(function (opt, i) {
      var btn = el('button', 'g-quiz-choice', opt.label);
      btn.type = 'button';
      btn.addEventListener('click', function () {
        if (locked) return;
        locked = true;
        var res = scoreChoice(q, i);
        reveal(i, res.correct, res.correctIndex);
        setAnswered(pageId, q.id, { correct: res.correct, picked: i });
        updateBadge(badgeEl, pageId, total);
      });
      opts.appendChild(btn);
    });

    wrap.appendChild(opts);
    wrap.appendChild(feedback);
    wrap.appendChild(explain);

    if (existing) {
      var res2 = scoreChoice(q, existing.picked);
      reveal(existing.picked, existing.correct, res2.correctIndex);
    }
    return wrap;
  }

  function renderNumericQuestion(q, idx, pageId, badgeEl, total, existing) {
    var wrap = el('div', 'g-quiz-q');
    wrap.appendChild(el('p', 'g-quiz-prompt', '<span class="g-quiz-qnum">' + (idx + 1) + '.</span> ' + q.prompt));
    var row = el('div', 'g-quiz-numeric-row');
    var input = document.createElement('input');
    input.type = 'text';
    input.inputMode = 'decimal';
    input.autocomplete = 'off';
    input.placeholder = q.unit ? ('value in ' + q.unit) : 'value';
    var btnRow = el('div', 'g-btnrow');
    var btn = el('button', 'g-primary', 'Check answer');
    btn.type = 'button';
    btnRow.appendChild(btn);
    var feedback = el('div', 'g-quiz-feedback');
    var explain = el('div', 'g-quiz-explain', q.explanation || '');
    feedback.style.display = 'none';
    explain.style.display = 'none';

    var locked = !!existing;

    function reveal(correct, answerVal) {
      input.disabled = true;
      btn.disabled = true;
      feedback.style.display = '';
      feedback.className = 'g-quiz-feedback ' + (correct ? 'hi' : 'bad');
      feedback.textContent = correct
        ? 'Correct.'
        : ('Not quite — the answer is ' + answerVal + (q.unit ? (' ' + q.unit) : '') + '.');
      if (q.explanation) explain.style.display = '';
      wrap.classList.add('answered');
    }

    function submit() {
      if (locked) return;
      locked = true;
      var res = scoreNumeric(q, input.value);
      reveal(res.correct, res.answer);
      setAnswered(pageId, q.id, { correct: res.correct, value: input.value });
      updateBadge(badgeEl, pageId, total);
    }

    btn.addEventListener('click', submit);
    input.addEventListener('keydown', function (ev) { if (ev.key === 'Enter') submit(); });

    row.appendChild(input);
    row.appendChild(btnRow);
    wrap.appendChild(row);
    wrap.appendChild(feedback);
    wrap.appendChild(explain);

    if (existing) {
      if (existing.value != null) input.value = existing.value;
      reveal(existing.correct, q.answer);
    }
    return wrap;
  }

  function render(container, questions, pageId) {
    container.innerHTML = '';
    var stepEl = container.closest ? container.closest('.g-step') : null;
    var badgeEl = stepEl ? stepEl.querySelector('[data-quiz-badge]') : null;
    var total = questions.length;
    registerTotal(pageId, total);

    if (!total) {
      container.appendChild(el('p', 'g-quiz-empty', 'Questions for this part are coming soon.'));
      if (badgeEl) badgeEl.style.display = 'none';
      return;
    }

    var progress = getProgress(pageId);
    questions.forEach(function (q, idx) {
      var existing = progress.answers[q.id];
      var node = q.kind === 'numeric'
        ? renderNumericQuestion(q, idx, pageId, badgeEl, total, existing)
        : renderChoiceQuestion(q, idx, pageId, badgeEl, total, existing);
      container.appendChild(node);
    });

    updateBadge(badgeEl, pageId, total);
  }

  function init(container, questions, pageId) {
    if (!container || !pageId) return;
    render(container, questions || [], pageId);
  }

  global.GuideQuiz = {
    init: init,
    render: render,
    scoreChoice: scoreChoice,
    scoreNumeric: scoreNumeric,
    getProgress: getProgress,
    setAnswered: setAnswered,
    updateBadge: updateBadge
  };
})(window);
