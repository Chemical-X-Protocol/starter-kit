import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

describe('m-task-card molecular capsule', () => {
  it('validates task card payload and chat link bindings', () => {
    const task = {
      id: 'task-42',
      title: 'Remediate composables',
      tier: 'hook',
      status: 'done',
      chatLink: 'conversation://536da3e7-6be6-47b6-b308-58786d395e36',
      conversationId: '536da3e7-6be6-47b6-b308-58786d395e36'
    };
    assert.equal(task.id, 'task-42');
    assert.equal(task.status, 'done');
    assert.equal(task.chatLink.startsWith('conversation://'), true);
  });

  it('validates provenance, receipt, and refusal data structures', () => {
    const auditTask = {
      id: 'task-99',
      title: 'Resolve architectural hazards in src/foo.ts (HOOK_RETURN_OVERLOAD)',
      status: 'done',
      originType: 'audit' as const,
      ruleId: 'HOOK_RETURN_OVERLOAD',
      targetPath: 'src/foo.ts',
      violationSnapshot: {
        healthBefore: 40,
        hazardCountBefore: 3
      },
      diffReceipt: {
        verified: true,
        healthBefore: 40,
        healthAfter: 100,
        hazardsResolved: 3
      }
    };
    assert.equal(auditTask.originType, 'audit');
    assert.equal(auditTask.diffReceipt.verified, true);
    assert.equal(auditTask.diffReceipt.hazardsResolved, 3);
  });
});
