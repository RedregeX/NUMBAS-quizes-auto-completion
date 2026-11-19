
(async () => {
  const AUTO_SUBMIT = true; // false = preview only

  const host = document.querySelector('numbas-exam');
  const root = host?.shadowRoot || document;
  const exam = window.Numbas?.exam || host?.exam;

  if (!exam?.questionList) {
    console.error('No Numbas exam in this console context.');
    return;
  }

  const found = new Set();
  const results = [];
  const groups = new Map();
  const choiceTypes = new Set(['1_n_2', 'm_n_2', 'm_n_x']);

  function outer(p) {
    while (p?.isGap && p.parentPart) {
      p = p.parentPart;
    }
    return p;
  }

  function isLoaded(p) {
    const html = outer(p)?.display?.html;
    return !!html && (
      root.contains?.(html) || html.isConnected
    );
  }

  function done(p) {
    return !!(
      p.locked ||
      p.revealed ||
      (p.answered && p.marks > 0 && p.score >= p.marks)
    );
  }

  function allParts(p, out) {
    if (!p || found.has(p)) return;
    found.add(p);

    if (p.type !== 'gapfill') {
      out.push(p);
    }

    for (const child of p.gaps || []) {
      allParts(child, out);
    }

    if (p.stepsShown) {
      for (const step of p.steps || []) {
        allParts(step, out);
      }
    }
  }

  function getAnswer(p) {
    const s = p.settings || {};
    const scope = typeof p.getScope === 'function'
      ? p.getScope()
      : undefined;

    // Prefer an answer formatted for the widget.
    const w = p.display?.correct_answer;

    if (typeof w === 'function') {
      const a = w();

      if (
        a?.valid === true &&
        a.value !== undefined &&
        a.value !== null &&
        a.value !== ''
      ) {
        return a.value;
      }
    }

    // Numbers, fractions, decimals, scientific notation.
    if (p.type === 'numberentry') {
      const a = s.displayAnswer ??
        p.getCorrectAnswer?.(scope);

      return a == null ? null : String(a).trim();
    }

    // Algebra, differentiation, graph formulas.
    if (p.type === 'jme') {
      const a = s.correctAnswer ||
        p.getCorrectAnswer?.(scope);

      return typeof a === 'string' ? a.trim() : null;
    }

    // Text entry, T/F truth tables, pattern matching.
    if (p.type === 'patternmatch') {
      const a = s.displayAnswer ||
        p.getCorrectAnswer?.(scope);

      return typeof a === 'string' ? a : null;
    }

    // Multiple choice, checkboxes and matching grids.
    if (choiceTypes.has(p.type)) {
      const a = s.maxMatrix ||
        p.getCorrectAnswer?.(scope);

      if (
        !Array.isArray(a) ||
        a.length !== p.numAnswers ||
        a.some(row =>
          !Array.isArray(row) ||
          row.length !== p.numChoices
        )
      ) {
        return null;
      }

      return a.map(row => row.map(Boolean));
    }

    // Matrix entry.
    if (p.type === 'matrix') {
      const a = p.getCorrectAnswer?.(scope);

      return Array.isArray(a) &&
        a.every(row => Array.isArray(row))
        ? a
        : null;
    }

    // Custom question types.
    if (p.is_custom_part_type) {
      const widget = p.input_widget?.();
      const a = p.input_options?.()?.correctAnswer ??
        p.getCorrectAnswer?.(scope);

      // Quantity with units and typed custom answers.
      if (['string', 'number', 'quantity'].includes(widget)) {
        return (
          typeof a === 'string' ||
          typeof a === 'number'
        ) ? String(a) : null;
      }

      // Custom mathematical expression.
      if (widget === 'jme') {
        if (typeof a === 'string') return a;

        const printer =
          window.Numbas?.jme?.display?.treeToJME;

        return a && printer
          ? printer(a, {}, scope)
          : null;
      }

      // Custom radio buttons and dropdowns.
      if (['radios', 'dropdown'].includes(widget)) {
        return Number.isInteger(a) && a >= 0
          ? a
          : null;
      }

      // Custom checkboxes.
      if (widget === 'checkboxes') {
        return Array.isArray(a) &&
          a.every(v => typeof v === 'boolean')
          ? a
          : null;
      }

      // Custom matrices.
      if (widget === 'matrix') {
        return Array.isArray(a) ? a : null;
      }
    }

    return null;
  }

  // Collect every loaded question, including offscreen parts.
  const parts = [];

  for (const question of exam.questionList) {
    for (const p of question.parts || []) {
      allParts(p, parts);
    }
  }

  // Process answers.
  for (const p of parts) {
    if (!isLoaded(p)) continue;

    const row = {
      question: p.question?.name || '',
      part: p.name || p.path || '',
      type: p.type,
      status: ''
    };

    results.push(row);

    if (done(p)) {
      row.status = 'Already complete / locked';
      continue;
    }

    try {
      const a = getAnswer(p);

      if (
        a == null ||
        a === '' ||
        (Array.isArray(a) && !a.length)
      ) {
        row.status =
          'Unsupported or no representative answer';
        continue;
      }

      row.answer = (
        typeof a === 'object'
          ? JSON.stringify(a)
          : String(a)
      ).slice(0, 120);

      if (AUTO_SUBMIT) {
        // Newer Numbas answer widgets.
        if (typeof p.display?.input_answer === 'function') {
          p.display.input_answer({
            valid: true,
            value: a,
            warnings: []
          });

        // Classic Numbas runtime.
        } else if (typeof p.storeAnswer === 'function') {
          p.storeAnswer(a);

        } else {
          row.status = 'No answer-entry method';
          continue;
        }

        row.status = 'Entered';

        // Submit the parent gap-fill once.
        const parent = outer(p);

        if (!groups.has(parent)) {
          groups.set(parent, []);
        }

        groups.get(parent).push(row);

      } else {
        row.status = 'Preview';
      }

    } catch (e) {
      row.status = 'Error: ' + e.message;
    }
  }

  // Submit all successfully staged answers.
  if (AUTO_SUBMIT) {
    for (const [p, rows] of groups) {
      try {
        if (typeof p.submit === 'function') {
          const returned = p.submit();

          if (returned?.then) {
            await returned;
          }

        } else if (
          typeof p.display?.controls?.submit === 'function'
        ) {
          const returned = p.display.controls.submit();

          if (returned?.then) {
            await returned;
          }

        } else {
          rows.forEach(r => {
            r.status = 'No submission method';
          });
        }

      } catch (e) {
        rows.forEach(r => {
          r.status = 'Submit error: ' + e.message;
        });
      }
    }
  }

  // Display answer-processing report.
  console.table(results);

  console.log(
    'Loaded candidate parts:', results.length,
    '| Submitted parent parts:', groups.size
  );

  // Verify actual marks.
  if (AUTO_SUBMIT) {
    setTimeout(() => {
      const scores = [...groups.keys()].map(p => ({
        question: p.question?.name || '',
        part: p.name || p.path,
        score: `${p.score}/${p.marks}`,
        fullMarks: !!(
          p.answered &&
          p.marks > 0 &&
          p.score >= p.marks
        )
      }));

      console.table(scores);

      console.log(
        'Full marks:',
        scores.filter(s => s.fullMarks).length,
        '/',
        scores.length
      );
    }, 1200);
  }
})();
