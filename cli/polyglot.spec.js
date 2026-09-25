import test from 'node:test';
import assert from 'node:assert/strict';
import { auditCode } from './audit/rules.js';
import { resolveArchitectureTier, extractAstMetadata } from './search-ast.js';
import { isSourceFile, getLanguageForFile } from './languages.js';

test('polyglot: C# source file recognition and tier mapping', () => {
  assert.equal(isSourceFile('ConsentService.cs'), true);
  assert.equal(getLanguageForFile('ConsentService.cs').id, 'csharp');

  const serviceTier = resolveArchitectureTier('Services/ConsentService.cs');
  assert.equal(serviceTier, 'organism');

  const controllerTier = resolveArchitectureTier('Controllers/ConsentController.cs');
  assert.equal(controllerTier, 'view');

  const domainTier = resolveArchitectureTier('Domain/ConsentLedger.cs');
  assert.equal(domainTier, 'atom');

  const dtoTier = resolveArchitectureTier('Dtos/ConsentRequestDto.cs');
  assert.equal(dtoTier, 'type');
});

test('polyglot: extracts C# classes and using imports into AST metadata', () => {
  const csharpCode = `
using System;
using System.Threading.Tasks;
using MediatR;

namespace Nadena.Services;

public class ConsentRevocationHandler : IRequestHandler<RevokeConsentCommand, Result>
{
    public async Task<Result> Handle(RevokeConsentCommand request)
    {
        return Result.Success();
    }
}
`;

  const meta = extractAstMetadata(csharpCode, 'Services/ConsentRevocationHandler.cs');
  assert.ok(meta.symbols.some((s) => s.name === 'ConsentRevocationHandler'));
  assert.ok(meta.imports.some((i) => i.sourceModule === 'MediatR'));
});

test('polyglot: audits C# code for mock data, slop catch, and fake green assertions without syntax errors', () => {
  const dirtyCSharp = `
using System;
using Xunit;

public class SimulatedConsentService
{
    public void Execute()
    {
        var email = "user@example.com";
        try
        {
            // Do work
        }
        catch (Exception)
        {
        }
    }

    [Fact]
    public void Test_Fake_Green()
    {
        Assert.True(true);
    }
}
`;

  const violations = auditCode(dirtyCSharp, 'Services/SimulatedConsentService.cs', 'Services/SimulatedConsentService.cs');

  // Must NOT emit SYNTAX_PARSE_ERROR on C#
  const hasSyntaxError = violations.some((v) => v.rule === 'SYNTAX_PARSE_ERROR');
  assert.equal(hasSyntaxError, false, 'C# code must not trigger Babel SYNTAX_PARSE_ERROR');

  // Must detect Synthetic Mock Data
  const hasMockData = violations.some((v) => v.rule === 'SYNTHETIC_MOCK_DATA');
  assert.equal(hasMockData, true, 'Must detect user@example.com in C# code');

  // Must detect Shallow Catch
  const hasShallowCatch = violations.some((v) => v.rule === 'AI_SLOP_SHALLOW_CATCH');
  assert.equal(hasShallowCatch, true, 'Must detect empty catch (Exception) in C#');

  // Must detect Fake Green Assertion
  const hasFakeGreen = violations.some((v) => v.rule === 'TEST_FAKE_GREEN');
  assert.equal(hasFakeGreen, true, 'Must detect Assert.True(true) in C# test');
});

test('polyglot: audits Python and Go without syntax errors and flags polyglot rules', () => {
  const pythonCode = `
def test_something():
    assert True
`;
  const pyViolations = auditCode(pythonCode, 'tests/test_flow.py', 'tests/test_flow.py');
  assert.equal(pyViolations.some((v) => v.rule === 'SYNTAX_PARSE_ERROR'), false);
  assert.equal(pyViolations.some((v) => v.rule === 'TEST_FAKE_GREEN'), true);

  const goCode = `
package main
import "testing"
func TestDummy(t *testing.T) {
    var email = "fake@example.com"
}
`;
  const goViolations = auditCode(goCode, 'pkg/service/service.go', 'pkg/service/service.go');
  assert.equal(goViolations.some((v) => v.rule === 'SYNTAX_PARSE_ERROR'), false);
  assert.equal(goViolations.some((v) => v.rule === 'SYNTHETIC_MOCK_DATA'), true);
});
