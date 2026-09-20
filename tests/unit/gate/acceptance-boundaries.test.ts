import { describe, expect, it } from 'vitest';
import { evaluateGate } from '../../../packages/core/src/domain/evaluate-gate.js';
import { createCheckFact, createGateInput } from '../../support/factories.js';

const evaluate = (input: ReturnType<typeof createGateInput>) => {
  const before = structuredClone(input);
  const result = evaluateGate(input);
  expect(input).toEqual(before); // 判定不能修改原始事实
  return result;
};

describe('StackGate mandatory acceptance boundaries', () => {
  it('允许完整、当前且受确认的必检证据', () => {
    expect(evaluate(createGateInput())).toMatchObject({
      verdict: 'PASS', freshness: 'FRESH', decision: 'ALLOW', exit_code: 0,
    });
  });

  it('JUnit进程为0但执行用例为0不能通过', () => {
    const check = createCheckFact({
      executed_test_ids: [], discovered_tests: 0, executed_tests: 0,
    });
    expect(evaluate(createGateInput({ checks: [check] }))).toMatchObject({
      verdict: 'INCOMPLETE', decision: 'DENY', exit_code: 2,
    });
  });

  it('真正的类型检查不因没有testcase被误拒', () => {
    const check = createCheckFact({
      check_id: 'typecheck', result_kind: 'exit-code',
      expected_test_ids: [], executed_test_ids: [],
      discovered_tests: 0, executed_tests: 0,
    });
    expect(evaluate(createGateInput({
      checks: [check], required_check_ids: ['typecheck'],
    }))).toMatchObject({ decision: 'ALLOW', exit_code: 0 });
  });

  it('缺失必检ID，即使其他测试通过也不允许', () => {
    expect(evaluate(createGateInput({
      required_check_ids: ['unit', 'e2e'],
    }))).toMatchObject({ verdict: 'INCOMPLETE', decision: 'DENY', exit_code: 2 });
  });

  it('空必检集合不能使用every空数组的真值获得通过', () => {
    expect(evaluate(createGateInput({
      checks: [], required_check_ids: [],
    }))).toMatchObject({ verdict: 'INCOMPLETE', decision: 'DENY', exit_code: 2 });
  });

  it('已变更的输入使历史PASS不能继续允许', () => {
    expect(evaluate(createGateInput({ freshness: 'STALE' }))).toMatchObject({
      verdict: 'PASS', freshness: 'STALE', decision: 'DENY', exit_code: 4,
    });
  });

  it('损坏报告优先于过期和业务失败', () => {
    expect(evaluate(createGateInput({
      checks: [createCheckFact({ status: 'FAIL', exit_code: 1 })],
      report_integrity: 'INVALID', freshness: 'STALE',
    }))).toMatchObject({ verdict: 'ERROR', decision: 'DENY', exit_code: 3 });
  });

  it('配置无效的出口优先于内部错误', () => {
    expect(evaluate(createGateInput({
      configuration_valid: false, fatal_error: true,
    }))).toMatchObject({ decision: 'DENY', exit_code: 64 });
  });

  it('重试后通过仍保留flaky并默认不完整', () => {
    expect(evaluate(createGateInput({
      checks: [createCheckFact({ flaky_tests: 1 })],
    }))).toMatchObject({ verdict: 'INCOMPLETE', decision: 'DENY', exit_code: 2 });
  });

  it('取消不消除已经发生的失败事实', () => {
    const input = createGateInput({
      canceled: true,
      checks: [createCheckFact({ status: 'FAIL', exit_code: 1 })],
    });
    expect(evaluate(input)).toMatchObject({
      verdict: 'INCOMPLETE', decision: 'DENY', exit_code: 2,
    });
    expect(input.checks[0]?.status).toBe('FAIL');
  });

  it('明确的可信策略拒绝不能被成功测试覆盖', () => {
    expect(evaluate(createGateInput({
      deterministic_denials: ['PROTECTED_INPUT_CHANGED'],
    }))).toMatchObject({ decision: 'DENY', exit_code: 1 });
  });
});
