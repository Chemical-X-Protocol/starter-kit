import test from 'node:test';
import assert from 'node:assert/strict';
import { generateAstOutline } from './reader.js';

const CPP = `
#include <memory>
namespace audio {
struct FrameHeader { uint32_t size; };
class StreamDecoder : public IDecoder {
public:
    bool DecodeFrame(const FrameHeader& header);
};
}
`;

const PY = `
import os

class ConsentService:
    def revoke(self, user_id):
        return True

def helper(x):
    return x
`;

test('outline: renders C++ declarations instead of an empty header', () => {
  const out = generateAstOutline(CPP, 'src/audio/StreamDecoder.cpp');
  const body = out.split('\n').filter((l) => !l.startsWith('// Outline:'));
  assert.ok(body.length > 0, `expected symbols, got only the header:\n${out}`);
  assert.ok(out.includes('StreamDecoder'), `expected StreamDecoder in:\n${out}`);
  assert.ok(out.includes('FrameHeader'), `expected FrameHeader in:\n${out}`);
});

test('outline: renders Python declarations instead of an empty header', () => {
  const out = generateAstOutline(PY, 'services/consent.py');
  const body = out.split('\n').filter((l) => !l.startsWith('// Outline:'));
  assert.ok(body.length > 0, `expected symbols, got only the header:\n${out}`);
  assert.ok(out.includes('ConsentService'), `expected ConsentService in:\n${out}`);
});

test('outline: still renders JavaScript exports unchanged', () => {
  const js = `export const FOO = 1;\nexport function bar(a) { return a; }\n`;
  const out = generateAstOutline(js, 'cli/thing.js');
  assert.ok(out.includes('FOO'), out);
  assert.ok(out.includes('bar'), out);
});
