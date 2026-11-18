
(async () => {
  const host = document.querySelector('numbas-exam');
  const root = host?.shadowRoot;
  const exam = window.Numbas?.exam;

  if (!root || !exam) {
    console.error('Select the Numbas exam frame in DevTools.');
    return;
  }

  const results = [];
  const queued = new Map();
  const visited = new Set();

  function outerPart(p) {
    while (p?.isGap && p.parentPart) {
      p = p.parentPart;
    }
    return p;
  }

  function loaded(p) {
    const outer = outerPart(p);
    const node = outer?.display?.html;

    return !!node && root.contains(node);
  }

  function fallback(p) {
    if (p.type === 'numberentry') {
      const answer = p.getCorrectAnswer?.(p.getScope());
      return answer ?? p.settings?.displayAnswer;
    }

    if (p.type === 'jme') {
      const s = p.settings?.correctAnswer;

      if (typeof s === 'string' && s.trim()) {
        return s;
      }

      const tree = p.getCorrectAnswer?.(p.getScope());

      if (typeof tree === 'string') {
        return tree;
      }

      if (tree && window.Numbas?.jme?.display?.treeToJME) {
        return Numbas.jme.display.treeToJME(
          tree, {}, p.getScope()
        );
      }
    }

    return null;
  }

  function scan(p) {
    if (!p || visited.has(p)) return;
    visited.add(p);

    if (p.type === 'gapfill') {
      (p.gaps || []).forEach(scan);
      (p.steps || []).forEach(scan);
      return;
    }

    (p.steps || []).forEach(scan);

    if (
      !loaded(p) ||
      !p.display ||
      p.locked ||
      p.revealed ||
      (p.answered && p.marks > 0 && p.score >= p.marks)
    ) {
      return;
    }

    const row = {
      question: p.question?.name,
      part: p.name || p.path,
      type: p.type
    };

    results.push(row);

    try {
      const native =
        typeof p.display.correct_answer === 'function'
          ? p.display.correct_answer()
          : null;

      const value =
        native?.valid && native.value != null
          ? native.value
          : fallback(p);

      if (
        value == null ||
        value === '' ||
        (Array.isArray(value) && !value.length)
      ) {
        row.status = 'Skipped: no widget-compatible expected answer';
        return;
      }

      p.display.input_answer({
        valid: true,
        value,
        warnings: []
      });

      row.status = native?.valid
        ? 'Entered (widget answer)'
        : 'Entered (fallback)';

      row.value = typeof value === 'object'
        ? JSON.stringify(value).slice(0, 100)
        : String(value).slice(0, 100);

      const parent = outerPart(p);

      if (!queued.has(parent)) {
        queued.set(parent, []);
      }

      queued.get(parent).push(row);

    } catch (err) {
      row.status = 'Error: ' + err.message;
    }
  }

  for (const question of exam.questionList || []) {
    for (const part of question.parts || []) {
      scan(part);
    }
  }

  for (const [p, rows] of queued) {
    try {
      const r = p.display.controls.submit();

      if (r?.then) {
        await r;
      }

    } catch (err) {
      for (const row of rows) {
        row.status = 'Save failed: ' + err.message;
      }
    }
  }

  console.table(results);

  console.log(
    `Loaded fields checked: ${results.length}; ` +
    `parts submitted: ${queued.size}`
  );

  setTimeout(() => {
    console.table([...queued].map(([p]) => ({
      question: p.question?.name,
      part: p.name,
      score: `${p.score}/${p.marks}`,
      fullMarks: !!(
        p.answered &&
        p.marks > 0 &&
        p.score >= p.marks
      )
    })));
  }, 1200);
})();
