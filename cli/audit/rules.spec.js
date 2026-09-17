import test from "node:test";
import assert from "node:assert";
import { auditCode } from "./rules.js";

test("Audit Rules: flags repetitive dispatch switch statement as CONTROL_FLOW_DISPATCH_SWITCH", () => {
  const code = `
export const resolveColor = (type) => {
  switch (type) {
    case "primary":
      return "blue";
    case "secondary":
      return "gray";
    case "danger":
      return "red";
    case "warning":
      return "yellow";
    default:
      return "white";
  }
};
`;

  const violations = auditCode(code, "src/utils/colors.js", "src/utils/colors.js");
  const dispatchViolation = violations.find((v) => v.rule === "CONTROL_FLOW_DISPATCH_SWITCH");
  assert.ok(dispatchViolation, "Expected CONTROL_FLOW_DISPATCH_SWITCH violation");
  assert.strictEqual(dispatchViolation.severity, "MEDIUM");
  assert.ok(dispatchViolation.hazard.includes("Dispatch switch smell detected"));
});

test("Audit Rules: does NOT flag non-dispatch complex switch statements", () => {
  const code = `
export const processOrder = (status, order) => {
  switch (status) {
    case "pending": {
      validatePayment(order);
      sendNotification(order.userId);
      return queueForFulfillment(order);
    }
    case "completed": {
      archiveOrder(order);
      emitAnalytics("order_completed", order);
      break;
    }
    default:
      throw new Error("Invalid status");
  }
};
`;

  const violations = auditCode(code, "src/order.js", "src/order.js");
  const dispatchViolation = violations.find((v) => v.rule === "CONTROL_FLOW_DISPATCH_SWITCH");
  assert.strictEqual(dispatchViolation, undefined, "Complex switch should not be flagged as dispatch smell");
});

test("Audit Rules: clean keyed map implementation produces 0 violations", () => {
  const code = `
const COLOR_MAP = {
  primary: "blue",
  secondary: "gray",
  danger: "red",
  warning: "yellow"
};

export const resolveColor = (type) => {
  return Object.prototype.hasOwnProperty.call(COLOR_MAP, type) ? COLOR_MAP[type] : "white";
};
`;

  const violations = auditCode(code, "src/utils/colors.js", "src/utils/colors.js");
  const dispatchViolation = violations.find((v) => v.rule === "CONTROL_FLOW_DISPATCH_SWITCH");
  assert.strictEqual(dispatchViolation, undefined);
});
