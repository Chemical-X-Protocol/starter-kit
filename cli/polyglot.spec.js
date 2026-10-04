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

test('polyglot: extracts C++ classes, structs, functions and includes', () => {
  const cppCode = `
#include <memory>
#include "vendor/codec.h"

namespace audio {

struct FrameHeader {
    uint32_t size;
};

enum class Codec { Opus, Flac };

class StreamDecoder : public IDecoder {
public:
    bool DecodeFrame(const FrameHeader& header);
};

bool StreamDecoder::DecodeFrame(const FrameHeader& header) {
    return header.size > 0;
}

}  // namespace audio
`;

  const meta = extractAstMetadata(cppCode, 'src/audio/StreamDecoder.cpp');
  const names = meta.symbols.map((s) => s.name);
  assert.ok(names.includes('StreamDecoder'), 'must extract class StreamDecoder');
  assert.ok(names.includes('FrameHeader'), 'must extract struct FrameHeader');
  assert.ok(names.includes('Codec'), 'must extract enum class Codec');
  assert.ok(names.includes('DecodeFrame'), 'must extract method DecodeFrame');
  assert.ok(meta.imports.some((i) => i.sourceModule === 'vendor/codec.h'), 'must map #include to imports');
  assert.ok(meta.imports.some((i) => i.sourceModule === 'memory'), 'must map angle-bracket includes');
});

test('polyglot: audits C++ without Babel syntax errors', () => {
  const cppCode = `
#include <string>
void Connect() {
    std::string email = "user@example.com";
}
`;
  const violations = auditCode(cppCode, 'src/net/Client.cpp', 'src/net/Client.cpp');
  assert.equal(violations.some((v) => v.rule === 'SYNTAX_PARSE_ERROR'), false, 'C++ must not trigger Babel SYNTAX_PARSE_ERROR');
  assert.equal(violations.some((v) => v.rule === 'SYNTHETIC_MOCK_DATA'), true, 'must detect placeholder email in C++');
});

test('polyglot: extracts Rust items and use imports', () => {
  const rustCode = `
use std::sync::Arc;

pub struct Decoder {
    buffer: Vec<u8>,
}

pub enum State { Idle, Running }

pub trait Sink {
    fn write(&self, data: &[u8]);
}

impl Decoder {
    pub fn new() -> Self { Decoder { buffer: Vec::new() } }
}
`;
  const meta = extractAstMetadata(rustCode, 'src/decoder.rs');
  const names = meta.symbols.map((s) => s.name);
  assert.ok(names.includes('Decoder'), 'must extract pub struct');
  assert.ok(names.includes('State'), 'must extract pub enum');
  assert.ok(names.includes('Sink'), 'must extract pub trait');
  assert.ok(names.includes('new'), 'must extract fn');
  assert.ok(meta.imports.some((i) => i.sourceModule === 'std::sync::Arc'), 'must map use statements');
});

test('polyglot: extracts Kotlin declarations and imports', () => {
  const kotlinCode = `
import kotlinx.coroutines.flow.Flow

class ConsentRepository(private val api: Api) {
    fun observe(): Flow<List<Consent>> = api.stream()
}

data class Consent(val id: String)

object Registry {
    fun lookup(id: String) = id
}
`;
  const meta = extractAstMetadata(kotlinCode, 'src/main/kotlin/ConsentRepository.kt');
  const names = meta.symbols.map((s) => s.name);
  assert.ok(names.includes('ConsentRepository'), 'must extract class');
  assert.ok(names.includes('Consent'), 'must extract data class');
  assert.ok(names.includes('Registry'), 'must extract object');
  assert.ok(names.includes('observe'), 'must extract fun');
  assert.ok(meta.imports.some((i) => i.sourceModule === 'kotlinx.coroutines.flow.Flow'), 'must map kotlin imports');
});

test('polyglot: declaration keywords never leak in as symbol names', () => {
  const cppCode = `
enum class Codec { Opus, Flac };
struct Frame { int size; };
namespace audio { }
`;
  const meta = extractAstMetadata(cppCode, 'src/audio/Codec.h');
  const names = meta.symbols.map((s) => s.name);
  assert.equal(names.includes('class'), false, 'bare "class" must not be extracted as a symbol');
  assert.equal(names.includes('struct'), false, 'bare "struct" must not be extracted as a symbol');
  assert.ok(names.includes('Codec'));
  assert.ok(names.includes('Frame'));
});
