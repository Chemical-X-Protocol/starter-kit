import test from 'node:test';
import assert from 'node:assert';
import {
  deduplicateRolePreambles,
  deduplicateRefactoringCommands,
  buildGradeFPrompt,
  buildGradeDPrompt,
  buildGradeCPrompt,
  buildGradeBPrompt,
  buildAiSlopPrompt,
  buildHotspotsPrompt,
  buildPillarPrompt,
  buildMasterPrompt
} from './prompts.js';

test('deduplicateRolePreambles: handles invalid and empty inputs', () => {
  assert.strictEqual(deduplicateRolePreambles(''), '');
  assert.strictEqual(deduplicateRolePreambles(null), '');
  assert.strictEqual(deduplicateRolePreambles(undefined), '');
  assert.strictEqual(deduplicateRolePreambles(123), '');
});

test('deduplicateRolePreambles: leaves single role preamble untouched', () => {
  const single = 'Act as a Principal Systems Architect. Execute a phased architectural refactoring.';
  assert.strictEqual(deduplicateRolePreambles(single), single);
});

test('deduplicateRolePreambles: removes repeated identical role preambles', () => {
  const input = [
    'Act as a Principal Systems Architect. Execute a phased architectural refactoring of our codebase according to Chemical X Molecular Architecture Standards.',
    '',
    'Act as a Principal Systems Architect. Surgically refactor the following Grade F Critical Context Hazards in our codebase according to Chemical X Molecular Architecture Standards:'
  ].join('\n');

  const expected = [
    'Act as a Principal Systems Architect. Execute a phased architectural refactoring of our codebase according to Chemical X Molecular Architecture Standards.',
    '',
    'Surgically refactor the following Grade F Critical Context Hazards in our codebase according to Chemical X Molecular Architecture Standards:'
  ].join('\n');

  assert.strictEqual(deduplicateRolePreambles(input), expected);
});

test('deduplicateRolePreambles: removes subsequent different role preambles by default', () => {
  const input = [
    'Act as a Principal Systems Architect. Execute a phased refactor.',
    '',
    'Act as a Senior Frontend Engineer. Refactor the following Grade C Medium-Severity Technical Debts:',
    '',
    'Act as a Clean Code Specialist. Clean up the following Grade B Low-Severity Hygiene Issues:'
  ].join('\n');

  const expected = [
    'Act as a Principal Systems Architect. Execute a phased refactor.',
    '',
    'Refactor the following Grade C Medium-Severity Technical Debts:',
    '',
    'Clean up the following Grade B Low-Severity Hygiene Issues:'
  ].join('\n');

  assert.strictEqual(deduplicateRolePreambles(input), expected);
});

test('deduplicateRolePreambles: respects onlyIdentical option', () => {
  const input = [
    'Act as a Principal Systems Architect. Execute step 1.',
    '',
    'Act as a Senior Frontend Engineer. Refactor step 2.',
    '',
    'Act as a Principal Systems Architect. Decompose step 3.'
  ].join('\n');

  const result = deduplicateRolePreambles(input, { onlyIdentical: true });
  assert.ok(result.includes('Act as a Principal Systems Architect. Execute step 1.'));
  assert.ok(result.includes('Act as a Senior Frontend Engineer. Refactor step 2.'));
  assert.ok(result.includes('\n\nDecompose step 3.'));
  assert.ok(!result.includes('Act as a Principal Systems Architect. Decompose step 3.'));
});

test('buildGradeFPrompt: respects isSubSection option', () => {
  const mockReport = {
    violations: [
      {
        severity: 'CRITICAL',
        pillar: 'Test Pillar',
        message: 'Critical issue',
        filePath: 'src/heavy.ts',
        line: 10
      }
    ],
    hotspots: []
  };

  const standalone = buildGradeFPrompt(mockReport);
  assert.ok(standalone.startsWith('Act as a Principal Systems Architect. Surgically refactor'));

  const subSection = buildGradeFPrompt(mockReport, { isSubSection: true });
  assert.ok(subSection.startsWith('Surgically refactor'));
  assert.ok(!subSection.includes('Act as a Principal Systems Architect.'));
});

test('buildGradeDPrompt: respects isSubSection option', () => {
  const mockReport = {
    violations: [
      {
        severity: 'HIGH',
        pillar: 'Test Pillar',
        message: 'High severity issue',
        filePath: 'src/high.ts',
        line: 20
      }
    ],
    hotspots: []
  };

  const standalone = buildGradeDPrompt(mockReport);
  assert.ok(standalone.startsWith('Act as a Principal Systems Architect. Refactor'));

  const subSection = buildGradeDPrompt(mockReport, { isSubSection: true });
  assert.ok(subSection.startsWith('Refactor'));
  assert.ok(!subSection.includes('Act as a Principal Systems Architect.'));
});

test('buildGradeCPrompt: respects isSubSection option', () => {
  const mockReport = {
    violations: [
      {
        severity: 'MEDIUM',
        pillar: 'Test Pillar',
        message: 'Medium severity issue',
        filePath: 'src/medium.ts',
        line: 30
      }
    ],
    hotspots: []
  };

  const standalone = buildGradeCPrompt(mockReport);
  assert.ok(standalone.startsWith('Act as a Senior Frontend Engineer. Refactor'));

  const subSection = buildGradeCPrompt(mockReport, { isSubSection: true });
  assert.ok(subSection.startsWith('Refactor'));
  assert.ok(!subSection.includes('Act as a Senior Frontend Engineer.'));
});

test('buildGradeBPrompt: respects isSubSection option', () => {
  const mockReport = {
    violations: [
      {
        severity: 'LOW',
        pillar: 'Test Pillar',
        message: 'Low severity issue',
        filePath: 'src/low.ts',
        line: 40
      }
    ],
    hotspots: []
  };

  const standalone = buildGradeBPrompt(mockReport);
  assert.ok(standalone.startsWith('Act as a Clean Code Specialist. Clean up'));

  const subSection = buildGradeBPrompt(mockReport, { isSubSection: true });
  assert.ok(subSection.startsWith('Clean up'));
  assert.ok(!subSection.includes('Act as a Clean Code Specialist.'));
});

test('buildAiSlopPrompt: respects isSubSection option', () => {
  const mockReport = {
    violations: [
      {
        severity: 'LOW',
        pillar: 'Code Authenticity & Anti-Slop',
        message: 'Echo comment',
        filePath: 'src/slop.ts',
        line: 5,
        isAiSlop: true
      }
    ],
    hotspots: []
  };

  const standalone = buildAiSlopPrompt(mockReport);
  assert.ok(standalone.startsWith('Act as a Clean Code Specialist and Code Authenticity Guardian. Eliminate'));

  const subSection = buildAiSlopPrompt(mockReport, { isSubSection: true });
  assert.ok(subSection.startsWith('Eliminate'));
  assert.ok(!subSection.includes('Act as a Clean Code Specialist'));
});

test('buildHotspotsPrompt: respects isSubSection option', () => {
  const mockReport = {
    violations: [],
    hotspots: [
      {
        filePath: 'src/monolith.ts',
        lineCount: 1200,
        violationCount: 10,
        isMonolith: true,
        monolithTier: 'SEVERE'
      }
    ]
  };

  const standalone = buildHotspotsPrompt(mockReport);
  assert.ok(standalone.startsWith('Act as a Principal Systems Architect. Surgically decompose'));

  const subSection = buildHotspotsPrompt(mockReport, { isSubSection: true });
  assert.ok(subSection.startsWith('Surgically decompose'));
  assert.ok(!subSection.includes('Act as a Principal Systems Architect.'));
});

test('buildPillarPrompt: respects isSubSection option', () => {
  const mockReport = {
    violations: [
      {
        severity: 'HIGH',
        pillar: 'Control Flow & Self-Documenting Logic',
        message: 'Complex conditional',
        filePath: 'src/flow.ts',
        line: 15
      }
    ],
    hotspots: []
  };

  const standalone = buildPillarPrompt(mockReport, 'Control Flow & Self-Documenting Logic');
  assert.ok(standalone.startsWith('Act as a Principal Systems Architect. Surgically refactor'));

  const subSection = buildPillarPrompt(mockReport, 'Control Flow & Self-Documenting Logic', { isSubSection: true });
  assert.ok(subSection.startsWith('Surgically refactor'));
  assert.ok(!subSection.includes('Act as a Principal Systems Architect.'));
});

test('buildMasterPrompt: has single top-level role preamble and no repeated Act as persona statements', () => {
  const mockReport = {
    violations: [
      {
        severity: 'CRITICAL',
        pillar: 'Pillar 1',
        message: 'Critical error',
        filePath: 'src/critical.ts',
        line: 1
      },
      {
        severity: 'HIGH',
        pillar: 'Pillar 2',
        message: 'High error',
        filePath: 'src/high.ts',
        line: 2
      },
      {
        severity: 'MEDIUM',
        pillar: 'Pillar 3',
        message: 'Medium error',
        filePath: 'src/medium.ts',
        line: 3
      },
      {
        severity: 'LOW',
        pillar: 'Pillar 4',
        message: 'Low error',
        filePath: 'src/low.ts',
        line: 4
      },
      {
        severity: 'LOW',
        pillar: 'Pillar 5',
        message: 'AI slop echo',
        filePath: 'src/slop.ts',
        line: 5,
        isAiSlop: true
      }
    ],
    hotspots: [
      {
        filePath: 'src/monolith.ts',
        lineCount: 2200,
        violationCount: 15,
        isMonolith: true,
        monolithTier: 'EXTREME'
      }
    ]
  };

  const prompt = buildMasterPrompt(mockReport);
  assert.ok(prompt.startsWith('Act as a Principal Systems Architect. Execute a phased architectural refactoring'));

  // Ensure "Act as" occurs exactly once in the entire composite prompt
  const matches = prompt.match(/Act as\b/g) || [];
  assert.strictEqual(matches.length, 1, `Expected exactly 1 "Act as", found ${matches.length}`);

  // Ensure refactoring commands section occurs exactly once
  const commandMatches = prompt.match(/### AI AGENT DISCOVERY & REFACTORING COMMANDS:/g) || [];
  assert.strictEqual(commandMatches.length, 1, `Expected exactly 1 refactoring commands section, found ${commandMatches.length}`);
});

test('deduplicateRefactoringCommands: collapses multiple occurrences to single block', () => {
  const header = '### AI AGENT DISCOVERY & REFACTORING COMMANDS:';
  const input = [
    'Section 1 content',
    header,
    '- Command A',
    '---',
    'Section 2 content',
    header,
    '- Command B'
  ].join('\n');

  const result = deduplicateRefactoringCommands(input);
  const matches = result.match(/### AI AGENT DISCOVERY & REFACTORING COMMANDS:/g) || [];
  assert.strictEqual(matches.length, 1);
  assert.ok(result.includes('Section 1 content'));
  assert.ok(result.includes('Section 2 content'));
  assert.ok(result.includes('- Command B'));
});
